// When a client has to pay by, once the provider has confirmed their booking.
//
// Clients pay after confirmation rather than at booking time, and nothing used to put a
// limit on that: an accepted booking could sit unpaid past its own date forever, holding
// the provider's slot against clients who would have paid for it (the booking-conflict
// check only ignores 'cancelled' and 'rejected'), and no job or endpoint ever looked at
// payment_status.
//
// Two limits, whichever falls first:
//  - PAYMENT_WINDOW_HOURS after the provider confirmed, so a booking made months ahead
//    doesn't hold a date on the strength of an intention.
//  - PAYMENT_CUTOFF_BEFORE_START_HOURS before the shoot starts, so a provider isn't
//    travelling to a job that is still unpaid.
export const PAYMENT_WINDOW_HOURS = parseFloat(process.env.PAYMENT_WINDOW_HOURS || '24');
export const PAYMENT_CUTOFF_BEFORE_START_HOURS = parseFloat(
  process.env.PAYMENT_CUTOFF_BEFORE_START_HOURS || '2'
);

// A floor, so the two rules above can't produce a deadline that has already passed. A
// booking confirmed an hour before it starts would otherwise be due two hours ago and be
// expired by the next sweep before the client could act on the notification.
export const MINIMUM_PAYMENT_WINDOW_MINUTES = parseFloat(
  process.env.MINIMUM_PAYMENT_WINDOW_MINUTES || '30'
);

// How close to the deadline the client gets a reminder.
export const PAYMENT_REMINDER_LEAD_HOURS = parseFloat(process.env.PAYMENT_REMINDER_LEAD_HOURS || '6');

/**
 * When payment for a booking confirmed at `confirmedAt`, starting at `startDate`, is due.
 *
 * Kept as one function because four places need the same answer: the accept and both
 * reschedule-approval paths that set the deadline, and the SQL backfill in
 * initializeTables that gives already-accepted bookings one.
 */
export function computePaymentDueAt(confirmedAt: Date, startDate: Date | null): Date {
  const windowEnd = new Date(confirmedAt.getTime() + PAYMENT_WINDOW_HOURS * 60 * 60 * 1000);
  const floor = new Date(confirmedAt.getTime() + MINIMUM_PAYMENT_WINDOW_MINUTES * 60 * 1000);

  let due = windowEnd;
  if (startDate && !isNaN(startDate.getTime())) {
    const cutoff = new Date(startDate.getTime() - PAYMENT_CUTOFF_BEFORE_START_HOURS * 60 * 60 * 1000);
    if (cutoff < due) due = cutoff;
  }

  return due < floor ? floor : due;
}

export function describePaymentWindow(): string {
  return `within ${PAYMENT_WINDOW_HOURS} hours, and at least ${PAYMENT_CUTOFF_BEFORE_START_HOURS} hours before the booking starts`;
}

// How early, before a booking starts, the provider may record that the cash arrived.
//
// The window exists because "paid" is an assertion only the provider can make for cash,
// and one made weeks ahead would be worthless: it would mark the booking paid, keep the
// slot, and leave the client with no deadline, no escrow and nothing to point at. A
// short grace covers the client who pays on arrival, a few minutes early.
//
// Mirrored in src/constants/commission.ts for the button's enabled state - keep the two
// in step, or the provider gets a button that only produces a refusal.
export const CASH_CONFIRM_GRACE_MINUTES = parseFloat(
  process.env.CASH_CONFIRM_GRACE_MINUTES || '30'
);

// The online payment methods offered to a client.
//
// QR Ph is the only one, by product decision. The card and e-wallet list is kept as a
// break-glass fallback rather than deleted, because QR Ph being the sole method means a
// PayMongo-side problem with it - an outage, the capability being deactivated on the
// account - is a total stop on taking money. PAYMONGO_QRPH_ENABLED=false makes that an env
// change and a restart instead of a code change and a deploy under pressure.
//
// This returns exactly one of the two lists and is never empty, which matters: PayMongo
// validates payment_method_allowed when the intent is created, so an empty array does not
// degrade to "no methods available", it fails intent creation and nobody can pay at all.
// An earlier version of this switch removed 'qrph' from a combined list; once QR Ph became
// the only method that would have left [].
export const QRPH_ENABLED = (process.env.PAYMONGO_QRPH_ENABLED || 'true').toLowerCase() !== 'false';

/** Only reachable via PAYMONGO_QRPH_ENABLED=false. Kept in step with what the UI can render. */
const FALLBACK_METHODS = ['card', 'gcash', 'grab_pay', 'paymaya'];

export function allowedPaymentMethods(): string[] {
  return QRPH_ENABLED ? ['qrph'] : [...FALLBACK_METHODS];
}

/** True when QR Ph is the only thing on offer, i.e. normal operation. */
export function isQrphOnly(): boolean {
  return QRPH_ENABLED;
}

// How long a QR Ph code stays scannable, in seconds. PayMongo accepts 60-9000 and
// defaults to 1800 (30 minutes).
//
// 900 (15 minutes) rather than the default: the code encodes one exact amount for one
// booking, and the client is sitting on the payment screen waiting for it. Thirty minutes
// of a live code is thirty minutes in which the intent cannot be retried with a different
// method, because an attached payment method holds the intent until it expires. Fifteen is
// long enough to open a banking app and finish, short enough that a client who gives up
// can start again without a long wait.
export const QRPH_EXPIRY_SECONDS = (() => {
  const raw = parseInt(process.env.PAYMONGO_QRPH_EXPIRY_SECONDS || '900', 10);
  if (!Number.isFinite(raw)) return 900;
  // Clamped, not trusted: a value outside PayMongo's range is rejected at payment-method
  // creation, which would surface to the client as a failed payment rather than as the
  // configuration mistake it is.
  return Math.min(9000, Math.max(60, raw));
})();
