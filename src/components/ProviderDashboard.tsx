import { useState, useRef, useEffect } from 'react';
import { Upload, Calendar, DollarSign, Star, TrendingUp, CheckCircle, XCircle, MessageSquare, Users, Camera, Edit, Plus, Trash2, Wallet, Tag } from 'lucide-react';

// Category options for providers and services
const CATEGORY_OPTIONS = [
  'Photography',
  'Videography',
  'Makeup Artist',
  'Design',
  'Event Organizer',
  'Wedding Photography',
  'Portrait Photography',
  'Event Photography',
  'Commercial Photography',
  'Other',
];
import { ImageWithFallback } from './figma/ImageWithFallback';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { BookingCardSkeleton, ServiceCardSkeleton, StatsCardSkeleton } from './ui/skeleton';
import { EmptyState } from './EmptyState';
import { ErrorState, InlineError } from './ErrorState';
import userService from '../api/services/userService';
import serviceService from '../api/services/serviceService';
import bookingService from '../api/services/bookingService';
import availabilityService from '../api/services/availabilityService';
import reviewService, { Review, ReviewStats } from '../api/services/reviewService';
import { ChatInterface } from './ChatInterface';
import { WalletDashboard } from './WalletDashboard';

export function ProviderDashboard() {
  const BASE_URL = ((import.meta as any).env?.VITE_API_URL as string) || 'http://localhost:3001/api';
  const STATIC_URL = 'http://localhost:3001/uploads';
  const [activeTab, setActiveTab] = useState<'overview' | 'profile' | 'availability' | 'bookings' | 'wallet' | 'reviews'>('overview');
  const [showChat, setShowChat] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null);
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const portfolioFileRef = useRef<HTMLInputElement | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [packages, setPackages] = useState<any[]>([]);
  const [isLoadingPackages, setIsLoadingPackages] = useState(false);
  const [packagesError, setPackagesError] = useState<string | null>(null);
  const [providerBookings, setProviderBookings] = useState<any[]>([]);
  const [isLoadingBookings, setIsLoadingBookings] = useState(false);
  const [bookingsError, setBookingsError] = useState<string | null>(null);
  const [blockedDates, setBlockedDates] = useState<any[]>([]);
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [newBlockDate, setNewBlockDate] = useState('');
  const [newBlockReason, setNewBlockReason] = useState('');
  const [isSavingBlock, setIsSavingBlock] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewStats, setReviewStats] = useState<ReviewStats>({ totalReviews: 0, averageRating: '0.0' });
  const [isLoadingReviews, setIsLoadingReviews] = useState(false);
  const [reviewsError, setReviewsError] = useState<string | null>(null);
  const [formState, setFormState] = useState<any>({
  name: user?.name || 'Sarah Johnson',
  title: user?.role === 'provider' ? 'Wedding & Portrait Photographer' : '',
  bio: user?.bio || '',
  location: user?.location || '',
  category: user?.category || 'Photography',
  years_experience: user?.years_experience || 10,
  profile_image: user?.profile_image
    ? user.profile_image.startsWith('http')
      ? user.profile_image
      : `${STATIC_URL}/${user.profile_image}`
    : 'https://images.unsplash.com/photo-1623783356340-95375aac85ce?...',
  portfolio_images: (user?.portfolio_images || []).map(
    (img: string) => img.startsWith('http') ? img : `${STATIC_URL}/${img}`
  ),
});


  useEffect(() => {
    if (formState?.profile_image) {
      console.log('ProviderDashboard: profile image set to', formState.profile_image);
    }
    if (formState?.portfolio_images) {
      console.log('ProviderDashboard: portfolio images count', formState.portfolio_images.length);
    }
  }, [formState.profile_image, formState.portfolio_images]);

  // Calculate real stats from bookings
  const stats = (() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const upcomingBookings = providerBookings.filter(b =>
      ['pending', 'accepted', 'confirmed'].includes(b.status) &&
      new Date(b.date) >= now
    ).length;

    const completedBookings = providerBookings.filter(b => b.status === 'completed').length;

    const recentEarnings = providerBookings
      .filter(b => b.status === 'completed' && new Date(b.date) >= thirtyDaysAgo)
      .reduce((sum, b) => sum + (b.amount || 0), 0);

    const pendingBookings = providerBookings.filter(b => b.status === 'pending').length;

    return [
      { label: 'Upcoming Bookings', value: String(upcomingBookings), change: `${pendingBookings} pending`, icon: Calendar, color: 'purple' },
      { label: 'Earnings (30d)', value: `$${recentEarnings.toLocaleString()}`, change: 'Last 30 days', icon: DollarSign, color: 'green' },
      { label: 'Completed Bookings', value: String(completedBookings), change: 'All time', icon: TrendingUp, color: 'blue' },
      { label: 'Total Bookings', value: String(providerBookings.length), change: 'All statuses', icon: Star, color: 'yellow' },
    ];
  })();

  // Sync formState when user changes
