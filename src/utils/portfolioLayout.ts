/**
 * The editor's view of a portfolio: projects as sections, each an ordered list of items,
 * with un-grouped work in a section of its own at the end.
 *
 * Dragging an item from one project into another changes two stored things at once - its
 * position in portfolio_images and its album in portfolio_meta - and the projects' own
 * order in portfolio_albums has to agree with both, or the public grid would come out in a
 * different order from the one the provider arranged. Working on sections and converting
 * back only at save time keeps those three in step by construction, and keeps every move a
 * plain function that can be tested without a browser.
 */

import { getStoredPath } from '../api/config';
import type { PortfolioAlbums, PortfolioMeta } from '../api/services/authService';
import { groupPortfolio, UNGROUPED_PROJECT_NAME } from './portfolio';

export interface LayoutSection {
  /** Project name; UNGROUPED_PROJECT_NAME for the un-grouped section. */
  name: string;
  isUngrouped: boolean;
  /** Stored paths, in order. */
  items: string[];
}

export type Layout = LayoutSection[];

/**
 * Sections from what is stored: every project in grid order - including ones with nothing
 * in them yet - then the un-grouped section, which is always present so there is somewhere
 * to drag work *out* of a project to.
 */
export function buildLayout(
  images: string[] | undefined,
  meta: PortfolioMeta | undefined,
  albums: PortfolioAlbums | undefined
): Layout {
  const projects = groupPortfolio(images, meta, albums, { includeEmpty: true });
  const named: Layout = projects
    .filter((p) => !p.isUngrouped)
    .map((p) => ({ name: p.name, isUngrouped: false, items: [...p.items] }));
  const ungrouped = projects.find((p) => p.isUngrouped);
  return [...named, { name: UNGROUPED_PROJECT_NAME, isUngrouped: true, items: ungrouped ? [...ungrouped.items] : [] }];
}

/** Every item, section by section: the order portfolio_images is stored in. */
export function flattenLayout(layout: Layout): string[] {
  return layout.flatMap((section) => section.items);
}

/** Which section an item is in, or -1. */
export function sectionOf(layout: Layout, path: string): number {
  const key = getStoredPath(path);
  return layout.findIndex((section) => section.items.some((item) => getStoredPath(item) === key));
}

/**
 * Moves an item to `toSection` at `toIndex` (clamped), returning a new layout. Moving within
 * a section works the same way. An unknown item or section returns the layout unchanged.
 */
export function moveItem(layout: Layout, path: string, toSection: number, toIndex: number): Layout {
  const from = sectionOf(layout, path);
  if (from === -1 || toSection < 0 || toSection >= layout.length) return layout;

  const key = getStoredPath(path);
  const next = layout.map((section) => ({ ...section, items: [...section.items] }));
  const fromItems = next[from].items;
  const fromIndex = fromItems.findIndex((item) => getStoredPath(item) === key);
  const [moved] = fromItems.splice(fromIndex, 1);

  const target = next[toSection].items;
  const index = Math.max(0, Math.min(toIndex, target.length));
  target.splice(index, 0, moved);
  return next;
}

/** One step earlier or later within its own section - the arrow buttons on a tile. */
export function nudgeItem(layout: Layout, path: string, delta: -1 | 1): Layout {
  const section = sectionOf(layout, path);
  if (section === -1) return layout;
  const key = getStoredPath(path);
  const index = layout[section].items.findIndex((item) => getStoredPath(item) === key);
  const to = index + delta;
  if (to < 0 || to >= layout[section].items.length) return layout;
  return moveItem(layout, path, section, to);
}

/** Moves several items to the end of one section, keeping their relative order. */
export function moveItemsToSection(layout: Layout, paths: string[], toSection: number): Layout {
  const keys = new Set(paths.map(getStoredPath));
  let next = layout;
  for (const item of flattenLayout(layout)) {
    if (keys.has(getStoredPath(item))) next = moveItem(next, item, toSection, Number.MAX_SAFE_INTEGER);
  }
  return next;
}

export function removeItems(layout: Layout, paths: string[]): Layout {
  const keys = new Set(paths.map(getStoredPath));
  return layout.map((section) => ({
    ...section,
    items: section.items.filter((item) => !keys.has(getStoredPath(item))),
  }));
}

/** Whether two layouts would store differently - same items, same places, same order. */
export function layoutsDiffer(a: Layout, b: Layout): boolean {
  const signature = (layout: Layout) =>
    layout.map((s) => `${s.name}\u0000${s.items.map(getStoredPath).join('\u0001')}`).join('\u0002');
  return signature(a) !== signature(b);
}

/**
 * The three stored columns for a layout.
 *
 * - images: section order, then item order within each.
 * - meta: each item's album set to its section (removed for un-grouped work); everything
 *   else on the entry - caption, tags, the file-derived fields - is carried over untouched.
 * - albums: every project kept, with `order` rewritten to its section position, so the
 *   public grid's ordering agrees with the arrangement exactly. A project the layout no
 *   longer has (deleted) is dropped.
 */
export function commitLayout(
  layout: Layout,
  meta: PortfolioMeta,
  albums: PortfolioAlbums
): { images: string[]; meta: PortfolioMeta; albums: PortfolioAlbums } {
  const images = flattenLayout(layout).map(getStoredPath);

  const nextMeta: PortfolioMeta = {};
  for (const section of layout) {
    for (const item of section.items) {
      const path = getStoredPath(item);
      const { album: _previous, ...rest } = meta[path] || {};
      const entry = section.isUngrouped ? rest : { ...rest, album: section.name };
      if (Object.keys(entry).length > 0) nextMeta[path] = entry;
    }
  }

  const nextAlbums: PortfolioAlbums = {};
  layout
    .filter((section) => !section.isUngrouped)
    .forEach((section, index) => {
      nextAlbums[section.name] = { ...(albums[section.name] || {}), order: index };
    });

  return { images, meta: nextMeta, albums: nextAlbums };
}
