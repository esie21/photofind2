// Single source of truth for the minimum payout amount. payouts.ts enforces it,
// wallet.ts exposes it to the frontend via GET /wallet/my so the payout form's
// validation can't silently drift from what the backend actually accepts.
export const MINIMUM_PAYOUT_AMOUNT = parseFloat(process.env.MINIMUM_PAYOUT_AMOUNT || '500'); // PHP
