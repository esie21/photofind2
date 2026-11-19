/**
 * Turning the three stored portfolio columns into the projects both screens render.
 *
 * The data is deliberately split across three places - portfolio_images is the ordered
 * list of what exists, portfolio_meta hangs captions and album names off each path, and
 * portfolio_albums hangs context off each album name - so *nothing* renders without
 * joining all three first. The public profile and the provider's editor both need that
 * join, and when each had its own version they disagreed about the two cases that
 * actually matter: which item is the cover, and where un-grouped work goes.
 *
 * Group into projects rather than showing a flat wall of media because that is what a
 * client is actually assessing. They are asking "can this person deliver a whole job at
 * this standard", and a set of nine frames from one wedding answers that in a way that
 * nine unrelated frames cannot.
 */

import { getStoredPath } from '../api/config';
import { isVideoPath } from './media';
import type { PortfolioAlbumMeta, PortfolioAlbums, PortfolioMeta } from '../api/services/authService';

/** Where work with no album of its own collects, so nothing is silently dropped. */
export const UNGROUPED_PROJECT_NAME = 'Other work';

export interface PortfolioProject {
  /** Album name, and the identity used everywhere - filter chips, cover lookup, keys. */
  name: string;
  description: string;
  /**
   * The project's primary label: the legacy category when it has one, otherwise its first
   * tag. The public filter chips group on this, so a project saved with tags only (as the
   * editor now does) still has something to be filtered by.
   */
  category: string;
  /** Every label, legacy category first, de-duplicated - see projectTags. */
  tags: string[];
  services: string[];
  location: string;
  /** ISO date (YYYY-MM-DD), or '' when the provider hasn't dated it. */
  doneOn: string;
  /** End of a date range, or '' for a single date. */
  dateEnd: string;
  clientType: string;
  duration: string;
  priceRange: string;
  outcome: string;
  beforeAfter: boolean;
  /** Stored paths, in portfolio order - which is the order the provider arranged. */
  items: string[];
  /**
   * Stored path of the item to lead with, falling back to items[0]. Empty only for a
   * project with no items, which only the editor asks for (see includeEmpty).
   */
  cover: string;
  count: number;
  /**
   * True for the catch-all bucket. It has no entry in portfolio_albums (there is nothing
   * to edit), so the editor hides its controls and the grid can label it differently.
   */
  isUngrouped: boolean;
}

/**
 * One project's context, whether or not the provider has filled any of it in.
 */
function albumMeta(albums: PortfolioAlbums, name: string): PortfolioAlbumMeta {
  return albums[name] || {};
}

/**
 * Group an ordered item list into projects.
 *
 * Ordering has two layers, and they are not the same thing:
 *  - Between projects: `order` when set, otherwise the position of the project's first
 *    item. A provider who has never touched project ordering still gets a grid that
 *    follows the arrangement they dragged their items into.
 *  - Within a project: strictly portfolio order. Sets read as a sequence, so the
 *    provider's arrangement is the narrative and nothing may re-sort it.
 */
export function groupPortfolio(
  images: string[] | undefined,
  meta: PortfolioMeta | undefined,
  albums: PortfolioAlbums | undefined,
  /**
   * includeEmpty: also return projects that exist in portfolio_albums but have no items
   * yet. The editor needs them - a project is created first and filled after - but the
   * public grid must not show a client an empty card, so it is off by default.
   */
  opts: { includeEmpty?: boolean } = {}
): PortfolioProject[] {
  const items = Array.isArray(images) ? images : [];
  const itemMeta = meta || {};
  const albumInfo = albums || {};

  // Insertion order of this Map is first-appearance order, which is the fallback
  // ordering below - so it is built by walking `items` once, in order.
  const grouped = new Map<string, string[]>();
  const ungrouped: string[] = [];

  for (const image of items) {
    const path = getStoredPath(image);
    const album = (itemMeta[path]?.album || '').trim();
    if (!album) {
      ungrouped.push(path);
      continue;
    }
    if (!grouped.has(album)) grouped.set(album, []);
    grouped.get(album)!.push(path);
  }

  if (opts.includeEmpty) {
    // After every project that has items, so with no explicit `order` an empty one ranks
    // last - which is where a just-created project should appear.
    for (const name of Object.keys(albums || {})) {
      if (name.trim() && !grouped.has(name)) grouped.set(name, []);
    }
  }

  // Sorted as (project, tiebreaker) pairs rather than by stashing the tiebreaker on the
  // project and deleting it afterwards - the sort key is not part of what a project is.
  const ranked = [...grouped].map(([name, paths], appearance) => {
    const info = albumMeta(albumInfo, name);
    // A cover that was deleted, or moved into another project, must not leave the card
    // rendering a broken tile. The backend prunes this on save, but a profile loaded
    // from a stale cache can still carry one, and the fallback costs nothing.
    // A before/after job leads with its first "after" when the provider hasn't picked a
    // cover: the finished result is what sells the work, and defaulting to the first item
    // usually put the *before* - the mess - on the card.
    const firstAfter = info.before_after
      ? paths.find((path) => {
          const partner = itemMeta[path]?.before;
          return partner ? paths.includes(getStoredPath(partner)) : false;
        })
      : undefined;
    const cover = info.cover && paths.includes(getStoredPath(info.cover))
      ? getStoredPath(info.cover)
      : firstAfter || paths[0] || '';

    const tags = projectTags(info);
    const project: PortfolioProject = {
      name,
      description: (info.description || '').trim(),
      category: tags[0] || '',
      tags,
      services: cleanList(info.services),
      location: (info.location || '').trim(),
      doneOn: (info.done_on || '').trim(),
      dateEnd: (info.date_end || '').trim(),
      clientType: (info.client_type || '').trim(),
      duration: (info.duration || '').trim(),
      priceRange: (info.price_range || '').trim(),
      outcome: (info.outcome || '').trim(),
      beforeAfter: info.before_after === true,
      items: paths,
      cover,
      count: paths.length,
      isUngrouped: false,
    };

    // An explicitly ordered project always outranks an unordered one, rather than
    // Infinity-vs-Infinity leaving the comparison to chance.
    const order = info.order;
    return {
      project,
      order: Number.isFinite(order as number) ? (order as number) : Number.MAX_SAFE_INTEGER,
      appearance,
    };
  });

  ranked.sort((a, b) => (a.order !== b.order ? a.order - b.order : a.appearance - b.appearance));

  const projects: PortfolioProject[] = ranked.map((entry) => entry.project);

  // Always last. It is the leftovers, and leading with it would put the provider's
  // least-organised work in the position a client looks at first.
  if (ungrouped.length > 0) {
    projects.push({
      name: UNGROUPED_PROJECT_NAME,
      description: '',
      category: '',
      tags: [],
      services: [],
      location: '',
      doneOn: '',
      dateEnd: '',
      clientType: '',
      duration: '',
      priceRange: '',
      outcome: '',
      beforeAfter: false,
      items: ungrouped,
      cover: ungrouped[0],
      count: ungrouped.length,
      isUngrouped: true,
    });
  }

  return projects;
}

