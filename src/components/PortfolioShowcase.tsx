import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Star, Camera, X, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { PortfolioThumbnail, PortfolioPlayer } from './PortfolioMedia';
import { BeforeAfterSlider } from './BeforeAfterSlider';
import { useModal } from '../hooks/useModal';
import { getStoredPath } from '../api/config';
import type { PortfolioAlbums, PortfolioMeta } from '../api/services/authService';
import type { Review } from '../api/services/reviewService';
import { isVideoPath } from '../utils/media';
import {
  groupPortfolio,
  describeProjectContext,
  describeProjectSize,
  type PortfolioProject,
} from '../utils/portfolio';

/**
 * A provider's portfolio as a client sees it: project cards, then the full set of one job,
 * then one item full-size.
 *
 * Rendered by ProviderProfilePage's Portfolio tab and keyed by provider id there, so opening
 * a different provider starts with nothing open and no filter applied.
 */

interface PortfolioShowcaseProps {
  providerName: string;
  images: string[];
  meta: PortfolioMeta;
  albums: PortfolioAlbums | undefined;
  /** The strongest written reviews, shown under the work. */
  topReviews: Review[];
  totalReviews: number;
  onShowReviews: () => void;
  /** Starts a booking with this provider. */
  onBook: () => void;
}

/** How many tag chips to offer before it stops being a filter and becomes a wall. */
const MAX_FILTER_CHIPS = 8;
/** Tags shown on a card; the rest are in the project sheet. */
const CARD_TAGS = 2;
/** A horizontal swipe longer than this, and more horizontal than vertical, changes item. */
const SWIPE_PX = 50;

interface Pair {
  before: string;
  after: string;
}

/**
 * The before/after pairs in a project that can be shown as a slider: both halves photos
 * (a slider over video makes no sense) and both still in this project. Only for projects
 * the provider has marked as before & after.
 */
function pairsIn(project: PortfolioProject, meta: PortfolioMeta): Pair[] {
  if (!project.beforeAfter) return [];
  const members = new Set(project.items.map(getStoredPath));
  const pairs: Pair[] = [];
  for (const item of project.items) {
    const after = getStoredPath(item);
    const before = meta[after]?.before ? getStoredPath(meta[after].before!) : '';
    if (!before || !members.has(before) || isVideoPath(before) || isVideoPath(after)) continue;
    pairs.push({ before, after });
  }
  return pairs;
}

