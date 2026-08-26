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
import type { PortfolioAlbumMeta, PortfolioAlbums, PortfolioMeta } from '../api/services/authService';

/** Where work with no album of its own collects, so nothing is silently dropped. */
export const UNGROUPED_PROJECT_NAME = 'Other work';

export interface PortfolioProject {
  /** Album name, and the identity used everywhere - filter chips, cover lookup, keys. */
  name: string;
  description: string;
  category: string;
  location: string;
  /** ISO date (YYYY-MM-DD), or '' when the provider hasn't dated it. */
  doneOn: string;
  /** Stored paths, in portfolio order - which is the order the provider arranged. */
  items: string[];
  /** Stored path of the item to lead with. Never empty: falls back to items[0]. */
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
  albums: PortfolioAlbums | undefined
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

  // Sorted as (project, tiebreaker) pairs rather than by stashing the tiebreaker on the
  // project and deleting it afterwards - the sort key is not part of what a project is.
  const ranked = [...grouped].map(([name, paths], appearance) => {
    const info = albumMeta(albumInfo, name);
    // A cover that was deleted, or moved into another project, must not leave the card
    // rendering a broken tile. The backend prunes this on save, but a profile loaded
    // from a stale cache can still carry one, and the fallback costs nothing.
    const cover = info.cover && paths.includes(getStoredPath(info.cover))
      ? getStoredPath(info.cover)
      : paths[0];

    const project: PortfolioProject = {
      name,
      description: (info.description || '').trim(),
      category: (info.category || '').trim(),
      location: (info.location || '').trim(),
      doneOn: (info.done_on || '').trim(),
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
      location: '',
      doneOn: '',
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

  if (project.doneOn) {
    // Parsed as UTC and formatted in UTC. Left to the local timezone, '2026-03-01' in
    // UTC-5 renders as February - the date is a plain calendar date, not an instant.
    const date = new Date(`${project.doneOn}T00:00:00Z`);
    if (!isNaN(date.getTime())) {
      parts.push(date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }));
    }
  }

  return parts.join(' · ');
}

/** "9 items" / "1 item", for the card's count line. */
export function describeProjectSize(count: number): string {
  return `${count} item${count === 1 ? '' : 's'}`;
}
