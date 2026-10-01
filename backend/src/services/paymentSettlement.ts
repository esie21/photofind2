import type { PoolClient } from 'pg';
import { pool } from '../config/database';
import { notificationService } from './notificationService';
import { settlePaymentSuccess, LATE_PAYMENT_PREFIX } from './walletService';
import { refundLatePayment } from './refundService';
import { paymongoRequest, PayMongoResponse } from './paymongoService';

/**
 * Turning what PayMongo says about a payment into our own records.
 *
 * Three things learn a payment's fate - the client polling /confirm, PayMongo's webhook, and
 * the reconciliation sweep below - and they must all reach the same answer. The pieces they
 * share live here so that a fix to one (the refunded guard, the amount check, the late-payment
 * refund) cannot silently miss the others.
 */

// The status a success path writes. A refunded payment stays refunded: without this, a
// /confirm poll or a webhook redelivery arriving after a refund flipped the row back to
// 'succeeded', and the books then showed money held that had already been sent back.
export const SUCCEEDED_UNLESS_REFUNDED =
  `CASE WHEN status IN ('refunded', 'partially_refunded') THEN status ELSE 'succeeded' END`;

// Statuses a "this payment failed" report must never overwrite: money that arrived, or has
// already been sent back. The old guard was `<> 'succeeded'`, which let a late failure event
// relabel a refunded payment as failed.
export const FINAL_MONEY_STATUSES = ['succeeded', 'refunded', 'partially_refunded'];

// Checking that what PayMongo says was paid is what this booking costs.
//
// Nothing compared them. Every success path marked the row 'succeeded' and credited the
// provider net_provider_amount - a figure computed from OUR gross_amount - on the strength
// of PayMongo saying "paid", without looking at how much. The intent is created server-side
// with that exact amount, so in normal operation they agree; this is for when they do not:
// a webhook resolved through the metadata.booking_id fallback to a row whose current intent
// is a different one, a row repriced after its intent was opened, or a bug not yet written.
// In any of those the provider would be credited for money that never arrived, or the
// client charged for something other than what the booking says.
//
// A mismatch is held, not guessed at: the row is NOT marked succeeded (so it can never be
// credited), the discrepancy is written to failure_reason, and admins are told. Which way to
// resolve it - refund, top up, accept - is a judgement this code cannot make.
export const AMOUNT_MISMATCH_PREFIX = 'AMOUNT_MISMATCH';

/** Amount and currency PayMongo reports, from a payment object or a payment intent. */
function reportedPaidAmount(attrs: any): { centavos: number | null; currency: string | null } {
  // On an intent the captured payment carries the authoritative figure; fall back to the
  // intent's own amount. On a payment object (payment.paid) attrs.amount is that figure.
  const captured = attrs?.payments?.[0]?.attributes;
  const amount = captured?.amount ?? attrs?.amount;
  const currency = captured?.currency ?? attrs?.currency;
  return {
    centavos: typeof amount === 'number' && Number.isFinite(amount) ? amount : null,
    currency: typeof currency === 'string' ? currency.toUpperCase() : null,
  };
}

/**
 * True when the payment may be settled. On a mismatch, records it on the row (inside the
 * caller's transaction) and returns false; `alert` is set only when this call is the one
 * that first recorded it, so admins are told once rather than on every /confirm poll.
 */
export async function checkPaidAmount(
  dbClient: PoolClient,
  payment: { id: string | number; gross_amount: string | number; booking_id: string | number },
  attrs: any,
  source: string
): Promise<{ ok: boolean; alert?: string }> {
  const expectedCentavos = Math.round((parseFloat(String(payment.gross_amount)) || 0) * 100);
  const reported = reportedPaidAmount(attrs);

  // A missing field is not evidence of a wrong amount. Refusing on it would turn a change in
  // PayMongo's payload shape into every payment being held, so it is allowed and logged.
  if (reported.centavos === null) {
    console.warn(`Payment ${payment.id}: ${source} carried no amount to verify; settling on our own figure.`);
    return { ok: true };
  }

  const currencyOk = reported.currency === null || reported.currency === 'PHP';
  if (reported.centavos === expectedCentavos && currencyOk) {
    return { ok: true };
  }

  const detail =
    `${AMOUNT_MISMATCH_PREFIX}: expected PHP ${(expectedCentavos / 100).toFixed(2)}, ` +
    `${source} reported ${reported.currency || '?'} ${(reported.centavos / 100).toFixed(2)}`;
  console.error(
    `Payment ${payment.id} (booking ${payment.booking_id}) NOT settled - ${detail}. Held for manual review.`
  );

  const flagged = await dbClient.query(
    `UPDATE payments
     SET failure_reason = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id::text = $1 AND (failure_reason IS NULL OR failure_reason NOT LIKE $3)
     RETURNING id`,
    [String(payment.id), detail, `${AMOUNT_MISMATCH_PREFIX}%`]
  );
  return { ok: false, alert: (flagged.rowCount ?? 0) > 0 ? detail : undefined };
}

