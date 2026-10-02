import { useState, useRef, useEffect, useMemo, useCallback, type Dispatch, type SetStateAction } from 'react';
import { Plus, X, ChevronUp, ChevronDown, Trash2, FolderOpen } from 'lucide-react';
import { PortfolioThumbnail, PortfolioPlayer } from './PortfolioMedia';
import { useModal } from '../hooks/useModal';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import userService from '../api/services/userService';
import { getStoredPath } from '../api/config';
import type { PortfolioAlbumMeta, PortfolioAlbums, PortfolioMeta } from '../api/services/authService';
import {
  groupPortfolio,
  describeProjectSize,
  projectTags,
  projectCompleteness,
  suggestedTags,
  suggestsBeforeAfter,
  BRIEF_SUGGESTED_LENGTH,
  CORE_DETAIL_LABELS,
  UNGROUPED_PROJECT_NAME,
  effectiveCover,
  type PortfolioProject,
} from '../utils/portfolio';
import { TagInput } from './TagInput';
import { PortfolioBoard } from './PortfolioBoard';
import {
  buildLayout,
  commitLayout,
  flattenLayout,
  layoutsDiffer,
  moveItemsToSection,
  removeItems,
  sectionOf,
  type Layout,
} from '../utils/portfolioLayout';
import { isVideoFile, formatDuration, generatePoster, generateThumbnail, compressPhoto } from '../utils/media';
import {
  MAX_PORTFOLIO_IMAGES,
  MAX_VIDEO_SECONDS,
  ALLOWED_MEDIA_TYPES,
  COMPRESS_ABOVE_BYTES,
  fileProblemBeforeProcessing,
  fileProblemAfterProcessing,
} from '../utils/mediaValidation';
import { PortfolioUploadList, type UploadItem } from './PortfolioUploadList';

/**
 * The provider's portfolio editor: upload, arrange, group into projects, label.
 *
 * Lives inside the dashboard's profile tab and shares its edit mode. It reads and writes the
 * dashboard's form state rather than keeping its own copy, because the profile's own Save
 * also posts portfolio_images and portfolio_meta - two copies would let that Save write back
 * a stale portfolio over changes made here.
 */


/** Working copy of one project's details while its row is open for editing. */
interface ProjectDraft {
  name: string;
  /** The brief - "What you did". */
  description: string;
  /** Includes the legacy category, folded in when the project was opened. */
  tags: string[];
  services: string[];
  location: string;
  /** ISO date (YYYY-MM-DD), or '' when not dated. */
  doneOn: string;
  /** End of a multi-day job, or ''. */
  dateEnd: string;
  clientType: string;
  duration: string;
  priceRange: string;
  outcome: string;
  beforeAfter: boolean;
  /** Stored path of the chosen cover, or '' to fall back to the first item. */
  cover: string;
}

/** Working copy of one item's details while its dialog is open. */
interface ItemDraft {
  caption: string;
  /** Project name, or '' for Other work. */
  album: string;
  alt: string;
  tags: string[];
  /** Stored path of the item this one is the "after" of, or ''. */
  before: string;
}

const EMPTY_ITEM_DRAFT: ItemDraft = { caption: '', album: '', alt: '', tags: [], before: '' };

// Mirrors backend/src/utils/portfolioSchema.ts.
const MAX_ITEM_TAGS = 8;
const MAX_ALT_LENGTH = 200;
const MAX_CAPTION_LENGTH = 140;

const EMPTY_DRAFT: ProjectDraft = {
  name: '', description: '', tags: [], services: [], location: '', doneOn: '', dateEnd: '',
  clientType: '', duration: '', priceRange: '', outcome: '', beforeAfter: false, cover: '',
};

// Mirrors backend/src/utils/portfolioSchema.ts.
const MAX_PROJECT_TAGS = 10;
const MAX_PROJECT_SERVICES = 10;
const MAX_TAG_LENGTH = 30;
const MAX_SERVICE_LENGTH = 40;
const MAX_SHORT_FIELD = 60;
const MAX_OUTCOME_LENGTH = 300;
// The server's own cap on a description. Briefs are nudged to BRIEF_SUGGESTED_LENGTH, but
// one written before that limit existed is never truncated by opening and re-saving it.
const MAX_DESCRIPTION_LENGTH = 600;

/** The slice of the dashboard's profile form this editor reads and writes. */
export interface PortfolioFormState {
  portfolio_images: string[];
  portfolio_meta: PortfolioMeta;
  portfolio_albums: PortfolioAlbums;
  /** Stored path of the chosen profile cover; '' or null means choose automatically. */
  portfolio_cover?: string | null;
  /** The provider's own service category - only used to pick placeholder wording. */
  category?: string;
  [key: string]: any;
}

interface PortfolioEditorProps {
  editMode: boolean;
  formState: PortfolioFormState;
  setFormState: Dispatch<SetStateAction<any>>;
  /** Names of the provider's own services, offered as "Services provided" suggestions. */
  serviceTitles?: string[];
}

