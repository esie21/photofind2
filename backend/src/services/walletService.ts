import { pool } from '../config/database';
import type { PoolClient } from 'pg';

// Idempotent wallet creation. If two requests race to create the same provider's
// wallet at once (e.g. a PayMongo webhook and a wallet page load for a brand-new
// provider), ON CONFLICT DO NOTHING lets the loser's INSERT succeed as a no-op
// instead of throwing a unique-constraint error, then falls back to reading the
// winner's row.
//
// `dbClient` MUST be passed by every caller that is already inside a transaction.
//
// This used to always use the shared pool, even when called from inside one - and both
// settlement functions below do exactly that, while holding a connection of their own. So
// each in-flight settlement needed a SECOND connection just to get here, out of a pool of
// ten. Eleven concurrent settlements and every one of them is holding a connection while
// waiting for a connection that only another of them can release: a deadlock that no
// amount of waiting clears, and which before the connectionTimeoutMillis added in
// config/database.ts would have hung every request forever rather than failing.
//
// It was also wrong in a quieter way. An INSERT on the pool commits immediately, outside
// the caller's transaction, so a settlement that rolled back still left a wallet row
// behind - and the row the caller then locked FOR UPDATE was not one its own transaction
// could see consistently.
export async function ensureProviderWallet(
  providerId: string,
  dbClient?: PoolClient
): Promise<string> {
  const db = dbClient ?? pool;

  const inserted = await db.query(
    `INSERT INTO wallets (provider_id) VALUES ($1)
     ON CONFLICT (provider_id) DO NOTHING
     RETURNING id`,
    [providerId]
  );

  if (inserted.rows[0]) {
    return inserted.rows[0].id;
  }

  const existing = await db.query(
    'SELECT id FROM wallets WHERE provider_id::text = $1',
    [providerId]
  );

  return existing.rows[0].id;
}

// Applies the one-time side effects of a payment succeeding: marks the booking paid,
// credits the provider's wallet pending_balance, and records the ledger transaction.
// Must be called with `dbClient` inside an open transaction, after that same
// transaction has already written payments.status = 'succeeded' for this payment
// (the claim below reads that status back, so it needs to see it).
//
// A payment can be marked 'succeeded' from three different places - attach-method
// (synchronously, for cards that don't need 3D Secure), /confirm, and the PayMongo
// webhook - and any of them can race to get there first. Gating on "did I just flip
// the status" is unsafe: whichever of the three actually flips it wins, but the other
// two would then see status already 'succeeded' and (with the old logic) skip
// crediting entirely, silently leaving the provider's wallet uncredited. Instead this
// claims a dedicated wallet_credited_at column with a single atomic UPDATE - Postgres
// resolves the race via row locking, so exactly one caller gets `settled: true` no
// matter which of the three code paths gets here first or how many call concurrently.
//
// The claim also requires the booking to still be live. A client can pay after their
// booking stopped existing - a QR code scanned after the provider cancelled, or after the
// unpaid-booking sweep released the slot - and PayMongo captures that money regardless.
// Crediting it put the client's money in the provider's escrow for a shoot that was never
// going to happen, where nothing would ever release or return it. Such a payment is left
// 'succeeded' (the money really did arrive) but uncredited, and `bookingUnpayable` tells
// the caller to refund it - see refundLatePayment in refundService.
//
// No lock is taken on the booking. Every path that cancels a booking with a payment on it
// also locks the payment row (settleCancelledBooking, and the sweep's payments UPDATE), and
// the caller already holds that lock, so the two serialise on the payment row; under READ
// COMMITTED this read then sees whichever cancellation committed first. Locking the booking
// here as well would take the two locks in the opposite order to settleCancelledBooking,
// which can deadlock.
export const UNPAYABLE_BOOKING_STATUSES = ['cancelled', 'rejected'];

/** failure_reason prefix marking a payment detected as late, and so eligible for auto-refund. */
export const LATE_PAYMENT_PREFIX = 'LATE_PAYMENT';