export function alertAmountMismatch(payment: { id: string | number; booking_id: string | number }, detail: string) {
  void notificationService.notifyAdmins(
    'Payment amount mismatch - held',
    `Payment ${payment.id} for booking #${payment.booking_id} was not settled: ${detail}. ` +
      'The provider has not been credited. Compare against the PayMongo dashboard and resolve by hand.',
    { payment_id: payment.id, booking_id: payment.booking_id }
  );
}

// Hands a payment that landed on a cancelled or rejected booking to the refund flow.
// Fire-and-forget on purpose: it makes its own PayMongo call (up to the client timeout),
// which should not hold up the client's response or a webhook acknowledgement, and it never
// throws. If the process dies first, the reconciliation sweep finds the payment again.
export function startLatePaymentRefund(paymentId: string) {
  void refundLatePayment(paymentId);
}

/** Tells the provider their payment arrived. Never throws. */
export async function notifyPaymentSettled(
  settleResult: Awaited<ReturnType<typeof settlePaymentSuccess>>,
  source: string
) {
  if (!settleResult.settled) return;
  try {
    const clientInfo = await pool.query('SELECT name FROM users WHERE id::text = $1', [settleResult.clientId]);
    await notificationService.notifyPaymentReceived(
      String(settleResult.providerId),
      String(settleResult.clientId),
      settleResult.creditedAmount,
      clientInfo.rows[0]?.name || 'Client',
      String(settleResult.bookingId)
    );
  } catch (notifError) {
    console.error(`Failed to send payment notification (${source}):`, notifError);
  }
}

export interface IntentStateOutcome {
  /** What to tell the client the payment's status is. */
  status: string;
  latePaymentRefund: boolean;
  /** Paid, but held for an admin because the amount did not match. */
  underReview: boolean;
  /** Something about our row actually changed. */
  changed: boolean;
}

/**
 * Applies a payment intent's state, as just read from PayMongo, to our payment row.
 *
 * Used by /confirm and by the reconciliation sweep. Each branch is guarded so that running
 * it twice, or concurrently with the webhook, changes nothing the second time.
 */
