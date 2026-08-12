// Single source of truth for the minimum payout amount. payouts.ts enforces it,
// wallet.ts exposes it to the frontend via GET /wallet/my so the payout form's
// validation can't silently drift from what the backend actually accepts.
export const MINIMUM_PAYOUT_AMOUNT = parseFloat(process.env.MINIMUM_PAYOUT_AMOUNT || '500'); // PHP

// How many payout requests a provider may have in flight at once. payouts.ts has always
// enforced this, but the number was buried in the handler and the provider only ever met
// it as a rejection after filling in the whole form - GET /wallet/my now reports it so
// the UI can say "2 of 3" up front.
export const MAX_CONCURRENT_PAYOUT_REQUESTS = 3;

// The methods a payout can actually be sent by. payouts.payout_method is a bare
// VARCHAR(50) with no CHECK constraint and the handler only tested it for truthiness, so
// any string at all was accepted and stored - and one longer than 50 characters made the
// INSERT throw, surfacing as a generic "Failed to request payout" 500.
export const PAYOUT_METHODS = ['gcash', 'paymaya', 'bank_transfer'] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

export function isPayoutMethod(value: unknown): value is PayoutMethod {
  return typeof value === 'string' && (PAYOUT_METHODS as readonly string[]).includes(value);
}

// Every money column here is DECIMAL(12,2), so Postgres rounds anything finer than a
// centavo on the way in. Rounding once, up front, means payouts.amount, the new
// wallets.available_balance and the transactions row all derive from the same number.
// Without it the amount and the balance are rounded independently - a request of 500.005
// stores 500.01 as the payout while the balance drops by 500.00 - and the cancel path,
// which refunds whatever the transaction row says, then hands back the other one.
export function toCentavos(amount: number): number {
  return Math.round(amount * 100) / 100;
}

// 09XXXXXXXXX, +639XXXXXXXXX and 639XXXXXXXXX all normalise to 09XXXXXXXXX; spaces,
// dashes and brackets are ignored. Deliberately mirrors isValidPhMobile() in
// src/components/PayoutRequestForm.tsx: the form's copy exists to give the provider a
// useful message while typing, this one is what actually guards the stored value.
export function normalisePhMobile(value: unknown): string | null {
  const digits = String(value ?? '').replace(/[\s()\-]/g, '');
  const match = /^(?:\+?63|0)(9\d{9})$/.exec(digits);
  return match ? `0${match[1]}` : null;
}

const MAX_DETAIL_LENGTH = 100;

/**
 * Checks that a payout request actually says where the money should go, and returns the
 * cleaned-up detail object to store.
 *
 * payout_details used to be written straight through as `JSON.stringify(details || {})`,
 * so a request with no details at all - or details for the wrong method - was accepted
 * and stored. An admin was then left holding a request for real money with nothing to
 * send it to, or with a phone number that had never been checked to be a phone number.
 */
export function validatePayoutDetails(
  method: PayoutMethod,
  details: unknown
): { error: string; details?: undefined } | { details: Record<string, string>; error?: undefined } {
  const raw =
    details && typeof details === 'object' && !Array.isArray(details)
      ? (details as Record<string, unknown>)
      : {};
  const field = (key: string) => String(raw[key] ?? '').trim().slice(0, MAX_DETAIL_LENGTH);

  const accountName = field('account_name');
  if (accountName.length < 2) {
    return { error: 'Account name is required' };
  }

  if (method === 'bank_transfer') {
    const bankName = field('bank_name');
    if (!bankName) {
      return { error: 'Bank name is required' };
    }
    const accountNumber = field('account_number').replace(/[\s\-]/g, '');
    if (!/^\d{6,20}$/.test(accountNumber)) {
      return { error: 'Bank account number must be 6 to 20 digits' };
    }
    return {
      details: { bank_name: bankName, account_name: accountName, account_number: accountNumber },
    };
  }

  const phoneNumber = normalisePhMobile(raw.phone_number);
  if (!phoneNumber) {
    return { error: 'Enter a valid Philippine mobile number, for example 09171234567' };
  }
  return { details: { phone_number: phoneNumber, account_name: accountName } };
}