export async function settlePaymentSuccess(
  dbClient: PoolClient,
  paymentId: string
): Promise<{
  settled: boolean;
  creditedAmount: number;
  bookingId?: string;
  providerId?: string;
  clientId?: string;
  /** Money arrived for a cancelled or rejected booking: not credited, needs refunding. */
  bookingUnpayable?: boolean;
}> {
  const claimRes = await dbClient.query(
    `UPDATE payments p
     SET wallet_credited_at = CURRENT_TIMESTAMP
     FROM bookings b
     WHERE p.id::text = $1
       AND p.status = 'succeeded'
       AND p.wallet_credited_at IS NULL
       AND b.id::text = p.booking_id::text
       AND b.status <> ALL($2::text[])
     RETURNING p.id, p.booking_id, p.provider_id, p.client_id, p.net_provider_amount, p.commission_rate`,
    [paymentId, UNPAYABLE_BOOKING_STATUSES]
  );
  if (!claimRes.rows[0]) {
    // Nothing claimed. Usually that is the ordinary case - another path already credited
    // it - but tell the caller apart from a payment that landed on a dead booking.
    const stranded = await dbClient.query(
      `SELECT p.booking_id, p.provider_id, p.client_id
       FROM payments p
       LEFT JOIN bookings b ON b.id::text = p.booking_id::text
       WHERE p.id::text = $1
         AND p.status = 'succeeded'
         AND p.wallet_credited_at IS NULL
         AND (b.id IS NULL OR b.status = ANY($2::text[]))`,
      [paymentId, UNPAYABLE_BOOKING_STATUSES]
    );
    if (stranded.rows[0]) {
      const row = stranded.rows[0];
      // Tag it, in the caller's transaction, as a late payment this code detected. The tag is
      // what refundLatePayment and the reconciliation sweep require before they will refund:
      // older rows that merely look similar (paid, uncredited, booking since cancelled under
      // the pre-refund cancellation flow) are history for a person to review, not something
      // a background job should start sending money back for on the first deploy.
      await dbClient.query(
        `UPDATE payments
         SET failure_reason = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $1 AND (failure_reason IS NULL OR failure_reason NOT LIKE $3)`,
        [paymentId, `${LATE_PAYMENT_PREFIX}: arrived after the booking was cancelled or rejected; refund pending`, `${LATE_PAYMENT_PREFIX}%`]
      );
      console.error(
        `[settlePaymentSuccess] Payment ${paymentId} succeeded for booking ${row.booking_id}, ` +
        'which is cancelled, rejected or missing. NOT crediting the provider; it will be refunded.'
      );
      return {
        settled: false,
        creditedAmount: 0,
        bookingUnpayable: true,
        bookingId: String(row.booking_id),
        providerId: String(row.provider_id),
        clientId: String(row.client_id),
      };
    }
    return { settled: false, creditedAmount: 0 };
  }
  const payment = claimRes.rows[0];
  const amount = parseFloat(payment.net_provider_amount) || 0;
  const commissionPct = Math.round((parseFloat(payment.commission_rate) || 0) * 100);

  await dbClient.query(
    `UPDATE bookings SET payment_status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id::text = $1`,
    [payment.booking_id]
  );

  const walletId = await ensureProviderWallet(String(payment.provider_id), dbClient);

  // Lock the wallet row to prevent races with any other payment settling concurrently
  // for the same provider.
  const walletLockRes = await dbClient.query(
    `SELECT id, pending_balance FROM wallets WHERE id::text = $1 FOR UPDATE`,
    [walletId]
  );
  const currentPending = parseFloat(walletLockRes.rows[0].pending_balance) || 0;
  const newPending = currentPending + amount;

  await dbClient.query(
    `UPDATE wallets SET pending_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id::text = $2`,
    [newPending, walletId]
  );

  await dbClient.query(
    `INSERT INTO transactions (wallet_id, payment_id, type, amount, balance_after, reference_id, description)
     VALUES ($1, $2, 'payment_received', $3, $4, $5, $6)`,
    [
      walletId,
      payment.id,
      amount,
      newPending,
      `payment_${payment.id}`,
      `Payment received for booking #${payment.booking_id} (after ${commissionPct}% commission)`
    ]
  );

  return {
    settled: true,
    creditedAmount: amount,
    bookingId: String(payment.booking_id),
    providerId: String(payment.provider_id),
    clientId: String(payment.client_id)
  };
}

