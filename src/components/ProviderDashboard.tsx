import { useState, useRef, useEffect } from 'react';
import { Upload, Calendar, DollarSign, Star, TrendingUp, CheckCircle, XCircle, MessageSquare, Users, Camera, Edit, Plus, Trash2 } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { useAuth } from '../context/AuthContext';
import userService from '../api/services/userService';
import serviceService from '../api/services/serviceService';
import { ChatInterface } from './ChatInterface';

export function ProviderDashboard() {
  const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
  const STATIC_URL = 'http://localhost:3001/uploads';
  const [activeTab, setActiveTab] = useState<'overview' | 'profile' | 'bookings' | 'earnings' | 'reviews'>('overview');
  const [showChat, setShowChat] = useState(false);
  const { user, refreshUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const portfolioFileRef = useRef<HTMLInputElement | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [packages, setPackages] = useState<any[]>([]);
  const [isLoadingPackages, setIsLoadingPackages] = useState(false);
  const [formState, setFormState] = useState<any>({
  name: user?.name || 'Sarah Johnson',
  title: user?.role === 'provider' ? 'Wedding & Portrait Photographer' : '',
  bio: user?.bio || '',
  location: user?.location || '',
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

  const stats = [
    { label: 'Upcoming Bookings', value: '12', change: '+3%', icon: Calendar, color: 'purple' },
    { label: 'Earnings (30d)', value: '$8,450', change: '+6%', icon: DollarSign, color: 'green' },
    { label: 'Completed Bookings', value: '230', change: '+10%', icon: TrendingUp, color: 'blue' },
    { label: 'Avg Rating', value: '4.9', change: '+1%', icon: Star, color: 'yellow' },
  ];

  // Sync formState when user changes
useEffect(() => {
  if (!user) return;

  setFormState({
    name: user.name || 'Sarah Johnson',
    title: user.role === 'provider' ? 'Wedding & Portrait Photographer' : '',
    bio: user.bio || '',
    location: user.location || '',
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


  const bookingRequests = [
    { id: 1, client: 'Emma Williams', service: 'Wedding Photography', date: '2025-12-20', time: '3:00 PM', amount: 2400, status: 'pending', image: 'https://images.unsplash.com/photo-1643968612613-fd411aecd1fd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwaG90b2dyYXBoZXIlMjBjYW1lcmElMjBwcm9mZXNzaW9uYWx8ZW58MXx8fHwxNzY0NDAwNjc1fDA&ixlib=rb-4.1.0&q=80&w=1080' },
    { id: 2, client: 'James Smith', service: 'Portrait Session', date: '2025-12-18', time: '10:00 AM', amount: 1200, status: 'pending', image: 'https://images.unsplash.com/photo-1643264623879-bb85ea39c62a?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwb3J0cmFpdCUyMHBob3RvZ3JhcGhlciUyMHByb2Zlc3Npb25hbHxlbnwxfHx8fDE3NjQ0MDc5NTR8MA&ixlib=rb-4.1.0&q=80&w=1080' },
    { id: 3, client: 'Sophia Brown', service: 'Engagement Photos', date: '2025-12-15', time: '2:00 PM', amount: 1800, status: 'confirmed', image: 'https://images.unsplash.com/photo-1623783356340-95375aac85ce?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3ZWRkaW5nJTIwcGhvdG9ncmFwaGVyfGVufDF8fHx8MTc2NDQwNzk1NHww&ixlib=rb-4.1.0&q=80&w=1080' },
  ];

  const reviews = [
    { id: 1, client: 'Emma Williams', rating: 5, comment: 'Absolutely amazing work! Sarah captured every moment perfectly. Highly recommend!', date: '2025-11-20', service: 'Wedding Photography' },
    { id: 2, client: 'Michael Johnson', rating: 5, comment: 'Professional, creative, and a pleasure to work with. The photos exceeded our expectations!', date: '2025-11-15', service: 'Corporate Event' },
    { id: 3, client: 'Lisa Chen', rating: 4, comment: 'Great experience overall. Very talented photographer with excellent communication.', date: '2025-11-10', service: 'Portrait Session' },
  ];

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
            { id: 'bookings', label: 'Bookings' },
            { id: 'earnings', label: 'Earnings' },
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
                {bookingRequests.map((booking) => (
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
                            <button className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm flex items-center gap-2">
                              <CheckCircle className="w-4 h-4" />
                              Accept
                            </button>
                            <button className="px-4 py-2 border border-red-600 text-red-600 rounded-lg hover:bg-red-50 transition-colors text-sm flex items-center gap-2">
                              <XCircle className="w-4 h-4" />
                              Decline
                            </button>
                            <button 
                              onClick={() => setShowChat(true)}
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
                              onClick={() => setShowChat(true)}
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
                <div className="text-center py-8 text-gray-500">Loading packages...</div>
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
                    </div>
                  ))}
                  {packages.length === 0 && !isLoadingPackages && (
                    <div className="text-center py-8 text-gray-500">
                      <p className="mb-4">No packages added yet.</p>
                      {editMode && (
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
                          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm flex items-center gap-2 mx-auto"
                        >
                          <Plus className="w-4 h-4" />
                          Add Your First Package
                        </button>
                      )}
                    </div>
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
            <div className="space-y-4">
              {bookingRequests.map((booking) => (
                <div key={booking.id} className="p-4 border border-gray-200 rounded-xl">
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
                        <span className={`px-3 py-1 rounded-full text-sm ${
                          booking.status === 'confirmed' 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {booking.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-600">
                        <span>{booking.date}</span>
                        <span>{booking.time}</span>
                        <span className="text-purple-600">${booking.amount}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Earnings Tab */}
        {activeTab === 'earnings' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                    <DollarSign className="w-6 h-6 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Total Earnings</p>
                    <p className="text-2xl text-gray-900">$45,230</p>
                  </div>
                </div>
                <p className="text-sm text-green-600">+18% from last month</p>
              </div>

              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                    <Calendar className="w-6 h-6 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">This Month</p>
                    <p className="text-2xl text-gray-900">$8,450</p>
                  </div>
                </div>
                <p className="text-sm text-purple-600">12 completed bookings</p>
              </div>

              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Pending</p>
                    <p className="text-2xl text-gray-900">$2,400</p>
                  </div>
                </div>
                <p className="text-sm text-blue-600">2 pending payouts</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <h2 className="text-gray-900 mb-6">Recent Transactions</h2>
              <div className="space-y-3">
                {[
                  { client: 'Emma Williams', amount: 2400, date: '2025-11-25', status: 'completed' },
                  { client: 'James Smith', amount: 1200, date: '2025-11-20', status: 'completed' },
                  { client: 'Sophia Brown', amount: 1800, date: '2025-11-18', status: 'pending' },
                ].map((transaction, index) => (
                  <div key={index} className="flex items-center justify-between p-4 border border-gray-200 rounded-xl">
                    <div>
                      <p className="text-gray-900">{transaction.client}</p>
                      <p className="text-sm text-gray-600">{transaction.date}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-gray-900">${transaction.amount}</p>
                      <span className={`text-sm ${
                        transaction.status === 'completed' ? 'text-green-600' : 'text-yellow-600'
                      }`}>
                        {transaction.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Reviews Tab */}
        {activeTab === 'reviews' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-gray-900">Client Reviews</h2>
              <div className="flex items-center gap-2">
                <Star className="w-6 h-6 fill-yellow-400 text-yellow-400" />
                <span className="text-2xl text-gray-900">4.9</span>
                <span className="text-gray-600">(127 reviews)</span>
              </div>
            </div>

            <div className="space-y-4">
              {reviews.map((review) => (
                <div key={review.id} className="p-6 border border-gray-200 rounded-xl">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-gray-900">{review.client}</h3>
                      <p className="text-sm text-gray-600">{review.service}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {[...Array(review.rating)].map((_, i) => (
                        <Star key={i} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                      ))}
                    </div>
                  </div>
                  <p className="text-gray-700 mb-3">{review.comment}</p>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-500">{review.date}</p>
                    <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs">
                      AI Verified
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Chat Modal */}
      {showChat && (
        <ChatInterface
          provider={{ name: 'Emma Williams', service: 'Client', image: 'https://images.unsplash.com/photo-1643968612613-fd411aecd1fd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwaG90b2dyYXBoZXIlMjBjYW1lcmElMjBwcm9mZXNzaW9uYWx8ZW58MXx8fHwxNzY0NDAwNjc1fDA&ixlib=rb-4.1.0&q=80&w=1080' }}
          onClose={() => setShowChat(false)}
        />
      )}
    </div>
  );
}