useEffect(() => {
  if (!user) return;

  setFormState({
    name: user.name || 'Sarah Johnson',
    title: user.role === 'provider' ? 'Wedding & Portrait Photographer' : '',
    bio: user.bio || '',
    location: user.location || '',
    category: user.category || 'Photography',
    years_experience: user.years_experience || 10,
    profile_image: user.profile_image
      ? user.profile_image.startsWith('http')
        ? user.profile_image
        : `${STATIC_URL}/${user.profile_image}`
      : 'https://images.unsplash.com/photo-1623783356340-95375aac85ce?...',
    portfolio_images: (user.portfolio_images || []).map(
      (img: string) => img.startsWith('http') ? img : `${STATIC_URL}/${img}`
    ),
  });
}, [user]);

  // Load services/packages for the provider
  useEffect(() => {
    const loadPackages = async () => {
      if (!user || user.role !== 'provider') return;
      
      setIsLoadingPackages(true);
      try {
        const allServices = await serviceService.getAllServices();
        console.log('All services loaded:', allServices.length);
        console.log('Current user ID:', user.id);
        console.log('Sample service:', allServices[0]);
        
        // Filter services for current provider (handle both snake_case and camelCase)
        const providerServices = allServices.filter((service: any) => {
          const serviceUserId = String(service.providerId || service.provider_id || '');
          const currentUserId = String(user.id || '');
          const matches = serviceUserId === currentUserId;
          if (!matches && service.providerId !== undefined) {
            console.log('Service mismatch:', {
              serviceId: service.id,
              serviceProviderId: service.providerId,
              serviceProvider_id: service.provider_id,
              currentUserId: user.id
            });
          }
          return matches;
        });
        
        console.log('Filtered provider services:', providerServices.length);
        
        if (providerServices.length > 0) {
          setPackages(providerServices.map((s: any) => ({
            id: s.id,
            title: s.title || '',
            description: s.description || '',
            price: parseFloat(s.price) || 0,
            category: s.category || '',
          })));
        } else {
          // Initialize with default packages if none exist
          setPackages([
            { id: null, title: 'Basic Package', description: 'Description of package features and benefits...', price: 1200, category: 'Photography' },
            { id: null, title: 'Standard Package', description: 'Description of package features and benefits...', price: 2400, category: 'Photography' },
            { id: null, title: 'Premium Package', description: 'Description of package features and benefits...', price: 3600, category: 'Photography' },
          ]);
        }
      } catch (error) {
        console.error('Failed to load packages:', error);
        // Initialize with default packages on error
        setPackages([
          { id: null, title: 'Basic Package', description: 'Description of package features and benefits...', price: 1200, category: 'Photography' },
          { id: null, title: 'Standard Package', description: 'Description of package features and benefits...', price: 2400, category: 'Photography' },
          { id: null, title: 'Premium Package', description: 'Description of package features and benefits...', price: 3600, category: 'Photography' },
        ]);
      } finally {
        setIsLoadingPackages(false);
      }
    };

    loadPackages();
  }, [user]);

  // Reload packages when exiting edit mode (in case packages were saved)
  useEffect(() => {
    if (!editMode && user && user.role === 'provider') {
      const loadPackages = async () => {
        setIsLoadingPackages(true);
        try {
          const allServices = await serviceService.getAllServices();
          // Filter services for current provider (handle both snake_case and camelCase)
          const providerServices = allServices.filter(
            (service: any) => String(service.providerId || service.provider_id) === String(user.id)
          );
          
          if (providerServices.length > 0) {
            setPackages(providerServices.map((s: any) => ({
              id: s.id,
              title: s.title || '',
              description: s.description || '',
              price: parseFloat(s.price) || 0,
              category: s.category || '',
            })));
          }
        } catch (error) {
          console.error('Failed to reload packages:', error);
        } finally {
          setIsLoadingPackages(false);
        }
      };
      loadPackages();
    }
  }, [editMode, user]);

  const fetchBookings = async () => {
    if (!user || (user.role !== 'provider' && user.role !== 'admin')) return;
    setIsLoadingBookings(true);
    setBookingsError(null);
    try {
      const data = await bookingService.getMyProviderBookings();
      const mapped = (data || []).map((b: any) => {
        const start = b.start_date ? new Date(b.start_date) : b.startDate ? new Date(b.startDate) : null;
        const date = start ? start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
        const time = start ? start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

        // Handle client image URL
        let clientImage = b.client_image;
        if (clientImage && !clientImage.startsWith('http')) {
          clientImage = `${STATIC_URL}/${clientImage}`;
        }
        if (!clientImage) {
          clientImage = `https://ui-avatars.com/api/?name=${encodeURIComponent(b.client_name || 'Client')}&background=7c3aed&color=fff`;
        }

        return {
          id: b.id,
          client_id: b.client_user_id || b.client_id,
          client: b.client_name || b.client_email || 'Client',
          clientEmail: b.client_email,
          service: b.service_title || 'Service',
          date,
          time,
          amount: Number(b.total_price || b.totalPrice || 0),
          status: b.status,
          image: clientImage,
        };
      });
      setProviderBookings(mapped);
    } catch (e: any) {
      setBookingsError(e?.message || 'Failed to load bookings');
      setProviderBookings([]);
    } finally {
      setIsLoadingBookings(false);
    }
  };

  const fetchAvailability = async () => {
    if (!user || (user.role !== 'provider' && user.role !== 'admin')) return;
    setIsLoadingAvailability(true);
    setAvailabilityError(null);
    try {
      // Fetch blocked dates (overrides where is_available = false)
      const from = new Date().toISOString().split('T')[0];
      const to = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const data = await availabilityService.getOverrides(String(user.id), from, to);
      // Filter only blocked dates
      const blocked = (data || []).filter((o: any) => !o.is_available);
      setBlockedDates(blocked);
    } catch (e: any) {
      setAvailabilityError(e?.message || 'Failed to load availability');
      setBlockedDates([]);
    } finally {
      setIsLoadingAvailability(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, [user]);

  useEffect(() => {
    fetchAvailability();
  }, [user]);

  const fetchReviews = async () => {
    if (!user || (user.role !== 'provider' && user.role !== 'admin')) return;
    setIsLoadingReviews(true);
    setReviewsError(null);
    try {
      const data = await reviewService.getReceivedReviews();
      setReviews(data.reviews || []);
      setReviewStats(data.stats || { totalReviews: 0, averageRating: '0.0' });
    } catch (e: any) {
      setReviewsError(e?.message || 'Failed to load reviews');
      setReviews([]);
    } finally {
      setIsLoadingReviews(false);
    }
  };

  useEffect(() => {
    fetchReviews();
  }, [user]);

  const bookingRequests = providerBookings;

  const portfolioImages = [
    'https://images.unsplash.com/photo-1623783356340-95375aac85ce?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3ZWRkaW5nJTIwcGhvdG9ncmFwaGVyfGVufDF8fHx8MTc2NDQwNzk1NHww&ixlib=rb-4.1.0&q=80&w=1080',
    'https://images.unsplash.com/photo-1643264623879-bb85ea39c62a?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwb3J0cmFpdCUyMHBob3RvZ3JhcGhlciUyMHByb2Zlc3Npb25hbHxlbnwxfHx8fDE3NjQ0MDc5NTR8MA&ixlib=rb-4.1.0&q=80&w=1080',
    'https://images.unsplash.com/photo-1643968612613-fd411aecd1fd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwaG90b2dyYXBoZXIlMjBjYW1lcmElMjBwcm9mZXNzaW9uYWx8ZW58MXx8fHwxNzY0NDAwNjc1fDA&ixlib=rb-4.1.0&q=80&w=1080',
    'https://images.unsplash.com/photo-1760780567530-389d8a3fba75?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjcmVhdGl2ZSUyMHByb2Zlc3Npb25hbCUyMHN0dWRpb3xlbnwxfHx8fDE3NjQzNzkwODF8MA&ixlib=rb-4.1.0&q=80&w=1080',
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Tabs */}
        <div className="bg-white rounded-2xl shadow-sm p-2 mb-6 flex gap-2 overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'profile', label: 'Profile' },
            { id: 'availability', label: 'Availability' },
            { id: 'bookings', label: 'Bookings' },
            { id: 'wallet', label: 'Wallet' },
            { id: 'reviews', label: 'Reviews' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-6 py-3 rounded-xl whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? 'bg-purple-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {stats.map((stat: any, index: number) => {
                const Icon = stat.icon;
                return (
                  <div key={index} className="bg-white rounded-2xl p-6 shadow-sm">
                    <div className="flex items-start justify-between mb-4">
                      <div className={`w-12 h-12 rounded-xl bg-${stat.color}-100 flex items-center justify-center`}>
                        <Icon className={`w-6 h-6 text-${stat.color}-600`} />
                      </div>
                      <span className="text-sm text-green-600">{stat.change}</span>
                    </div>
                    <div className="text-2xl text-gray-900 mb-1">{stat.value}</div>
                    <div className="text-sm text-gray-600">{stat.label}</div>
                  </div>
                );
              })}
            </div>

            {/* Booking Requests */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-gray-900">Recent Booking Requests</h2>
                <button className="text-sm text-purple-600 hover:text-purple-700">View all</button>
              </div>

              <div className="space-y-4">
                {isLoadingBookings ? (
                  <>
                    {Array.from({ length: 2 }).map((_, i) => (
                      <BookingCardSkeleton key={i} />
                    ))}
                  </>
                ) : bookingsError ? (
                  <InlineError
                    message={bookingsError}
                    onRetry={fetchBookings}
                    retrying={isLoadingBookings}
                  />
                ) : bookingRequests.length === 0 ? (
                  <EmptyState
                    type="bookings"
                    title="No booking requests"
                    description="New booking requests from clients will appear here."
                  />
                ) : bookingRequests.map((booking) => (
                  <div key={booking.id} className="p-4 border border-gray-200 rounded-xl hover:border-purple-300 transition-colors">
                    <div className="flex flex-col sm:flex-row gap-4">
                      <ImageWithFallback
                        src={booking.image}
                        alt={booking.client}
                        className="w-full sm:w-20 h-20 object-cover rounded-lg"
                      />
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h3 className="text-gray-900">{booking.client}</h3>
                            <p className="text-sm text-gray-600">{booking.service}</p>
                          </div>
                          <div className="text-right">
                            <div className="text-purple-600">${booking.amount}</div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 mb-3">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            <span>{booking.date}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span>{booking.time}</span>
                          </div>
                        </div>
                        {booking.status === 'pending' ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={async () => {
                                try {
                                  await bookingService.updateBooking(String(booking.id), { status: 'accepted' } as any);
                                  setProviderBookings((prev) => prev.map((b: any) => b.id === booking.id ? { ...b, status: 'accepted' } : b));
                                  toast.success('Booking accepted', `Booking with ${booking.client} has been confirmed.`);
                                } catch (e) {
                                  console.error('Failed to accept booking', e);
                                  toast.error('Failed to accept', 'Please try again.');
                                }
                              }}
                              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm flex items-center gap-2"
                            >
                              <CheckCircle className="w-4 h-4" />
                              Accept
                            </button>
                            <button
                              onClick={async () => {
                                try {
                                  await bookingService.updateBooking(String(booking.id), { status: 'rejected' } as any);
                                  setProviderBookings((prev) => prev.map((b: any) => b.id === booking.id ? { ...b, status: 'rejected' } : b));
                                  toast.info('Booking declined', 'The client has been notified.');
                                } catch (e) {
                                  console.error('Failed to reject booking', e);
                                  toast.error('Failed to decline', 'Please try again.');
                                }
                              }}
                              className="px-4 py-2 border border-red-600 text-red-600 rounded-lg hover:bg-red-50 transition-colors text-sm flex items-center gap-2"
                            >
                              <XCircle className="w-4 h-4" />
                              Decline
                            </button>
                            <button 
                              onClick={() => {
                                setSelectedBookingId(booking.id);
                                setShowChat(true);
                              }}
                              className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm flex items-center gap-2"
                            >
                              <MessageSquare className="w-4 h-4" />
                              Message
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm">
                              Confirmed
                            </span>
                            <button 
                              onClick={() => {
                                setSelectedBookingId(booking.id);
                                setShowChat(true);
                              }}
                              className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm flex items-center gap-2"
                            >
                              <MessageSquare className="w-4 h-4" />
                              Message
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'availability' && (
          <div className="space-y-6">
            {/* Info Banner */}
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6">
              <h3 className="text-blue-900 font-medium mb-2">How Booking Works</h3>
              <p className="text-blue-700 text-sm">
                Clients can request bookings for any date and time. You'll receive a notification to accept or decline each request.
                Use this page to block dates when you're not available (vacations, holidays, etc.).
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Block Date Form */}
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <h3 className="text-gray-900 font-medium mb-4">Block a Date</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Block dates when you're unavailable. Clients won't be able to book on these dates.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Date to Block</label>
                    <input
                      type="date"
                      value={newBlockDate}
                      onChange={(e) => setNewBlockDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Reason (optional)</label>
                    <input
                      type="text"
                      value={newBlockReason}
                      onChange={(e) => setNewBlockReason(e.target.value)}
                      placeholder="e.g., Vacation, Personal day..."
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                    />
                  </div>

                  <button
                    onClick={async () => {
                      if (!newBlockDate) {
                        toast.error('Please select a date', 'Choose a date to block.');
                        return;
                      }
                      setIsSavingBlock(true);
                      try {
                        const created = await availabilityService.saveOverride({
                          override_date: newBlockDate,
                          is_available: false,
                          reason: newBlockReason || undefined,
                        });
                        setBlockedDates((prev) => [...prev, created].sort((a: any, b: any) =>
                          new Date(a.override_date).getTime() - new Date(b.override_date).getTime()
                        ));
                        setNewBlockDate('');
                        setNewBlockReason('');
                        toast.success('Date blocked', `${new Date(newBlockDate).toLocaleDateString()} has been blocked.`);
                      } catch (e: any) {
                        console.error('Failed to block date', e);
                        toast.error('Failed to block date', e?.message || 'Please try again.');
                      } finally {
                        setIsSavingBlock(false);
                      }
                    }}
                    disabled={isSavingBlock || !newBlockDate}
                    className="w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <XCircle className="w-4 h-4" />
                    {isSavingBlock ? 'Blocking...' : 'Block This Date'}
                  </button>
                </div>
              </div>

              {/* Blocked Dates List */}
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <h3 className="text-gray-900 font-medium mb-4">Blocked Dates</h3>

                {isLoadingAvailability ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center justify-between p-4 border border-gray-100 rounded-xl">
                        <div className="space-y-2">
                          <div className="h-4 bg-gray-200 animate-pulse rounded w-32" />
                          <div className="h-3 bg-gray-200 animate-pulse rounded w-24" />
                        </div>
                        <div className="h-9 bg-gray-200 animate-pulse rounded-lg w-20" />
                      </div>
                    ))}
                  </div>
                ) : availabilityError ? (
                  <InlineError
                    message={availabilityError}
                    onRetry={fetchAvailability}
                    retrying={isLoadingAvailability}
                  />
                ) : blockedDates.length === 0 ? (
                  <EmptyState
                    type="generic"
                    title="No blocked dates"
                    description="You haven't blocked any dates. Block dates when you're not available."
                  />
                ) : (
                  <div className="space-y-3 max-h-[400px] overflow-y-auto">
                    {blockedDates.map((block: any) => (
                      <div key={block.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-xl hover:border-red-200 transition-colors">
                        <div>
                          <div className="text-sm text-gray-900 font-medium">
                            {new Date(block.override_date + 'T00:00:00').toLocaleDateString('en-US', {
                              weekday: 'long',
                              month: 'long',
                              day: 'numeric',
                              year: 'numeric'
                            })}
                          </div>
                          {block.reason && (
                            <div className="text-xs text-gray-500 mt-1">{block.reason}</div>
                          )}
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              await availabilityService.deleteOverride(block.id);
                              setBlockedDates((prev) => prev.filter((b: any) => String(b.id) !== String(block.id)));
                              toast.success('Date unblocked', 'Clients can now book on this date.');
                            } catch (e) {
                              console.error('Failed to unblock date', e);
                              toast.error('Failed to unblock', 'Please try again.');
                            }
                          }}
                          className="px-3 py-2 border border-green-600 text-green-600 rounded-lg hover:bg-green-50 transition-colors text-sm flex items-center gap-1"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Unblock
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Upcoming Bookings Reference */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <h3 className="text-gray-900 font-medium mb-4">Upcoming Bookings</h3>
              <p className="text-sm text-gray-600 mb-4">
                These dates already have confirmed bookings.
              </p>

              {isLoadingBookings ? (
                <div className="space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="h-10 bg-gray-100 animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : (() => {
                const upcomingBookings = providerBookings.filter(b =>
                  ['accepted', 'confirmed', 'pending'].includes(b.status) &&
                  new Date(b.date) >= new Date()
                );

                if (upcomingBookings.length === 0) {
                  return (
                    <p className="text-sm text-gray-500 italic">No upcoming bookings</p>
                  );
                }

                return (
                  <div className="flex flex-wrap gap-2">
                    {upcomingBookings.slice(0, 10).map((booking) => (
                      <span
                        key={booking.id}
                        className={`px-3 py-2 rounded-lg text-sm ${
                          booking.status === 'pending'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-purple-100 text-purple-700'
                        }`}
                      >
                        {booking.date} - {booking.client}
                      </span>
                    ))}
                    {upcomingBookings.length > 10 && (
                      <span className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm">
                        +{upcomingBookings.length - 10} more
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-gray-900">Profile Information</h2>
                {!editMode ? (
                  <button
                    onClick={() => setEditMode(true)}
                    className="px-4 py-2 border border-purple-600 text-purple-600 rounded-lg hover:bg-purple-50 transition-colors text-sm flex items-center gap-2"
                    disabled={!user || (user.role !== 'provider' && user.role !== 'admin')}
                  >
                    <Edit className="w-4 h-4" />
                    Edit Profile
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        if (!user) return;
                        try {
                          // Save profile information
                          const payload: any = {
                            name: formState.name,
                            bio: formState.bio,
                            years_experience: formState.years_experience,
                            location: formState.location,
                            category: formState.category,
                            profile_image: formState.profile_image,
                            portfolio_images: formState.portfolio_images,
                          };
                          console.log('Saving profile payload', { payload, userId: user.id });
                          const res = await userService.updateUser(user.id, payload);
                          console.log('Update response', res);
                          
                          // Save packages/services
                          if (packages.length > 0) {
                            try {
                              await Promise.all(
                                packages.map(async (pkg) => {
                                  if (pkg.id) {
                                    // Update existing service
                                    return serviceService.updateService(pkg.id, {
                                      title: pkg.title,
                                      description: pkg.description,
                                      price: pkg.price,
                                      category: pkg.category,
                                    });
                                  } else {
                                    // Create new service
                                    return serviceService.createService({
                                      title: pkg.title,
                                      description: pkg.description,
                                      price: pkg.price,
                                      category: pkg.category || 'Photography',
                                    });
                                  }
                                })
                              );
                              console.log('Packages saved successfully');
                              
                              // Reload packages to get IDs for newly created ones
                              const allServices = await serviceService.getAllServices();
                              const providerServices = allServices.filter(
                                (service: any) => String(service.providerId || service.provider_id) === String(user.id)
                              );
                              setPackages(providerServices.map((s: any) => ({
                                id: s.id,
                                title: s.title || '',
                                description: s.description || '',
                                price: parseFloat(s.price) || 0,
                                category: s.category || '',
                              })));
                            } catch (packageError) {
                              console.error('Failed to save packages:', packageError);
                              // Continue even if packages fail to save
                            }
                          }
                          
                          await refreshUser();
                          setEditMode(false);
                        } catch (err) {
                          console.error('Failed to save profile', err);
                        }
                      }}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm flex items-center gap-2"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setFormState((s: any) => ({
                          ...s,
                          name: user?.name || s.name,
                          bio: (user as any)?.bio || s.bio,
                          years_experience: (user as any)?.years_experience || s.years_experience,
                          location: (user as any)?.location || s.location,
                          category: (user as any)?.category || s.category,
                          profile_image: (user as any)?.profile_image || s.profile_image,
                          portfolio_images: (user as any)?.portfolio_images || s.portfolio_images,
                        }));
                        setEditMode(false);
                      }}
                      className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-sm flex items-center gap-2"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-6">
                <div className="flex items-start gap-6">
                  <div className="relative">
                    <ImageWithFallback
                      src={formState.profile_image}
                      alt="Profile"
                      className="w-24 h-24 object-cover rounded-2xl"
                    />
                    <input
                      type="file"
                      ref={fileInputRef}
                      name="profile"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !user) return;
                        try {
                          const response = await userService.uploadProfileImage(user.id, file);
                          await refreshUser();
                          setFormState((s: any) => ({ ...s, profile_image: response.profile_image }));
                        } catch (err) {
                          console.error('Profile image upload failed', err);
                        }
                      }}
                    />
                    <button
                      onClick={() => { if (editMode) fileInputRef.current?.click(); }}
                      className="absolute -bottom-2 -right-2 w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center hover:bg-purple-700"
                      title="Change profile image"
                    >
                      <Camera className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex-1">
                    {editMode ? (
                      <input
                        id="profile-name"
                        name="name"
                        value={formState.name}
                        onChange={(e) => setFormState((s: any) => ({ ...s, name: e.target.value }))}
                        className="text-xl text-gray-900 font-semibold border border-gray-200 rounded-md px-2 py-1"
                      />
                    ) : (
                      <h3 className="text-gray-900 mb-2">{formState.name}</h3>
                    )}
                    {editMode ? (
                      <input
                        id="profile-title"
                        name="title"
                        value={formState.title}
                        onChange={(e) => setFormState((s: any) => ({ ...s, title: e.target.value }))}
                        className="text-sm text-gray-600 border border-gray-200 rounded-md px-2 py-1 mb-2"
                      />
                    ) : (
                      <p className="text-gray-600 mb-4">{formState.title}</p>
                    )}
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                        <span>4.9 (127 reviews)</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Users className="w-4 h-4" />
                        <span>156 clients</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label htmlFor="profile-bio" className="block text-sm text-gray-700 mb-2">Bio</label>
                    <textarea
                      id="profile-bio"
                      name="bio"
                    value={formState.bio}
                    onChange={(e) => setFormState((s: any) => ({ ...s, bio: e.target.value }))}
                    rows={4}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                    readOnly={!editMode}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="profile-years-experience" className="block text-sm text-gray-700 mb-2">Years of Experience</label>
                    <input
                      id="profile-years-experience"
                      name="years_experience"
                      type="number"
                      value={formState.years_experience}
                      onChange={(e) => setFormState((s: any) => ({ ...s, years_experience: Number(e.target.value) }))}
                      readOnly={!editMode}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="profile-location" className="block text-sm text-gray-700 mb-2">Location</label>
                    <input
                      id="profile-location"
                      name="location"
                      type="text"
                      value={formState.location}
                      onChange={(e) => setFormState((s: any) => ({ ...s, location: e.target.value }))}
                      readOnly={!editMode}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                    />
                  </div>
                </div>

                {/* Category Selection */}
                <div>
                  <label htmlFor="profile-category" className="block text-sm text-gray-700 mb-2">
                    <Tag className="w-4 h-4 inline mr-1" />
                    Primary Category
                  </label>
                  {editMode ? (
                    <select
                      id="profile-category"
                      name="category"
                      value={formState.category}
                      onChange={(e) => setFormState((s: any) => ({ ...s, category: e.target.value }))}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white"
                    >
                      {CATEGORY_OPTIONS.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-gray-50 text-gray-700">
                      {formState.category || 'Not selected'}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Portfolio */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-gray-900">Portfolio</h2>
                <input
                  type="file"
                  accept="image/*"
                  ref={portfolioFileRef}
                  name="images"
                  id="profile-portfolio"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    if (!user || files.length === 0) return;
                    try {
                      const resp = await userService.uploadPortfolioImages(user.id, files);
                      await refreshUser();
                      setFormState((s: any) => ({ ...s, portfolio_images: resp.portfolio_images }));
                    } catch (err) {
                      console.error('Portfolio update failed', err);
                    }
                  }}
                />
                <button
                  onClick={() => { if (editMode) portfolioFileRef.current?.click(); }}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm flex items-center gap-2"
                  disabled={!editMode}
                >
                  <Plus className="w-4 h-4" />
                  Add Images
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {(formState.portfolio_images || []).map((image: string, index: number) => (
                  <div key={index} className="relative group aspect-square">
                    <ImageWithFallback
                      src={image}
                      alt={`Portfolio ${index + 1}`}
                      className="w-full h-full object-cover rounded-xl"
                    />
                    {editMode && (
                      <button
                        onClick={async () => {
                          const arr = (formState.portfolio_images || []).filter((_: any, i: number) => i !== index);
                          setFormState((s: any) => ({ ...s, portfolio_images: arr }));
                          if (user) {
                            try {
                              await userService.updateUser(user.id, { portfolio_images: arr });
                              await refreshUser();
                            } catch (err) {
                              console.error('Failed to remove image', err);
                            }
                          }
                        }}
                        className="absolute top-2 right-2 p-2 bg-white rounded-md hover:bg-gray-100"
                        title="Remove image"
                      >
                        <XCircle className="w-4 h-4 text-red-600" />
                      </button>
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center">
                      <button className="p-2 bg-white rounded-lg hover:bg-gray-100">
                        <Upload className="w-5 h-5 text-gray-700" />
                      </button>
                    </div>
                  </div>
                ))}
                <button className="aspect-square border-2 border-dashed border-gray-300 rounded-xl hover:border-purple-500 hover:bg-purple-50 transition-all flex items-center justify-center">
                  <Plus className="w-8 h-8 text-gray-400" />
                </button>
              </div>
            </div>

            {/* Pricing & Packages */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-gray-900">Pricing & Packages</h2>
                {editMode && (
                  <button
                    onClick={() => {
                      setPackages([...packages, {
                        id: null,
                        title: 'New Package',
                        description: 'Description of package features and benefits...',
                        price: 0,
                        category: 'Photography'
                      }]);
                    }}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add Package
                  </button>
                )}
              </div>
              {isLoadingPackages ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <ServiceCardSkeleton key={i} />
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  {packages.map((pkg, index) => (
                    <div key={index} className="p-4 border border-gray-200 rounded-xl">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex-1">
                          {editMode ? (
                            <input
                              type="text"
                              value={pkg.title}
                              onChange={(e) => {
                                const updated = [...packages];
                                updated[index].title = e.target.value;
                                setPackages(updated);
                              }}
                              className="text-gray-900 border border-gray-200 rounded-md px-3 py-2 w-full focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                              placeholder="Package name"
                            />
                          ) : (
                            <h3 className="text-gray-900">{pkg.title}</h3>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {editMode && (
                            <span className="text-gray-400">$</span>
                          )}
                          {editMode ? (
                            <input
                              type="number"
                              value={pkg.price}
                              onChange={(e) => {
                                const updated = [...packages];
                                updated[index].price = parseFloat(e.target.value) || 0;
                                setPackages(updated);
                              }}
                              className="w-24 text-right px-2 py-2 border border-gray-200 rounded-lg text-purple-600 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                              min="0"
                              step="0.01"
                            />
                          ) : (
                            <span className="text-purple-600 font-semibold">${pkg.price.toLocaleString()}</span>
                          )}
                          {editMode && packages.length > 1 && (
                            <button
                              onClick={async () => {
                                if (pkg.id && user) {
                                  try {
                                    await serviceService.deleteService(pkg.id);
                                  } catch (error) {
                                    console.error('Failed to delete service:', error);
                                  }
                                }
                                const updated = packages.filter((_, i) => i !== index);
                                setPackages(updated);
                              }}
                              className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Delete package"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      {editMode ? (
                        <textarea
                          value={pkg.description}
                          onChange={(e) => {
                            const updated = [...packages];
                            updated[index].description = e.target.value;
                            setPackages(updated);
                          }}
                          rows={3}
                          className="w-full text-sm text-gray-600 border border-gray-200 rounded-md px-3 py-2 resize-none focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                          placeholder="Description of package features and benefits..."
                        />
                      ) : (
                        <p className="text-sm text-gray-600 whitespace-pre-wrap">{pkg.description}</p>
                      )}
                      {/* Service Category */}
                      {editMode ? (
                        <div className="mt-3">
                          <label className="block text-xs text-gray-500 mb-1">Service Category</label>
                          <select
                            value={pkg.category || 'Photography'}
                            onChange={(e) => {
                              const updated = [...packages];
                              updated[index].category = e.target.value;
                              setPackages(updated);
                            }}
                            className="w-full sm:w-48 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white"
                          >
                            {CATEGORY_OPTIONS.map((cat) => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                          </select>
                        </div>
                      ) : pkg.category && (
                        <div className="mt-2">
                          <span className="inline-flex items-center px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded-full">
                            <Tag className="w-3 h-3 mr-1" />
                            {pkg.category}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                  {packages.length === 0 && !isLoadingPackages && (
                    <EmptyState
                      type="services"
                      title="No packages yet"
                      description="Create service packages to showcase your offerings and start receiving bookings."
                      action={editMode ? (
                        <button
                          onClick={() => {
                            setPackages([{
                              id: null,
                              title: 'New Package',
                              description: 'Description of package features and benefits...',
                              price: 0,
                              category: 'Photography'
                            }]);
                          }}
                          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm flex items-center gap-2"
                        >
                          <Plus className="w-4 h-4" />
                          Add Your First Package
                        </button>
                      ) : undefined}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Bookings Tab */}
        {activeTab === 'bookings' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-gray-900 mb-6">All Bookings</h2>
            {isLoadingBookings ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <BookingCardSkeleton key={i} />
                ))}
              </div>
            ) : bookingsError ? (
              <ErrorState
                type="network"
                title="Failed to load bookings"
                message={bookingsError}
                onRetry={fetchBookings}
                retrying={isLoadingBookings}
              />
            ) : bookingRequests.length === 0 ? (
              <EmptyState
                type="bookings"
                title="No bookings yet"
                description="When clients book your services, they'll appear here."
              />
            ) : (
              <div className="space-y-4">
                {bookingRequests.map((booking) => {
                  const statusStyles: Record<string, string> = {
                    pending: 'bg-yellow-100 text-yellow-700',
                    accepted: 'bg-green-100 text-green-700',
                    confirmed: 'bg-green-100 text-green-700',
                    completed: 'bg-blue-100 text-blue-700',
                    cancelled: 'bg-gray-100 text-gray-700',
                    rejected: 'bg-red-100 text-red-700',
                  };
                  return (
                    <div key={booking.id} className="p-4 border border-gray-200 rounded-xl hover:border-purple-300 transition-colors">
                      <div className="flex flex-col sm:flex-row gap-4">
                        <ImageWithFallback
                          src={booking.image}
                          alt={booking.client}
                          className="w-full sm:w-20 h-20 object-cover rounded-lg"
                        />
                        <div className="flex-1">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <h3 className="text-gray-900 font-medium">{booking.client}</h3>
                              <p className="text-sm text-gray-600">{booking.service || 'Service'}</p>
                            </div>
                            <span className={`px-3 py-1 rounded-full text-sm capitalize ${statusStyles[booking.status] || 'bg-gray-100 text-gray-700'}`}>
                              {booking.status}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 mb-3">
                            <div className="flex items-center gap-1">
                              <Calendar className="w-4 h-4" />
                              <span>{booking.date}</span>
                            </div>
                            <span>{booking.time}</span>
                            <span className="text-purple-600 font-medium">${booking.amount?.toLocaleString()}</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {booking.status === 'pending' && (
                              <>
                                <button
                                  onClick={async () => {
                                    try {
                                      await bookingService.updateBooking(String(booking.id), { status: 'accepted' } as any);
                                      setProviderBookings((prev) => prev.map((b: any) => b.id === booking.id ? { ...b, status: 'accepted' } : b));
                                      toast.success('Booking accepted', `Booking with ${booking.client} has been confirmed.`);
                                    } catch (e) {
                                      console.error('Failed to accept booking', e);
                                      toast.error('Failed to accept', 'Please try again.');
                                    }
                                  }}
                                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm flex items-center gap-2"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                  Accept
                                </button>
                                <button
                                  onClick={async () => {
                                    try {
                                      await bookingService.updateBooking(String(booking.id), { status: 'rejected' } as any);
                                      setProviderBookings((prev) => prev.map((b: any) => b.id === booking.id ? { ...b, status: 'rejected' } : b));
                                      toast.info('Booking declined', 'The client has been notified.');
                                    } catch (e) {
                                      console.error('Failed to reject booking', e);
                                      toast.error('Failed to decline', 'Please try again.');
                                    }
                                  }}
                                  className="px-4 py-2 border border-red-600 text-red-600 rounded-lg hover:bg-red-50 transition-colors text-sm flex items-center gap-2"
                                >
                                  <XCircle className="w-4 h-4" />
                                  Decline
                                </button>
                              </>
                            )}
                            {['accepted', 'confirmed'].includes(booking.status) && (
                              <button
                                onClick={async () => {
                                  try {
                                    await bookingService.updateBooking(String(booking.id), { status: 'completed' } as any);
                                    setProviderBookings((prev) => prev.map((b: any) => b.id === booking.id ? { ...b, status: 'completed' } : b));
                                    toast.success('Booking completed', 'Great job! The booking has been marked as complete.');
                                  } catch (e) {
                                    console.error('Failed to complete booking', e);
                                    toast.error('Failed to complete', 'Please try again.');
                                  }
                                }}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm flex items-center gap-2"
                              >
                                <CheckCircle className="w-4 h-4" />
                                Mark Complete
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setSelectedBookingId(booking.id);
                                setShowChat(true);
                              }}
                              className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm flex items-center gap-2"
                            >
                              <MessageSquare className="w-4 h-4" />
                              Message
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Wallet Tab */}
        {activeTab === 'wallet' && (
          <WalletDashboard />
        )}

        {/* Reviews Tab */}
        {activeTab === 'reviews' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-gray-900">Client Reviews</h2>
              <div className="flex items-center gap-2">
                <Star className="w-6 h-6 fill-yellow-400 text-yellow-400" />
                <span className="text-2xl text-gray-900">{reviewStats.averageRating}</span>
                <span className="text-gray-600">({reviewStats.totalReviews} {reviewStats.totalReviews === 1 ? 'review' : 'reviews'})</span>
              </div>
            </div>

            {isLoadingReviews ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="p-6 border border-gray-100 rounded-xl">
                    <div className="flex items-start justify-between mb-3">
                      <div className="space-y-2">
                        <div className="h-5 bg-gray-200 animate-pulse rounded w-32" />
                        <div className="h-4 bg-gray-200 animate-pulse rounded w-24" />
                      </div>
                      <div className="flex gap-1">
                        {Array.from({ length: 5 }).map((_, j) => (
                          <div key={j} className="w-4 h-4 bg-gray-200 animate-pulse rounded" />
                        ))}
                      </div>
                    </div>
                    <div className="h-16 bg-gray-200 animate-pulse rounded mb-3" />
                    <div className="h-4 bg-gray-200 animate-pulse rounded w-20" />
                  </div>
                ))}
              </div>
            ) : reviewsError ? (
              <ErrorState
                type="network"
                title="Failed to load reviews"
                message={reviewsError}
                onRetry={fetchReviews}
                retrying={isLoadingReviews}
              />
            ) : reviews.length === 0 ? (
              <EmptyState
                type="reviews"
                title="No reviews yet"
                description="Reviews from your clients will appear here after they complete bookings with you."
              />
            ) : (
              <div className="space-y-4">
                {reviews.map((review) => (
                  <div key={review.id} className="p-6 border border-gray-200 rounded-xl">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        {review.reviewer_image ? (
                          <ImageWithFallback
                            src={review.reviewer_image.startsWith('http') ? review.reviewer_image : `${STATIC_URL}/${review.reviewer_image}`}
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
                          <h3 className="text-gray-900 font-medium">{review.reviewer_name || 'Anonymous'}</h3>
                          <p className="text-sm text-gray-600">{review.service_title || 'Service'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {[...Array(5)].map((_, i) => (
                          <Star
                            key={i}
                            className={`w-4 h-4 ${i < review.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-200'}`}
                          />
                        ))}
                      </div>
                    </div>
                    {review.comment && (
                      <p className="text-gray-700 mb-3">{review.comment}</p>
                    )}
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-gray-500">
                        {reviewService.formatReviewDate(review.created_at)}
                      </p>
                      {review.moderation_status === 'approved' && (
                        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs">
                          Verified
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chat Modal */}
      {showChat && selectedBookingId && (() => {
        const selectedBooking = providerBookings.find(b => b.id === selectedBookingId);
        return (
          <ChatInterface
            provider={{
              id: selectedBooking?.client_id,
              name: selectedBooking?.client || 'Client',
              service: selectedBooking?.service || 'Service',
              image: selectedBooking?.image || '',
            }}
            bookingId={selectedBookingId}
            onClose={() => setShowChat(false)}
          />
        );
      })()}
    </div>
  );
}
