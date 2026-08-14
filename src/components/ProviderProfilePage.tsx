import { useState, useEffect, useRef, useCallback } from 'react';
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
import type { PortfolioMeta } from '../api/services/authService';

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
  // The lightbox tracks the *position* in the portfolio rather than a bare URL, so it
  // can step to the next and previous image instead of being a dead end.
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  // null means "All work"; otherwise the album the client is filtering by.
  const [activeAlbum, setActiveAlbum] = useState<string | null>(null);

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

  // Album names in the order they first appear in the portfolio, so the provider's own
  // arrangement decides which filter comes first rather than the alphabet.
  const albums: string[] = [];
  for (const image of allPortfolioImages) {
    const album = (metaFor(image).album || '').trim();
    if (album && !albums.includes(album)) albums.push(album);
  }

  const portfolioImages = activeAlbum
    ? allPortfolioImages.filter((image) => (metaFor(image).album || '').trim() === activeAlbum)
    : allPortfolioImages;

  // The cover strip is a still. A video leading the portfolio contributes its poster
  // frame; without one, the first actual photo stands in rather than leaving a raw video
  // path in an <img> to fail loading.
  const coverImage = (() => {
    const first = allPortfolioImages[0];
    if (!first) return '';
    if (!isVideoPath(first)) return first;
    return metaFor(first).poster || allPortfolioImages.find((img) => !isVideoPath(img)) || '';
  })();

  const lightboxOpen =
    selectedImage !== null && selectedImage >= 0 && selectedImage < portfolioImages.length;

  // Everything else in the app closes on Escape and freezes the page behind it; this
  // viewer did neither, so on a phone the profile scrolled away underneath the photo.
  const { overlayProps, cardProps } = useModal(() => setSelectedImage(null), {
    enabled: lightboxOpen,
    label: 'Portfolio image viewer',
  });

  const stepImage = useCallback(
    (delta: number) => {
      setSelectedImage((current) => {
        if (current === null || portfolioImages.length === 0) return current;
        // Wrap around, so the arrows never dead-end at either end of the set.
        return (current + delta + portfolioImages.length) % portfolioImages.length;
      });
    },
    [portfolioImages.length]
  );

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') stepImage(1);
      if (e.key === 'ArrowLeft') stepImage(-1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxOpen, stepImage]);

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
                {allPortfolioImages.length > 0 ? (
                  <>
                    {/* Only worth showing once the provider has actually grouped their
                        work - a lone "All" chip would be pure decoration. */}
                    {albums.length > 0 && (
                      <div className="portfolio-albums">
                        <button
                          type="button"
                          onClick={() => { setActiveAlbum(null); setSelectedImage(null); }}
                          className={`portfolio-album-chip ${activeAlbum === null ? 'portfolio-album-chip--active' : ''}`}
                        >
                          All work ({allPortfolioImages.length})
                        </button>
                        {albums.map((album) => {
                          const count = allPortfolioImages.filter(
                            (image) => (metaFor(image).album || '').trim() === album
                          ).length;
                          return (
                            <button
                              key={album}
                              type="button"
                              onClick={() => { setActiveAlbum(album); setSelectedImage(null); }}
                              className={`portfolio-album-chip ${activeAlbum === album ? 'portfolio-album-chip--active' : ''}`}
                            >
                              {album} ({count})
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Columns rather than a square grid: a fixed 1:1 tile centre-cropped
                        every portrait and every panorama in a photographer's portfolio. */}
                    <div className="portfolio-masonry">
                      {portfolioImages.map((image, index) => {
                        const meta = metaFor(image);
                        const isVideo = isVideoPath(image);
                        return (
                          <button
                            key={getStoredPath(image)}
                            type="button"
                            className="portfolio-masonry-item"
                            onClick={() => setSelectedImage(index)}
                            aria-label={
                              meta.caption
                                ? `${isVideo ? 'Play' : 'View'} "${meta.caption}"`
                                : `${isVideo ? 'Play video' : 'View image'} ${index + 1} of ${portfolioImages.length}`
                            }
                          >
                            {/* Thumbnails are the provider's originals at full
                                resolution - up to 24 of them - so off-screen items
                                aren't fetched, and video shows a poster frame rather
                                than downloading the clip. */}
                            <PortfolioThumbnail
                              path={image}
                              meta={meta}
                              alt={meta.caption || `${provider.name}'s work, item ${index + 1}`}
                            />
                            {meta.caption && (
                              <span className="portfolio-masonry-caption">{meta.caption}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12">
                    <Camera className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No portfolio images yet</p>
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

      {/* Lightbox for Portfolio Images */}
      {lightboxOpen && (
        <div className="modal-lightbox" {...overlayProps}>
          <button
            onClick={() => setSelectedImage(null)}
            className="modal-lightbox-close w-10 h-10 rounded-full flex items-center justify-center"
            aria-label="Close image viewer"
          >
            <X className="w-6 h-6 text-white" />
          </button>

          {portfolioImages.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); stepImage(-1); }}
                className="modal-lightbox-nav modal-lightbox-nav--prev"
                aria-label="Previous image"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); stepImage(1); }}
                className="modal-lightbox-nav modal-lightbox-nav--next"
                aria-label="Next image"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
              <span className="modal-lightbox-counter">
                {selectedImage! + 1} / {portfolioImages.length}
              </span>
            </>
          )}

          {/* The dialog role belongs on this wrapper, not on the <img> - overriding an
              image's own role would leave a screen reader with no image at all. */}
          <div {...cardProps} className="portfolio-viewer">
            <PortfolioPlayer
              path={portfolioImages[selectedImage!]}
              meta={metaFor(portfolioImages[selectedImage!])}
              alt={
                metaFor(portfolioImages[selectedImage!]).caption ||
                `${provider.name}'s work, item ${selectedImage! + 1} of ${portfolioImages.length}`
              }
            />
            {(metaFor(portfolioImages[selectedImage!]).caption ||
              metaFor(portfolioImages[selectedImage!]).album) && (
              <div className="portfolio-lightbox-caption">
                {metaFor(portfolioImages[selectedImage!]).caption}
                {metaFor(portfolioImages[selectedImage!]).album && (
                  <span>{metaFor(portfolioImages[selectedImage!]).album}</span>
                )}
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
