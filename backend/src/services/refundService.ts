import type { PoolClient } from 'pg';
import { pool } from '../config/database';
import { createRefund, paymongoRequest, PayMongoRefundReason } from './paymongoService';
import { notificationService } from './notificationService';
import { UNPAYABLE_BOOKING_STATUSES, LATE_PAYMENT_PREFIX } from './walletService';

/**
 * Unwinding the money when a booking is cancelled.
 *
 * Cancelling used to be a pure status change. PUT /bookings/:id and DELETE /bookings/:id
 * both let either party cancel an 'accepted' or 'confirmed' booking, and neither looked at
 * whether it had been paid for - so a client could pay, the provider could cancel, and the
 * client's money would stay in that provider's pending_balance forever: never refunded,
 * because nothing here called PayMongo, and never released either, since release only
 * happens on completion. The only refund path in the codebase was dispute resolution,
 * which an admin has to drive by hand.
 *
 * The policy this implements is a full refund. The shoot has not happened, so there is
 * nothing for anyone to be paid for, and splitting the money would mean inventing a
 * cancellation-fee policy that does not exist anywhere else in this system. Partial
 * settlements remain what the dispute flow is for.
 *
 * Deliberately NOT a refactor of that dispute flow. It computes percentages, reverses cash
 * commission proportionally and reconciles a short pending_balance, and folding both into
 * one function would mean rewriting the one money path that currently works in order to fix
 * one that does not. The shapes are close enough that dispute resolution can adopt this
 * later; that is a separate change with its own testing.
 */

/** A payment is mid-capture, so what the booking is owed is not yet knowable. */
export class PaymentInFlightError extends Error {
  constructor() {
    super('A payment for this booking is currently being processed.');
    this.name = 'PaymentInFlightError';
  }
}

/** PayMongo refused or could not be reached. The caller must roll back and not cancel. */
export class RefundGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefundGatewayError';
  }
}

export interface CancellationSettlement {
  /** 'none' when the booking was never paid for and there was nothing to unwind. */
  paymentMethod: 'online' | 'cash' | 'none';
  /** Sent back through PayMongo. Always the gross the client paid, never the net. */
  refundedToClient: number;
  /** Taken back out of the provider's pending_balance. */
  escrowReversed: number;
  /** Set when pending_balance held less than the escrow - see the note below. */
  escrowShortfall: number;
  /** Cash only: platform commission handed back to the provider. */
  commissionReversed: number;
  /** Cash only: what the provider has to return to the client themselves. */
  manualRefundRequired: number;
  paymongoRefundId: string | null;
  paymongoRefundStatus: string | null;
}

