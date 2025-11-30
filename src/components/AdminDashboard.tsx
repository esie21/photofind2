import { useState } from 'react';
import { Users, DollarSign, TrendingUp, AlertCircle, CheckCircle, XCircle, Search, Filter, MoreVertical, Eye, FileText } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';

export function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'providers' | 'disputes' | 'analytics'>('overview');

  const stats = [
    { label: 'Total Users', value: '15,234', change: '+8%', icon: Users, color: 'blue' },
    { label: 'Active Providers', value: '5,147', change: '+12%', icon: Users, color: 'purple' },
    { label: 'Revenue (MTD)', value: '$127,450', change: '+23%', icon: DollarSign, color: 'green' },
    { label: 'Pending Approvals', value: '23', change: '-5%', icon: AlertCircle, color: 'yellow' },
  ];

  const pendingProviders = [
    { id: 1, name: 'Alex Thompson', service: 'Event Videographer', location: 'Austin, TX', submitted: '2025-11-28', experience: '5 years', portfolio: 12, image: 'https://images.unsplash.com/photo-1713392824135-a7c7db3d9465?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx2aWRlb2dyYXBoZXIlMjBmaWxtaW5nfGVufDF8fHx8MTc2NDQwNzk1M3ww&ixlib=rb-4.1.0&q=80&w=1080' },
    { id: 2, name: 'Maria Garcia', service: 'Makeup Artist', location: 'Miami, FL', submitted: '2025-11-27', experience: '8 years', portfolio: 25, image: 'https://images.unsplash.com/photo-1698181842119-a5283dea1440?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtYWtldXAlMjBhcnRpc3QlMjBiZWF1dHl8ZW58MXx8fHwxNzY0MzU4MjcwfDA&ixlib=rb-4.1.0&q=80&w=1080' },
    { id: 3, name: 'Ryan Martinez', service: 'Brand Designer', location: 'Seattle, WA', submitted: '2025-11-26', experience: '6 years', portfolio: 18, image: 'https://images.unsplash.com/photo-1760780567530-389d8a3fba75?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjcmVhdGl2ZSUyMHByb2Zlc3Npb25hbCUyMHN0dWRpb3xlbnwxfHx8fDE3NjQzNzkwODF8MA&ixlib=rb-4.1.0&q=80&w=1080' },
  ];

  const disputes = [
    { id: 1, type: 'Refund Request', client: 'Emma Williams', provider: 'Sarah Johnson', amount: 2400, reason: 'Service not delivered as expected', status: 'pending', date: '2025-11-28' },
    { id: 2, type: 'Quality Issue', client: 'James Smith', provider: 'Michael Chen', amount: 1200, reason: 'Photos did not meet expectations', status: 'investigating', date: '2025-11-27' },
    { id: 3, type: 'Cancellation', client: 'Sophia Brown', provider: 'Emily Rodriguez', amount: 1800, reason: 'Last minute cancellation by provider', status: 'resolved', date: '2025-11-25' },
  ];

  const recentUsers = [
    { id: 1, name: 'John Doe', email: 'john@example.com', role: 'Client', joined: '2025-11-28', bookings: 0, status: 'active' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com', role: 'Client', joined: '2025-11-27', bookings: 2, status: 'active' },
    { id: 3, name: 'Mike Johnson', email: 'mike@example.com', role: 'Client', joined: '2025-11-26', bookings: 5, status: 'active' },
  ];

  const analyticsData = {
    bookings: [
      { month: 'Jul', value: 45 },
      { month: 'Aug', value: 52 },
      { month: 'Sep', value: 48 },
      { month: 'Oct', value: 61 },
      { month: 'Nov', value: 73 },
      { month: 'Dec', value: 58 },
    ],
    categories: [
      { name: 'Photography', percentage: 35, count: 1234 },
      { name: 'Videography', percentage: 25, count: 856 },
      { name: 'Design', percentage: 20, count: 567 },
      { name: 'Makeup', percentage: 12, count: 423 },
      { name: 'Tutors', percentage: 8, count: 312 },
    ],
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-gray-900 mb-2">Admin Dashboard</h1>
          <p className="text-gray-600">Manage users, providers, and platform operations</p>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-2xl shadow-sm p-2 mb-6 flex gap-2 overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'users', label: 'Users' },
            { id: 'providers', label: 'Provider Approvals' },
            { id: 'disputes', label: 'Disputes' },
            { id: 'analytics', label: 'Analytics' },
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
                      <span className={`text-sm ${stat.change.startsWith('+') ? 'text-green-600' : 'text-red-600'}`}>
                        {stat.change}
                      </span>
                    </div>
                    <div className="text-2xl text-gray-900 mb-1">{stat.value}</div>
                    <div className="text-sm text-gray-600">{stat.label}</div>
                  </div>
                );
              })}
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Pending Approvals */}
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-gray-900">Pending Provider Approvals</h3>
                  <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm">
                    {pendingProviders.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {pendingProviders.slice(0, 3).map((provider) => (
                    <div key={provider.id} className="p-3 border border-gray-200 rounded-xl hover:border-purple-300 transition-colors">
                      <div className="flex items-center gap-3 mb-2">
                        <ImageWithFallback
                          src={provider.image}
                          alt={provider.name}
                          className="w-10 h-10 object-cover rounded-lg"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 truncate">{provider.name}</p>
                          <p className="text-xs text-gray-600 truncate">{provider.service}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button className="flex-1 px-3 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 text-xs">
                          Approve
                        </button>
                        <button className="flex-1 px-3 py-1 border border-red-600 text-red-600 rounded-lg hover:bg-red-50 text-xs">
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button 
                  onClick={() => setActiveTab('providers')}
                  className="w-full mt-4 py-2 text-sm text-purple-600 hover:text-purple-700"
                >
                  View all pending
                </button>
              </div>

              {/* Recent Disputes */}
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-gray-900">Recent Disputes</h3>
                  <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm">
                    {disputes.filter(d => d.status === 'pending' || d.status === 'investigating').length}
                  </span>
                </div>
                <div className="space-y-3">
                  {disputes.slice(0, 3).map((dispute) => (
                    <div key={dispute.id} className="p-3 border border-gray-200 rounded-xl">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900">{dispute.type}</p>
                          <p className="text-xs text-gray-600 truncate">{dispute.client} vs {dispute.provider}</p>
                        </div>
                        <span className={`px-2 py-1 rounded-full text-xs whitespace-nowrap ${
                          dispute.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                          dispute.status === 'investigating' ? 'bg-blue-100 text-blue-700' :
                          'bg-green-100 text-green-700'
                        }`}>
                          {dispute.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mb-2">${dispute.amount} • {dispute.date}</p>
                      <button className="text-xs text-purple-600 hover:text-purple-700">
                        Review Details →
                      </button>
                    </div>
                  ))}
                </div>
                <button 
                  onClick={() => setActiveTab('disputes')}
                  className="w-full mt-4 py-2 text-sm text-purple-600 hover:text-purple-700"
                >
                  View all disputes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search users..."
                  className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                />
              </div>
              <button className="px-6 py-3 border border-gray-200 rounded-xl hover:bg-gray-50 flex items-center gap-2 justify-center">
                <Filter className="w-5 h-5" />
                Filters
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 text-sm text-gray-600">User</th>
                    <th className="text-left py-3 px-4 text-sm text-gray-600">Role</th>
                    <th className="text-left py-3 px-4 text-sm text-gray-600">Joined</th>
                    <th className="text-left py-3 px-4 text-sm text-gray-600">Bookings</th>
                    <th className="text-left py-3 px-4 text-sm text-gray-600">Status</th>
                    <th className="text-left py-3 px-4 text-sm text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recentUsers.map((user) => (
                    <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-4 px-4">
                        <div>
                          <p className="text-sm text-gray-900">{user.name}</p>
                          <p className="text-xs text-gray-600">{user.email}</p>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-sm text-gray-700">{user.role}</td>
                      <td className="py-4 px-4 text-sm text-gray-700">{user.joined}</td>
                      <td className="py-4 px-4 text-sm text-gray-700">{user.bookings}</td>
                      <td className="py-4 px-4">
                        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs">
                          {user.status}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <button className="p-2 hover:bg-gray-100 rounded-lg">
                          <MoreVertical className="w-4 h-4 text-gray-600" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Provider Approvals Tab */}
        {activeTab === 'providers' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-gray-900 mb-6">Pending Provider Approvals</h2>

            <div className="space-y-4">
              {pendingProviders.map((provider) => (
                <div key={provider.id} className="p-6 border border-gray-200 rounded-xl hover:border-purple-300 transition-colors">
                  <div className="flex flex-col sm:flex-row gap-6">
                    <ImageWithFallback
                      src={provider.image}
                      alt={provider.name}
                      className="w-full sm:w-32 h-32 object-cover rounded-xl"
                    />
                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="text-gray-900 mb-1">{provider.name}</h3>
                          <p className="text-gray-600">{provider.service}</p>
                        </div>
                        <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm">
                          Pending
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 text-sm">
                        <div>
                          <p className="text-gray-600">Location</p>
                          <p className="text-gray-900">{provider.location}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Experience</p>
                          <p className="text-gray-900">{provider.experience}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Portfolio</p>
                          <p className="text-gray-900">{provider.portfolio} items</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Submitted</p>
                          <p className="text-gray-900">{provider.submitted}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm flex items-center gap-2">
                          <Eye className="w-4 h-4" />
                          Review Details
                        </button>
                        <button className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm flex items-center gap-2">
                          <CheckCircle className="w-4 h-4" />
                          Approve
                        </button>
                        <button className="px-4 py-2 border border-red-600 text-red-600 rounded-lg hover:bg-red-50 transition-colors text-sm flex items-center gap-2">
                          <XCircle className="w-4 h-4" />
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Disputes Tab */}
        {activeTab === 'disputes' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-gray-900 mb-6">Dispute Management</h2>

            <div className="space-y-4">
              {disputes.map((dispute) => (
                <div key={dispute.id} className="p-6 border border-gray-200 rounded-xl">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-gray-900">{dispute.type}</h3>
                        <span className={`px-3 py-1 rounded-full text-sm ${
                          dispute.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                          dispute.status === 'investigating' ? 'bg-blue-100 text-blue-700' :
                          'bg-green-100 text-green-700'
                        }`}>
                          {dispute.status}
                        </span>
                      </div>
                      <p className="text-gray-600 mb-2">{dispute.client} vs {dispute.provider}</p>
                      <p className="text-sm text-gray-600">{dispute.reason}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-purple-600 mb-1">${dispute.amount}</p>
                      <p className="text-sm text-gray-500">{dispute.date}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      View Details
                    </button>
                    {dispute.status !== 'resolved' && (
                      <>
                        <button className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm">
                          Resolve
                        </button>
                        <button className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm">
                          Contact Parties
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Bookings Trend */}
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <h3 className="text-gray-900 mb-6">Booking Trends</h3>
                <div className="h-64 flex items-end justify-between gap-2">
                  {analyticsData.bookings.map((data, index) => (
                    <div key={index} className="flex-1 flex flex-col items-center gap-2">
                      <div className="w-full bg-purple-600 rounded-t-lg hover:bg-purple-700 transition-colors relative group" style={{ height: `${(data.value / 73) * 100}%` }}>
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-900 text-white px-2 py-1 rounded text-xs">
                          {data.value}
                        </div>
                      </div>
                      <span className="text-xs text-gray-600">{data.month}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Category Distribution */}
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <h3 className="text-gray-900 mb-6">Service Categories</h3>
                <div className="space-y-4">
                  {analyticsData.categories.map((category, index) => (
                    <div key={index}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-gray-700">{category.name}</span>
                        <span className="text-sm text-gray-900">{category.percentage}%</span>
                      </div>
                      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-purple-600 rounded-full transition-all"
                          style={{ width: `${category.percentage}%` }}
                        ></div>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{category.count} professionals</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Platform Stats */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <h3 className="text-gray-900 mb-6">Platform Statistics</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div>
                  <p className="text-sm text-gray-600 mb-1">Conversion Rate</p>
                  <p className="text-2xl text-gray-900">68%</p>
                  <p className="text-sm text-green-600">+5% this month</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Avg. Booking Value</p>
                  <p className="text-2xl text-gray-900">$1,847</p>
                  <p className="text-sm text-green-600">+12% this month</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Response Time</p>
                  <p className="text-2xl text-gray-900">2.3h</p>
                  <p className="text-sm text-green-600">-15% this month</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Customer Satisfaction</p>
                  <p className="text-2xl text-gray-900">4.8/5</p>
                  <p className="text-sm text-green-600">+0.2 this month</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
