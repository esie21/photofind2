/**
 * The provider-editable fields of a portfolio, and how each one is checked.
 *
 * A portfolio is three columns on users: portfolio_images (what exists, in order),
 * portfolio_meta (per item, keyed by stored path) and portfolio_albums (per project, keyed
 * by project name). Everything here is optional and additive: a portfolio saved before any
 * of these fields existed is still valid, and renders exactly as it did.
 *
 * Kept apart from routes/users.ts because the same rules have to hold for every route that
 * writes these columns, and because the route was already long enough that a new field
 * added there was easy to validate in one branch and forget in another.
 */

export const MAX_PROJECT_TAGS = 10;
export const MAX_ITEM_TAGS = 8;
export const MAX_TAG_LENGTH = 30;
export const MAX_PROJECT_SERVICES = 10;
export const MAX_SERVICE_LENGTH = 40;
export const MAX_ALT_LENGTH = 200;
export const MAX_SHORT_FIELD = 60;
export const MAX_OUTCOME_LENGTH = 300;

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * A provider-typed list of labels: tags, services.
 *
 * Normalised rather than just checked, because these are matched on later (tag
 * suggestions, filter chips) and "Wedding", "wedding " and "Wedding" twice are one tag to
 * the provider. Whitespace is collapsed, duplicates are dropped case-insensitively (the
 * first spelling wins), and empty entries are ignored rather than rejected - an empty chip
 * left in a form is not an error worth refusing the whole save for.
 */
export function normaliseLabelList(
  value: unknown,
  opts: { max: number; maxLength: number; label: string }
): FieldResult<string[]> {
  if (value == null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, error: `${opts.label} must be a list` };

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (raw == null) continue;
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      return { ok: false, error: `Each of the ${opts.label.toLowerCase()} must be text` };
    }
    const label = String(raw).replace(/\s+/g, ' ').trim();
    if (!label) continue;
    if (label.length > opts.maxLength) {
      return { ok: false, error: `${opts.label} must be ${opts.maxLength} characters or fewer each` };
    }
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  if (out.length > opts.max) {
    return { ok: false, error: `Use at most ${opts.max} ${opts.label.toLowerCase()}` };
  }
  return { ok: true, value: out };
}

/** Optional free text with a length cap. '' means unset. */
export function optionalText(value: unknown, max: number, label: string): FieldResult<string> {
  if (value == null) return { ok: true, value: '' };
  if (typeof value !== 'string' && typeof value !== 'number') {
    return { ok: false, error: `${label} must be text` };
  }
  const text = String(value).trim();
  if (text.length > max) return { ok: false, error: `${label} must be ${max} characters or fewer` };
  return { ok: true, value: text };
}

/**
 * A plain calendar date (YYYY-MM-DD) for finished work, or '' when unset.
 *
 * One full day of slack on "not in the future", not "end of today in UTC": the date picker
 * offers the provider's *local* today, which in Manila is tomorrow in UTC between midnight
 * and 8am. The furthest-ahead zone is UTC+14, so 24 hours covers every one of them and
 * still blocks a date genuinely days out.
 */
export function pastCalendarDate(value: unknown, label: string): FieldResult<string> {
  if (value == null || String(value).trim() === '') return { ok: true, value: '' };
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { ok: false, error: `${label} must look like YYYY-MM-DD` };
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  // Round-tripping catches 2026-02-30, which Date silently rolls into March.
  if (isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    return { ok: false, error: `${label} is not a real date` };
  }
  if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    return { ok: false, error: `${label} cannot be in the future` };
  }
  return { ok: true, value: text };
}

/** The new, optional per-project fields. Legacy fields stay validated in routes/users.ts. */
export interface ProjectExtras {
  tags?: string[];
  services?: string[];
  date_end?: string;
  client_type?: string;
  duration?: string;
  price_range?: string;
  outcome?: string;
  before_after?: boolean;
}

/**
 * Checks the optional project fields, returning only the ones that are set.
 *
 * `doneOn` is the already-validated start date. A range needs a start: an end date on its
 * own reads as "finished on", which is what done_on already means.
 */
