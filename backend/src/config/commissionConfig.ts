// Single source of truth for the platform commission. payments.ts uses it to split
// each payment, and bookings.ts uses it to validate the price a client submits - those
// two were hardcoding 0.15 separately, so changing the env var would have made price
// validation reject correct prices while the payment split moved.
export const PLATFORM_COMMISSION_RATE = parseFloat(process.env.PLATFORM_COMMISSION_RATE || '0.15'); // 15%