// Moves a completed booking's escrowed funds from pending_balance to available_balance.
//
// Two things this centralises, both of which were wrong when the three call sites in
// bookings.ts (client confirmation, 48-hour auto-confirm, dispute resolution) each had
// their own copy:
//
//  1. The old code clamped pending with Math.max(0, pending - amount) but credited
//     available with the *full* amount regardless. If pending was short, the difference
//     was invented out of nothing and became withdrawable. Here both sides move by the
//     same `released` figure, so the wallet can never gain value it never received.
//  2. A shortfall means an earlier step (the initial escrow credit) didn't happen, so it
//     is logged loudly instead of being silently papered over.
//
// Must be called inside an open transaction; it takes FOR UPDATE on the wallet row.
export async function releaseEscrow(
  dbClient: PoolClient,
  providerUserId: string,
  amount: number,
  opts: { bookingId: string; paymentId: string; referenceId: string; description: string }
): Promise<{ released: number; shortfall: number; walletId: string }> {
  const walletRes = await dbClient.query(
    `SELECT id, pending_balance, available_balance FROM wallets WHERE provider_id::text = $1 FOR UPDATE`,
    [providerUserId]
  );
  let wallet = walletRes.rows[0];

  if (!wallet) {
    const created = await dbClient.query(
      `INSERT INTO wallets (provider_id, available_balance, pending_balance)
       VALUES ($1, 0, 0)
       RETURNING id, pending_balance, available_balance`,
      [providerUserId]
    );
    wallet = created.rows[0];
  }

  const currentPending = parseFloat(wallet.pending_balance) || 0;
  const currentAvailable = parseFloat(wallet.available_balance) || 0;

  // Never release more than is actually being held.
  const released = Math.min(amount, currentPending);
  const shortfall = Math.round((amount - released) * 100) / 100;

  if (shortfall > 0) {
    console.error(
      `[releaseEscrow] SHORTFALL: booking ${opts.bookingId} / payment ${opts.paymentId} ` +
      `expected to release ${amount} to provider ${providerUserId} but only ${currentPending} ` +
      `was in pending_balance. Releasing ${released}, short by ${shortfall}. ` +
      `The escrow credit for this payment is missing - investigate.`
    );
  }

  const newPending = Math.round((currentPending - released) * 100) / 100;
  const newAvailable = Math.round((currentAvailable + released) * 100) / 100;

  await dbClient.query(
    `UPDATE wallets
     SET pending_balance = $1,
         available_balance = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id::text = $3`,
    [newPending, newAvailable, String(wallet.id)]
  );

  // 'escrow_released', not 'payment_received': this is the SAME money the client already
  // paid, moving from pending to available now that the booking is done. Recording it as a
  // second payment made every completed job show up twice in the provider's ledger.
  await dbClient.query(
    `INSERT INTO transactions (wallet_id, payment_id, type, amount, balance_after, reference_id, description)
     VALUES ($1, $2, 'escrow_released', $3, $4, $5, $6)`,
    [String(wallet.id), opts.paymentId, released, newAvailable, opts.referenceId, opts.description]
  );

  return { released, shortfall, walletId: String(wallet.id) };
}

