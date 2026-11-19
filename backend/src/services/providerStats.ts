import { pool } from '../config/database';

// Below this many decided bookings (or answered requests) a rate says nothing: one
// declined booking would make a brand-new provider 0% reliable. Under the threshold the
// stat is reported as null and the ranking falls back to a neutral value.
export const MIN_SAMPLE = 3;

export interface ProviderStats {
  // completed / (completed + rejected + disputed), 0..1, or null if too few bookings.
  completionRate: number | null;
  // Median seconds from the request being created to the provider accepting or declining
  // it, or null if too few answered requests.
  medianResponseSeconds: number | null;
}

// Cancelled bookings are deliberately left out of the completion rate: bookings has no
// cancelled_by column, so a client backing out can't be told apart from the provider
// bailing, and counting them would punish providers for clients' decisions.
export async function getProviderStats(providerIds: string[]): Promise<Map<string, ProviderStats>> {
  const stats = new Map<string, ProviderStats>();
  if (providerIds.length === 0) return stats;

  const result = await pool.query(
    `SELECT provider_id::text AS provider_id,
            COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
            COUNT(*) FILTER (WHERE status IN ('rejected', 'disputed'))::int AS failed,
            COUNT(*) FILTER (WHERE COALESCE(accepted_at, rejected_at) IS NOT NULL)::int AS answered,
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (COALESCE(accepted_at, rejected_at) - created_at))
            ) FILTER (WHERE COALESCE(accepted_at, rejected_at) >= created_at) AS median_response
       FROM bookings
      WHERE provider_id::text = ANY($1::text[])
      GROUP BY provider_id`,
    [providerIds.map(String)]
  );

  for (const row of result.rows) {
    const decided = row.completed + row.failed;
    stats.set(row.provider_id, {
      completionRate: decided >= MIN_SAMPLE ? row.completed / decided : null,
      medianResponseSeconds:
        row.answered >= MIN_SAMPLE && row.median_response !== null ? Number(row.median_response) : null,
    });
  }

  // Providers with no bookings at all get no row from the GROUP BY; return an explicit
  // "no data" entry so callers don't have to special-case a missing key.
  for (const id of providerIds) {
    if (!stats.has(String(id))) stats.set(String(id), { completionRate: null, medianResponseSeconds: null });
  }
  return stats;
}