export function validateProjectExtras(value: any, doneOn: string): FieldResult<ProjectExtras> {
  const tags = normaliseLabelList(value.tags, { max: MAX_PROJECT_TAGS, maxLength: MAX_TAG_LENGTH, label: 'Tags' });
  if (!tags.ok) return tags;
  const services = normaliseLabelList(value.services, {
    max: MAX_PROJECT_SERVICES,
    maxLength: MAX_SERVICE_LENGTH,
    label: 'Services',
  });
  if (!services.ok) return services;

  const dateEnd = pastCalendarDate(value.date_end, 'The end date');
  if (!dateEnd.ok) return dateEnd;
  if (dateEnd.value) {
    if (!doneOn) return { ok: false, error: 'Add a start date before an end date' };
    if (dateEnd.value < doneOn) return { ok: false, error: 'The end date cannot be before the start date' };
  }

  const clientType = optionalText(value.client_type, MAX_SHORT_FIELD, 'Client type');
  if (!clientType.ok) return clientType;
  const duration = optionalText(value.duration, MAX_SHORT_FIELD, 'Duration');
  if (!duration.ok) return duration;
  const priceRange = optionalText(value.price_range, MAX_SHORT_FIELD, 'Price range');
  if (!priceRange.ok) return priceRange;
  const outcome = optionalText(value.outcome, MAX_OUTCOME_LENGTH, 'Results');
  if (!outcome.ok) return outcome;

  if (value.before_after != null && typeof value.before_after !== 'boolean') {
    return { ok: false, error: 'before_after must be true or false' };
  }

  return {
    ok: true,
    value: {
      ...(tags.value.length ? { tags: tags.value } : {}),
      ...(services.value.length ? { services: services.value } : {}),
      // Collapsed when equal to the start: a one-day job is not a range.
      ...(dateEnd.value && dateEnd.value !== doneOn ? { date_end: dateEnd.value } : {}),
      ...(clientType.value ? { client_type: clientType.value } : {}),
      ...(duration.value ? { duration: duration.value } : {}),
      ...(priceRange.value ? { price_range: priceRange.value } : {}),
      ...(outcome.value ? { outcome: outcome.value } : {}),
      ...(value.before_after === true ? { before_after: true } : {}),
    },
  };
}

/** The new, optional per-item fields. `before` is checked against the portfolio later. */
export interface ItemExtras {
  alt?: string;
  tags?: string[];
  /** Stored path of the item this one is the "after" of. */
  before?: string;
}

export function validateItemExtras(
  value: any,
  normalisePath: (v: unknown) => string
): FieldResult<ItemExtras> {
  const alt = optionalText(value.alt, MAX_ALT_LENGTH, 'Alt text');
  if (!alt.ok) return alt;
  const tags = normaliseLabelList(value.tags, { max: MAX_ITEM_TAGS, maxLength: MAX_TAG_LENGTH, label: 'Tags' });
  if (!tags.ok) return tags;
  if (value.before != null && typeof value.before !== 'string') {
    return { ok: false, error: 'before must be the path of another portfolio item' };
  }
  const before = value.before ? normalisePath(value.before) : '';

  return {
    ok: true,
    value: {
      ...(alt.value ? { alt: alt.value } : {}),
      ...(tags.value.length ? { tags: tags.value } : {}),
      ...(before ? { before } : {}),
    },
  };
}

/**
 * Drops before/after pairings that no longer make sense, in place.
 *
 * Run against the metadata that is actually about to be stored, after deletions and album
 * moves have been applied - which is why it is a pruning step and not part of validation.
 * A pairing survives only when:
 *  - the "before" item still exists and is not the item itself;
 *  - both items are in the same project (a pair split across two jobs is not a comparison);
 *  - the "before" item is not itself an "after" (no chains - a slider has two ends);
 *  - no earlier item has already claimed that "before" (one before, one after).
 *
 * "Earlier" is portfolio order, so the provider's arrangement decides any tie.
 */
export function prunePairings(
  meta: Record<string, { album?: string; before?: string }>,
  order: string[]
): void {
  const exists = new Set(Object.keys(meta).concat(order));
  const afters = new Set(
    Object.entries(meta)
      .filter(([, entry]) => entry.before)
      .map(([path]) => path)
  );
  const claimed = new Set<string>();

  const ordered = [...order, ...Object.keys(meta).filter((p) => !order.includes(p))];
  for (const path of ordered) {
    const entry = meta[path];
    if (!entry?.before) continue;
    const before = entry.before;
    const target = meta[before];
    const valid =
      before !== path &&
      exists.has(before) &&
      (entry.album || '').trim() === (target?.album || '').trim() &&
      !afters.has(before) &&
      !claimed.has(before);
    if (valid) {
      claimed.add(before);
    } else {
      delete entry.before;
      afters.delete(path);
    }
  }
}
