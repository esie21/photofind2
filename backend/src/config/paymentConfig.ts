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
