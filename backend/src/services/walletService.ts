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
