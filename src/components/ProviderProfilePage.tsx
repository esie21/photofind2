import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Star, MapPin, Clock, ArrowLeft, MessageSquare, Camera, Briefcase, X, ShieldCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { PortfolioThumbnail, PortfolioPlayer } from './PortfolioMedia';
import { ChatInterface } from './ChatInterface';
import { useModal } from '../hooks/useModal';
import { isVideoPath } from '../utils/media';
import reviewService, { Review, ReviewStats } from '../api/services/reviewService';
import serviceService from '../api/services/serviceService';
import { useAuth } from '../context/AuthContext';
import { getUploadUrl, getStoredPath, API_CONFIG } from '../api/config';
import type { PortfolioAlbums, PortfolioMeta } from '../api/services/authService';
import {
  groupPortfolio,
  describeProjectContext,
  describeProjectSize,
  type PortfolioProject,
} from '../utils/portfolio';

const API_URL = API_CONFIG.BASE_URL;

// Reviews arrive a page at a time. The tab badge shows the true total, so without a
// "Load more" a provider with 40 reviews advertised 40 and displayed 20.
const REVIEWS_PER_PAGE = 20;

interface ProviderProfilePageProps {
  providerId: string;
  onStartBooking: (provider: any, service?: any) => void;
  onBack: () => void;
}

interface ProviderData {
  id: string;
  name: string;
  email?: string;
  bio: string;
  profile_image: string;
  portfolio_images: string[];
  /** Caption and album for each portfolio image, keyed by its stored path. */
  portfolio_meta: PortfolioMeta;
  /** Title, context and cover for each project, keyed by album name. */
  portfolio_albums: PortfolioAlbums;
  location: string;
  category: string;
  /** Headline the provider writes for themselves, e.g. "Wedding Photographer". */
  title: string;
  years_experience: number;
  rating: number;
  review_count: number;
  is_verified?: boolean;
}

interface Service {
  id: string;
  title: string;
  description: string;
  price: number;
  duration_minutes: number;
  category: string;
  images: string[];
  hourly_rate?: number;
  hourly_price?: number;
  package_price?: number;
}

