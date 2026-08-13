import { useState, useEffect } from 'react';
import { useModal } from '../hooks/useModal';
import { Search, SlidersHorizontal, Star, MapPin, MessageSquare, Clock, ChevronRight, Filter, ShieldCheck } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { ChatInterface } from './ChatInterface';
import { ProviderCardSkeleton, BookingCardSkeleton } from './ui/skeleton';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { ConfirmCompletionModal } from './ConfirmCompletionModal';
import userService from '../api/services/userService';
import bookingService from '../api/services/bookingService';
import { CATEGORY_OPTIONS } from '../constants/categories';

interface ClientDashboardProps {
  onStartBooking: (provider?: any) => void;
  onViewProvider?: (providerId: string) => void;
  initialSearchQuery?: string;
  initialCategory?: string;
  onContactSupport?: () => void;
}

export function ClientDashboard({ onStartBooking, onViewProvider, initialSearchQuery, initialCategory, onContactSupport }: ClientDashboardProps) {
  const [showFilters, setShowFilters] = useState(!!initialCategory);
  const [showChat, setShowChat] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<any>(null);

  // Written inline in this component's JSX, so it declares itself unconditionally and
  // only takes effect while the profile is open.
  useModal(() => setSelectedProvider(null), { enabled: !!selectedProvider });
  const [providersList, setProvidersList] = useState<any[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || '');
  const [typedQuery, setTypedQuery] = useState(initialSearchQuery || '');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(12);
  const [totalProviders, setTotalProviders] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState(initialCategory || 'all');
  const [sortBy, setSortBy] = useState('recommended');
  const [myBookings, setMyBookings] = useState<any[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [bookingsError, setBookingsError] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmBookingData, setConfirmBookingData] = useState<any>(null);

  const upcomingBookings = myBookings;

  const fetchProviders = async () => {
    setLoadingProviders(true);
    setProvidersError(null);
    try {
      const res = await userService.getAllProviders({ q: searchQuery, category: selectedCategory, sort: sortBy, page, limit });
      const list = res.data;
      const total = res.meta?.total ?? null;
      setProvidersList(list);
      setTotalProviders(total);
      const pageCount = total ? Math.max(1, Math.ceil(total / limit)) : null;
      if (pageCount && page > pageCount) {
        setPage(pageCount);
        return;
      }
      if (list.length === 0 && page > 1) {
        setPage(1);
      }
    } catch (err: any) {
      console.error('Failed to fetch providers', err);
      setProvidersError(err?.message || 'Failed to load providers');
    } finally {
      setLoadingProviders(false);
    }
  };

  const handleViewProfile = (provider: any) => {
    if (onViewProvider) {
      onViewProvider(String(provider.id));
    } else {
      setSelectedProvider(provider);
    }
  };

  useEffect(() => {
    fetchProviders();
  }, [searchQuery, selectedCategory, sortBy, page, limit]);

  const fetchMyBookings = async () => {
    setLoadingBookings(true);
    setBookingsError(null);
    try {
      const data = await bookingService.getMyBookings();
      const mapped = (data || []).map((b: any) => {
        const start = b.start_date ? new Date(b.start_date) : b.startDate ? new Date(b.startDate) : null;
        // Always render in Manila time so the date and time shown agree with
        // each other and with the server, regardless of the viewer's device timezone.
        const date = start ? start.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) : '';
        const time = start ? start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }) : '';
        return {
          id: b.id,
          provider_id: b.provider_user_id || b.provider_id,
          provider: b.provider_name || 'Provider',
          service: b.service_title || b.service_name || 'Service',
          date,
          time,
          start_date: b.start_date,
          status: b.status,
          image: b.provider_image || b.image || '',
          provider_completed_at: b.provider_completed_at,
          completion_notes: b.completion_notes,
          total_price: b.total_price || b.price || 0,
        };
      });
      setMyBookings(mapped);
    } catch (err: any) {
      console.error('Failed to fetch bookings:', err);
      setBookingsError(err?.message || 'Failed to load bookings');
      setMyBookings([]);
    } finally {
      setLoadingBookings(false);
    }
  };

  useEffect(() => {
    fetchMyBookings();
  }, []);

  const handleSendMessage = (provider: any) => {
    setSelectedProvider(provider);
    setShowChat(true);
  };

  const totalPages = totalProviders ? Math.max(1, Math.ceil(totalProviders / limit)) : null;
  const isLastPage = totalPages ? page >= totalPages : providersList.length < limit;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Search & Filters */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row gap-4 mb-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search for services or professionals..."
                    value={typedQuery}
                    onChange={(e) => setTypedQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { setSearchQuery(typedQuery); setPage(1); } }}
                    className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                  />
                </div>
                <button
                  onClick={() => { setSearchQuery(typedQuery); setPage(1); }}
                  className="px-6 py-3 border border-gray-200 rounded-xl hover:bg-gray-50 flex items-center gap-2 justify-center"
                >
                  Search
                </button>
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="px-6 py-3 border border-gray-200 rounded-xl hover:bg-gray-50 flex items-center gap-2 justify-center"
                >
                  <SlidersHorizontal className="w-5 h-5" />
                  Filters
                </button>
              </div>

              {/* Advanced Filters */}
              {showFilters && (
                <div className="pt-4 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Category</label>
                    <select
                      value={selectedCategory}
                      onChange={(e) => { setSelectedCategory(e.target.value); setPage(1); }}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-purple-500"
                    >
                      <option value="all">All Categories</option>
                      {CATEGORY_OPTIONS.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Sort By</label>
                    <select
                      value={sortBy}
                      onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-purple-500"
                    >
                      <option value="recommended">Recommended</option>
                      <option value="rating">Highest Rated</option>
                      <option value="price-low">Price: Low to High</option>
                      <option value="price-high">Price: High to Low</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Service Providers Grid */}
            <div className="space-y-4">
              <h2 className="text-gray-900">Available Professionals</h2>

              <div className="grid grid-cols-1 gap-4">
                {loadingProviders ? (
                  <>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="bg-white rounded-2xl p-6 shadow-sm">
                        <div className="flex flex-col sm:flex-row gap-6">
                          <div className="w-full sm:w-32 h-32 bg-gray-200 animate-pulse rounded-xl" />
                          <div className="flex-1 space-y-3">
                            <div className="h-5 bg-gray-200 animate-pulse rounded w-1/3" />
                            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/2" />
                            <div className="flex gap-4">
                              <div className="h-4 bg-gray-200 animate-pulse rounded w-20" />
                              <div className="h-4 bg-gray-200 animate-pulse rounded w-24" />
                            </div>
                            <div className="flex gap-2 pt-2">
                              <div className="h-9 bg-gray-200 animate-pulse rounded-lg w-24" />
                              <div className="h-9 bg-gray-200 animate-pulse rounded-lg w-24" />
                              <div className="h-9 bg-gray-200 animate-pulse rounded-lg w-24" />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                ) : providersError ? (
                  <div className="bg-white rounded-2xl p-8 shadow-sm">
                    <ErrorState
                      type="network"
                      title="Unable to load providers"
                      message={providersError}
                      onRetry={fetchProviders}
                      retrying={loadingProviders}
                    />
                  </div>
                ) : providersList.length === 0 ? (
                  <div className="bg-white rounded-2xl p-8 shadow-sm">
                    <EmptyState
                      type="providers"
                      title="No providers found"
                      description="Try adjusting your search or filters to find service providers."
                      action={
                        <button
                          onClick={() => { setSearchQuery(''); setTypedQuery(''); }}
                          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
                        >
                          Clear filters
                        </button>
                      }
                    />
                  </div>
                ) : (providersList.map((provider) => (
                  <div key={provider.id} className="bg-white rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex flex-col sm:flex-row gap-6">
                      <div className="relative w-full sm:w-32 h-32 flex-shrink-0">
                        <ImageWithFallback
                          src={provider.image}
                          alt={provider.name}
                          className="w-full h-full object-cover rounded-xl"
                        />
                        {provider.available && (
                          <div className="absolute -top-2 -right-2 px-3 py-1 bg-green-500 text-white text-xs rounded-full">
                            Available
                          </div>
                        )}
                      </div>

                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="flex items-center gap-1.5 mb-1">
                              <h3 className="text-gray-900">{provider.name}</h3>
                              {provider.is_verified && (
                                <span
                                  title="Verified provider"
                                  className="flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[10px] font-medium"
                                >
                                  <ShieldCheck className="w-3 h-3" />
                                  Verified
                                </span>
                              )}
                            </div>
                            <p className="text-gray-600 text-sm">{provider.featured_service?.title || provider.service}</p>
                          </div>
                          <div className="text-right">
                            <div className="text-purple-600">{provider.featured_service?.price ? `₱${provider.featured_service.price}/hr` : provider.price ? `₱${provider.price}/hr` : ''}</div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 mb-4 text-sm text-gray-600">
                          <div className="flex items-center gap-1">
                            <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                            <span>{provider.rating}</span>
                            <span className="text-gray-400">({provider.reviews} reviews)</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <MapPin className="w-4 h-4" />
                            <span>{provider.location}</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => handleViewProfile(provider)}
                            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
                          >
                            View Profile
                          </button>
                          <button
                            onClick={() => onStartBooking(provider)}
                            className="px-4 py-2 border border-purple-600 text-purple-600 rounded-lg hover:bg-purple-50 transition-colors text-sm"
                          >
                            Book Now
                          </button>
                          <button
                            onClick={() => handleSendMessage(provider)}
                            className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm flex items-center gap-2"
                          >
                            <MessageSquare className="w-4 h-4" />
                            Message
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )))}
                {/* Pagination */}
                <div className="flex items-center justify-between mt-4">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || loadingProviders}
                    className="px-3 py-2 border rounded-md"
                  >
                    Prev
                  </button>
                  <div className="text-sm text-gray-600">{totalPages ? `Page ${page} of ${totalPages}` : `Page ${page}`}</div>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    className="px-3 py-2 border rounded-md"
                    disabled={isLastPage || loadingProviders}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Needs Your Attention - Bookings awaiting confirmation */}
            {upcomingBookings.filter(b => b.status === 'awaiting_confirmation').length > 0 && (
              <div className="bg-orange-50 border-2 border-orange-200 rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                  <h3 className="text-orange-800 font-semibold">Needs Your Confirmation</h3>
                </div>
                <div className="space-y-3">
                  {upcomingBookings
                    .filter(b => b.status === 'awaiting_confirmation')
                    .map((booking) => (
                      <div key={`attention-${booking.id}`} className="p-4 bg-white border border-orange-200 rounded-xl">
                        <div className="flex gap-3">
                          <ImageWithFallback
                            src={booking.image}
                            alt={booking.provider}
                            className="w-12 h-12 object-cover rounded-lg"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-900 truncate">{booking.provider}</p>
                            <p className="text-xs text-gray-600 truncate">{booking.service || 'Service'}</p>
                            <p className="text-xs text-orange-600 mt-1">Provider marked this service as complete</p>
                            <button
                              onClick={() => {
                                setConfirmBookingData({
                                  id: String(booking.id),
                                  service_title: booking.service || 'Service',
                                  provider_name: booking.provider || 'Provider',
                                  provider_completed_at: booking.provider_completed_at,
                                  completion_notes: booking.completion_notes,
                                  start_date: booking.start_date || booking.date,
                                });
                                setShowConfirmModal(true);
                              }}
                              className="mt-2 w-full px-3 py-2 bg-orange-600 text-white text-sm rounded-lg hover:bg-orange-700 transition-colors flex items-center justify-center gap-2"
                            >
                              <Clock className="w-4 h-4" />
                              Review & Confirm Completion
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Quick Actions */}
            <div className="bg-gradient-to-br from-purple-600 to-pink-600 rounded-2xl p-6 text-white">
              <h3 className="mb-2">Need help with something?</h3>
              <p className="text-sm text-purple-100 mb-4">
                Check our FAQ or send our team a message and we'll get back to you
              </p>
              <button
                onClick={onContactSupport}
                className="w-full py-2 bg-white text-purple-600 rounded-lg hover:bg-purple-50 transition-colors text-sm"
              >
                Contact Support
              </button>
            </div>

            {/* Notifications are shown in the Header */}
          </div>
        </div>
      </div>

      {/* Chat Modal */}
      {showChat && selectedProvider && (
        <ChatInterface
          provider={selectedProvider}
          onClose={() => {
            setShowChat(false);
            setSelectedProvider(null);
          }}
        />
      )}

      {/* Confirm Completion Modal - Client confirms or disputes */}
      {showConfirmModal && confirmBookingData && (
        <ConfirmCompletionModal
          booking={confirmBookingData}
          onClose={() => {
            setShowConfirmModal(false);
            setConfirmBookingData(null);
          }}
          onSuccess={() => {
            setShowConfirmModal(false);
            setConfirmBookingData(null);
            fetchMyBookings();
          }}
        />
      )}

      {/* Provider Profile Modal */}
      {selectedProvider && !showChat && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setSelectedProvider(null); }}>
          <div role="dialog" aria-modal="true" aria-label="Provider profile" className="modal-card modal-card--2xl modal-card--plain">
            <div className="relative h-64">
              <ImageWithFallback
                src={selectedProvider.image}
                alt={selectedProvider.name}
                className="w-full h-full object-cover"
              />
              <button
                onClick={() => setSelectedProvider(null)}
                className="absolute top-4 right-4 w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-lg hover:bg-gray-100"
              >
                ×
              </button>
            </div>

            <div className="p-6">
              <h2 className="text-gray-900 mb-2">{selectedProvider.name}</h2>
              <p className="text-gray-600 mb-4">{selectedProvider.service}</p>

              <div className="flex items-center gap-4 mb-6">
                <div className="flex items-center gap-1">
                  <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
                  <span>{selectedProvider.rating}</span>
                  <span className="text-gray-400">({selectedProvider.reviews} reviews)</span>
                </div>
                <div className="flex items-center gap-1 text-gray-600">
                  <MapPin className="w-4 h-4" />
                  <span>{selectedProvider.location}</span>
                </div>
              </div>

              <div className="border-t border-gray-200 pt-6 mb-6">
                <h3 className="text-gray-900 mb-3">About</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Professional photographer with over 10 years of experience specializing in weddings,
                  portraits, and events. Passionate about capturing authentic moments and creating
                  timeless memories for my clients.
                </p>
              </div>

              <div className="border-t border-gray-200 pt-6 mb-6">
                <h3 className="text-gray-900 mb-3">Pricing</h3>
                <div className="bg-purple-50 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-700">Hourly Rate</span>
                    <span className="text-purple-600">₱{selectedProvider.price}/hr</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => onStartBooking(selectedProvider)}
                  className="flex-1 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors"
                >
                  Book Now
                </button>
                <button
                  onClick={() => {
                    setShowChat(true);
                  }}
                  className="flex-1 py-3 border border-purple-600 text-purple-600 rounded-xl hover:bg-purple-50 transition-colors"
                >
                  Send Message
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