// Settles a booking that was paid in cash, on the day, directly to the provider.
//
// This is the mirror image of settlePaymentSuccess and the difference is the whole
// point: with an online payment the platform holds the client's money, takes its
// commission off the top and credits the provider the net. With cash the provider
// already has the *gross* in their pocket and the platform has nothing - so instead
// of crediting anything, this DEBITS the commission the provider now owes.
//
// available_balance is allowed to go negative as a result. That negative figure is
// the debt, and routes/payouts.ts refuses to pay out while it stands, so the balance
// is worked off by the provider's next online bookings before any money leaves. The
// alternative - refusing the cash confirmation when the wallet is short - would mean
// a provider who has done the shoot and taken the money cannot record that fact,
// which helps nobody and just makes the books wrong.
//
// Claims payments.wallet_credited_at with the same atomic single-UPDATE pattern as
// settlePaymentSuccess, so a double-submitted confirmation charges the commission
// exactly once. Must be called inside an open transaction.
export async function settleCashPayment(
  dbClient: PoolClient,
  paymentId: string
): Promise<{ settled: boolean; commissionCharged: number; balanceAfter: number; bookingId?: string; providerId?: string; clientId?: string }> {
  const claimRes = await dbClient.query(
    `UPDATE payments
     SET wallet_credited_at = CURRENT_TIMESTAMP
     WHERE id::text = $1 AND status = 'succeeded' AND wallet_credited_at IS NULL
     RETURNING id, booking_id, provider_id, client_id, gross_amount, commission_amount, commission_rate`,
    [paymentId]
  );
  if (!claimRes.rows[0]) {
    return { settled: false, commissionCharged: 0, balanceAfter: 0 };
  }

  const payment = claimRes.rows[0];
  const commission = Math.round((parseFloat(payment.commission_amount) || 0) * 100) / 100;
  const gross = parseFloat(payment.gross_amount) || 0;
  const commissionPct = Math.round((parseFloat(payment.commission_rate) || 0) * 100);

  await dbClient.query(
    `UPDATE bookings SET payment_status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id::text = $1`,
    [payment.booking_id]
  );

  const walletId = await ensureProviderWallet(String(payment.provider_id), dbClient);

  const walletLockRes = await dbClient.query(
    `SELECT id, available_balance FROM wallets WHERE id::text = $1 FOR UPDATE`,
    [walletId]
  );
  const currentAvailable = parseFloat(walletLockRes.rows[0].available_balance) || 0;
  const newAvailable = Math.round((currentAvailable - commission) * 100) / 100;

  await dbClient.query(
    `UPDATE wallets SET available_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id::text = $2`,
    [newAvailable, walletId]
  );

  // Negative amount: the ledger reads as money leaving the provider, which is what a
  // commission on cash they already hold actually is. The wallet page renders the
  // sign straight from this figure.
  await dbClient.query(
    `INSERT INTO transactions (wallet_id, payment_id, type, amount, balance_after, reference_id, description)
     VALUES ($1, $2, 'commission_deducted', $3, $4, $5, $6)`,
    [
      walletId,
      payment.id,
      -commission,
      newAvailable,
      `cash_commission_${payment.id}`,
      `${commissionPct}% platform commission on the ₱${gross.toFixed(2)} cash payment for booking #${payment.booking_id}`
    ]
  );

  return {
    settled: true,
    commissionCharged: commission,
    balanceAfter: newAvailable,
    bookingId: String(payment.booking_id),
    providerId: String(payment.provider_id),
    clientId: String(payment.client_id)
  };
}

// What the provider owes the platform right now, as a positive number (0 when they
// are square or in credit). Unpaid cash commission is the only thing that drives
// available_balance below zero, so the shortfall *is* the debt.
export async function getOutstandingCommission(providerUserId: string): Promise<number> {
  const res = await pool.query(
    'SELECT available_balance FROM wallets WHERE provider_id::text = $1',
    [providerUserId]
  );
  if (!res.rows[0]) return 0;
  const available = parseFloat(res.rows[0].available_balance) || 0;
  return available < 0 ? Math.round(-available * 100) / 100 : 0;
}
