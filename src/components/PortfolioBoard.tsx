import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDndContext,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CheckCircle, ChevronLeft, ChevronRight, Edit, GripVertical, XCircle } from 'lucide-react';
import { getStoredPath } from '../api/config';
import type { PortfolioImageMeta } from '../api/services/authService';
import { PortfolioThumbnail } from './PortfolioMedia';
import { moveItem, nudgeItem, sectionOf, type Layout } from '../utils/portfolioLayout';
import { describeProjectSize } from '../utils/portfolio';

/**
 * The editor's grid: one section per project, then un-grouped work, with every item
 * draggable within and between sections.
 *
 * Dragging is by a handle on each tile rather than the whole tile, for two reasons:
 *  - Touch. A whole-tile drag on a phone either fights the page scroll or needs a
 *    long-press delay nobody discovers. A handle starts a drag the moment it is touched
 *    (touch-action: none on the handle only) and leaves the rest of the tile to scroll.
 *  - Keyboard. The handle is a button, so Space/Enter picks the item up and the arrow keys
 *    move it - including into the next project - without colliding with the tile's own
 *    "open" button, whose Enter would otherwise start a drag.
 *
 * Every change goes to `onLayoutChange` as a staged draft; nothing here saves.
 */

const SECTION_PREFIX = 'section:';
const sectionId = (name: string) => `${SECTION_PREFIX}${name}`;

/**
 * What the dragged item is over: whatever is under the pointer, preferring a tile to the
 * section it sits in (so the drop lands at that tile's position, not the section's end).
 *
 * closestCorners alone - which measures from the dragged item's rectangle, not the pointer -
 * picked the wrong section when sections differ in size: a full-width "drop here" box and a
 * single tile have very different corners. Keyboard drags have no pointer, so they keep
 * closestCorners, which is what sortableKeyboardCoordinates is designed around.
 */
const collisionDetection: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCorners(args);
  const hits = pointerWithin(args);
  const tile = hits.find((hit) => !String(hit.id).startsWith(SECTION_PREFIX));
  if (tile) return [tile];
  if (hits.length > 0) return hits;
  return closestCorners(args);
};

interface PortfolioBoardProps {
  layout: Layout;
  onLayoutChange: (next: Layout) => void;
  editMode: boolean;
  selectMode: boolean;
  busy: boolean;
  /** Stored path of the profile cover, for its badge. */
  coverPath: string;
  metaFor: (path: string) => PortfolioImageMeta;
  /** What a screen reader calls this item: its caption, or its position. */
  labelFor: (path: string) => string;
  isSelected: (path: string) => boolean;
  onTileClick: (path: string) => void;
  onEditItem: (path: string) => void;
  pendingDelete: string | null;
  onRequestDelete: (path: string | null) => void;
  onConfirmDelete: (path: string) => void;
  /** Rendered at the end of the un-grouped section - the upload slot. */
  addSlot?: ReactNode;
}

