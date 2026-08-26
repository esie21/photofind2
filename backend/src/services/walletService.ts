import { pool } from '../config/database';
import type { PoolClient } from 'pg';

// Idempotent wallet creation. If two requests race to create the same provider's
// wallet at once (e.g. a PayMongo webhook and a wallet page load for a brand-new
// provider), ON CONFLICT DO NOTHING lets the loser's INSERT succeed as a no-op
// instead of throwing a unique-constraint error, then falls back to reading the
// winner's row.
export async function ensureProviderWallet(providerId: string): Promise<string> {
  const inserted = await pool.query(
    `INSERT INTO wallets (provider_id) VALUES ($1)
     ON CONFLICT (provider_id) DO NOTHING
     RETURNING id`,
    [providerId]
  );

  if (inserted.rows[0]) {
    return inserted.rows[0].id;
  }

  const existing = await pool.query(
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
export async function settlePaymentSuccess(
  dbClient: PoolClient,
  paymentId: string
): Promise<{ settled: boolean; creditedAmount: number; bookingId?: string; providerId?: string; clientId?: string }> {
  const claimRes = await dbClient.query(
    `UPDATE payments
     SET wallet_credited_at = CURRENT_TIMESTAMP
     WHERE id::text = $1 AND status = 'succeeded' AND wallet_credited_at IS NULL
     RETURNING id, booking_id, provider_id, client_id, net_provider_amount, commission_rate`,
    [paymentId]
  );
  if (!claimRes.rows[0]) {
    return { settled: false, creditedAmount: 0 };
  }
  const payment = claimRes.rows[0];
  const amount = parseFloat(payment.net_provider_amount) || 0;
  const commissionPct = Math.round((parseFloat(payment.commission_rate) || 0) * 100);

  await dbClient.query(
    `UPDATE bookings SET payment_status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id::text = $1`,
    [payment.booking_id]
  );

  const walletId = await ensureProviderWallet(String(payment.provider_id));

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

  await dbClient.query(
    `INSERT INTO transactions (wallet_id, payment_id, type, amount, balance_after, reference_id, description)
     VALUES ($1, $2, 'payment_received', $3, $4, $5, $6)`,
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

  const walletId = await ensureProviderWallet(String(payment.provider_id));

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
