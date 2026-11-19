/**
 * Small parsers for values that arrive off the wire.
 *
 * These exist because `parseInt(x) || fallback` and `if (!n || n < 1 || n > 5)` are both
 * wrong in ways that only show up as a 500 later, in a query, with the real cause several
 * frames away. JSON request bodies can carry any type at all, and comparisons against a
 * non-number are all false - so a validity check written as a pair of range comparisons
 * waves through every value that is not a number, which is precisely the set that breaks
 * the database.
 */

export interface Pagination {
  limit: number;
  offset: number;
}

/**
 * `limit` and `offset` from a query string, always within bounds.
 *
 * Two separate failures this removes:
 *
 *  - `parseInt('abc')` is NaN, and `NaN || 50` is 50, but plenty of call sites wrote
 *    `parseInt(limit as string)` with no fallback and bound NaN straight into a LIMIT.
 *    Postgres refuses it, so `?limit=abc` - a typo, or a stray character in a URL - came
 *    back as a 500 rather than as a page of results.
 *  - An unbounded limit is an invitation: `?limit=1000000` asks the server to load and
 *    serialise an entire table into one response, holding a pooled connection for as long
 *    as that takes.
 *
 * A nonsensical value falls back to the default rather than erroring. This is a listing
 * endpoint; refusing to show anything because a page size was mistyped helps nobody.
 */
export function parsePagination(
  query: Record<string, unknown>,
  options: { defaultLimit?: number; maxLimit?: number } = {}
): Pagination {
  const defaultLimit = options.defaultLimit ?? 50;
  const maxLimit = options.maxLimit ?? 100;

  const rawLimit = Number.parseInt(String(query.limit ?? ''), 10);
  const rawOffset = Number.parseInt(String(query.offset ?? ''), 10);

  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, maxLimit)
    : defaultLimit;

  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  return { limit, offset };
}

/** A resolved reporting window, as absolute instants. */
export interface DateRange {
  /** Inclusive start. */
  from: Date;
  /** Inclusive end - the last millisecond of the `to` day, not midnight at its start. */
  to: Date;
  /** Echoed back so a report can say which days it actually covered. */
  fromDate: string;
  toDate: string;
}

export class DateRangeError extends Error {}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Turns `from`/`to` day strings into the instants a SQL range needs.
 *
 * Day boundaries are Asia/Manila, not the server's timezone. Render runs UTC, so a
 * "today" report built from UTC midnight would start at 08:00 Manila and a month-end
 * report would take the first eight hours of the following day with it - the report would
 * disagree with what an admin in Manila sees on a calendar, which is the one thing a
 * financial report cannot do.
 *
 * A fixed +08:00 offset is correct here rather than lazy: the Philippines has observed no
 * DST since 1978 and PHT has no seasonal variant, so there is no transition for an offset
 * to be wrong across. Anywhere with DST would need a real timezone database instead.
 *
 * `to` resolves to 23:59:59.999 so the range is inclusive of its last day. Using midnight
 * would silently drop everything that happened on the day the admin asked for.
 */
export function parseDateRange(
  rawFrom: unknown,
  rawTo: unknown,
  options: { maxDays?: number } = {}
): DateRange {
  const fromStr = String(rawFrom ?? '').trim();
  const toStr = String(rawTo ?? '').trim();

  if (!YMD.test(fromStr) || !YMD.test(toStr)) {
    throw new DateRangeError('from and to must both be given, as YYYY-MM-DD');
  }

  // A real day, not merely a well-shaped string. V8 does NOT reject "2026-02-30" in an
  // ISO datetime - it rolls it forward to March 2 - so a typo would silently move the
  // window the report covers and be reported as a clean success. Checked by round-trip
  // rather than by a days-in-month table so leap years need no special case.
  for (const [label, value] of [['from', fromStr], ['to', toStr]] as const) {
    const [, y, m, d] = value.match(YMD)!;
    const probe = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (
      probe.getUTCFullYear() !== Number(y) ||
      probe.getUTCMonth() !== Number(m) - 1 ||
      probe.getUTCDate() !== Number(d)
    ) {
      throw new DateRangeError(`${label} is not a real date`);
    }
  }

  const from = new Date(`${fromStr}T00:00:00.000+08:00`);
  const to = new Date(`${toStr}T23:59:59.999+08:00`);

  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    throw new DateRangeError('from or to could not be parsed');
  }
  if (to < from) {
    throw new DateRangeError('to must not be earlier than from');
  }

  const maxDays = options.maxDays ?? 366;
  const days = Math.ceil((to.getTime() - from.getTime()) / 86400000);
  if (days > maxDays) {
    throw new DateRangeError(`range must be ${maxDays} days or fewer`);
  }

  return { from, to, fromDate: fromStr, toDate: toStr };
}

/**
 * A star rating, or null if the value is not one.
 *
 * `if (!rating || rating < 1 || rating > 5)` looks like it covers this and does not. The
 * body is JSON, so `rating` can be a string, a boolean, an object - and every comparison
 * against a non-number is false, so all of them passed the guard and went on to be bound
 * into an `INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5)` column:
 *
 *     "5abc"  -> truthy, both comparisons false -> Postgres: invalid input syntax
 *     4.7     -> in range                       -> Postgres: invalid input syntax
 *     true    -> truthy, both comparisons false -> Postgres: invalid input syntax
 *
 * Each of those became a 500 and a failed review the person had already written.
 */
export function parseRating(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;

  const n = Number(value);
  if (!Number.isInteger(n)) return null;      // rejects 4.7, NaN, Infinity and "5abc"
  if (n < 1 || n > 5) return null;

  return n;
}

/**
 * Trimmed free text, or null when it is empty.
 *
 * Returns `{ error }` when it is longer than `maxLength`, so the caller can say which
 * field and how long rather than letting the database truncate or reject it.
 */
export function parseBoundedText(
  value: unknown,
  maxLength: number,
  fieldName: string
): { value: string | null } | { error: string } {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== 'string') return { error: `${fieldName} must be text` };

  const trimmed = value.trim();
  if (trimmed.length === 0) return { value: null };
  if (trimmed.length > maxLength) {
    return { error: `${fieldName} must be ${maxLength} characters or fewer` };
  }

  return { value: trimmed };
}
