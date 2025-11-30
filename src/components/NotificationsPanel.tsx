import { Bell, Calendar, MessageSquare, Star, CheckCircle } from 'lucide-react';

export function NotificationsPanel() {
  const notifications = [
    {
      id: 1,
      type: 'booking',
      icon: Calendar,
      title: 'Booking Confirmed',
      message: 'Sarah Johnson confirmed your booking',
      time: '2 hours ago',
      read: false
    },
    {
      id: 2,
      type: 'message',
      icon: MessageSquare,
      title: 'New Message',
      message: 'Michael Chen sent you a message',
      time: '5 hours ago',
      read: false
    },
    {
      id: 3,
      type: 'review',
      icon: Star,
      title: 'Review Reminder',
      message: 'Please review your session with Emily Rodriguez',
      time: '1 day ago',
      read: true
    },
  ];

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-gray-700" />
          <h3 className="text-gray-900">Notifications</h3>
        </div>
        <div className="w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs">
          2
        </div>
      </div>

      <div className="space-y-3">
        {notifications.map((notification) => {
          const Icon = notification.icon;
          return (
            <div 
              key={notification.id} 
              className={`p-3 rounded-xl border ${
                notification.read 
                  ? 'border-gray-100 bg-gray-50' 
                  : 'border-purple-200 bg-purple-50'
              } hover:shadow-sm transition-shadow cursor-pointer`}
            >
              <div className="flex gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                  notification.read ? 'bg-gray-200' : 'bg-purple-100'
                }`}>
                  <Icon className={`w-5 h-5 ${notification.read ? 'text-gray-600' : 'text-purple-600'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900">{notification.title}</p>
                  <p className="text-xs text-gray-600 truncate">{notification.message}</p>
                  <p className="text-xs text-gray-400 mt-1">{notification.time}</p>
                </div>
                {!notification.read && (
                  <div className="w-2 h-2 bg-purple-600 rounded-full flex-shrink-0 mt-2"></div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button className="w-full mt-4 py-2 text-sm text-purple-600 hover:text-purple-700">
        View all notifications
      </button>
    </div>
  );
}