export function PortfolioBoard(props: PortfolioBoardProps) {
  const { layout, onLayoutChange, editMode, selectMode, busy, metaFor, labelFor } = props;
  const [activeId, setActiveId] = useState<string | null>(null);
  // The layout as it was when the drag began, so Escape puts everything back - including
  // a cross-project move that was applied while the item was still in the air.
  const before = useRef<Layout | null>(null);

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so a tap on the handle stays a tap.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const dragEnabled = editMode && !selectMode && !busy;

  // Which items are halves of a before/after pair, so their tiles can say so. Pairs are
  // stored on the "after" (meta.before = its partner), so the "before" side is found by
  // looking for whoever points at it.
  const pairRoles = useMemo(() => {
    const roles = new Map<string, 'before' | 'after'>();
    for (const section of layout) {
      for (const item of section.items) {
        const partner = metaFor(item).before;
        if (!partner) continue;
        roles.set(getStoredPath(item), 'after');
        roles.set(getStoredPath(partner), 'before');
      }
    }
    return roles;
  }, [layout, metaFor]);
  const hasProjects = layout.some((section) => !section.isUngrouped);

  /** The section index an id refers to: a section's own droppable, or the item's section. */
  const containerOf = (id: UniqueIdentifier): number => {
    const value = String(id);
    if (value.startsWith(SECTION_PREFIX)) {
      const name = value.slice(SECTION_PREFIX.length);
      return layout.findIndex((section) => section.name === name);
    }
    return sectionOf(layout, value);
  };
  const sectionLabel = (id: UniqueIdentifier) => {
    const index = containerOf(id);
    return index >= 0 ? layout[index].name : 'the portfolio';
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    before.current = layout;
  };

  // A move into another section happens on drop, not while the item is in the air. Moving
  // it mid-drag (the usual multi-list pattern) resized both sections under the pointer - an
  // empty project's full-width drop box collapsed to one tile the moment the item entered -
  // and the next collision check then sent it on to whatever section was now nearest, so a
  // drop aimed at an empty project landed in a different one. The target section is
  // outlined instead (see BoardSection), and the overlay shows what is being carried.
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    before.current = null;
    if (!over) return;
    const from = containerOf(active.id);
    const to = containerOf(over.id);
    if (from < 0 || to < 0) return;

    const overIsSection = String(over.id).startsWith(SECTION_PREFIX);
    const items = layout[to].items.map(getStoredPath);
    const activeKey = getStoredPath(String(active.id));

    if (from !== to) {
      const index = overIsSection ? items.length : Math.max(0, items.indexOf(getStoredPath(String(over.id))));
      onLayoutChange(moveItem(layout, activeKey, to, index));
      return;
    }
    if (overIsSection) return;
    const oldIndex = items.indexOf(activeKey);
    const newIndex = items.indexOf(getStoredPath(String(over.id)));
    if (oldIndex !== newIndex && oldIndex >= 0 && newIndex >= 0) {
      onLayoutChange(moveItem(layout, activeKey, to, newIndex));
    }
  };

  const onDragCancel = () => {
    if (before.current) onLayoutChange(before.current);
    before.current = null;
    setActiveId(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            'To move this item, press space or enter to pick it up. Use the arrow keys to move it, ' +
            'including into another project, then press space or enter to drop it, or escape to cancel.',
        },
        announcements: {
          onDragStart: ({ active }) => `Picked up ${labelFor(String(active.id))}.`,
          onDragOver: ({ active, over }) =>
            over
              ? `${labelFor(String(active.id))} is in ${sectionLabel(over.id)}.`
              : `${labelFor(String(active.id))} is not over a project.`,
          onDragEnd: ({ active, over }) =>
            over
              ? `Dropped ${labelFor(String(active.id))} in ${sectionLabel(over.id)}.`
              : `Dropped ${labelFor(String(active.id))}.`,
          onDragCancel: ({ active }) => `Cancelled. ${labelFor(String(active.id))} is back where it was.`,
        },
      }}
    >
      <div className="pf-board">
        {layout.map((section) => {
          // With no projects at all there is nothing to section, and the board is just the
          // grid it always was. Other work is hidden only when empty and not editable.
          if (section.isUngrouped && section.items.length === 0 && !editMode && !props.addSlot) return null;
          return (
            <BoardSection
              key={section.name}
              id={sectionId(section.name)}
              title={hasProjects ? section.name : null}
              count={section.items.length}
              isUngrouped={section.isUngrouped}
              items={section.items}
              editMode={editMode}
              trailing={section.isUngrouped ? props.addSlot : null}
            >
              {section.items.map((path) => (
                <BoardTile
                  key={getStoredPath(path)}
                  path={path}
                  dragEnabled={dragEnabled}
                  pairRole={pairRoles.get(getStoredPath(path)) || null}
                  {...props}
                />
              ))}
            </BoardSection>
          );
        })}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeId ? (
          <div className="portfolio-tile pf-tile-overlay">
            <span className="portfolio-tile-image">
              <PortfolioThumbnail path={activeId} meta={metaFor(activeId)} alt="" />
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardSection({
  id,
  title,
  count,
  isUngrouped,
  items,
  editMode,
  trailing,
  children,
}: {
  id: string;
  title: string | null;
  count: number;
  isUngrouped: boolean;
  items: string[];
  editMode: boolean;
  trailing: ReactNode;
  children: ReactNode;
}) {
  // The whole section is a drop target, which is what makes an empty project - or an empty
  // Other work - something an item can be dropped into at all.
  const { setNodeRef } = useDroppable({ id });
  // Outlined while the item being dragged would land here - over this section's empty
  // space or over one of its tiles - but only when that would actually move it to another
  // section; reordering within its own section shows the gap opening instead.
  const { active, over } = useDndContext();
  const keys = items.map(getStoredPath);
  const overHere = over != null && (String(over.id) === id || keys.includes(String(over.id)));
  const isOver = active != null && overHere && !keys.includes(String(active.id));

  return (
    <section className="pf-board-section" aria-label={title || 'Portfolio items'}>
      {title && (
        <h4 className="pf-board-section__title">
          {title}
          <span className="pf-board-section__count">{describeProjectSize(count)}</span>
        </h4>
      )}
      <SortableContext items={items.map(getStoredPath)} strategy={rectSortingStrategy}>
        <div ref={setNodeRef} className={`portfolio-grid ${isOver ? 'pf-board-section__grid--over' : ''}`}>
          {children}
          {count === 0 && editMode && (
            <div className="pf-board-empty">
              {isUngrouped
                ? 'Drag work here to take it out of a project.'
                : 'Empty project. Drag photos or videos here.'}
            </div>
          )}
          {trailing}
        </div>
      </SortableContext>
    </section>
  );
}

function BoardTile({
  path,
  dragEnabled,
  layout,
  onLayoutChange,
  editMode,
  selectMode,
  busy,
  coverPath,
  metaFor,
  labelFor,
  isSelected,
  onTileClick,
  onEditItem,
  pendingDelete,
  onRequestDelete,
  onConfirmDelete,
  pairRole,
}: PortfolioBoardProps & { path: string; dragEnabled: boolean; pairRole: 'before' | 'after' | null }) {
  const key = getStoredPath(path);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: key, disabled: !dragEnabled });

  const meta = metaFor(path);
  const label = labelFor(path);
  const selected = isSelected(path);
  const section = sectionOf(layout, path);
  const position = section >= 0 ? layout[section].items.findIndex((p) => getStoredPath(p) === key) : -1;
  const sectionLength = section >= 0 ? layout[section].items.length : 0;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`portfolio-tile ${isDragging ? 'portfolio-tile--dragging' : ''} ${selected ? 'portfolio-tile--selected' : ''} ${
        editMode && !selectMode ? 'portfolio-tile--editing' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onTileClick(path)}
        className="portfolio-tile-image"
        title={selectMode ? 'Select this item' : 'View and label this item'}
        aria-pressed={selectMode ? selected : undefined}
      >
        <PortfolioThumbnail path={path} meta={meta} alt={meta.alt || meta.caption || label} />
      </button>

      {selectMode && (
        <span className={`portfolio-check ${selected ? 'portfolio-check--on' : ''}`}>
          {selected && <CheckCircle className="w-4 h-4" />}
        </span>
      )}

      {!selectMode && key === coverPath && (
        <span className="portfolio-badge portfolio-badge--cover">Cover</span>
      )}

      {/* What this item is, at a glance: its half of a before/after pair and its tags. The
          project name used to be repeated on every tile here; the section heading says it
          once now. The video marker (play icon, duration) is drawn by PortfolioThumbnail. */}
      {(pairRole || (meta.tags && meta.tags.length > 0)) && (
        <span className="pf-tile-info" aria-hidden="true">
          {pairRole && (
            <span className="pf-tile-chip pf-tile-chip--pair">{pairRole === 'before' ? 'Before' : 'After'}</span>
          )}
          {meta.tags && meta.tags.length > 0 && <span className="pf-tile-chip">{meta.tags[0]}</span>}
          {meta.tags && meta.tags.length > 1 && <span className="pf-tile-chip">+{meta.tags.length - 1}</span>}
        </span>
      )}

      {dragEnabled && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="pf-drag-handle"
          aria-label={`Drag ${label} to another spot`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4" aria-hidden="true" />
        </button>
      )}

      {editMode && !selectMode && pendingDelete === key ? (
        <div className="portfolio-confirm">
          <p className="text-white text-xs">Remove this item?</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirmDelete(path)}
              className="px-2 py-1 bg-red-600 text-white text-xs rounded-md hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? 'Removing...' : 'Remove'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onRequestDelete(null)}
              className="px-2 py-1 bg-white text-gray-700 text-xs rounded-md hover:bg-gray-100 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        editMode &&
        !selectMode && (
          // A bar along the bottom edge only, visible while focused, so every action is
          // reachable by keyboard; the arrows stay as the no-drag way to reorder.
          <div className="portfolio-actions">
            <button
              type="button"
              disabled={busy || position <= 0}
              onClick={() => onLayoutChange(nudgeItem(layout, path, -1))}
              className="portfolio-action"
              title="Move earlier"
              aria-label={`Move ${label} earlier`}
            >
              <ChevronLeft className="w-4 h-4 text-gray-700" />
            </button>
            <button
              type="button"
              disabled={busy || position < 0 || position >= sectionLength - 1}
              onClick={() => onLayoutChange(nudgeItem(layout, path, 1))}
              className="portfolio-action"
              title="Move later"
              aria-label={`Move ${label} later`}
            >
              <ChevronRight className="w-4 h-4 text-gray-700" />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onEditItem(path)}
              className="portfolio-action"
              title="Caption, project and details"
              aria-label={`Edit details for ${label}`}
            >
              <Edit className="w-4 h-4 text-gray-700" />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onRequestDelete(key)}
              className="portfolio-action"
              title="Remove"
              aria-label={`Remove ${label}`}
            >
              <XCircle className="w-4 h-4 text-red-600" />
            </button>
          </div>
        )
      )}
    </div>
  );
}
