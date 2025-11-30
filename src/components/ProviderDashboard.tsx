import { useState } from 'react';
import { Upload, Calendar, DollarSign, Star, TrendingUp, CheckCircle, XCircle, MessageSquare, Users, Camera, Edit, Plus } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { ChatInterface } from './ChatInterface';

export function ProviderDashboard() {
  const [activeTab, setActiveTab] = useState<'overview' | 'profile' | 'bookings' | 'earnings' | 'reviews'>('overview');
  const [showChat, setShowChat] = useState(false);

  const stats = [
    { label: 'Total Bookings', value: '127', change: '+12%', icon: Calendar, color: 'purple' },
    { label: 'This Month', value: '$8,450', change: '+23%', icon: DollarSign, color: 'green' },
    { label: 'Avg Rating', value: '4.9', change: '+0.2', icon: Star, color: 'yellow' },
    { label: 'Response Rate', value: '98%', change: '+5%', icon: TrendingUp, color: 'blue' },
  ];

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
              {stats.map((stat, index) => {
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
            {/* Basic Info */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-gray-900">Profile Information</h2>
                <button className="px-4 py-2 border border-purple-600 text-purple-600 rounded-lg hover:bg-purple-50 transition-colors text-sm flex items-center gap-2">
                  <Edit className="w-4 h-4" />
                  Edit Profile
                </button>
              </div>

              <div className="space-y-6">
                <div className="flex items-start gap-6">
                  <div className="relative">
                    <ImageWithFallback
                      src="https://images.unsplash.com/photo-1623783356340-95375aac85ce?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3ZWRkaW5nJTIwcGhvdG9ncmFwaGVyfGVufDF8fHx8MTc2NDQwNzk1NHww&ixlib=rb-4.1.0&q=80&w=1080"
                      alt="Profile"
                      className="w-24 h-24 object-cover rounded-2xl"
                    />
                    <button className="absolute -bottom-2 -right-2 w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center hover:bg-purple-700">
                      <Camera className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-gray-900 mb-2">Sarah Johnson</h3>
                    <p className="text-gray-600 mb-4">Wedding & Portrait Photographer</p>
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
                  <label className="block text-sm text-gray-700 mb-2">Bio</label>
                  <textarea
                    defaultValue="Professional photographer with over 10 years of experience specializing in weddings, portraits, and events. Passionate about capturing authentic moments and creating timeless memories for my clients."
                    rows={4}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Years of Experience</label>
                    <input
                      type="number"
                      defaultValue="10"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Location</label>
                    <input
                      type="text"
                      defaultValue="New York, NY"
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
                <button className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Add Images
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {portfolioImages.map((image, index) => (
                  <div key={index} className="relative group aspect-square">
                    <ImageWithFallback
                      src={image}
                      alt={`Portfolio ${index + 1}`}
                      className="w-full h-full object-cover rounded-xl"
                    />
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
              <h2 className="text-gray-900 mb-6">Pricing & Packages</h2>

              <div className="space-y-4">
                {['Basic Package', 'Standard Package', 'Premium Package'].map((pkg, index) => (
                  <div key={index} className="p-4 border border-gray-200 rounded-xl">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <input
                          type="text"
                          defaultValue={pkg}
                          className="text-gray-900 bg-transparent border-0 outline-none p-0"
                        />
                      </div>
                      <input
                        type="number"
                        defaultValue={(index + 1) * 1200}
                        className="w-24 text-right px-2 py-1 border border-gray-200 rounded-lg text-purple-600"
                      />
                    </div>
                    <textarea
                      defaultValue="Description of package features and benefits..."
                      rows={2}
                      className="w-full text-sm text-gray-600 bg-transparent border-0 outline-none p-0 resize-none"
                    />
                  </div>
                ))}
              </div>
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