/**
 * The line under a project's title: "Tagaytay · March 2026".
 *
 * Month and year, never the day. The point is to show the work is recent and real, and a
 * day-level date on a wedding is a detail nobody asked for that also ages the work faster
 * than it deserves.
 */
export function describeProjectContext(project: PortfolioProject): string {
  const parts: string[] = [];
  if (project.location) parts.push(project.location);

  const when = describeProjectDates(project.doneOn, project.dateEnd);
  if (when) parts.push(when);

  return parts.join(' · ');
}

/**
 * "March 2026", or for a range "March – May 2026" / "Dec 2025 – Jan 2026".
 *
 * Month-level for the same reason as a single date: the point is recency, not the
 * calendar. Parsed and formatted in UTC - left to the local timezone, '2026-03-01' in
 * UTC-5 renders as February, and these are plain calendar dates, not instants.
 */
export function describeProjectDates(start: string, end: string): string {
  const parse = (value: string) => {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return isNaN(date.getTime()) ? null : date;
  };
  const from = parse(start);
  if (!from) return '';
  const to = parse(end);

  const month = (d: Date, style: 'long' | 'short') =>
    d.toLocaleDateString('en-US', { month: style, timeZone: 'UTC' });
  const year = (d: Date) => d.getUTCFullYear();

  if (!to || (from.getUTCMonth() === to.getUTCMonth() && year(from) === year(to))) {
    return `${month(from, 'long')} ${year(from)}`;
  }
  if (year(from) === year(to)) {
    return `${month(from, 'long')} – ${month(to, 'long')} ${year(to)}`;
  }
  return `${month(from, 'short')} ${year(from)} – ${month(to, 'short')} ${year(to)}`;
}

/** Trimmed, non-empty strings from a stored list, tolerating anything malformed. */
function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? '').trim()).filter(Boolean);
}

/**
 * Every label on a project: the legacy category (if any) first, then its tags,
 * de-duplicated without regard to case.
 *
 * The category comes first because it is what the project was filed under before tags
 * existed, so a client who has filtered by it before still finds the project in the same
 * place.
 */
export function projectTags(info: PortfolioAlbumMeta): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of [(info.category || '').trim(), ...cleanList(info.tags)]) {
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push(label);
  }
  return out;
}

/** The core details every project is nudged toward, in the order the form asks for them. */
export const CORE_PROJECT_DETAILS = ['title', 'location', 'date', 'brief', 'services'] as const;
export type CoreProjectDetail = (typeof CORE_PROJECT_DETAILS)[number];

export const CORE_DETAIL_LABELS: Record<CoreProjectDetail, string> = {
  title: 'Project title',
  location: 'Location',
  date: 'Date',
  brief: 'What you did',
  services: 'Services provided',
};

/**
 * How many of the five core details a project has: "3 of 5 details added".
 *
 * The title always counts - a project cannot exist without its name - so the floor is 1,
 * which reads as progress already made rather than a blank scorecard.
 */
