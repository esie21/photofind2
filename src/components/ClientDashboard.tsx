import { useState } from 'react';
import { Search, SlidersHorizontal, Star, MapPin, Calendar, MessageSquare, Clock, ChevronRight, Filter, DollarSign } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { ChatInterface } from './ChatInterface';
import { NotificationsPanel } from './NotificationsPanel';

interface ClientDashboardProps {
  onStartBooking: () => void;
}

export function ClientDashboard({ onStartBooking }: ClientDashboardProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<any>(null);
  const [priceRange, setPriceRange] = useState([0, 1000]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [sortBy, setSortBy] = useState('recommended');

  const providers = [
    { id: 1, name: 'Sarah Johnson', service: 'Wedding Photographer', rating: 4.9, reviews: 127, price: 300, location: 'New York, NY', available: true, image: 'https://images.unsplash.com/photo-1623783356340-95375aac85ce?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3ZWRkaW5nJTIwcGhvdG9ncmFwaGVyfGVufDF8fHx8MTc2NDQwNzk1NHww&ixlib=rb-4.1.0&q=80&w=1080' },
    { id: 2, name: 'Michael Chen', service: 'Commercial Videographer', rating: 5.0, reviews: 89, price: 450, location: 'Los Angeles, CA', available: true, image: 'https://images.unsplash.com/photo-1713392824135-a7c7db3d9465?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx2aWRlb2dyYXBoZXIlMjBmaWxtaW5nfGVufDF8fHx8MTc2NDQwNzk1M3ww&ixlib=rb-4.1.0&q=80&w=1080' },
    { id: 3, name: 'Emily Rodriguez', service: 'Portrait Photographer', rating: 4.8, reviews: 234, price: 200, location: 'Chicago, IL', available: false, image: 'https://images.unsplash.com/photo-1643264623879-bb85ea39c62a?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwb3J0cmFpdCUyMHBob3RvZ3JhcGhlciUyMHByb2Zlc3Npb25hbHxlbnwxfHx8fDE3NjQ0MDc5NTR8MA&ixlib=rb-4.1.0&q=80&w=1080' },
    { id: 4, name: 'David Park', service: 'Brand Designer', rating: 4.9, reviews: 156, price: 250, location: 'San Francisco, CA', available: true, image: 'https://images.unsplash.com/photo-1760780567530-389d8a3fba75?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjcmVhdGl2ZSUyMHByb2Zlc3Npb25hbCUyMHN0dWRpb3xlbnwxfHx8fDE3NjQzNzkwODF8MA&ixlib=rb-4.1.0&q=80&w=1080' },
    { id: 5, name: 'Jessica Lee', service: 'Makeup Artist', rating: 4.7, reviews: 98, price: 180, location: 'Miami, FL', available: true, image: 'https://images.unsplash.com/photo-1698181842119-a5283dea1440?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtYWtldXAlMjBhcnRpc3QlMjBiZWF1dHl8ZW58MXx8fHwxNzY0MzU4MjcwfDA&ixlib=rb-4.1.0&q=80&w=1080' },
    { id: 6, name: 'Alex Thompson', service: 'Event Videographer', rating: 4.9, reviews: 145, price: 380, location: 'Austin, TX', available: true, image: 'https://images.unsplash.com/photo-1713392824135-a7c7db3d9465?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx2aWRlb2dyYXBoZXIlMjBmaWxtaW5nfGVufDF8fHx8MTc2NDQwNzk1M3ww&ixlib=rb-4.1.0&q=80&w=1080' },
  ];

  const upcomingBookings = [
    { id: 1, provider: 'Sarah Johnson', service: 'Wedding Photography', date: '2025-12-15', time: '2:00 PM', status: 'confirmed', image: 'https://images.unsplash.com/photo-1623783356340-95375aac85ce?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3ZWRkaW5nJTIwcGhvdG9ncmFwaGVyfGVufDF8fHx8MTc2NDQwNzk1NHww&ixlib=rb-4.1.0&q=80&w=1080' },
    { id: 2, provider: 'Michael Chen', service: 'Product Video', date: '2025-12-08', time: '10:00 AM', status: 'pending', image: 'https://images.unsplash.com/photo-1713392824135-a7c7db3d9465?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx2aWRlb2dyYXBoZXIlMjBmaWxtaW5nfGVufDF8fHx8MTc2NDQwNzk1M3ww&ixlib=rb-4.1.0&q=80&w=1080' },
  ];

  const handleViewProfile = (provider: any) => {
    setSelectedProvider(provider);
  };

  const handleSendMessage = (provider: any) => {
    setSelectedProvider(provider);
    setShowChat(true);
  };

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
                    className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                  />
                </div>
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
                <div className="pt-4 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Category</label>
                    <select 
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-purple-500"
                    >
                      <option value="all">All Categories</option>
                      <option value="photography">Photography</option>
                      <option value="videography">Videography</option>
                      <option value="design">Design</option>
                      <option value="makeup">Makeup</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Sort By</label>
                    <select 
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-purple-500"
                    >
                      <option value="recommended">Recommended</option>
                      <option value="rating">Highest Rated</option>
                      <option value="price-low">Price: Low to High</option>
                      <option value="price-high">Price: High to Low</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Availability</label>
                    <select className="w-full px-4 py-2 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-purple-500">
                      <option>Any time</option>
                      <option>This week</option>
                      <option>This month</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Service Providers Grid */}
            <div className="space-y-4">
              <h2 className="text-gray-900">Available Professionals</h2>
              
              <div className="grid grid-cols-1 gap-4">
                {providers.map((provider) => (
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
                            <h3 className="text-gray-900 mb-1">{provider.name}</h3>
                            <p className="text-gray-600 text-sm">{provider.service}</p>
                          </div>
                          <div className="text-right">
                            <div className="text-purple-600">${provider.price}/hr</div>
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
                            onClick={onStartBooking}
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
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Upcoming Bookings */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-gray-900">Upcoming Bookings</h3>
                <button className="text-sm text-purple-600 hover:text-purple-700">View all</button>
              </div>

              <div className="space-y-3">
                {upcomingBookings.map((booking) => (
                  <div key={booking.id} className="p-4 border border-gray-200 rounded-xl hover:border-purple-300 transition-colors">
                    <div className="flex gap-3">
                      <ImageWithFallback
                        src={booking.image}
                        alt={booking.provider}
                        className="w-12 h-12 object-cover rounded-lg"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 truncate">{booking.provider}</p>
                        <p className="text-xs text-gray-600 truncate">{booking.service}</p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                          <Calendar className="w-3 h-3" />
                          <span>{booking.date}</span>
                          <Clock className="w-3 h-3 ml-1" />
                          <span>{booking.time}</span>
                        </div>
                        <div className="mt-2">
                          <span className={`inline-block px-2 py-1 text-xs rounded-full ${
                            booking.status === 'confirmed' 
                              ? 'bg-green-100 text-green-700' 
                              : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {booking.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-gradient-to-br from-purple-600 to-pink-600 rounded-2xl p-6 text-white">
              <h3 className="mb-2">Need help finding the right professional?</h3>
              <p className="text-sm text-purple-100 mb-4">
                Our team can help match you with the perfect service provider
              </p>
              <button className="w-full py-2 bg-white text-purple-600 rounded-lg hover:bg-purple-50 transition-colors text-sm">
                Contact Support
              </button>
            </div>

            {/* Notifications Preview */}
            <NotificationsPanel />
          </div>
        </div>
      </div>

      {/* Chat Modal */}
      {showChat && selectedProvider && (
        <ChatInterface
          provider={selectedProvider}
          onClose={() => setShowChat(false)}
        />
      )}

      {/* Provider Profile Modal */}
      {selectedProvider && !showChat && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
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
                    <span className="text-purple-600">${selectedProvider.price}/hr</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={onStartBooking}
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
