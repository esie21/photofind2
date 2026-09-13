import type { PoolClient } from 'pg';
import { createRefund, paymongoRequest, PayMongoRefundReason } from './paymongoService';

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
