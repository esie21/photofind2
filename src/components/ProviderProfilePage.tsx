import { useState, useEffect } from 'react';
import { Star, MapPin, Clock, ArrowLeft, MessageSquare, Camera, Briefcase, X } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { ChatInterface } from './ChatInterface';
import reviewService, { Review, ReviewStats } from '../api/services/reviewService';
import serviceService from '../api/services/serviceService';
import { useAuth } from '../context/AuthContext';
import { getUploadUrl, API_CONFIG } from '../api/config';

const API_URL = API_CONFIG.BASE_URL;

interface ProviderProfilePageProps {
  providerId: string;
  onStartBooking: (provider: any, service?: any) => void;
  onBack: () => void;
}

interface ProviderData {
  id: string;
  name: string;
  email: string;
  bio: string;
  profile_image: string;
  portfolio_images: string[];
  location: string;
  category: string;
  years_experience: number;
  rating: number;
  review_count: number;
}

interface Service {
  id: string;
  title: string;
  description: string;
  price: number;
  duration_minutes: number;
  category: string;
  images: string[];
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
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      fetchProviderData();
    }
  }, [id]);

  const fetchProviderData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Fetch provider details
      const providerRes = await fetch(`${API_URL}/providers/${id}`);
      if (!providerRes.ok) {
        // Try fetching from users endpoint
        const usersRes = await fetch(`${API_URL}/providers`);
        if (usersRes.ok) {
          const data = await usersRes.json();
          const found = data.data?.find((p: any) => String(p.id) === String(id));
          if (found) {
            setProvider({
              id: found.id,
              name: found.name,
              email: found.email,
              bio: found.bio || '',
              profile_image: found.profile_image || '',
              portfolio_images: found.portfolio_images || [],
              location: found.location || '',
              category: found.category || '',
              years_experience: found.years_experience || 0,
              rating: found.rating || 0,
              review_count: found.review_count || 0,
            });
          } else {
            throw new Error('Provider not found');
          }
        } else {
          throw new Error('Failed to fetch provider');
        }
      } else {
        const data = await providerRes.json();
        setProvider(data);
      }

      // Fetch services
      try {
        const servicesData = await serviceService.getProviderServices(id!);
        setServices(servicesData || []);
      } catch (e) {
        console.error('Failed to fetch services:', e);
        setServices([]);
      }

      // Fetch reviews
      try {
        const reviewsData = await reviewService.getProviderReviews(id!, 20, 0);
        setReviews(reviewsData.reviews || []);
        setReviewStats(reviewsData.stats || { totalReviews: 0, averageRating: '0.0' });
      } catch (e) {
        console.error('Failed to fetch reviews:', e);
        setReviews([]);
      }
    } catch (e: any) {
      console.error('Error fetching provider:', e);
      setError(e?.message || 'Failed to load provider profile');
    } finally {
      setIsLoading(false);
    }
  };

  const getImageUrl = (path: string) => {
    return getUploadUrl(path);
  };

  const handleBookService = (service?: Service) => {
    if (provider) {
      onStartBooking({
        id: provider.id,
        name: provider.name,
        image: getImageUrl(provider.profile_image),
        service: service?.title || provider.category,
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
            {provider.portfolio_images?.[0] && (
              <ImageWithFallback
                src={getImageUrl(provider.portfolio_images[0])}
                alt="Cover"
                className="w-full h-full object-cover opacity-50"
              />
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
                <h1 className="text-2xl font-semibold text-gray-900">{provider.name}</h1>
                <p className="text-purple-600">{provider.category || 'Professional'}</p>

                <div className="flex flex-wrap items-center gap-4 mt-3 text-sm">
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
                  {tab === 'portfolio' && provider.portfolio_images?.length > 0 && (
                    <span className="ml-1 text-xs text-gray-400">({provider.portfolio_images.length})</span>
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
                            <span className="text-purple-600 font-medium">${service.price}</span>
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
                {provider.portfolio_images?.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {provider.portfolio_images.map((image, index) => (
                      <div
                        key={index}
                        className="aspect-square rounded-xl overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => setSelectedImage(getImageUrl(image))}
                      >
                        <ImageWithFallback
                          src={getImageUrl(image)}
                          alt={`Portfolio ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
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
                              <span className="text-purple-600 font-medium">${service.price}</span>
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
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedImage(null)}
        >
          <button
            onClick={() => setSelectedImage(null)}
            className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-colors"
          >
            <X className="w-6 h-6 text-white" />
          </button>
          <img
            src={selectedImage}
            alt="Portfolio"
            className="max-w-full max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
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