export async function applyIntentState(
  paymentId: string,
  intent: PayMongoResponse['data'],
  source: string
): Promise<IntentStateOutcome> {
  const status = intent.attributes.status;
  const outcome: IntentStateOutcome = { status, latePaymentRefund: false, underReview: false, changed: false };
  const dbClient = await pool.connect();

  try {
    if (status === 'succeeded') {
      await dbClient.query('BEGIN');

      // Lock the payment row. attach-method (for cards that don't need 3D Secure) or the
      // webhook may already have marked this 'succeeded' - the status update below is an
      // idempotent no-op in that case, and settlePaymentSuccess's own atomic claim (not this
      // row lock) is what actually prevents crediting the wallet twice across every path.
      const lockedRes = await dbClient.query('SELECT * FROM payments WHERE id::text = $1 FOR UPDATE', [paymentId]);
      const lockedPayment = lockedRes.rows[0];
      if (!lockedPayment) {
        await dbClient.query('ROLLBACK');
        return outcome;
      }
      const capturedPaymentId = intent.attributes.payments?.[0]?.id || null;

      const amountCheck = await checkPaidAmount(dbClient, lockedPayment, intent.attributes, source);
      if (!amountCheck.ok) {
        await dbClient.query('COMMIT');
        if (amountCheck.alert) alertAmountMismatch(lockedPayment, amountCheck.alert);
        // 'processing', not the intent's 'succeeded': the client's screen keeps waiting
        // rather than declaring a payment complete that the platform has not accepted.
        return { ...outcome, status: 'processing', underReview: true, changed: Boolean(amountCheck.alert) };
      }

      await dbClient.query(
        `UPDATE payments
         SET status = ${SUCCEEDED_UNLESS_REFUNDED},
             paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
             paymongo_payment_id = COALESCE($2, paymongo_payment_id),
             updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $1`,
        [lockedPayment.id, capturedPaymentId]
      );

      const settleResult = await settlePaymentSuccess(dbClient, String(lockedPayment.id));
      await dbClient.query('COMMIT');

      outcome.changed = !FINAL_MONEY_STATUSES.includes(String(lockedPayment.status)) || settleResult.settled;
      await notifyPaymentSettled(settleResult, source);
      if (settleResult.bookingUnpayable) {
        outcome.latePaymentRefund = true;
        startLatePaymentRefund(String(lockedPayment.id));
      }
    } else if (status === 'awaiting_payment_method') {
      // The intent has no usable method on it any more: a QR Ph code that expired
      // unscanned, or a method PayMongo rejected. The INTENT is still fine, so this is a
      // reopen, not a failure - see the qrph.expired note in the webhook handler for why
      // 'pending' and not 'failed'.
      //
      // This branch is the safety net that needs no webhook at all: the client polls
      // /confirm while a QR is on screen, and the sweep covers the client who closed the tab.
      // It also covers a card whose 3D Secure was abandoned, which previously left the row
      // stuck at 'processing' with a dead payment method id attached to it.
      const reopened = await dbClient.query(
        `UPDATE payments
         SET status = 'pending',
             paymongo_payment_method_id = NULL,
             payment_method_type = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $1
           AND status = 'processing'
         RETURNING id`,
        [paymentId]
      );

      if ((reopened.rowCount ?? 0) > 0) {
        outcome.changed = true;
        console.log(`Payment ${paymentId} reopened for retry (${source}) - intent is awaiting a payment method.`);
      }
    } else if (status === 'failed') {
      // Guarded the same way as the webhook's failed branch: this row may already have
      // settled via attach-method or the webhook while this request was in flight, and a
      // payment that has been credited to a provider's wallet - or refunded - must not be
      // walked back to 'failed' here. See the longer note in the webhook handler.
      const reason = intent.attributes.last_payment_error?.message || 'Payment failed';
      const failedUpdate = await dbClient.query(
        `UPDATE payments
         SET status = 'failed',
             failure_reason = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $2
           AND status <> ALL($3::text[])
         RETURNING id, booking_id, client_id, provider_id`,
        [reason, paymentId, FINAL_MONEY_STATUSES]
      );
      const failedRow = failedUpdate.rows[0];

      if (failedRow) {
        outcome.changed = true;
        // The booking is only marked unpaid if no payment for it has succeeded.
        await dbClient.query(
          `UPDATE bookings b
           SET payment_status = 'failed', updated_at = CURRENT_TIMESTAMP
           WHERE b.id::text = $1
             AND NOT EXISTS (
               SELECT 1 FROM payments p
               WHERE p.booking_id::text = b.id::text AND p.status = 'succeeded'
             )`,
          [failedRow.booking_id]
        );

        try {
          await notificationService.notifyPaymentFailed(
            String(failedRow.client_id),
            String(failedRow.provider_id),
            String(failedRow.booking_id),
            intent.attributes.last_payment_error?.message || 'Payment could not be processed'
          );
        } catch (notifError) {
          console.error('Failed to send payment failure notification:', notifError);
        }
      }
    }

    return outcome;
  } catch (error) {
    // Only the succeeded branch opens a transaction. A throwing ROLLBACK would mask the
    // real error with an unrelated one.
    try {
      await dbClient.query('ROLLBACK');
    } catch {
      /* no transaction was open */
    }
    throw error;
  } finally {
    dbClient.release();
  }
}

// ---------------------------------------------------------------------------------------
// Reconciliation sweep
// ---------------------------------------------------------------------------------------

// How long a payment may sit open before the sweep asks PayMongo about it. Longer than a
// QR Ph code lives (15 minutes by default) so a client mid-payment is left to /confirm and
// the webhook, which are faster; the sweep is for what those two missed.
const RECONCILE_AFTER_MINUTES = parseInt(process.env.PAYMENT_RECONCILE_AFTER_MINUTES || '20', 10) || 20;

