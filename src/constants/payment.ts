// Client-side mirrors of the payment rules the backend actually enforces.
//
// Nothing here decides anything - the backend is the only authority. These exist so the
// UI can state the numbers and enable/disable controls in step with the rules, instead
// of each component carrying its own literal and drifting.

// Mirrors PLATFORM_COMMISSION_RATE in backend/src/config/commissionConfig.ts.
// Used by the booking summary's fee line and by the cash toggle's explanation of what a
// provider gets billed when they collect cash themselves.
export const PLATFORM_COMMISSION_RATE = 0.15;
export const PLATFORM_COMMISSION_PERCENT = Math.round(PLATFORM_COMMISSION_RATE * 100);

// Mirrors CASH_CONFIRM_GRACE_MINUTES in backend/src/config/paymentConfig.ts: how early
// before the start a provider may record that the cash arrived. If this drifts below the
// backend's value the provider gets a button that only produces a refusal; above it, the
// button hides while the call would have worked.
export const CASH_CONFIRM_GRACE_MINUTES = 30;
export const CASH_CONFIRM_GRACE_MS = CASH_CONFIRM_GRACE_MINUTES * 60 * 1000;
