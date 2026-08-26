import { PLATFORM_COMMISSION_RATE } from './commissionConfig';

// What a booking is allowed to cost, in one place.
//
// This lived inline in POST /bookings and nowhere else, which is how the
// create-intent endpoint ended up with a *different* rule: it compared the stored
// total_price against the flat, unscaled services.price, so it rejected every
// legitimate hourly booking shorter than an hour while passing anything positive
// once that comparison was dropped. Two endpoints guarding the same money need the
// same arithmetic, so both now call computeMinimumBookingPrice().

/** The `services` columns computeMinimumBookingPrice() reads. */
export interface ServicePricingRow {
  price?: unknown;
  pricing_type?: string | null;
  duration_minutes?: number | null;
  package_price?: unknown;
  hourly_rate?: unknown;
  /** Legacy column; nothing writes to it on purpose, but old rows still carry it. */
  hourly_price?: unknown;
}

export type MinimumPriceResult =
  | { ok: true; minPrice: number; durationMinutes: number }
  | { ok: false; error: string };

/**
 * Of the pricing columns this module can use, the ones a given schema actually has.
 *
 * Callers build their SELECT from this because the deployed schemas differ - see the
 * information_schema probing in routes/services.ts.
 */
export function servicePricingColumns(existingColumns: string[]): string[] {
  const columns = ['id', 'price', 'pricing_type', 'duration_minutes'];
  for (const optional of ['package_price', 'hourly_rate', 'hourly_price']) {
    if (existingColumns.includes(optional)) columns.push(optional);
  }
  return columns;
}

/**
 * The least a booking of this service for this window may be charged, platform fee
 * included.
 *
 * `end` is optional: without it the service's own package duration is assumed, which
 * is what POST /bookings does when a request omits end_date.
 */
export function computeMinimumBookingPrice(
  service: ServicePricingRow,
  start: Date,
  end: Date | null
): MinimumPriceResult {
  const servicePrice = parseFloat(String(service.price ?? '')) || 0;
  const packagePrice = parseFloat(String(service.package_price ?? '')) || servicePrice;
  const packageDuration = service.duration_minutes || 60;
  const platformFeeRate = PLATFORM_COMMISSION_RATE;

  if (isNaN(start.getTime())) return { ok: false, error: 'Invalid start_date' };

  const effectiveEnd = end && !isNaN(end.getTime())
    ? end
    : new Date(start.getTime() + packageDuration * 60 * 1000);

  const durationMinutes = Math.round((effectiveEnd.getTime() - start.getTime()) / (1000 * 60));
  // A zero or negative duration would otherwise price an hourly booking at nothing.
  if (durationMinutes <= 0) {
    return { ok: false, error: 'Booking duration must be greater than zero' };
  }

  if (service.pricing_type === 'hourly') {
    // Scales with the real duration. This used to be floored to a minimum of one hour,
    // which stopped an 8-hour booking being submitted at one hour's price but also
    // doubled the minimum for anything shorter than an hour - rejecting a client's own
    // correctly proportional price as "Invalid price".
    //
    // Priced off hourly_rate, not the legacy `price` column. Both are writable and
    // nothing kept them equal, so a service whose hourly_rate had been raised without
    // `price` following was still charged at the stale, lower `price` - the same
    // preference the 'both' branch below has always applied.
    const minPrice = resolveHourlyRate(service, servicePrice) * (durationMinutes / 60) * (1 + platformFeeRate);
    return finalise(minPrice, durationMinutes);
  }

  // Package pricing: price scales with duration (e.g. 2 hrs of a 1-hr package = 2x).
  const units = Math.max(1, durationMinutes / packageDuration);
  let minPrice = packagePrice * units * (1 + platformFeeRate);

  if (service.pricing_type === 'both') {
    // Either pricing mode is a legitimate way to buy this service, so the floor is
    // whichever is cheaper - charging the package minimum for someone who picked the
    // hourly rate would reject their honest price.
    const hourlyExpected =
      resolveHourlyRate(service, servicePrice) * (durationMinutes / 60) * (1 + platformFeeRate);
    minPrice = Math.min(minPrice, hourlyExpected);
  }

  return finalise(minPrice, durationMinutes);
}

/** The rate a provider actually configured, preferring it over the legacy column. */
function resolveHourlyRate(service: ServicePricingRow, fallback: number): number {
  return (
    parseFloat(String(service.hourly_rate ?? '')) ||
    parseFloat(String(service.hourly_price ?? '')) ||
    fallback
  );
}

/**
 * Last line of defence: a floor of zero or less would let a booking through for
 * nothing. routes/services.ts refuses to store a rate like that, but rows written
 * before it did are still out there.
 */
function finalise(minPrice: number, durationMinutes: number): MinimumPriceResult {
  if (!Number.isFinite(minPrice) || minPrice <= 0) {
    return { ok: false, error: 'This service has no usable price configured' };
  }
  return { ok: true, minPrice, durationMinutes };
}

/**
 * Whether a submitted price clears the minimum.
 *
 * The 1% slack absorbs the client's own rounding; it is not a discount, and it is
 * applied identically everywhere so the two endpoints can't disagree about a price
 * sitting on the boundary.
 */
export const PRICE_TOLERANCE = 0.99;

export function isPriceAcceptable(submittedPrice: number, minPrice: number): boolean {
  return submittedPrice >= minPrice * PRICE_TOLERANCE;
}