export function PortfolioEditor({ editMode, formState, setFormState, serviceTitles = [] }: PortfolioEditorProps) {
  const { user, refreshUser, applyUser } = useAuth();
  const toast = useToast();

  const portfolioFileRef = useRef<HTMLInputElement | null>(null);
  const [uploadingPortfolio, setUploadingPortfolio] = useState(false);
  // One row per file in the current (or last) upload - see PortfolioUploadList.
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const patchUpload = (id: string, patch: Partial<UploadItem>) =>
    setUploads((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  // Index of the image the provider has asked to remove, awaiting confirmation.
  // Deleting is irreversible - the backend unlinks the file - so one stray click on a
  // small icon used to be enough to lose a photo for good.
  const [portfolioPendingDelete, setPortfolioPendingDelete] = useState<string | null>(null);
  // Any portfolio write (remove / reorder / caption) in flight, so nothing fires twice.
  const [portfolioBusy, setPortfolioBusy] = useState(false);
  const [portfolioPreview, setPortfolioPreview] = useState<number | null>(null);
  // A rearrangement the provider is still working on - order and which project each item
  // is in. Held locally so that dragging ten photos into place is one save at the end, not
  // ten round trips, and so it can be abandoned wholesale with Cancel.
  const [layoutDraft, setLayoutDraft] = useState<Layout | null>(null);
  // Creating a project: the name being typed, or null while the form is closed.
  const [newProjectName, setNewProjectName] = useState<string | null>(null);
  // Deleting a project: which one is asking for confirmation.
  const [projectPendingDelete, setProjectPendingDelete] = useState<string | null>(null);
  // Bulk selection, by stored path rather than index, so it survives a reorder.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [bulkAlbum, setBulkAlbum] = useState('');
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  // Everything editable about one item, while its detail dialog is open.
  const [detailDraft, setDetailDraft] = useState<ItemDraft>(EMPTY_ITEM_DRAFT);
  // Which project's details are open for editing, by album name, plus the working copy.
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>(EMPTY_DRAFT);
  // Length of the brief when the form opened. A brief written before the 200-character
  // guidance existed may be longer, and must still be editable without being cut short.
  const [briefLimit, setBriefLimit] = useState(BRIEF_SUGGESTED_LENGTH);
  // The optional section starts open when anything in it is already filled in, so a
  // provider never has a saved value hidden from them.
  const [showMoreDetails, setShowMoreDetails] = useState(false);

  /**
   * Writes a new portfolio arrangement and/or its captions to the server, then to the
   * form.
   *
   * Server first, deliberately: updating local state up front made a failed request
   * look like it had worked, and the change silently reverted on the next refresh.
   *
   * The image list always goes with the request even when only captions changed. The
   * backend prunes portfolio_meta against it, so sending both is what keeps a removed
   * photo's caption from lingering in the column.
   */
  const persistPortfolio = async (
    next: { images?: string[]; meta?: PortfolioMeta; albums?: PortfolioAlbums; cover?: string | null },
    success: { title: string; body: string }
  ) => {
    if (!user || portfolioBusy) return false;

    const images = next.images ?? (formState.portfolio_images || []);
    const keys = new Set(images.map((img: string) => getStoredPath(img)));
    // Mirror the server's pruning locally, so the form doesn't hold captions for images
    // that no longer exist until the next refresh.
    const sourceMeta: PortfolioMeta = next.meta ?? (formState.portfolio_meta || {});
    const meta: PortfolioMeta = {};
    for (const [path, value] of Object.entries(sourceMeta)) {
      if (keys.has(getStoredPath(path))) meta[getStoredPath(path)] = value;
    }

    // Projects are sent as they are, including ones with nothing in them: a project is now
    // created before it is filled, and deleted explicitly rather than by moving its last
    // item out. (This used to drop any project with no items, mirroring a server prune that
    // no longer exists.)
    const albums: PortfolioAlbums = next.albums ?? (formState.portfolio_albums || {});

    setPortfolioBusy(true);
    try {
      // The PUT returns the full updated row, so the signed-in user is refreshed from
      // that rather than by a second call to /auth/me - which is what every reorder,
      // caption edit and deletion used to cost.
      const updated = await userService.updateUser(user.id, {
        portfolio_images: images,
        portfolio_meta: meta,
        portfolio_albums: albums,
        ...(next.cover !== undefined ? { portfolio_cover: next.cover } : {}),
      } as any);
      setFormState((s: any) => ({
        ...s,
        portfolio_images: (updated.portfolio_images || images) as string[],
        portfolio_meta: (updated.portfolio_meta || meta) as PortfolioMeta,
        portfolio_albums: (updated.portfolio_albums || albums) as PortfolioAlbums,
        portfolio_cover: updated.portfolio_cover ?? null,
      }));
      applyUser(updated);
      toast.success(success.title, success.body);
      return true;
    } catch (err: any) {
      console.error('Portfolio update failed', err);
      toast.error('Could not update your portfolio', err?.message || 'Please try again.');
      return false;
    } finally {
      setPortfolioBusy(false);
    }
  };

  /**
   * Uploads photos and videos, shared by the file picker and the drop zone.
   *
   * One file at a time, each with its own progress and its own outcome, so a file that
   * fails - wrong type, too big, a clip too long, the item limit reached - is reported on its
   * own row while the rest still arrive. It used to be one request for the whole batch,
   * which the server rejected outright if any single file failed its checks.
   *
   * Each file is prepared before it is sent:
   *  - Photos over COMPRESS_ABOVE_BYTES are re-encoded as WebP (see compressPhoto), which
   *    also means a phone photo too big for the server's limit can now get in rather than
   *    being refused.
   *  - Every item gets a small derived image - a video's poster frame, a photo's gallery
   *    thumbnail - which the grids render instead of the original.
   *  - A clip that runs too long is caught before its bytes go over the wire, since the
   *    browser is the only thing here that can decode video.
   */
  const uploadPortfolioFiles = async (files: File[], slotsLeft: number) => {
    if (!user || files.length === 0 || uploadingPortfolio) return;
    // New items would not appear in an unsaved arrangement - it lists only what existed
    // when it was started - so they would seem to vanish until the arrangement was saved.
    if (orderDirty) {
      toast.error('Save your arrangement first', 'Save or cancel the changes to your layout, then add more.');
      return;
    }

    const stamp = Date.now();
    let room = slotsLeft;
    const items: UploadItem[] = files.map((file, index) => {
      const item: UploadItem = {
        id: `${stamp}-${index}`,
        name: file.name || `File ${index + 1}`,
        isVideo: isVideoFile(file),
        originalSize: file.size,
        status: 'waiting',
        progress: 0,
      };
      const problem = fileProblemBeforeProcessing(file);
      if (problem) return { ...item, status: 'failed', error: problem };
      if (room <= 0) {
        return {
          ...item,
          status: 'failed',
          error: `No room left - your portfolio holds ${MAX_PORTFOLIO_IMAGES} items. Remove one to add another.`,
        };
      }
      room -= 1;
      return item;
    });
    setUploads(items);
    if (!items.some((item) => item.status === 'waiting')) return;

    setUploadingPortfolio(true);
    let added = 0;
    let lastResponse: any = null;
    // Paths already in the portfolio, for a server too old to report `added` itself.
    const known = new Set(((formState.portfolio_images || []) as string[]).map((img) => getStoredPath(img)));

    try {
      for (const [index, item] of items.entries()) {
        if (item.status !== 'waiting') continue;
        try {
          patchUpload(item.id, { status: 'preparing' });
          let file = files[index];
          let compressed = false;
          let preview: { kind: 'poster' | 'thumb'; file: File; duration?: number; width?: number; height?: number } | null = null;

          if (item.isVideo) {
            const result = await generatePoster(file);
            if (result && result.duration > MAX_VIDEO_SECONDS + 1) {
              throw new Error(
                `Runs ${formatDuration(result.duration)}. Videos can be up to ${MAX_VIDEO_SECONDS} seconds - trim it and try again.`
              );
            }
            // A null result just means this browser couldn't decode the file (Chrome and
            // Firefox generally refuse .mov). The upload still goes ahead; the thumbnail
            // falls back to whatever first frame the viewer's own browser can show.
            if (result) {
              preview = { kind: 'poster', file: result.poster, duration: result.duration, width: result.width, height: result.height };
            }
          } else {
            if (file.size > COMPRESS_ABOVE_BYTES) {
              const result = await compressPhoto(file);
              file = result.file;
              compressed = result.compressed;
            }
            const sizeProblem = fileProblemAfterProcessing(file, compressed);
            if (sizeProblem) throw new Error(sizeProblem);
            const thumb = await generateThumbnail(file);
            if (thumb) preview = { kind: 'thumb', file: thumb.thumb, width: thumb.width, height: thumb.height };
          }

          patchUpload(item.id, { status: 'uploading', progress: 0, sentSize: file.size, compressed });
          const response = await userService.uploadPortfolioImages(user.id, [file], (percent) =>
            patchUpload(item.id, { progress: percent })
          );
          lastResponse = response;
          const path =
            response.added?.[0] ||
            ((response.portfolio_images || []) as string[]).find((img) => !known.has(getStoredPath(img)));
          if (path) known.add(getStoredPath(path));

          // A missing thumbnail only means that tile loads the full-size file, so a failure
          // here is logged rather than reported as the upload failing - the file is stored.
          if (path && preview) {
            await userService
              .uploadPortfolioPreview(user.id, getStoredPath(path), preview)
              .catch((e) => console.error('Preview upload failed for', path, e));
          }

          patchUpload(item.id, { status: 'done', progress: 100 });
          added += 1;
        } catch (err: any) {
          patchUpload(item.id, { status: 'failed', error: err?.message || 'Could not upload this file.' });
        }
      }
    } finally {
      if (added > 0) {
        // One read at the end settles what all those writes produced, and doubles as the
        // refresh the signed-in user needs. The form is set directly because the resync
        // effect is deliberately paused while editing.
        const fresh = (await refreshUser()) || lastResponse;
        if (fresh) {
          setFormState((s: any) => ({
            ...s,
            portfolio_images: (fresh.portfolio_images || []) as string[],
            portfolio_meta: (fresh.portfolio_meta || {}) as PortfolioMeta,
            portfolio_albums: (fresh.portfolio_albums || {}) as PortfolioAlbums,
            portfolio_cover: fresh.portfolio_cover ?? null,
          }));
        }
      }
      setUploadingPortfolio(false);
    }

    const failed = items.length - added;
    if (added > 0 && failed === 0) {
      toast.success('Added to your portfolio', `${added} file${added === 1 ? '' : 's'} uploaded. Drag them into a project.`);
      // Nothing to read on a clean run; the list clears itself. A run with failures stays
      // until dismissed, because those rows are the only record of what went wrong.
      setTimeout(() => setUploads((list) => (list.every((u) => u.status === 'done') ? [] : list)), 4000);
    } else if (added > 0) {
      toast.error('Some files were not added', `${added} added, ${failed} not added - see the list for why.`);
    } else {
      toast.error('Nothing was added', 'See the list under Portfolio for why.');
    }
  };

  // Leaving edit mode - by saving or by cancelling - abandons any portfolio work that
  // was still only staged locally, so it can't reappear the next time editing starts.
  useEffect(() => {
    if (editMode) return;
    setLayoutDraft(null);
    setPortfolioPendingDelete(null);
    setNewProjectName(null);
    setProjectPendingDelete(null);
    setSelectMode(false);
    setSelectedPaths([]);
    setBulkAlbum('');
    setBulkDeleteConfirm(false);
  }, [editMode]);

  const portfolioImages: string[] = formState.portfolio_images || [];
  const portfolioMeta: PortfolioMeta = formState.portfolio_meta || {};
  const portfolioSlotsLeft = Math.max(0, MAX_PORTFOLIO_IMAGES - portfolioImages.length);

  const portfolioAlbums: PortfolioAlbums = formState.portfolio_albums || {};

  // What the grid renders: the unsaved arrangement while one is in progress, otherwise
  // what is saved, as project sections.
  const savedLayout = useMemo(
    () => buildLayout(portfolioImages, portfolioMeta, portfolioAlbums),
    [portfolioImages, portfolioMeta, portfolioAlbums]
  );
  const displayLayout = layoutDraft ?? savedLayout;
  const displayOrder = useMemo(() => flattenLayout(displayLayout), [displayLayout]);
  const orderDirty = useMemo(
    () => layoutDraft !== null && layoutsDiffer(layoutDraft, savedLayout),
    [layoutDraft, savedLayout]
  );
  // The profile cover as it stands - the provider's choice, or the automatic one.
  const coverPath = effectiveCover(portfolioImages, portfolioMeta, portfolioAlbums, formState.portfolio_cover);
  const coverIsChosen = Boolean(formState.portfolio_cover) && coverPath === getStoredPath(formState.portfolio_cover || '');

  // Dragging fires a state update on every dragenter, so the whole dashboard re-renders
  // dozens of times over one gesture. These are the values the grid reads on each of
  // those renders; recomputing them every time is the difference between a smooth drag
  // and a stuttering one on a full 24-item portfolio.
  const metaFor = useCallback(
    (image: string) => portfolioMeta[getStoredPath(image)] || {},
    [portfolioMeta]
  );

  /** Opens the detail dialog for one item, seeded with its caption and current project. */
  const openImageDetail = (path: string) => {
    const index = displayOrder.findIndex((p) => getStoredPath(p) === getStoredPath(path));
    if (index < 0) return;
    const section = sectionOf(displayLayout, path);
    const inProject = section >= 0 && !displayLayout[section].isUngrouped;
    const meta = metaFor(path);
    setDetailDraft({
      caption: meta.caption || '',
      album: inProject ? displayLayout[section].name : '',
      alt: meta.alt || '',
      tags: (meta.tags || []).slice(0, MAX_ITEM_TAGS),
      before: meta.before || '',
    });
    setPortfolioPreview(index);
  };

  /** Screen-reader name for an item: its alt text or caption, else its position. */
  const labelFor = useCallback(
    (path: string) => {
      const meta = metaFor(path);
      if (meta.alt || meta.caption) return `"${meta.alt || meta.caption}"`;
      const index = displayOrder.findIndex((p) => getStoredPath(p) === getStoredPath(path));
      return `item ${index + 1}`;
    },
    [metaFor, displayOrder]
  );

  // The same join the public grid uses, so what the provider arranges here is literally
  // what a client sees - the two used to derive grouping separately and disagree about
  // covers and un-grouped work. includeEmpty because a project the provider has created
  // but not filled yet still has to be listed here, even though clients never see it.
  const projects: PortfolioProject[] = useMemo(
    () =>
      groupPortfolio(portfolioImages, portfolioMeta, portfolioAlbums, { includeEmpty: true }).filter(
        (project) => !project.isUngrouped
      ),
    [portfolioImages, portfolioMeta, portfolioAlbums]
  );

  /** Saves an arrangement: order, project membership and project order in one write. */
  const saveLayout = async (layout: Layout, success: { title: string; body: string }, extra: { cover?: string | null } = {}) => {
    const committed = commitLayout(layout, portfolioMeta, portfolioAlbums);
    const ok = await persistPortfolio({ ...committed, ...extra }, success);
    if (ok) setLayoutDraft(null);
    return ok;
  };

  const isProjectName = (name: string, except = '') =>
    name.toLowerCase() === UNGROUPED_PROJECT_NAME.toLowerCase() ||
    projects.some((p) => p.name.toLowerCase() === name.toLowerCase() && p.name !== except);

  /** Creates an empty project, last in the grid. Work is dragged into it afterwards. */
  const createProject = async () => {
    const name = (newProjectName || '').replace(/\s+/g, ' ').trim();
    if (!name) {
      toast.error('Name required', 'Give the project a name, e.g. "Santos debut" or "Office deep clean".');
      return;
    }
    if (isProjectName(name)) {
      toast.error('Name already used', `You already have a project called "${name}".`);
      return;
    }
    const ok = await persistPortfolio(
      { albums: { ...portfolioAlbums, [name]: { order: projects.length } } },
      { title: 'Project created', body: `Drag photos or videos into "${name}" below.` }
    );
    if (ok) setNewProjectName(null);
  };

  /**
   * Deletes a project. Its items either go back to Other work, or are deleted with it -
   * the provider chooses, because "delete this project" is ambiguous about the photos and
   * guessing wrong in the destructive direction cannot be undone.
   */
  const deleteProject = async (name: string, deleteItems: boolean) => {
    const index = displayLayout.findIndex((section) => section.name === name);
    if (index < 0) return;
    const items = displayLayout[index].items;
    const ungrouped = displayLayout.findIndex((section) => section.isUngrouped);
    let next = deleteItems ? removeItems(displayLayout, items) : moveItemsToSection(displayLayout, items, ungrouped);
    next = next.filter((section) => section.name !== name);
    const ok = await saveLayout(next, {
      title: 'Project deleted',
      body: deleteItems
        ? `"${name}" and its ${describeProjectSize(items.length)} were removed.`
        : `"${name}" was removed. Its work is now under ${UNGROUPED_PROJECT_NAME}.`,
    });
    if (ok) setProjectPendingDelete(null);
  };

  /**
   * Saves one project's details.
   *
   * Renaming is the interesting case. The album name *is* the project's identity - it is
   * the key in portfolio_albums and the value in every member image's meta.album - so a
   * rename has to move both halves in a single write, or the details would detach from
   * their images and the project would split into two: an empty one under the new name
   * and a bare one under the old.
   */
  const saveProject = async (original: string, draft: ProjectDraft) => {
    const name = draft.name.trim();
    if (!name) {
      toast.error('Name required', 'Give this project a name so clients know what it is.');
      return;
    }
    if (name !== original && isProjectName(name, original)) {
      toast.error('Name already used', `You already have a project called "${name}".`);
      return;
    }

    const nextMeta: PortfolioMeta = {};
    for (const [path, entry] of Object.entries(portfolioMeta)) {
      nextMeta[path] =
        (entry.album || '').trim() === original ? { ...entry, album: name } : entry;
    }

    const nextAlbums: PortfolioAlbums = {};
    for (const [key, value] of Object.entries(portfolioAlbums)) {
      if (key !== original) nextAlbums[key] = value;
    }
    if (draft.dateEnd && !draft.doneOn) {
      toast.error('Add a start date', 'An end date needs a start date to go with it.');
      return;
    }
    if (draft.dateEnd && draft.dateEnd < draft.doneOn) {
      toast.error('Check the dates', 'The end date is before the start date.');
      return;
    }

    // No `category`: a legacy one was folded into the tags when this form opened, so it is
    // saved as a tag now. That is what lets a caterer or a cleaner label their work - the
    // category list only fits some of the trades on the platform.
    const text = (value: string) => value.trim();
    const entry: PortfolioAlbumMeta = {
      ...(text(draft.description) ? { description: text(draft.description) } : {}),
      ...(draft.tags.length ? { tags: draft.tags } : {}),
      ...(draft.services.length ? { services: draft.services } : {}),
      ...(text(draft.location) ? { location: text(draft.location) } : {}),
      ...(draft.doneOn ? { done_on: draft.doneOn } : {}),
      ...(draft.dateEnd && draft.dateEnd !== draft.doneOn ? { date_end: draft.dateEnd } : {}),
      ...(text(draft.clientType) ? { client_type: text(draft.clientType) } : {}),
      ...(text(draft.duration) ? { duration: text(draft.duration) } : {}),
      ...(text(draft.priceRange) ? { price_range: text(draft.priceRange) } : {}),
      ...(text(draft.outcome) ? { outcome: text(draft.outcome) } : {}),
      ...(draft.beforeAfter ? { before_after: true } : {}),
      ...(draft.cover ? { cover: draft.cover } : {}),
      ...(portfolioAlbums[original]?.order !== undefined
        ? { order: portfolioAlbums[original].order }
        : {}),
    };
    nextAlbums[name] = entry;

    const ok = await persistPortfolio(
      { meta: nextMeta, albums: nextAlbums },
      { title: 'Project saved', body: `"${name}" is up to date on your profile.` }
    );
    if (ok) setEditingProject(null);
  };

  /** Opens one project's form, seeded from what is saved. `focusBrief` jumps to the brief. */
  const openProjectEditor = (project: PortfolioProject, focusBrief = false) => {
    const info = portfolioAlbums[project.name] || {};
    const description = info.description || '';
    const draft: ProjectDraft = {
      name: project.name,
      description,
      tags: projectTags(info).slice(0, MAX_PROJECT_TAGS),
      services: (info.services || []).slice(0, MAX_PROJECT_SERVICES),
      location: info.location || '',
      doneOn: info.done_on || '',
      dateEnd: info.date_end || '',
      clientType: info.client_type || '',
      duration: info.duration || '',
      priceRange: info.price_range || '',
      outcome: info.outcome || '',
      beforeAfter: info.before_after === true,
      cover: info.cover || '',
    };
    setProjectDraft(draft);
    setBriefLimit(Math.min(MAX_DESCRIPTION_LENGTH, Math.max(BRIEF_SUGGESTED_LENGTH, description.length)));
    setShowMoreDetails(
      Boolean(draft.clientType || draft.duration || draft.priceRange || draft.outcome || draft.beforeAfter)
    );
    setEditingProject(project.name);
    if (focusBrief) {
      // After the form has rendered.
      requestAnimationFrame(() => document.getElementById('pf-project-brief')?.focus());
    }
  };

  // Every tag the provider has used on any project, so the same label gets reused across
  // jobs - which is what makes it work as a filter for a client.
  const usedTags = useMemo(
    () => Object.values(portfolioAlbums).flatMap((info) => projectTags(info || {})),
    [portfolioAlbums]
  );
  const tagSuggestions = useMemo(
    () => suggestedTags(formState.category, usedTags),
    [formState.category, usedTags]
  );
  // Item tags: what the provider has already used on items, then on projects, then the
  // suggestions for their trade - the same order and reasoning as project tags.
  const itemTagSuggestions = useMemo(() => {
    const usedOnItems = Object.values(portfolioMeta).flatMap((entry) => entry?.tags || []);
    return suggestedTags(formState.category, [...usedOnItems, ...usedTags]);
  }, [portfolioMeta, usedTags, formState.category]);

  const serviceSuggestions = useMemo(() => {
    const used = Object.values(portfolioAlbums).flatMap((info) => info?.services || []);
    const seen = new Set<string>();
    return [...serviceTitles, ...used]
      .map((t) => (t || '').trim())
      .filter((t) => t && t.length <= MAX_SERVICE_LENGTH && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
  }, [serviceTitles, portfolioAlbums]);

  /**
   * Moves a project up or down the public grid.
   *
   * Writes an explicit `order` on every project, not just the two being swapped. Order is
   * optional in the data - projects without one fall back to the position of their first
   * image - so setting it on a pair alone would rank those two against a fallback the
   * provider can't see, and the result would look arbitrary.
   */
  const moveProject = async (from: number, to: number) => {
    // `projects` no longer includes the un-grouped bucket, which has no entry to order and
    // is pinned last regardless.
    if (orderDirty) {
      toast.error('Save your arrangement first', 'Save or cancel the changes below, then reorder projects.');
      return;
    }
    const ordered = projects.map((p) => p.name);
    if (from < 0 || to < 0 || from >= ordered.length || to >= ordered.length) return;

    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);

    const nextAlbums: PortfolioAlbums = { ...portfolioAlbums };
    ordered.forEach((name, index) => {
      nextAlbums[name] = { ...(nextAlbums[name] || {}), order: index };
    });

    await persistPortfolio(
      { albums: nextAlbums },
      { title: 'Order saved', body: 'Your projects are in the new order.' }
    );
  };

  const toggleSelected = (image: string) => {
    const path = getStoredPath(image);
    setSelectedPaths((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  };
  const isSelected = (image: string) => selectedPaths.includes(getStoredPath(image));

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedPaths([]);
    setBulkAlbum('');
    setBulkDeleteConfirm(false);
  };

  const previewOpen =
    portfolioPreview !== null && portfolioPreview >= 0 && portfolioPreview < displayOrder.length;
  const previewImage = previewOpen ? displayOrder[portfolioPreview!] : '';

  // Providers could only ever see their portfolio as small thumbnails here - there was
  // no way to check a photo at full size, let alone label it, without opening their own
  // public profile.
  const { overlayProps: previewOverlayProps, cardProps: previewCardProps } = useModal(
    () => setPortfolioPreview(null),
    { enabled: previewOpen, closeOnEscape: !portfolioBusy, label: 'Portfolio item details', manageFocus: true }
  );

  return (
    <>
    {/* Portfolio */}
    <div className="bg-white rounded-2xl p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-gray-900">Portfolio</h2>
          {/* The 24-item cap was invisible here until an upload failed. */}
          <p className="text-xs text-gray-500 mt-1">
            {portfolioImages.length} of {MAX_PORTFOLIO_IMAGES} photos and videos
            {portfolioImages.length > 0 && editMode && ' - drag the handle on a tile to move it, including into another project'}
          </p>
          {coverPath && (
            <p className="pf-cover-line">
              Profile cover: {coverIsChosen ? 'chosen by you' : "automatic (your first project's cover)"}
              {editMode && coverIsChosen && (
                <button
                  type="button"
                  className="pf-link-button"
                  disabled={portfolioBusy}
                  onClick={() =>
                    persistPortfolio(
                      { cover: null },
                      { title: 'Cover reset', body: "Your first project's cover is your profile cover again." }
                    )
                  }
                >
                  Use automatic
                </button>
              )}
            </p>
          )}
        </div>

        <input
          type="file"
          accept={ALLOWED_MEDIA_TYPES.join(',')}
          ref={portfolioFileRef}
          name="images"
          id="profile-portfolio"
          multiple
          className="hidden"
          onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            // Clear the input before awaiting, so picking the same file twice in
            // a row still fires a change event.
            if (portfolioFileRef.current) portfolioFileRef.current.value = '';
            await uploadPortfolioFiles(files, portfolioSlotsLeft);
          }}
        />

        {editMode && (
          <div className="flex items-center gap-2">
            {portfolioImages.length > 0 && (
              <button
                onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-sm"
              >
                {selectMode ? 'Done' : 'Select'}
              </button>
            )}
            <button
              onClick={() => portfolioFileRef.current?.click()}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={uploadingPortfolio || portfolioSlotsLeft === 0 || orderDirty}
              title={
                portfolioSlotsLeft === 0
                  ? `Limit of ${MAX_PORTFOLIO_IMAGES} items reached`
                  : orderDirty
                    ? 'Save or cancel your arrangement first'
                    : undefined
              }
            >
              <Plus className="w-4 h-4" />
              {uploadingPortfolio ? 'Uploading...' : 'Add photos or videos'}
            </button>
          </div>
        )}
      </div>

      <PortfolioUploadList items={uploads} onDismiss={() => setUploads([])} />

      {/* Rearranging is staged locally and saved once, rather than one request
          per nudge - dragging ten photos into place is a single write. */}
      {orderDirty && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 p-3 bg-purple-50 border border-purple-200 rounded-xl">
          <p className="text-sm text-purple-900">
            New arrangement not saved yet.
          </p>
          <div className="flex gap-2">
            <button
              disabled={portfolioBusy}
              onClick={() =>
                saveLayout(displayLayout, { title: 'Arrangement saved', body: 'Your portfolio now appears this way.' })
              }
              className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              {portfolioBusy ? 'Saving...' : 'Save order'}
            </button>
            <button
              disabled={portfolioBusy}
              onClick={() => setLayoutDraft(null)}
              className="px-3 py-1.5 bg-white border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {editMode && selectMode && (
        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-gray-700">{selectedPaths.length} selected</p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="pf-visually-hidden" htmlFor="pf-bulk-project">Move selected to</label>
              <select
                id="pf-bulk-project"
                value={bulkAlbum}
                onChange={(e) => setBulkAlbum(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
              >
                <option value="">Move to project...</option>
                {displayLayout.map((section) => (
                  <option key={section.name} value={section.name}>
                    {section.isUngrouped ? `${UNGROUPED_PROJECT_NAME} (no project)` : section.name}
                  </option>
                ))}
              </select>
              <button
                disabled={portfolioBusy || selectedPaths.length === 0 || !bulkAlbum}
                onClick={async () => {
                  const target = displayLayout.findIndex((section) => section.name === bulkAlbum);
                  if (target < 0) return;
                  const ok = await saveLayout(moveItemsToSection(displayLayout, selectedPaths, target), {
                    title: `Moved to ${bulkAlbum}`,
                    body: `${describeProjectSize(selectedPaths.length)} moved.`,
                  });
                  if (ok) exitSelectMode();
                }}
                className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                Move
              </button>
              <button
                disabled={portfolioBusy || selectedPaths.length === 0}
                onClick={() => setBulkDeleteConfirm(true)}
                className="px-3 py-1.5 border border-red-200 text-red-600 text-sm rounded-lg hover:bg-red-50 disabled:opacity-50"
              >
                Remove
              </button>
              <button
                onClick={exitSelectMode}
                className="px-3 py-1.5 border border-gray-200 text-sm rounded-lg hover:bg-white"
              >
                Cancel
              </button>
            </div>
          </div>

          {bulkDeleteConfirm && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">
                Remove {describeProjectSize(selectedPaths.length)}? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  disabled={portfolioBusy}
                  onClick={async () => {
                    const ok = await saveLayout(removeItems(displayLayout, selectedPaths), {
                      title: 'Removed',
                      body: `${describeProjectSize(selectedPaths.length)} deleted.`,
                    });
                    if (ok) exitSelectMode();
                  }}
                  className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {portfolioBusy ? 'Removing...' : 'Remove them'}
                </button>
                <button
                  disabled={portfolioBusy}
                  onClick={() => setBulkDeleteConfirm(false)}
                  className="px-3 py-1.5 bg-white border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Keep them
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Projects.
          The grid below is where files live; this is where they become a body of
          work a client can judge. Always there while editing, since this is where a
          project is created; outside editing, only once there is something in it. */}
      {(editMode || projects.length > 0) && (
        <div className="pf-editor-projects">
          <div className="pf-editor-projects__head">
            <div className="pf-editor-projects__titlebar">
              <h3 className="pf-editor-projects__title">Projects</h3>
              {editMode && newProjectName === null && (
                <button
                  type="button"
                  className="pf-new-project"
                  disabled={portfolioBusy}
                  onClick={() => setNewProjectName('')}
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  New project
                </button>
              )}
            </div>
            <p className="pf-editor-projects__hint">
              Clients browse your work one job at a time. A name, where and when it happened,
              and a line about the brief do more than extra photos.
            </p>
            {editMode && newProjectName !== null && (
              <form
                className="pf-new-project-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  createProject();
                }}
              >
                <label className="pf-visually-hidden" htmlFor="pf-new-project-name">New project title</label>
                <input
                  id="pf-new-project-name"
                  autoFocus
                  type="text"
                  maxLength={60}
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setNewProjectName(null);
                  }}
                  placeholder="Project title, e.g. Reyes wedding, Condo repaint"
                  className="pf-field__input"
                />
                <button
                  type="submit"
                  disabled={portfolioBusy}
                  className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50"
                >
                  {portfolioBusy ? 'Creating...' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => setNewProjectName(null)}
                  className="px-3 py-1.5 border border-gray-200 text-sm rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
              </form>
            )}
            {editMode && projects.length === 0 && newProjectName === null && (
              <p className="pf-editor-projects__hint">
                No projects yet. Create one for each job, then drag its photos into it.
              </p>
            )}
          </div>

          {projects.map((project, index, list) => {
            const isEditing = editingProject === project.name;
            const info = portfolioAlbums[project.name] || {};
            return (
              <div key={project.name} className="pf-editor-project">
                {isEditing ? (
                  <div className="pf-editor-project__form">
                    <label className="pf-field">
                      <span className="pf-field__label">Project title</span>
                      <input
                        type="text"
                        maxLength={60}
                        value={projectDraft.name}
                        onChange={(e) => setProjectDraft((d) => ({ ...d, name: e.target.value }))}
                        placeholder="e.g. Santos family reunion, Condo deep clean"
                        className="pf-field__input"
                      />
                    </label>

                    <label className="pf-field">
                      <span className="pf-field__label">
                        What you did
                        <span
                          className={`pf-field__count ${
                            projectDraft.description.length > BRIEF_SUGGESTED_LENGTH ? 'pf-field__count--over' : ''
                          }`}
                        >
                          {projectDraft.description.length}/{BRIEF_SUGGESTED_LENGTH}
                        </span>
                      </span>
                      <textarea
                        id="pf-project-brief"
                        rows={3}
                        maxLength={briefLimit}
                        value={projectDraft.description}
                        onChange={(e) => setProjectDraft((d) => ({ ...d, description: e.target.value }))}
                        placeholder="A short brief: what the client needed and what you delivered."
                        className="pf-field__input pf-field__input--area"
                      />
                      {projectDraft.description.length > BRIEF_SUGGESTED_LENGTH && (
                        <span className="pf-field__hint">
                          Project cards show about the first {BRIEF_SUGGESTED_LENGTH} characters.
                        </span>
                      )}
                    </label>

                    <div className="pf-field-row">
                      <label className="pf-field">
                        <span className="pf-field__label">Location</span>
                        <input
                          type="text"
                          maxLength={120}
                          value={projectDraft.location}
                          onChange={(e) => setProjectDraft((d) => ({ ...d, location: e.target.value }))}
                          placeholder="City or area, e.g. Quezon City"
                          className="pf-field__input"
                        />
                      </label>

                      <label className="pf-field">
                        <span className="pf-field__label">Date</span>
                        <input
                          type="date"
                          value={projectDraft.doneOn}
                          // Today in the provider's own timezone. The server allows a day
                          // of slack past that, so this is the stricter of the two and
                          // never offers a date the save would then refuse.
                          max={new Date().toLocaleDateString('en-CA')}
                          onChange={(e) => setProjectDraft((d) => ({ ...d, doneOn: e.target.value }))}
                          className="pf-field__input"
                        />
                      </label>

                      <label className="pf-field">
                        <span className="pf-field__label">
                          End date
                          <span className="pf-field__count">optional</span>
                        </span>
                        <input
                          type="date"
                          value={projectDraft.dateEnd}
                          min={projectDraft.doneOn || undefined}
                          max={new Date().toLocaleDateString('en-CA')}
                          disabled={!projectDraft.doneOn}
                          title={projectDraft.doneOn ? 'For jobs that ran over several days' : 'Pick a start date first'}
                          onChange={(e) => setProjectDraft((d) => ({ ...d, dateEnd: e.target.value }))}
                          className="pf-field__input"
                        />
                      </label>
                    </div>

                    <TagInput
                      label="Services provided"
                      value={projectDraft.services}
                      onChange={(services) => setProjectDraft((d) => ({ ...d, services }))}
                      suggestions={serviceSuggestions}
                      max={MAX_PROJECT_SERVICES}
                      maxLength={MAX_SERVICE_LENGTH}
                      placeholder="e.g. Full catering, Styling, Deep cleaning"
                    />

                    <TagInput
                      label="Tags"
                      value={projectDraft.tags}
                      onChange={(tags) => setProjectDraft((d) => ({ ...d, tags }))}
                      suggestions={tagSuggestions}
                      max={MAX_PROJECT_TAGS}
                      maxLength={MAX_TAG_LENGTH}
                      placeholder="Type a tag and press Enter"
                      hint="Clients can filter your work by these. Pick one below or type your own."
                    />

                    <button
                      type="button"
                      className="pf-more-toggle"
                      aria-expanded={showMoreDetails}
                      aria-controls="pf-project-more"
                      onClick={() => setShowMoreDetails((open) => !open)}
                    >
                      {showMoreDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      More details <span className="pf-more-toggle__hint">(optional)</span>
                    </button>

                    {showMoreDetails && (
                      <div id="pf-project-more" className="pf-more">
                        <div className="pf-field-row">
                          <label className="pf-field">
                            <span className="pf-field__label">Client type</span>
                            <input
                              type="text"
                              maxLength={MAX_SHORT_FIELD}
                              value={projectDraft.clientType}
                              onChange={(e) => setProjectDraft((d) => ({ ...d, clientType: e.target.value }))}
                              placeholder="e.g. Family, Small business"
                              className="pf-field__input"
                            />
                          </label>
                          <label className="pf-field">
                            <span className="pf-field__label">Duration</span>
                            <input
                              type="text"
                              maxLength={MAX_SHORT_FIELD}
                              value={projectDraft.duration}
                              onChange={(e) => setProjectDraft((d) => ({ ...d, duration: e.target.value }))}
                              placeholder="e.g. 6 hours, 3 days"
                              className="pf-field__input"
                            />
                          </label>
                          <label className="pf-field">
                            <span className="pf-field__label">Price range</span>
                            <input
                              type="text"
                              maxLength={MAX_SHORT_FIELD}
                              value={projectDraft.priceRange}
                              onChange={(e) => setProjectDraft((d) => ({ ...d, priceRange: e.target.value }))}
                              placeholder="e.g. ₱15,000 – ₱20,000"
                              className="pf-field__input"
                            />
                          </label>
                        </div>

                        <label className="pf-field">
                          <span className="pf-field__label">
                            Results
                            <span className="pf-field__count">{projectDraft.outcome.length}/{MAX_OUTCOME_LENGTH}</span>
                          </span>
                          <textarea
                            rows={2}
                            maxLength={MAX_OUTCOME_LENGTH}
                            value={projectDraft.outcome}
                            onChange={(e) => setProjectDraft((d) => ({ ...d, outcome: e.target.value }))}
                            placeholder="How it turned out, e.g. Finished a day early, client booked again"
                            className="pf-field__input pf-field__input--area"
                          />
                        </label>

                        <label className="pf-switch">
                          <input
                            type="checkbox"
                            checked={projectDraft.beforeAfter}
                            onChange={(e) => setProjectDraft((d) => ({ ...d, beforeAfter: e.target.checked }))}
                          />
                          <span>
                            <span className="pf-switch__label">Show as before &amp; after</span>
                            <span className="pf-switch__hint">
                              {suggestsBeforeAfter(formState.category, projectDraft.tags)
                                ? 'Recommended for your kind of work. Pair photos from each photo\'s details.'
                                : 'For repairs, cleaning, makeup, renovation and similar work.'}
                            </span>
                          </span>
                        </label>
                      </div>
                    )}

                    {project.items.length > 0 && (
                    <div className="pf-field">
                      <span className="pf-field__label">Project cover</span>
                      <div className="pf-cover-picker">
                        {project.items.map((item) => (
                          <button
                            key={item}
                            type="button"
                            onClick={() => setProjectDraft((d) => ({ ...d, cover: item }))}
                            aria-pressed={(projectDraft.cover || project.items[0]) === item}
                            aria-label="Use as cover"
                            className="pf-cover-option"
                          >
                            <PortfolioThumbnail path={item} meta={metaFor(item)} alt="" />
                          </button>
                        ))}
                      </div>
                    </div>
                    )}

                    <div className="pf-editor-project__actions">
                      <button
                        type="button"
                        onClick={() => setEditingProject(null)}
                        disabled={portfolioBusy}
                        className="px-3 py-1.5 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => saveProject(project.name, projectDraft)}
                        disabled={portfolioBusy}
                        className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50"
                      >
                        {portfolioBusy ? 'Saving...' : 'Save project'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="pf-editor-project__row">
                    <span className="pf-editor-project__thumb">
                      {project.cover ? (
                        <PortfolioThumbnail path={project.cover} meta={metaFor(project.cover)} alt="" />
                      ) : (
                        <FolderOpen className="pf-editor-project__empty-icon" aria-hidden="true" />
                      )}
                    </span>
                    <div className="pf-editor-project__text">
                      <p className="pf-editor-project__name">{project.name}</p>
                      <p className="pf-editor-project__sub">
                        {[project.category, info.location, describeProjectSize(project.count)]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {(() => {
                        const { done, total, missing } = projectCompleteness(project.name, info);
                        return (
                          <div className="pf-completeness">
                            <span
                              className="pf-completeness__bar"
                              role="progressbar"
                              aria-valuemin={0}
                              aria-valuemax={total}
                              aria-valuenow={done}
                              aria-label={`${project.name}: ${done} of ${total} details added`}
                            >
                              <span
                                className="pf-completeness__fill"
                                style={{ width: `${(done / total) * 100}%` }}
                              />
                            </span>
                            <span className="pf-completeness__text">
                              {done === total
                                ? 'All details added'
                                : `${done} of ${total} details added`}
                              {done < total && (
                                <span className="pf-completeness__missing">
                                  {' '}&middot; missing {missing.map((m) => CORE_DETAIL_LABELS[m].toLowerCase()).join(', ')}
                                </span>
                              )}
                            </span>
                          </div>
                        );
                      })()}
                      {/* The research is blunt about this: a thin set doesn't prove
                          you can deliver a whole job. Said once, quietly - it is a
                          nudge, not an error. */}
                      {project.count === 0 && (
                        <p className="pf-editor-project__nudge">
                          Empty &mdash; drag photos or videos into it below. Clients won&rsquo;t see it until it has work in it.
                        </p>
                      )}
                      {project.count > 0 && project.count < 5 && (
                        <p className="pf-editor-project__nudge">
                          Only {project.count} item{project.count === 1 ? '' : 's'} &mdash; a few more
                          would show a client you can carry a whole job.
                        </p>
                      )}
                      {!info.description && (
                        editMode ? (
                          <button
                            type="button"
                            className="pf-add-prompt"
                            onClick={() => openProjectEditor(project, true)}
                          >
                            <Plus className="w-4 h-4" aria-hidden="true" />
                            Add description
                          </button>
                        ) : (
                          <p className="pf-editor-project__nudge">No description yet.</p>
                        )
                      )}
                    </div>
                    {editMode && (
                      <div className="pf-editor-project__buttons">
                        <button
                          type="button"
                          onClick={() => moveProject(index, index - 1)}
                          disabled={index === 0 || portfolioBusy || orderDirty}
                          aria-label={`Move ${project.name} up`}
                          className="pf-icon-button"
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveProject(index, index + 1)}
                          disabled={index === list.length - 1 || portfolioBusy || orderDirty}
                          aria-label={`Move ${project.name} down`}
                          className="pf-icon-button"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openProjectEditor(project)}
                          className="px-3 py-1.5 border border-gray-200 text-sm rounded-lg hover:bg-gray-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setProjectPendingDelete(project.name)}
                          disabled={portfolioBusy}
                          aria-label={`Delete project ${project.name}`}
                          className="pf-icon-button pf-icon-button--danger"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {projectPendingDelete === project.name && (
                  <div className="pf-delete-project" role="group" aria-label={`Delete ${project.name}`}>
                    <p className="pf-delete-project__text">
                      Delete &ldquo;{project.name}&rdquo;?
                      {project.count > 0 && ` What should happen to its ${describeProjectSize(project.count)}?`}
                    </p>
                    <div className="pf-delete-project__actions">
                      {project.count > 0 ? (
                        <>
                          <button
                            type="button"
                            disabled={portfolioBusy}
                            onClick={() => deleteProject(project.name, false)}
                            className="px-3 py-1.5 bg-white border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
                          >
                            Keep them in {UNGROUPED_PROJECT_NAME}
                          </button>
                          <button
                            type="button"
                            disabled={portfolioBusy}
                            onClick={() => deleteProject(project.name, true)}
                            className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50"
                          >
                            Delete them too
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={portfolioBusy}
                          onClick={() => deleteProject(project.name, false)}
                          className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50"
                        >
                          Delete project
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={portfolioBusy}
                        onClick={() => setProjectPendingDelete(null)}
                        className="px-3 py-1.5 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div
        onDragOver={(e) => {
          // Only react to files coming in from outside the browser. Moving a tile is
          // handled by the board with pointer events, which never carry Files.
          if (!editMode || uploadingPortfolio) return;
          if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
          e.preventDefault();
          setIsDraggingFiles(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setIsDraggingFiles(false);
        }}
        onDrop={async (e) => {
          if (!editMode || uploadingPortfolio) return;
          const files = Array.from(e.dataTransfer.files || []);
          if (files.length === 0) return;
          e.preventDefault();
          setIsDraggingFiles(false);
          await uploadPortfolioFiles(files, portfolioSlotsLeft);
        }}
        className={isDraggingFiles ? 'pf-board-drop pf-board-drop--active' : 'pf-board-drop'}
      >
        <PortfolioBoard
          layout={displayLayout}
          onLayoutChange={setLayoutDraft}
          editMode={editMode}
          selectMode={selectMode}
          busy={portfolioBusy}
          coverPath={coverPath}
          metaFor={metaFor}
          labelFor={labelFor}
          isSelected={isSelected}
          onTileClick={(path) => (selectMode ? toggleSelected(path) : openImageDetail(path))}
          onEditItem={openImageDetail}
          pendingDelete={portfolioPendingDelete}
          onRequestDelete={setPortfolioPendingDelete}
          onConfirmDelete={async (path) => {
            const ok = await saveLayout(removeItems(displayLayout, [path]), {
              title: 'Removed',
              body: 'It no longer appears on your public profile.',
            });
            if (ok) setPortfolioPendingDelete(null);
          }}
          addSlot={
            portfolioSlotsLeft > 0 && !selectMode ? (
              <button
                onClick={() => { if (editMode) portfolioFileRef.current?.click(); }}
                disabled={!editMode || uploadingPortfolio || orderDirty}
                title={editMode ? (orderDirty ? 'Save or cancel your arrangement first' : 'Add photos or videos') : 'Click "Edit Profile" to add work'}
                className="aspect-square border-2 border-dashed border-gray-300 rounded-xl hover:border-purple-500 hover:bg-purple-50 transition-all flex flex-col items-center justify-center gap-1 px-2 text-center disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="w-8 h-8 text-gray-400" aria-hidden="true" />
                {editMode ? (
                  <>
                    <span className="pf-add-slot__title">Add photo or video</span>
                    <span className="pf-add-slot__sub">or drop files here &middot; {portfolioSlotsLeft} left</span>
                  </>
                ) : (
                  <span className="pf-add-slot__sub">{portfolioSlotsLeft} left</span>
                )}
              </button>
            ) : null
          }
        />
      </div>

      {portfolioImages.length === 0 && (
        <p className="text-sm text-gray-500 mt-4">
          Clients browse your portfolio before they book. Add a few examples of your best
          work, then group them into projects - one for each job.
        </p>
      )}
    </div>

    {/* Full-size view of one portfolio item, and where it gets labelled */}
    {previewOpen && (
      <div className="modal-lightbox" {...previewOverlayProps}>
        <button
          onClick={() => setPortfolioPreview(null)}
          className="modal-lightbox-close w-10 h-10 rounded-full flex items-center justify-center"
          aria-label="Close preview"
        >
          <X className="w-6 h-6 text-white" />
        </button>

        <div
          {...previewCardProps}
          className={`flex flex-col items-center gap-4 w-full ${editMode ? 'pf-detail-dialog' : ''}`}
        >
          <div className="portfolio-detail-media">
            <PortfolioPlayer
              path={previewImage}
              meta={metaFor(previewImage)}
              alt={metaFor(previewImage).alt || metaFor(previewImage).caption || `Portfolio item ${portfolioPreview! + 1}`}
            />
          </div>

          {editMode ? (
            <div className="portfolio-detail space-y-3">
              <div>
                <label htmlFor="portfolio-caption" className="block text-sm text-gray-700 mb-1">
                  Caption
                </label>
                <input
                  id="portfolio-caption"
                  value={detailDraft.caption}
                  onChange={(e) => setDetailDraft((d) => ({ ...d, caption: e.target.value }))}
                  maxLength={MAX_CAPTION_LENGTH}
                  placeholder="Optional, e.g. Finished living room, front view"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {detailDraft.caption.length}/{MAX_CAPTION_LENGTH} &middot; shown under the photo when clients open it
                </p>
              </div>

              <div>
                <label htmlFor="portfolio-album" className="block text-sm text-gray-700 mb-1">
                  Project
                </label>
                <select
                  id="portfolio-album"
                  value={detailDraft.album}
                  onChange={(e) => setDetailDraft((d) => ({ ...d, album: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                >
                  <option value="">{UNGROUPED_PROJECT_NAME} (no project)</option>
                  {projects.map((project) => (
                    <option key={project.name} value={project.name}>{project.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="portfolio-alt" className="block text-sm text-gray-700 mb-1">
                  Alt text <span className="text-xs text-gray-500">(optional)</span>
                </label>
                <input
                  id="portfolio-alt"
                  value={detailDraft.alt}
                  onChange={(e) => setDetailDraft((d) => ({ ...d, alt: e.target.value }))}
                  maxLength={MAX_ALT_LENGTH}
                  placeholder="Describe what is in the photo"
                  aria-describedby="portfolio-alt-hint"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                />
                <p id="portfolio-alt-hint" className="text-xs text-gray-500 mt-1">
                  Read aloud to people using screen readers. Leave blank to use the caption.
                </p>
              </div>

              <TagInput
                label="Tags"
                value={detailDraft.tags}
                onChange={(tags) => setDetailDraft((d) => ({ ...d, tags }))}
                suggestions={itemTagSuggestions}
                max={MAX_ITEM_TAGS}
                maxLength={MAX_TAG_LENGTH}
                placeholder="e.g. Kitchen, Bridal, Grazing table"
              />

              {(() => {
                // Pairing is offered inside a project that is shown as before & after. The
                // server enforces the same rules (same project, no chains, one partner each)
                // and drops a pair that breaks them, so this only has to offer valid choices.
                const project = projects.find((p) => p.name === detailDraft.album);
                if (!project) return null;
                if (!project.beforeAfter) {
                  return suggestsBeforeAfter(formState.category, project.tags) ? (
                    <p className="text-xs text-gray-500">
                      To pair this with a &ldquo;before&rdquo; photo, turn on <strong>Show as before &amp; after</strong> in
                      the project&rsquo;s details.
                    </p>
                  ) : null;
                }
                const self = getStoredPath(previewImage);
                const section = displayLayout.find((s) => s.name === project.name);
                const members = (section?.items || []).map(getStoredPath).filter((p) => p !== self);
                // An item already paired as an "after" cannot be a "before" (no chains), and a
                // "before" already claimed by another item cannot be claimed twice.
                const taken = new Set(
                  members.flatMap((p) => {
                    const partner = metaFor(p).before;
                    return partner && p !== self ? [getStoredPath(partner), p] : [];
                  })
                );
                const choices = members.filter((p) => !taken.has(p) || p === detailDraft.before);
                return (
                  <div className="pf-field">
                    <span className="pf-field__label">This is the &ldquo;after&rdquo; of</span>
                    <div className="pf-cover-picker" role="group" aria-label="Pick its before photo">
                      <button
                        type="button"
                        className="pf-pair-none"
                        aria-pressed={!detailDraft.before}
                        onClick={() => setDetailDraft((d) => ({ ...d, before: '' }))}
                      >
                        Not paired
                      </button>
                      {choices.map((path) => (
                        <button
                          key={path}
                          type="button"
                          className="pf-cover-option"
                          aria-pressed={detailDraft.before === path}
                          aria-label={`Pair with ${labelFor(path)} as its before photo`}
                          onClick={() => setDetailDraft((d) => ({ ...d, before: path }))}
                        >
                          <PortfolioThumbnail path={path} meta={metaFor(path)} alt="" />
                        </button>
                      ))}
                    </div>
                    {choices.length === 0 && (
                      <p className="pf-field__hint">Add the &ldquo;before&rdquo; photo to this project first.</p>
                    )}
                  </div>
                );
              })()}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  disabled={portfolioBusy}
                  onClick={async () => {
                    const path = getStoredPath(previewImage);
                    const caption = detailDraft.caption.trim();
                    // Project membership goes through the layout, so the item lands at the
                    // end of its new project and the project order stays as arranged. Any
                    // unsaved arrangement is saved with it.
                    const target = detailDraft.album
                      ? displayLayout.findIndex((section) => section.name === detailDraft.album)
                      : displayLayout.findIndex((section) => section.isUngrouped);
                    const current = sectionOf(displayLayout, path);
                    const layout = target >= 0 && target !== current
                      ? moveItemsToSection(displayLayout, [path], target)
                      : displayLayout;
                    const committed = commitLayout(layout, portfolioMeta, portfolioAlbums);
                    const { caption: _c, alt: _a, tags: _t, before: _b, ...rest } = committed.meta[path] || {};
                    const alt = detailDraft.alt.trim();
                    // A pair only means something inside one project; moving the item to
                    // another project drops it (the server would too).
                    const destination = layout.find((s) => s.items.some((p) => getStoredPath(p) === path));
                    const before =
                      detailDraft.before &&
                      destination &&
                      !destination.isUngrouped &&
                      destination.items.some((p) => getStoredPath(p) === detailDraft.before)
                        ? detailDraft.before
                        : '';
                    committed.meta[path] = {
                      ...rest,
                      ...(caption ? { caption } : {}),
                      ...(alt ? { alt } : {}),
                      ...(detailDraft.tags.length ? { tags: detailDraft.tags } : {}),
                      ...(before ? { before } : {}),
                    };
                    if (Object.keys(committed.meta[path]).length === 0) delete committed.meta[path];
                    const ok = await persistPortfolio(committed, {
                      title: 'Details saved',
                      body: 'This item is labelled on your public profile.',
                    });
                    if (ok) {
                      setLayoutDraft(null);
                      setPortfolioPreview(null);
                    }
                  }}
                  className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50"
                >
                  {portfolioBusy ? 'Saving...' : 'Save details'}
                </button>

                {getStoredPath(previewImage) !== coverPath && (
                  <button
                    disabled={portfolioBusy}
                    onClick={async () => {
                      const ok = await persistPortfolio(
                        { cover: getStoredPath(previewImage) },
                        { title: 'Profile cover set', body: 'This is now the first thing clients see on your profile.' }
                      );
                      if (ok) setPortfolioPreview(null);
                    }}
                    className="px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    Use as profile cover
                  </button>
                )}

                <button
                  disabled={portfolioBusy}
                  onClick={() => setPortfolioPreview(null)}
                  className="px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            (metaFor(previewImage).caption || metaFor(previewImage).album) && (
              <div className="portfolio-lightbox-caption">
                {metaFor(previewImage).caption && <p>{metaFor(previewImage).caption}</p>}
                {metaFor(previewImage).album && (
                  <span>{metaFor(previewImage).album}</span>
                )}
              </div>
            )
          )}
        </div>
      </div>
    )}
    </>
  );
}