// A card whose 3D Secure page was abandoned leaves the intent at awaiting_next_action
// indefinitely, and our row at 'processing' - which the unpaid-booking sweep deliberately
// will not touch, so the booking held the provider's date forever. After this long nobody is
// still completing a 3D Secure challenge.
const ABANDONED_ACTION_HOURS = 2;

// Per run. PayMongo rate-limits, and anything beyond this is picked up next run.
const RECONCILE_BATCH = 50;

/**
 * Brings stuck payments back in line with PayMongo. Runs on a schedule (server.ts).
 *
 * Why it exists: every path that records a payment's outcome depended on something
 * arriving - the webhook, or the client's browser polling /confirm. When both were missing (a
 * webhook misconfigured or lost, a client who closed the tab after paying) the payment stayed
 * 'processing' forever: a client who had paid, a provider never credited, and a booking the
 * expiry sweep would not release because a payment was "in flight".
 *
 * Also retries late-payment refunds that failed the first time (see refundLatePayment).
 * Payments held for an amount mismatch are skipped; those are waiting for a person.
 */
export async function reconcileOpenPayments(): Promise<void> {
  const stale = await pool.query(
    `SELECT id, status, paymongo_payment_intent_id, updated_at
     FROM payments
     WHERE status IN ('pending', 'processing')
       AND paymongo_payment_intent_id IS NOT NULL
       AND updated_at < NOW() - ($1 || ' minutes')::interval
       AND (failure_reason IS NULL OR failure_reason NOT LIKE $2)
     ORDER BY updated_at ASC
     LIMIT $3`,
    [String(RECONCILE_AFTER_MINUTES), `${AMOUNT_MISMATCH_PREFIX}%`, RECONCILE_BATCH]
  );

  let changed = 0;
  for (const row of stale.rows) {
    try {
      const intentRes = await paymongoRequest(`/payment_intents/${row.paymongo_payment_intent_id}`, 'GET');
      const intent = intentRes.data;
      const result = await applyIntentState(String(row.id), intent, 'reconciliation sweep');
      if (result.changed) changed++;

      if (
        !result.changed &&
        row.status === 'processing' &&
        intent.attributes.status === 'awaiting_next_action' &&
        Date.now() - new Date(row.updated_at).getTime() > ABANDONED_ACTION_HOURS * 60 * 60 * 1000
      ) {
        // Reopen rather than fail: the intent can still take a new method. If the client does
        // somehow finish later, the success paths still settle it - or refund it, if the
        // booking has expired in the meantime.
        const reopened = await pool.query(
          `UPDATE payments
           SET status = 'pending', paymongo_payment_method_id = NULL, payment_method_type = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id::text = $1 AND status = 'processing'
           RETURNING id`,
          [String(row.id)]
        );
        if ((reopened.rowCount ?? 0) > 0) {
          changed++;
          console.log(`Payment ${row.id}: action abandoned for over ${ABANDONED_ACTION_HOURS}h - reopened.`);
        }
      }
    } catch (error: any) {
      // One payment's problem must not stop the rest of the batch.
      console.error(`Reconciliation: could not check payment ${row.id}:`, error?.message);
    }
  }

  // Late payments whose automatic refund failed, or never started because the process died
  // first. Only rows tagged LATE_PAYMENT by settlePaymentSuccess - see the note there on why
  // untagged lookalikes are left for a person. alertAdmins: false - they were alerted on the
  // first failure, and this runs every few minutes.
  const strandedRes = await pool.query(
    `SELECT p.id
     FROM payments p
     LEFT JOIN bookings b ON b.id::text = p.booking_id::text
     WHERE p.status = 'succeeded'
       AND p.wallet_credited_at IS NULL
       AND (b.id IS NULL OR b.status IN ('cancelled', 'rejected'))
       AND p.failure_reason LIKE $2
     LIMIT $1`,
    [RECONCILE_BATCH, `${LATE_PAYMENT_PREFIX}%`]
  );
  let refunded = 0;
  for (const row of strandedRes.rows) {
    if ((await refundLatePayment(String(row.id), { alertAdmins: false })) === 'refunded') refunded++;
  }

  if (stale.rows.length > 0 || strandedRes.rows.length > 0) {
    console.log(
      `Payment reconciliation: checked ${stale.rows.length} open payment(s), updated ${changed}; ` +
      `retried ${strandedRes.rows.length} late-payment refund(s), ${refunded} succeeded.`
    );
  }
}
