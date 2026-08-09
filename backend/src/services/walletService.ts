import { pool } from '../config/database';

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