const EMPTY_SETTLEMENT: CancellationSettlement = {
  paymentMethod: 'none',
  refundedToClient: 0,
  escrowReversed: 0,
  escrowShortfall: 0,
  commissionReversed: 0,
  manualRefundRequired: 0,
  paymongoRefundId: null,
  paymongoRefundStatus: null,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Unwinds whatever money a cancelled booking is carrying.
 *
 * Must be called inside an open transaction, with the booking row already locked, and
 * BEFORE the caller commits. Every failure mode throws rather than returning a partial
 * result, so an unrefundable booking never ends up cancelled: the caller's rollback takes
 * the status change with it and the booking stays exactly as it was, ready to retry.
 *
 * Ordering matters. The PayMongo call happens first, while nothing is committed - if it
 * fails, nothing has moved. The reverse order would leave the wallet debited for a refund
 * that never reached the client.
 */
export async function settleCancelledBooking(
  dbClient: PoolClient,
  opts: {
    bookingId: string;
    providerUserId: string;
    /** Shown on the PayMongo refund and in the wallet ledger. */
    reason: string;
    /** Who asked. Only changes the refund reason code PayMongo records. */
    cancelledBy: 'client' | 'provider' | 'admin';
  }
): Promise<CancellationSettlement> {
  const { bookingId, providerUserId, reason, cancelledBy } = opts;

  // Lock every payment row this booking has. `unique_booking_payment` means there is at
  // most one - create-intent updates that row in place across retries rather than adding
  // to it - but the ordering costs nothing and keeps this correct on purpose rather than
  // by relying on a constraint declared in another file.
  const paymentsRes = await dbClient.query(
    `SELECT id, status, gross_amount, net_provider_amount, commission_amount,
            payment_method_type, paymongo_payment_id, paymongo_payment_intent_id
     FROM payments
     WHERE booking_id::text = $1
     ORDER BY CASE status WHEN 'succeeded' THEN 0 ELSE 1 END, created_at DESC
     FOR UPDATE`,
    [bookingId]
  );

  // A card is attached and PayMongo may be capturing right now. Whichever way that lands,
  // it lands after this transaction - and settlePaymentSuccess does not check booking
  // status, so cancelling now would credit escrow against a cancelled booking moments
  // later. expireUnpaidBookings already backs off for exactly this reason; do the same
  // and let the caller tell the user to try again shortly.
  if (paymentsRes.rows.some((p) => String(p.status) === 'processing')) {
    throw new PaymentInFlightError();
  }

  const settled = paymentsRes.rows.find((p) => String(p.status) === 'succeeded');

  if (!settled) {
    // Nothing was ever captured. Any intent still open is now dead, and leaving it open
    // would let create-intent's "reuse the most recent open attempt" branch hand the same
    // intent back. Mirrors the same cleanup in expireUnpaidBookings.
    await dbClient.query(
      `UPDATE payments
       SET status = 'cancelled',
           failure_reason = COALESCE(failure_reason, $2),
           updated_at = CURRENT_TIMESTAMP
       WHERE booking_id::text = $1 AND status IN ('pending', 'processing')`,
      [bookingId, 'Booking was cancelled before payment was completed']
    );
    return { ...EMPTY_SETTLEMENT };
  }

  const gross = round2(parseFloat(settled.gross_amount) || 0);
  const net = round2(parseFloat(settled.net_provider_amount) || 0);
  const commission = round2(parseFloat(settled.commission_amount) || 0);
  const isCash = String(settled.payment_method_type || '') === 'cash';

  if (isCash) {
    // The platform never held this money - the client handed it to the provider on the
    // day - so there is nothing here to send back. What the platform CAN do is give up the
    // commission it charged for a booking that is not happening; keeping a cut of a
    // cancelled shoot would mean profiting from the cancellation. The client gets their
    // cash back from the provider directly, and the caller surfaces that figure.
    let commissionReversed = 0;

    if (commission > 0) {
      const wallet = await lockOrCreateWallet(dbClient, providerUserId);
      const currentAvailable = parseFloat(wallet.available_balance) || 0;
      const newAvailable = round2(currentAvailable + commission);

      await dbClient.query(
        `UPDATE wallets SET available_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id::text = $2`,
        [newAvailable, String(wallet.id)]
      );

      await dbClient.query(
        `INSERT INTO transactions (wallet_id, payment_id, type, amount, balance_after, reference_id, description)
         VALUES ($1, $2, 'adjustment', $3, $4, $5, $6)`,
        [
          String(wallet.id),
          String(settled.id),
          commission,
          newAvailable,
          `cancel_cash_commission_reversal_${bookingId}`,
          `Platform commission reversed after cash booking #${bookingId} was cancelled: ${reason}`,
        ]
      );

      commissionReversed = commission;
    }

    await dbClient.query(
      `UPDATE payments
       SET status = 'refunded',
           refunded_amount = $2,
           refunded_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id::text = $1`,
      [String(settled.id), gross]
    );

    return {
      paymentMethod: 'cash',
      refundedToClient: 0,
      escrowReversed: 0,
      escrowShortfall: 0,
      commissionReversed,
      manualRefundRequired: gross,
      paymongoRefundId: null,
      paymongoRefundStatus: null,
    };
  }

  // ---- Online payment: refund first, move balances second. ----

  let refundId: string | null = null;
  let refundStatus: string | null = null;

  if (gross > 0) {
    try {
      let paymongoPaymentId: string | null = settled.paymongo_payment_id || null;

      if (!paymongoPaymentId && settled.paymongo_payment_intent_id) {
        // Payments captured before paymongo_payment_id was recorded can still be refunded;
        // the id is readable off the intent. Same self-heal the dispute path does.
        const intentRes = await paymongoRequest(
          `/payment_intents/${settled.paymongo_payment_intent_id}`,
          'GET'
        );
        paymongoPaymentId = intentRes.data.attributes.payments?.[0]?.id || null;
      }

      if (!paymongoPaymentId) {
        throw new Error(
          'No PayMongo payment ID on file for this payment, so it cannot be refunded ' +
          'automatically. Refund it from the PayMongo dashboard, then cancel the booking.'
        );
      }

      // Deterministic per booking: a retry after a network failure returns the refund
      // PayMongo already created rather than issuing a second one.
      const reasonCode: PayMongoRefundReason =
        cancelledBy === 'client' ? 'requested_by_customer' : 'others';

      const refundRes = await createRefund(
        paymongoPaymentId,
        Math.round(gross * 100),
        reasonCode,
        `Booking #${bookingId} cancelled: ${reason}`,
        `cancel_refund_${bookingId}`
      );

      refundId = refundRes.data.id;
      refundStatus = refundRes.data.attributes.status;
    } catch (refundError: any) {
      throw new RefundGatewayError(refundError?.message || 'PayMongo refund failed');
    }
  }

  // Take the escrow back out of pending_balance. Clamped to what is actually held, for the
  // same reason releaseEscrow clamps: crediting or debiting a figure the wallet never
  // received invents value. A shortfall means the escrow credit for this payment is
  // missing, which is a bug worth shouting about rather than silently absorbing.
  const wallet = await lockOrCreateWallet(dbClient, providerUserId);
  const currentPending = parseFloat(wallet.pending_balance) || 0;
  const currentAvailable = parseFloat(wallet.available_balance) || 0;

  const escrowReversed = Math.min(net, currentPending);
  const escrowShortfall = round2(net - escrowReversed);

  if (escrowShortfall > 0) {
    console.error(
      `[settleCancelledBooking] SHORTFALL: booking ${bookingId} / payment ${settled.id} ` +
      `expected to reverse ${net} out of provider ${providerUserId}'s pending_balance but ` +
      `only ${currentPending} was held. Reversed ${escrowReversed}, short by ${escrowShortfall}. ` +
      `The client has still been refunded ${gross} in full - investigate the missing escrow credit.`
    );
  }

  if (escrowReversed > 0) {
    await dbClient.query(
      `UPDATE wallets
       SET pending_balance = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id::text = $2`,
      [round2(currentPending - escrowReversed), String(wallet.id)]
    );
  }

  // Negative amount: money leaving the provider's side of the ledger. balance_after is
  // available_balance, which this does not touch - the reversal comes out of pending.
  await dbClient.query(
    `INSERT INTO transactions (wallet_id, payment_id, type, amount, balance_after, reference_id, description)
     VALUES ($1, $2, 'refund', $3, $4, $5, $6)`,
    [
      String(wallet.id),
      String(settled.id),
      -escrowReversed,
      round2(currentAvailable),
      `cancel_refund_${bookingId}`,
      `Escrow returned to the client after booking #${bookingId} was cancelled: ${reason}`,
    ]
  );

  await dbClient.query(
    `UPDATE payments
     SET status = 'refunded',
         paymongo_refund_id = $2,
         refund_status = $3,
         refunded_amount = $4,
         refunded_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id::text = $1`,
    [String(settled.id), refundId, refundStatus, gross]
  );

  return {
    paymentMethod: 'online',
    refundedToClient: gross,
    escrowReversed,
    escrowShortfall,
    commissionReversed: 0,
    manualRefundRequired: 0,
    paymongoRefundId: refundId,
    paymongoRefundStatus: refundStatus,
  };
}

/**
 * The provider's wallet row, locked, created at zero if it does not exist yet.
 *
 * Uses the caller's transaction rather than the pool, so the row this locks is the row the
 * caller goes on to update, and an abandoned transaction leaves no wallet behind.
 */
async function lockOrCreateWallet(dbClient: PoolClient, providerUserId: string) {
  const existing = await dbClient.query(
    `SELECT id, pending_balance, available_balance FROM wallets WHERE provider_id::text = $1 FOR UPDATE`,
    [providerUserId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const created = await dbClient.query(
    `INSERT INTO wallets (provider_id, available_balance, pending_balance)
     VALUES ($1, 0, 0)
     ON CONFLICT (provider_id) DO NOTHING
     RETURNING id, pending_balance, available_balance`,
    [providerUserId]
  );
  if (created.rows[0]) return created.rows[0];

  // Lost the insert race to a concurrent transaction that has since committed.
  const reread = await dbClient.query(
    `SELECT id, pending_balance, available_balance FROM wallets WHERE provider_id::text = $1 FOR UPDATE`,
    [providerUserId]
  );
  return reread.rows[0];
}

export type LatePaymentRefundOutcome = 'refunded' | 'not_needed' | 'failed';

/**
 * Sends back a payment that arrived after its booking was cancelled or rejected.
 *
 * settlePaymentSuccess refuses to credit such a payment and reports it as
 * `bookingUnpayable`; this is what the caller does next. Refunding is the only sensible
 * outcome - there is no booking left to deliver - and it is done automatically because the
 * alternative is client money sitting with the platform until someone happens to notice.
 *
 * Opens its own transaction rather than joining the caller's, and must be called AFTER the
 * caller has committed. The 'succeeded, uncredited' state has to be durable before the
 * PayMongo call: if the refund then fails, the payment is still on record, still refusing
 * to be credited, and findable for a retry - instead of rolled back to 'processing' as if
 * the money had never come in.
 *
 * Never throws. A failure is logged loudly, admins are told (unless `alertAdmins` is false,
 * for a retry loop that has already told them), and 'failed' is returned.
 */
export async function refundLatePayment(
  paymentId: string,
  opts: { alertAdmins?: boolean } = {}
): Promise<LatePaymentRefundOutcome> {
  const alertAdmins = opts.alertAdmins !== false;
  const dbClient = await pool.connect();
  let context: { bookingId?: string; clientId?: string; gross?: number } = {};

  try {
    await dbClient.query('BEGIN');

    // Re-checked under the lock, not trusted from the caller: by now another path may have
    // refunded it already, or (in principle) the booking may have been reinstated.
    const res = await dbClient.query(
      `SELECT p.id, p.booking_id, p.client_id, p.status, p.wallet_credited_at, p.gross_amount, p.failure_reason,
              p.paymongo_payment_id, p.paymongo_payment_intent_id, b.status AS booking_status
       FROM payments p
       LEFT JOIN bookings b ON b.id::text = p.booking_id::text
       WHERE p.id::text = $1
       FOR UPDATE OF p`,
      [paymentId]
    );
    const row = res.rows[0];
    const bookingDead = !row?.booking_status || UNPAYABLE_BOOKING_STATUSES.includes(String(row.booking_status));

    // The LATE_PAYMENT tag is required, not just the shape: settlePaymentSuccess sets it when
    // it refuses to credit a payment, so only payments this code saw arrive late qualify.
    const taggedLate = String(row?.failure_reason || '').startsWith(LATE_PAYMENT_PREFIX);

    if (!row || String(row.status) !== 'succeeded' || row.wallet_credited_at || !bookingDead || !taggedLate) {
      await dbClient.query('ROLLBACK');
      return 'not_needed';
    }

    const gross = round2(parseFloat(row.gross_amount) || 0);
    context = { bookingId: String(row.booking_id), clientId: String(row.client_id), gross };

    let paymongoPaymentId: string | null = row.paymongo_payment_id || null;
    if (!paymongoPaymentId && row.paymongo_payment_intent_id) {
      const intentRes = await paymongoRequest(`/payment_intents/${row.paymongo_payment_intent_id}`, 'GET');
      paymongoPaymentId = intentRes.data.attributes.payments?.[0]?.id || null;
    }
    if (!paymongoPaymentId) {
      throw new Error('No PayMongo payment ID could be found for this payment.');
    }

    // Keyed on our payment row: a retry - from the sweep, or a webhook redelivery racing a
    // /confirm - gets back the refund PayMongo already made instead of refunding twice.
    // Distinct from cancel_refund_<booking> so the two flows can never collide on a key.
    const refundRes = await createRefund(
      paymongoPaymentId,
      Math.round(gross * 100),
      'others',
      `Booking #${row.booking_id} was ${row.booking_status || 'removed'} before this payment arrived`,
      `late_payment_refund_${row.id}`
    );

    // No wallet movement: settlePaymentSuccess never credited this, so there is nothing in
    // the provider's escrow to take back. Moving to 'refunded' is also what stops any later
    // settle attempt - its claim requires status = 'succeeded'.
    await dbClient.query(
      `UPDATE payments
       SET status = 'refunded',
           paymongo_refund_id = $2,
           refund_status = $3,
           refunded_amount = $4,
           refunded_at = CURRENT_TIMESTAMP,
           failure_reason = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id::text = $1`,
      [
        String(row.id),
        refundRes.data.id,
        refundRes.data.attributes.status,
        gross,
        'Paid after the booking was cancelled or rejected - refunded automatically',
      ]
    );
    await dbClient.query(
      `UPDATE bookings SET payment_status = 'refunded', updated_at = CURRENT_TIMESTAMP WHERE id::text = $1`,
      [String(row.booking_id)]
    );

    await dbClient.query('COMMIT');
    console.log(`Late payment ${row.id} for booking ${row.booking_id} refunded (PHP ${gross}, refund ${refundRes.data.id}).`);

    try {
      await notificationService.notifySystem(
        String(row.client_id),
        'Payment refunded',
        `Your payment of PHP ${gross.toLocaleString()} arrived after booking #${row.booking_id} was ` +
          `no longer active, so it has been refunded in full. Refunds can take 5-10 banking days to appear.`,
        { booking_id: row.booking_id, payment_id: row.id, amount: gross }
      );
    } catch (notifError) {
      console.error('Failed to notify client of late-payment refund:', notifError);
    }

    return 'refunded';
  } catch (error: any) {
    try {
      await dbClient.query('ROLLBACK');
    } catch {
      /* no transaction open */
    }
    // Keep the tag (so the sweep retries it) but record why the last attempt failed.
    try {
      await pool.query(
        `UPDATE payments SET failure_reason = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $1 AND status = 'succeeded' AND failure_reason LIKE $3`,
        [paymentId, `${LATE_PAYMENT_PREFIX}_REFUND_FAILED: ${String(error?.message || 'unknown').slice(0, 400)}`, `${LATE_PAYMENT_PREFIX}%`]
      );
    } catch {
      /* the log line below is the record of last resort */
    }
    console.error(
      `[refundLatePayment] FAILED to refund payment ${paymentId} (booking ${context.bookingId ?? 'unknown'}, ` +
      `PHP ${context.gross ?? '?'}). The client has paid for a booking that no longer exists and has NOT ` +
      `been refunded. Refund it from the PayMongo dashboard if it is not retried successfully. Cause: ${error?.message}`
    );

    if (alertAdmins) {
      await notificationService.notifyAdmins(
        'Late payment needs a manual refund',
        `Payment ${paymentId} (PHP ${context.gross ?? '?'}) arrived for booking #${context.bookingId ?? '?'}, ` +
          `which is no longer active. The automatic refund failed: ${error?.message}. ` +
          'Refund it from the PayMongo dashboard.',
        { payment_id: paymentId, booking_id: context.bookingId }
      );
    }
    return 'failed';
  } finally {
    dbClient.release();
  }
}