export function PortfolioShowcase({
  providerName,
  images,
  meta,
  albums,
  topReviews,
  totalReviews,
  onShowReviews,
  onBook,
}: PortfolioShowcaseProps) {
  // Which project's full set is open, by index into the filtered list. A client browses
  // projects, so this is the outer level of navigation - the arrows step between whole
  // jobs, not between loose frames.
  const [openProject, setOpenProject] = useState<number | null>(null);
  // Position within the open project, when the client has clicked through to one item.
  // null means the set is showing as a grid rather than one item full-size.
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  // null means "All work"; otherwise the tag the client is filtering by.
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const metaFor = (image: string) => meta[getStoredPath(image)] || {};
  const firstName = (providerName || '').trim().split(/\s+/)[0] || 'this provider';

  // The join lives in utils/portfolio so the provider's editor renders exactly the same
  // grouping the client sees - the two used to derive it separately and disagree.
  const allProjects = useMemo(() => groupPortfolio(images, meta, albums), [images, meta, albums]);

  // Tags the provider has used, most-used first. A client filtering by "Debut" is asking
  // whether this person does that kind of work at all - the versatility question a
  // portfolio has to answer. Tags rather than the old fixed category, because a caterer or
  // a cleaner has no category in that list to file their work under.
  const tagChips = useMemo(() => {
    const counts = new Map<string, { label: string; count: number; first: number }>();
    allProjects.forEach((project, index) => {
      for (const tag of project.tags) {
        const key = tag.toLowerCase();
        const entry = counts.get(key);
        if (entry) entry.count += 1;
        else counts.set(key, { label: tag, count: 1, first: index });
      }
    });
    return [...counts.values()]
      .sort((a, b) => b.count - a.count || a.first - b.first)
      .slice(0, MAX_FILTER_CHIPS);
  }, [allProjects]);

  const projects = useMemo(
    () =>
      activeTag
        ? allProjects.filter((p) => p.tags.some((t) => t.toLowerCase() === activeTag.toLowerCase()))
        : allProjects,
    [allProjects, activeTag]
  );

  // Nobody has grouped anything yet, so for a provider whose work is entirely un-grouped
  // the grid would be a single card labelled "Other work", hiding a portfolio that used to
  // be visible in full. Show the set itself in that case.
  const onlyUngrouped = allProjects.length === 1 && allProjects[0].isUngrouped;

  const activeProject: PortfolioProject | null =
    openProject !== null && openProject >= 0 && openProject < projects.length
      ? projects[openProject]
      : null;
  const projectOpen = activeProject !== null;

  /**
   * Escape, the close button and a backdrop click all step back one level - out of the
   * item, then out of the project - rather than dumping the client to the grid from a
   * full-size frame. Except when nothing is grouped, where the grid *is* the set: the
   * client opened an item directly and never saw a project sheet.
   */
  const closeViewerLevel = useCallback(() => {
    if (selectedImage !== null && !onlyUngrouped) {
      setSelectedImage(null);
      return;
    }
    setOpenProject(null);
    setSelectedImage(null);
  }, [selectedImage, onlyUngrouped]);

  const { overlayProps, cardProps } = useModal(closeViewerLevel, {
    enabled: projectOpen,
    label: 'Portfolio project viewer',
    manageFocus: true,
  });

  // Moving between levels - the set, one item, the next project - replaces the content
  // that had focus, which would drop a keyboard user back on <body>. Put them on the
  // viewer itself, so the next Tab starts inside it.
  useEffect(() => {
    if (!projectOpen) return;
    const frame = requestAnimationFrame(() => {
      const viewer = document.querySelector<HTMLElement>('.modal-lightbox [role="dialog"]');
      if (viewer && !viewer.contains(document.activeElement)) viewer.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [projectOpen, selectedImage, openProject]);

  const stepImage = useCallback(
    (delta: number) => {
      setSelectedImage((current) => {
        const total = activeProject?.items.length ?? 0;
        if (current === null || total === 0) return current;
        // Wrap around, so the arrows never dead-end at either end of the set.
        return (current + delta + total) % total;
      });
    },
    [activeProject]
  );

  const stepProject = useCallback(
    (delta: number) => {
      setOpenProject((current) => {
        if (current === null || projects.length === 0) return current;
        return (current + delta + projects.length) % projects.length;
      });
      // A new project means a new set; landing on item 4 of the next job because that is
      // where you left the last one would be meaningless.
      setSelectedImage(null);
    },
    [projects.length]
  );

  useEffect(() => {
    if (!projectOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      // The comparison slider uses the arrow keys itself; leave them to it.
      if ((e.target as HTMLElement | null)?.closest?.('.pf-compare')) return;
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      // Inside an item the arrows walk the set; at the set level they walk between jobs.
      if (selectedImage !== null) stepImage(delta);
      else stepProject(delta);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [projectOpen, selectedImage, stepImage, stepProject]);

  // A filter change can leave openProject pointing past the end of a shorter list, which
  // would render an empty modal over the grid.
  useEffect(() => {
    setOpenProject(null);
    setSelectedImage(null);
  }, [activeTag]);

  // Swipe between items on a touch screen. Pointer events rather than touch events, so a
  // pen or a dragged mouse behaves the same; only a mostly-horizontal swipe counts, so a
  // vertical scroll on a tall caption is not mistaken for one.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const swipeHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      // Video keeps its own controls - scrubbing the timeline is a horizontal drag too.
      if ((e.target as HTMLElement).tagName === 'VIDEO') return;
      swipeStart.current = { x: e.clientX, y: e.clientY };
      // Captured, so the gesture still ends here if the pointer leaves the photo mid-swipe.
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    // A mouse pressed on a photo and moved starts the browser's own "drag this image"
    // instead, which cancels the pointer and swallowed every mouse swipe. Touch has no
    // such default, which is why this only showed up with a mouse.
    onDragStart: (e: React.DragEvent) => e.preventDefault(),
    onPointerUp: (e: React.PointerEvent) => {
      const start = swipeStart.current;
      swipeStart.current = null;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) stepImage(dx < 0 ? 1 : -1);
    },
    onPointerCancel: () => {
      swipeStart.current = null;
    },
  };

  const book = () => {
    setOpenProject(null);
    setSelectedImage(null);
    onBook();
  };

  const altFor = (item: string, fallback: string) => metaFor(item).alt || metaFor(item).caption || fallback;
  const pairRole = (project: PortfolioProject, item: string): 'Before' | 'After' | null => {
    const key = getStoredPath(item);
    for (const pair of pairsIn(project, meta)) {
      if (pair.before === key) return 'Before';
      if (pair.after === key) return 'After';
    }
    return null;
  };

  const activePairs = activeProject ? pairsIn(activeProject, meta) : [];
  const pairedItems = new Set(activePairs.flatMap((pair) => [pair.before, pair.after]));
  const details: Array<[string, string]> = activeProject
    ? ([
        ['Services provided', activeProject.services.join(', ')],
        ['Client', activeProject.clientType],
        ['Duration', activeProject.duration],
        ['Price range', activeProject.priceRange],
        ['Results', activeProject.outcome],
      ] as Array<[string, string]>).filter(([, value]) => value)
    : [];
  const singleProject = !onlyUngrouped && projects.length === 1;

  return (
    <>
      <div className="pf-showcase">
        {allProjects.length > 0 ? (
          <>
            {/* Only worth showing once there is more than one tag to choose between - a
                lone chip is pure decoration. */}
            {tagChips.length > 1 && (
              <div className="portfolio-albums" role="group" aria-label="Filter work by tag">
                <button
                  type="button"
                  onClick={() => setActiveTag(null)}
                  aria-pressed={activeTag === null}
                  className={`portfolio-album-chip ${activeTag === null ? 'portfolio-album-chip--active' : ''}`}
                >
                  All work ({allProjects.length})
                </button>
                {tagChips.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => setActiveTag(chip.label)}
                    aria-pressed={activeTag === chip.label}
                    className={`portfolio-album-chip ${activeTag === chip.label ? 'portfolio-album-chip--active' : ''}`}
                  >
                    {chip.label} ({chip.count})
                  </button>
                ))}
              </div>
            )}

            {onlyUngrouped ? (
              <div className="pf-project-set">
                {allProjects[0].items.map((item, index) => (
                  <button
                    key={item}
                    type="button"
                    className="pf-project-frame"
                    onClick={() => { setOpenProject(0); setSelectedImage(index); }}
                    aria-label={metaFor(item).caption || `Open item ${index + 1} of ${allProjects[0].count}`}
                  >
                    <PortfolioThumbnail
                      path={item}
                      meta={metaFor(item)}
                      alt={altFor(item, `${providerName}'s work, item ${index + 1}`)}
                    />
                  </button>
                ))}
              </div>
            ) : (
              /* Cards, not a wall of frames. A client is deciding whether this person can
                 deliver a whole job at a consistent standard, and a set from one job answers
                 that where unrelated frames don't. One project gets one wide card rather
                 than a single tile stranded in a three-column grid. */
              <div className={`pf-projects ${singleProject ? 'pf-projects--single' : ''}`}>
                {projects.map((project, index) => {
                  const context = describeProjectContext(project);
                  const extraTags = project.tags.length - CARD_TAGS;
                  return (
                    <button
                      key={project.name}
                      type="button"
                      className="pf-project-card"
                      onClick={() => { setOpenProject(index); setSelectedImage(null); }}
                      aria-label={`Open project "${project.name}", ${describeProjectSize(project.count)}`}
                    >
                      <span className="pf-project-cover">
                        <PortfolioThumbnail
                          path={project.cover}
                          meta={metaFor(project.cover)}
                          alt={altFor(project.cover, `Cover of ${project.name}`)}
                        />
                        {project.beforeAfter && pairsIn(project, meta).length > 0 && (
                          <span className="pf-project-cover__badge">Before &amp; after</span>
                        )}
                      </span>
                      <span className="pf-project-body">
                        <span className="pf-project-title">{project.name}</span>
                        {/* Location and date do more for credibility than any amount of bio
                            copy - they say the work is real and recent. Always rendered, so
                            cards with and without them still line up. */}
                        <span className="pf-project-context">{context}</span>
                        {project.description && <span className="pf-project-brief">{project.description}</span>}
                        <span className="pf-project-meta">
                          {project.tags.slice(0, CARD_TAGS).map((tag) => (
                            <span key={tag} className="pf-project-tag">{tag}</span>
                          ))}
                          {extraTags > 0 && <span className="pf-project-tag pf-project-tag--more">+{extraTags}</span>}
                          <span className="pf-project-count">{describeProjectSize(project.count)}</span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Social proof sits with the work rather than only on its own tab - it is
                what tips a decision once the work has been judged. */}
            {topReviews.length > 0 && (
              <div className="pf-testimonials">
                <h3 className="pf-testimonials__heading">What clients said</h3>
                <div className="pf-testimonial-list">
                  {topReviews.map((review) => (
                    <blockquote key={review.id} className="pf-testimonial">
                      <div className="pf-testimonial__stars" aria-label={`${review.rating} out of 5`}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star
                            key={n}
                            className={`w-4 h-4 ${n <= review.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`}
                          />
                        ))}
                      </div>
                      <p className="pf-testimonial__body">{review.comment}</p>
                      <footer className="pf-testimonial__author">{review.reviewer_name || 'A client'}</footer>
                    </blockquote>
                  ))}
                </div>
                <button type="button" onClick={onShowReviews} className="pf-testimonials__more">
                  Read all {totalReviews} reviews
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12">
            <Camera className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No work published yet</p>
          </div>
        )}
      </div>

      {/* Booking stays one tap away while the work is being judged. Fixed rather than
          sticky: the tab panel this sits in clips its overflow, which stops sticky from
          working. The showcase reserves room for it at the bottom (pf-showcase). */}
      {/* Hidden while a project is open: the sheet has its own, and this one showed faintly
          through the viewer's backdrop. */}
      {!projectOpen && (
        <div className="pf-book-bar" role="region" aria-label={`Book ${providerName}`}>
          <p className="pf-book-bar__text">Like this work?</p>
          <button type="button" className="pf-book-button" onClick={book}>
            <Calendar className="w-4 h-4" aria-hidden="true" />
            Book {firstName}
          </button>
        </div>
      )}

      {/* Project viewer. Two levels, because a client browses at two levels: the whole set
          of a job, and then one item from it. Opening a card shows the *complete* set -
          never a truncated teaser. */}
      {projectOpen && activeProject && (
        <div className="modal-lightbox" {...overlayProps}>
          <button
            onClick={closeViewerLevel}
            className="modal-lightbox-close w-10 h-10 rounded-full flex items-center justify-center"
            aria-label={selectedImage !== null && !onlyUngrouped ? 'Back to the project' : 'Close viewer'}
          >
            <X className="w-6 h-6 text-white" />
          </button>

          {/* At the set level the arrows move between jobs; inside an item they move
              through that job's frames. Same controls, and the label says which. */}
          {(selectedImage !== null ? activeProject.items.length > 1 : projects.length > 1) && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); selectedImage !== null ? stepImage(-1) : stepProject(-1); }}
                className="modal-lightbox-nav modal-lightbox-nav--prev"
                aria-label={selectedImage !== null ? 'Previous item' : 'Previous project'}
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); selectedImage !== null ? stepImage(1) : stepProject(1); }}
                className="modal-lightbox-nav modal-lightbox-nav--next"
                aria-label={selectedImage !== null ? 'Next item' : 'Next project'}
              >
                <ChevronRight className="w-6 h-6" />
              </button>
              <span className="modal-lightbox-counter">
                {selectedImage !== null
                  ? `${selectedImage + 1} / ${activeProject.items.length}`
                  : `${openProject! + 1} / ${projects.length}`}
              </span>
            </>
          )}

          <div
            {...cardProps}
            className={`pf-project-view ${selectedImage !== null ? 'pf-project-view--item' : ''}`}
          >
            {selectedImage !== null ? (
              <div className="portfolio-viewer pf-swipe" {...swipeHandlers}>
                <PortfolioPlayer
                  path={activeProject.items[selectedImage]}
                  meta={metaFor(activeProject.items[selectedImage])}
                  alt={altFor(
                    activeProject.items[selectedImage],
                    `${activeProject.name}, item ${selectedImage + 1} of ${activeProject.items.length}`
                  )}
                />
                {(metaFor(activeProject.items[selectedImage]).caption ||
                  pairRole(activeProject, activeProject.items[selectedImage])) && (
                  <div className="portfolio-lightbox-caption">
                    {pairRole(activeProject, activeProject.items[selectedImage]) && (
                      <span className="pf-lightbox-role">{pairRole(activeProject, activeProject.items[selectedImage])}</span>
                    )}
                    {metaFor(activeProject.items[selectedImage]).caption}
                  </div>
                )}
              </div>
            ) : (
              <div className="pf-project-sheet">
                <header className="pf-project-sheet__header">
                  <h2 className="pf-project-sheet__title">{activeProject.name}</h2>
                  {describeProjectContext(activeProject) && (
                    <p className="pf-project-sheet__context">{describeProjectContext(activeProject)}</p>
                  )}
                  <p className="pf-project-sheet__meta">
                    {activeProject.tags.map((tag) => (
                      <span key={tag} className="pf-project-tag">{tag}</span>
                    ))}
                    <span>{describeProjectSize(activeProject.count)}</span>
                  </p>
                  {activeProject.description && (
                    <p className="pf-project-sheet__description">{activeProject.description}</p>
                  )}
                  {details.length > 0 && (
                    <dl className="pf-sheet-details">
                      {details.map(([term, value]) => (
                        <div key={term} className="pf-sheet-details__row">
                          <dt>{term}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </header>

                {activePairs.length > 0 && (
                  <section
                    className={`pf-sheet-pairs ${activePairs.length > 1 ? 'pf-sheet-pairs--multi' : ''}`}
                    aria-label="Before and after"
                  >
                    {activePairs.map((pair) => (
                      <BeforeAfterSlider
                        key={pair.after}
                        before={pair.before}
                        after={pair.after}
                        beforeMeta={metaFor(pair.before)}
                        afterMeta={metaFor(pair.after)}
                        label={metaFor(pair.after).caption || activeProject.name}
                      />
                    ))}
                  </section>
                )}

                <div className="pf-project-set">
                  {activeProject.items.map((item, index) =>
                    pairedItems.has(getStoredPath(item)) ? null : (
                      <button
                        key={item}
                        type="button"
                        className="pf-project-frame"
                        onClick={() => setSelectedImage(index)}
                        aria-label={metaFor(item).caption || `Open item ${index + 1} of ${activeProject.items.length}`}
                      >
                        <PortfolioThumbnail
                          path={item}
                          meta={metaFor(item)}
                          alt={altFor(item, `${activeProject.name}, item ${index + 1}`)}
                        />
                      </button>
                    )
                  )}
                </div>

                <div className="pf-sheet-cta">
                  <p className="pf-sheet-cta__text">Want something like this?</p>
                  <button type="button" className="pf-book-button" onClick={book}>
                    <Calendar className="w-4 h-4" aria-hidden="true" />
                    Book {firstName}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