export function projectCompleteness(
  name: string,
  info: PortfolioAlbumMeta
): { done: number; total: number; missing: CoreProjectDetail[] } {
  const has: Record<CoreProjectDetail, boolean> = {
    title: name.trim().length > 0,
    location: (info.location || '').trim().length > 0,
    date: (info.done_on || '').trim().length > 0,
    brief: (info.description || '').trim().length > 0,
    services: cleanList(info.services).length > 0,
  };
  const missing = CORE_PROJECT_DETAILS.filter((detail) => !has[detail]);
  return { done: CORE_PROJECT_DETAILS.length - missing.length, total: CORE_PROJECT_DETAILS.length, missing };
}

/** Suggested length of a project brief. Longer briefs from before this limit still save. */
export const BRIEF_SUGGESTED_LENGTH = 200;

/**
 * Tag suggestions, starting from the provider's own service category.
 *
 * Keyed by the platform's existing CATEGORY_OPTIONS, with a general list for everything
 * else - "Other", a caterer, a cleaner, a tutor - so a provider whose trade is not in that
 * list still gets suggestions that fit any kind of job. Suggestions only: the provider can
 * type anything.
 */
const TAG_SUGGESTIONS: Record<string, string[]> = {
  Photography: ['Wedding', 'Debut', 'Birthday', 'Christening', 'Portrait', 'Product', 'Corporate', 'Graduation'],
  'Wedding Photography': ['Wedding', 'Pre-nup', 'Engagement', 'Church', 'Beach wedding', 'Garden wedding', 'Reception'],
  'Portrait Photography': ['Portrait', 'Family', 'Maternity', 'Newborn', 'Graduation', 'Headshot', 'Couple'],
  'Event Photography': ['Debut', 'Birthday', 'Christening', 'Corporate', 'Concert', 'Reunion', 'Party'],
  'Commercial Photography': ['Product', 'Food', 'Real estate', 'Fashion', 'Brand', 'E-commerce', 'Interior'],
  Videography: ['Wedding film', 'Same-day edit', 'Debut', 'Corporate video', 'Music video', 'Drone', 'Highlights'],
  'Makeup Artist': ['Bridal', 'Debut', 'Glam', 'Natural', 'Editorial', 'Airbrush', 'Before & after'],
  Design: ['Branding', 'Logo', 'Social media', 'Print', 'Packaging', 'Invitation', 'Web'],
  'Event Organizer': ['Wedding', 'Debut', 'Birthday', 'Corporate', 'Styling', 'Coordination', 'Venue setup'],
};

const GENERAL_TAG_SUGGESTIONS = [
  'Residential', 'Commercial', 'Event', 'Rush job', 'Before & after', 'Repeat client', 'Small job', 'Large job',
];

export function suggestedTags(providerCategory: string | undefined, alreadyUsed: string[] = []): string[] {
  const base = TAG_SUGGESTIONS[(providerCategory || '').trim()] || [];
  // The provider's own earlier tags first: reusing "Kitchen" across jobs is what makes a
  // tag useful as a filter, and it is the strongest signal of what they actually do.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of [...alreadyUsed, ...base, ...GENERAL_TAG_SUGGESTIONS]) {
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/** Trades where a before/after comparison is the natural way to show the work. */
export function suggestsBeforeAfter(providerCategory: string | undefined, tags: string[] = []): boolean {
  const haystack = [providerCategory || '', ...tags].join(' ').toLowerCase();
  return /makeup|repair|clean|renovat|before|restor|groom|salon|hair|detail|paint/.test(haystack);
}

/** "9 items" / "1 item", for the card's count line. */
export function describeProjectSize(count: number): string {
  return `${count} item${count === 1 ? '' : 's'}`;
}

/**
 * The still for the strip across the top of a provider's profile.
 *
 * The strip is a still. A video leading the portfolio contributes its poster frame;
 * without one, the first actual photo stands in rather than leaving a raw video path in an
 * <img> to fail loading. And it is the leading project's chosen cover, not simply the first
 * file uploaded - a provider who picked a cover for their best project meant it to be the
 * first thing seen.
 */
export function portfolioCoverImage(
  images: string[] | undefined,
  meta: PortfolioMeta | undefined,
  albums: PortfolioAlbums | undefined,
  /** The provider's explicit choice (users.portfolio_cover), when they made one. */
  chosen?: string | null
): string {
  const all = Array.isArray(images) ? images : [];
  const first = effectiveCover(all, meta, albums, chosen);
  if (!first) return '';
  if (!isVideoPath(first)) return first;
  return (meta || {})[getStoredPath(first)]?.poster || all.find((img) => !isVideoPath(img)) || '';
}

/**
 * Which item is the profile cover: the provider's explicit choice when it is still one of
 * their items, otherwise the leading project's cover, otherwise the first item. Returns the
 * stored path, video or not - portfolioCoverImage turns it into a still.
 */
export function effectiveCover(
  images: string[] | undefined,
  meta: PortfolioMeta | undefined,
  albums: PortfolioAlbums | undefined,
  chosen?: string | null
): string {
  const all = (Array.isArray(images) ? images : []).map(getStoredPath);
  const picked = chosen ? getStoredPath(chosen) : '';
  if (picked && all.includes(picked)) return picked;
  return groupPortfolio(all, meta, albums)[0]?.cover || all[0] || '';
}