export function ProviderProfilePage({ providerId, onStartBooking, onBack }: ProviderProfilePageProps) {
  const id = providerId;
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<'about' | 'portfolio' | 'reviews' | 'services'>('about');
  const [provider, setProvider] = useState<ProviderData | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [showChat, setShowChat] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewStats, setReviewStats] = useState<ReviewStats>({ totalReviews: 0, averageRating: '0.0' });
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMoreReviews, setIsLoadingMoreReviews] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which project's full set is open, by index into the filtered list. A client browses
  // projects, so this is the outer level of navigation - the arrows step between whole
  // jobs, not between loose frames.
  const [openProject, setOpenProject] = useState<number | null>(null);
  // Position within the open project, when the client has clicked through to one item.
  // null means the set is showing as a grid rather than one item full-size.
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  // null means "All work"; otherwise the category the client is filtering by. Note this
  // is a category, not an album name: projects are the unit now, and filtering by one
  // project would just be opening it.
  const [activeCategory, setActiveAlbum] = useState<string | null>(null);

  // Every fetch is tagged with the id it was started for. Without this, opening
  // provider A, going back and opening provider B could render A's data whenever A's
  // slower response landed last - the page would show one provider's name over
  // another's portfolio.
  const requestedIdRef = useRef<string | null>(null);

  const normaliseProvider = (raw: any): ProviderData => ({
    id: raw.id,
    name: raw.name,
    email: raw.email,
    bio: raw.bio || '',
    profile_image: raw.profile_image || '',
    portfolio_images: Array.isArray(raw.portfolio_images) ? raw.portfolio_images : [],
    portfolio_meta:
      raw.portfolio_meta && typeof raw.portfolio_meta === 'object' ? raw.portfolio_meta : {},
    portfolio_albums:
      raw.portfolio_albums && typeof raw.portfolio_albums === 'object' ? raw.portfolio_albums : {},
    location: raw.location || '',
    category: raw.category || '',
    title: raw.title || '',
    years_experience: Number(raw.years_experience) || 0,
    rating: Number(raw.rating) || 0,
    review_count: Number(raw.review_count) || 0,
    is_verified: !!raw.is_verified,
  });

  const fetchProviderData = useCallback(async () => {
    const forId = id;
    requestedIdRef.current = forId;
    const isStale = () => requestedIdRef.current !== forId;

    setIsLoading(true);
    setError(null);

    try {
      // All three requests go out at once. They used to run one after another even
      // though services and reviews need nothing but the id, which is known before any
      // of them start - so opening a profile cost three round trips of latency in a row.
      // Services and reviews resolve to a result object rather than rejecting, so one
      // failing doesn't take the page down with it.
      const [providerRes, servicesResult, reviewsResult] = await Promise.all([
        // GET /providers/:id is the real endpoint. It used not to exist at all, so this
        // always fell through to the list below - which returns one page (12 providers),
        // meaning anyone outside the first page saw "Provider not found" on their profile.
        fetch(`${API_URL}/providers/${forId}`),
        serviceService
          .getServicesByProvider(forId!)
          .catch((e) => { console.error('Failed to fetch services:', e); return null; }),
        reviewService
          .getProviderReviews(forId!, REVIEWS_PER_PAGE, 0)
          .catch((e) => { console.error('Failed to fetch reviews:', e); return null; }),
      ]);

      if (providerRes.ok) {
        const data = await providerRes.json();
        if (isStale()) return;
        setProvider(normaliseProvider(data));
      } else if (providerRes.status === 404) {
        // A genuine 404 from the real endpoint is the answer, not a reason to go
        // hunting through the list.
        throw new Error('Provider not found');
      } else {
        // Only reachable against a backend that predates the route above. Ask for a
        // large page so the fallback isn't limited to the first twelve providers.
        const listRes = await fetch(`${API_URL}/providers?limit=100`);
        if (!listRes.ok) throw new Error('Failed to fetch provider');
        const data = await listRes.json();
        const found = data.data?.find((p: any) => String(p.id) === String(forId));
        if (!found) throw new Error('Provider not found');
        if (isStale()) return;
        setProvider(normaliseProvider(found));
      }

      if (isStale()) return;

      setServices(
        (servicesResult || []).map((service: any) => ({
          ...service,
          // Keep backward compatibility with legacy `price`
          price:
            Number(service.price) ||
            Number(service.package_price) ||
            Number(service.hourly_rate) ||
            Number(service.hourly_price) ||
            0,
          duration_minutes: Number(service.duration_minutes) || 60,
        }))
      );

      setReviews(reviewsResult?.reviews || []);
      setReviewStats(reviewsResult?.stats || { totalReviews: 0, averageRating: '0.0' });
    } catch (e: any) {
      console.error('Error fetching provider:', e);
      if (!isStale()) setError(e?.message || 'Failed to load provider profile');
    } finally {
      if (!isStale()) setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    // Opening a different provider starts from a clean slate: the previous provider's
    // rows, the tab they happened to leave open, and any lightbox they had up.
    setProvider(null);
    setServices([]);
    setReviews([]);
    setReviewStats({ totalReviews: 0, averageRating: '0.0' });
    setActiveTab('about');
    setOpenProject(null);
    setSelectedImage(null);
    setActiveAlbum(null);
    fetchProviderData();
  }, [id, fetchProviderData]);

  // Load the next page of reviews onto the end of the list.
  const loadMoreReviews = async () => {
    if (!id || isLoadingMoreReviews) return;
    setIsLoadingMoreReviews(true);
    try {
      const data = await reviewService.getProviderReviews(id, REVIEWS_PER_PAGE, reviews.length);
      setReviews((prev) => [...prev, ...(data.reviews || [])]);
    } catch (e) {
      console.error('Failed to load more reviews:', e);
    } finally {
      setIsLoadingMoreReviews(false);
    }
  };

  const getImageUrl = (path: string) => {
    return getUploadUrl(path);
  };

  // --- Portfolio ----------------------------------------------------------------
  // Hooks have to run before the loading/error early-returns below, so they live here
  // rather than next to the JSX they drive.
  const allPortfolioImages = provider?.portfolio_images ?? [];
  const providerMeta: PortfolioMeta = provider?.portfolio_meta ?? {};
  const metaFor = (image: string) => providerMeta[getStoredPath(image)] || {};

  // The join lives in utils/portfolio so the provider's editor renders exactly the same
  // grouping the client sees - the two used to derive it separately and disagree.
  const allProjects = useMemo(
    () => groupPortfolio(allPortfolioImages, providerMeta, provider?.portfolio_albums),
    [allPortfolioImages, providerMeta, provider?.portfolio_albums]
  );

  // Categories the provider has actually used, in grid order. A client filtering by
  // "Videography" is asking whether this person does that kind of work at all, which is
  // the versatility question a portfolio has to answer.
  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const project of allProjects) {
      if (project.category && !seen.includes(project.category)) seen.push(project.category);
    }
    return seen;
  }, [allProjects]);

  const projects = useMemo(
    () => (activeCategory ? allProjects.filter((p) => p.category === activeCategory) : allProjects),
    [allProjects, activeCategory]
  );

  // The two or three strongest testimonials, to sit under the work.
  //
  // Only reviews that actually say something: a bare 5-star with no comment is already
  // counted in the rating badge at the top of the page and adds nothing as a pull quote.
  // Sorted by rating then recency, because this is the highlight reel - the Reviews tab
  // is where the complete, unfiltered list lives.
  const topReviews = useMemo(
    () =>
      reviews
        .filter((review) => (review.comment || '').trim().length > 0)
        .sort((a, b) =>
          b.rating !== a.rating
            ? b.rating - a.rating
            : new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        .slice(0, 3),
    [reviews]
  );

  // Nobody has grouped anything yet - projects only just became a thing - so for a
  // provider whose work is entirely un-albumed the grid would be a single card labelled
  // "Other work", hiding a portfolio that used to be visible in full. Show the set itself
  // in that case. There is no project structure to present, so presenting one is a lie
  // that also costs the client a click.
  const onlyUngrouped = allProjects.length === 1 && allProjects[0].isUngrouped;

  const activeProject: PortfolioProject | null =
    openProject !== null && openProject >= 0 && openProject < projects.length
      ? projects[openProject]
      : null;

  // The cover strip is a still. A video leading the portfolio contributes its poster
  // frame; without one, the first actual photo stands in rather than leaving a raw video
  // path in an <img> to fail loading.
  const coverImage = (() => {
    // The leading project's chosen cover, not simply the first file uploaded - a provider
    // who picked a cover for their best project meant it to be the first thing seen.
    const first = allProjects[0]?.cover || allPortfolioImages[0];
    if (!first) return '';
    if (!isVideoPath(first)) return first;
    return metaFor(first).poster || allPortfolioImages.find((img) => !isVideoPath(img)) || '';
  })();

  const projectOpen = activeProject !== null;
  const lightboxOpen =
    projectOpen && selectedImage !== null &&
    selectedImage >= 0 && selectedImage < activeProject!.items.length;

  // Everything else in the app closes on Escape and freezes the page behind it; this
  // viewer did neither, so on a phone the profile scrolled away underneath the photo.
  // Escape steps back one level - out of the item, then out of the project - rather than
  // dumping the client all the way to the grid from a full-size frame.
  /**
   * Escape, the close button and a backdrop click all step back one level - out of the
   * item, then out of the project - rather than dumping the client to the grid from a
   * full-size frame.
   *
   * Except when nothing is grouped, where the grid *is* the set: the client opened an
   * item directly and never saw a project sheet, so surfacing one on the way out would
   * show them a screen they never asked for.
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
  });

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
  }, [activeCategory]);

  const handleBookService = (service?: Service) => {
    if (provider) {
      onStartBooking({
        id: provider.id,
        name: provider.name,
        image: getImageUrl(provider.profile_image),
        service: service?.title || provider.category || provider.title,
        price: service?.price,
      }, service);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 py-8">
          {/* Header skeleton */}
          <div className="bg-white rounded-2xl overflow-hidden shadow-sm mb-6">
            <div className="h-48 bg-gray-200 animate-pulse" />
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-24 h-24 rounded-full bg-gray-200 animate-pulse -mt-16 border-4 border-white" />
                <div className="flex-1 space-y-3 pt-2">
                  <div className="h-6 bg-gray-200 animate-pulse rounded w-48" />
                  <div className="h-4 bg-gray-200 animate-pulse rounded w-32" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !provider) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl text-gray-900 mb-2">Provider not found</h2>
          <p className="text-gray-600 mb-4">{error || 'The provider you are looking for does not exist.'}</p>
          <button
            onClick={onBack}
            className="px-6 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-700"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Back Button */}
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-5 h-5" />
          Back
        </button>

        {/* Header Section */}
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm mb-6">
          {/* Cover Image */}
          <div className="h-48 bg-gradient-to-r from-purple-600 to-pink-600 relative">
            {coverImage && (
              <ImageWithFallback src={getImageUrl(coverImage)} alt="" className="portfolio-cover" />
            )}
          </div>

          {/* Profile Info */}
          <div className="p-6">
            <div className="flex flex-col sm:flex-row items-start gap-4">
              {/* Avatar */}
              <div className="w-24 h-24 rounded-full bg-white border-4 border-white shadow-lg -mt-16 overflow-hidden flex-shrink-0">
                {provider.profile_image ? (
                  <ImageWithFallback
                    src={getImageUrl(provider.profile_image)}
                    alt={provider.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-purple-100 flex items-center justify-center">
                    <span className="text-3xl text-purple-600 font-medium">
                      {provider.name?.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-semibold text-gray-900">{provider.name}</h1>
                  {provider.is_verified && (
                    <span
                      title="Verified provider"
                      className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-xs font-medium"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Verified
                    </span>
                  )}
                </div>
                {/* The provider's own headline ("Wedding & Portrait Photographer") is
                    what they actually wrote about themselves; the category is the
                    marketplace bucket. Only fall back to "Professional" when they have
                    given us neither. */}
                <p className="text-purple-600">
                  {provider.title || provider.category || 'Professional'}
                </p>

                <div className="flex flex-wrap items-center gap-4 mt-3 text-sm">
                  {provider.category && provider.category !== provider.title && (
                    <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full text-xs">
                      {provider.category}
                    </span>
                  )}
                  <div className="flex items-center gap-1">
                    <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                    <span className="font-medium">{reviewStats.averageRating}</span>
                    <span className="text-gray-500">({reviewStats.totalReviews} reviews)</span>
                  </div>
                  {provider.location && (
                    <div className="flex items-center gap-1 text-gray-600">
                      <MapPin className="w-4 h-4" />
                      <span>{provider.location}</span>
                    </div>
                  )}
                  {provider.years_experience > 0 && (
                    <div className="flex items-center gap-1 text-gray-600">
                      <Briefcase className="w-4 h-4" />
                      <span>{provider.years_experience} years exp.</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 w-full sm:w-auto">
                <button
                  onClick={() => handleBookService()}
                  className="flex-1 sm:flex-initial px-6 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors"
                >
                  Book Now
                </button>
                <button
                  onClick={() => setShowChat(true)}
                  className="p-2 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                  title="Send Message"
                >
                  <MessageSquare className="w-5 h-5 text-gray-600" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="border-b border-gray-200">
            <div className="flex">
              {(['about', 'portfolio', 'services', 'reviews'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 px-4 py-4 text-sm font-medium transition-colors relative ${
                    activeTab === tab
                      ? 'text-purple-600'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  {tab === 'portfolio' && allPortfolioImages.length > 0 && (
                    <span className="ml-1 text-xs text-gray-400">({allPortfolioImages.length})</span>
                  )}
                  {tab === 'services' && services.length > 0 && (
                    <span className="ml-1 text-xs text-gray-400">({services.length})</span>
                  )}
                  {tab === 'reviews' && reviewStats.totalReviews > 0 && (
                    <span className="ml-1 text-xs text-gray-400">({reviewStats.totalReviews})</span>
                  )}
                  {activeTab === tab && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-600" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="p-6">
            {/* About Tab */}
            {activeTab === 'about' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-3">About</h3>
                  <p className="text-gray-600 leading-relaxed">
                    {provider.bio || 'No bio provided yet.'}
                  </p>
                </div>

                {services.length > 0 && (
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-3">Featured Services</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {services.slice(0, 2).map((service) => (
                        <div
                          key={service.id}
                          className="p-4 border border-gray-200 rounded-xl hover:border-purple-300 transition-colors cursor-pointer"
                          onClick={() => handleBookService(service)}
                        >
                          <h4 className="font-medium text-gray-900">{service.title}</h4>
                          <p className="text-sm text-gray-600 mt-1 line-clamp-2">{service.description}</p>
                          <div className="flex items-center justify-between mt-3">
                            <span className="text-purple-600 font-medium">₱{service.price}</span>
                            <span className="text-sm text-gray-500">{service.duration_minutes} min</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Portfolio Tab */}
            {activeTab === 'portfolio' && (
              <div>
                {allProjects.length > 0 ? (
                  <>
                    {/* Only worth showing once there is more than one category to choose
                        between - a lone chip is pure decoration. */}
                    {categories.length > 1 && (
                      <div className="portfolio-albums">
                        <button
                          type="button"
                          onClick={() => setActiveAlbum(null)}
                          className={`portfolio-album-chip ${activeCategory === null ? 'portfolio-album-chip--active' : ''}`}
                        >
                          All work ({allProjects.length})
                        </button>
                        {categories.map((category) => {
                          const count = allProjects.filter((p) => p.category === category).length;
                          return (
                            <button
                              key={category}
                              type="button"
                              onClick={() => setActiveAlbum(category)}
                              className={`portfolio-album-chip ${activeCategory === category ? 'portfolio-album-chip--active' : ''}`}
                            >
                              {category} ({count})
                            </button>
                          );
                        })}
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
                            aria-label={
                              metaFor(item).caption ||
                              `Open item ${index + 1} of ${allProjects[0].count}`
                            }
                          >
                            <PortfolioThumbnail
                              path={item}
                              meta={metaFor(item)}
                              alt={metaFor(item).caption || `${provider.name}'s work, item ${index + 1}`}
                            />
                          </button>
                        ))}
                      </div>
                    ) : (
                    /* Cards, not a wall of frames. A client is deciding whether this
                       person can deliver a whole job at a consistent standard, and a
                       set of nine from one wedding answers that where nine unrelated
                       frames don't. */
                    <div className="pf-projects">
                      {projects.map((project, index) => {
                        const context = describeProjectContext(project);
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
                                alt={`Cover of ${project.name}`}
                              />
                            </span>
                            <span className="pf-project-body">
                              <span className="pf-project-title">{project.name}</span>
                              {/* Location and date do more for credibility than any
                                  amount of bio copy - they say the work is real and
                                  recent. Rendered only when set, and the row keeps its
                                  height either way so the grid stays even. */}
                              {/* Always rendered, empty when there is nothing to say: the
                                  min-height in CSS is what keeps cards level, and an empty
                                  element reserves it without a screen reader announcing a
                                  blank line the way a padded non-breaking space would. */}
                              <span className="pf-project-context">{context}</span>
                              <span className="pf-project-meta">
                                {project.category && (
                                  <span className="pf-project-tag">{project.category}</span>
                                )}
                                <span className="pf-project-count">{describeProjectSize(project.count)}</span>
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    )}

                    {/* Social proof sits with the work rather than only on its own tab -
                        it is what tips a decision once the work has been judged. */}
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
                                    className={`w-3.5 h-3.5 ${n <= review.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`}
                                  />
                                ))}
                              </div>
                              <p className="pf-testimonial__body">{review.comment}</p>
                              <footer className="pf-testimonial__author">
                                {review.reviewer_name || 'A client'}
                              </footer>
                            </blockquote>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveTab('reviews')}
                          className="pf-testimonials__more"
                        >
                          Read all {reviewStats.totalReviews} reviews
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
            )}

            {/* Services Tab */}
            {activeTab === 'services' && (
              <div>
                {services.length > 0 ? (
                  <div className="space-y-4">
                    {services.map((service) => (
                      <div
                        key={service.id}
                        className="p-4 border border-gray-200 rounded-xl hover:border-purple-300 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="font-medium text-gray-900">{service.title}</h4>
                            <p className="text-sm text-gray-600 mt-1">{service.description}</p>
                            <div className="flex items-center gap-4 mt-3 text-sm">
                              <span className="text-purple-600 font-medium">₱{service.price}</span>
                              <span className="text-gray-500 flex items-center gap-1">
                                <Clock className="w-4 h-4" />
                                {service.duration_minutes} min
                              </span>
                              {service.category && (
                                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">
                                  {service.category}
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => handleBookService(service)}
                            className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition-colors"
                          >
                            Book
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Briefcase className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No services listed yet</p>
                  </div>
                )}
              </div>
            )}

            {/* Reviews Tab */}
            {activeTab === 'reviews' && (
              <div>
                {reviews.length > 0 ? (
                  <div className="space-y-4">
                    {/* Stats Summary */}
                    <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl mb-6">
                      <div className="text-center">
                        <div className="text-3xl font-semibold text-gray-900">{reviewStats.averageRating}</div>
                        <div className="flex items-center justify-center gap-0.5 mt-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className={`w-4 h-4 ${
                                star <= parseFloat(reviewStats.averageRating)
                                  ? 'fill-yellow-400 text-yellow-400'
                                  : 'text-gray-300'
                              }`}
                            />
                          ))}
                        </div>
                        <div className="text-sm text-gray-500 mt-1">{reviewStats.totalReviews} reviews</div>
                      </div>
                      {reviewStats.distribution && (
                        <div className="flex-1 space-y-1">
                          {[5, 4, 3, 2, 1].map((rating) => {
                            const count = reviewStats.distribution?.[rating as keyof typeof reviewStats.distribution] || 0;
                            const percentage = reviewStats.totalReviews > 0 ? (count / reviewStats.totalReviews) * 100 : 0;
                            return (
                              <div key={rating} className="flex items-center gap-2 text-sm">
                                <span className="w-3 text-gray-600">{rating}</span>
                                <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-yellow-400 rounded-full"
                                    style={{ width: `${percentage}%` }}
                                  />
                                </div>
                                <span className="w-8 text-gray-500 text-xs">{count}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Review List */}
                    {reviews.map((review) => (
                      <div key={review.id} className="p-4 border border-gray-200 rounded-xl">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-3">
                            {review.reviewer_image ? (
                              <ImageWithFallback
                                src={getImageUrl(review.reviewer_image)}
                                alt={review.reviewer_name || 'Reviewer'}
                                className="w-10 h-10 rounded-full object-cover"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                                <span className="text-purple-600 font-medium">
                                  {(review.reviewer_name || 'A').charAt(0).toUpperCase()}
                                </span>
                              </div>
                            )}
                            <div>
                              <p className="font-medium text-gray-900">{review.reviewer_name || 'Anonymous'}</p>
                              <p className="text-sm text-gray-500">{review.service_title}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Star
                                key={star}
                                className={`w-4 h-4 ${
                                  star <= review.rating
                                    ? 'fill-yellow-400 text-yellow-400'
                                    : 'text-gray-300'
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                        {review.comment && (
                          <p className="text-gray-600 text-sm">{review.comment}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-2">
                          {reviewService.formatReviewDate(review.created_at)}
                        </p>
                      </div>
                    ))}

                    {reviews.length < reviewStats.totalReviews && (
                      <button
                        onClick={loadMoreReviews}
                        disabled={isLoadingMoreReviews}
                        className="w-full py-3 border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLoadingMoreReviews
                          ? 'Loading...'
                          : `Show more reviews (${reviewStats.totalReviews - reviews.length} left)`}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Star className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No reviews yet</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Project viewer.
          Two levels, because a client browses at two levels: the whole set of a job, and
          then one item from it. Opening a card shows the *complete* set - never a
          truncated teaser - because seeing a job delivered end to end at one standard is
          the thing that answers "can they repeat this". */}
      {projectOpen && activeProject && (
        <div className="modal-lightbox" {...overlayProps}>
          <button
            onClick={closeViewerLevel}
            className="modal-lightbox-close w-10 h-10 rounded-full flex items-center justify-center"
            aria-label={
              selectedImage !== null && !onlyUngrouped ? 'Back to the project' : 'Close viewer'
            }
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

          {/* The dialog role belongs on this wrapper, not on the media - overriding an
              image's own role would leave a screen reader with no image at all. */}
          {/* The width cap on this wrapper is for the sheet, which is a reading layout.
              A single item full-size is not - capping it at 64rem shrank a panorama to a
              third of a wide screen - so the modifier drops the cap and the scrolling. */}
          <div
            {...cardProps}
            className={`pf-project-view ${selectedImage !== null ? 'pf-project-view--item' : ''}`}
          >
            {selectedImage !== null ? (
              <div className="portfolio-viewer">
                <PortfolioPlayer
                  path={activeProject.items[selectedImage]}
                  meta={metaFor(activeProject.items[selectedImage])}
                  alt={
                    metaFor(activeProject.items[selectedImage]).caption ||
                    `${activeProject.name}, item ${selectedImage + 1} of ${activeProject.items.length}`
                  }
                />
                {metaFor(activeProject.items[selectedImage]).caption && (
                  <div className="portfolio-lightbox-caption">
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
                    {activeProject.category && (
                      <span className="pf-project-tag">{activeProject.category}</span>
                    )}
                    <span>{describeProjectSize(activeProject.count)}</span>
                  </p>
                  {activeProject.description && (
                    <p className="pf-project-sheet__description">{activeProject.description}</p>
                  )}
                </header>

                <div className="pf-project-set">
                  {activeProject.items.map((item, index) => (
                    <button
                      key={item}
                      type="button"
                      className="pf-project-frame"
                      onClick={() => setSelectedImage(index)}
                      aria-label={
                        metaFor(item).caption ||
                        `Open item ${index + 1} of ${activeProject.items.length}`
                      }
                    >
                      <PortfolioThumbnail
                        path={item}
                        meta={metaFor(item)}
                        alt={metaFor(item).caption || `${activeProject.name}, item ${index + 1}`}
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Direct Chat Modal */}
      {showChat && provider && (
        <ChatInterface
          provider={{
            id: provider.id,
            name: provider.name,
            image: getImageUrl(provider.profile_image),
          }}
          onClose={() => setShowChat(false)}
        />
      )}
    </div>
  );
}

export default ProviderProfilePage;
