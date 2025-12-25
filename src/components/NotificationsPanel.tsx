import { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, X, CheckCheck, Trash2, Loader2, RefreshCw } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import notificationService, { Notification } from '../api/services/notificationService';
import { NotificationItem } from './NotificationItem';
import { useAuth } from '../context/AuthContext';

interface NotificationsPanelProps {
  onNavigate?: (notification: Notification) => void;
}

export function NotificationsPanel({ onNavigate }: NotificationsPanelProps) {
  const { user, token } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);

  // Fetch notifications
  const fetchNotifications = useCallback(async (refresh = false) => {
    if (!user) return;

    setLoading(true);
    try {
      const offset = refresh ? 0 : notifications.length;
      const res = await notificationService.getNotifications({ limit: 20, offset });

      if (refresh) {
        setNotifications(res.data);
      } else {
        setNotifications(prev => [...prev, ...res.data]);
      }

      setHasMore(res.data.length === 20);
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    } finally {
      setLoading(false);
    }
  }, [user, notifications.length]);

  // Fetch unread count
  const fetchUnreadCount = useCallback(async () => {
    if (!user) return;

    try {
      const res = await notificationService.getUnreadCount();
      setUnreadCount(res.count);
    } catch (error) {
      console.error('Failed to fetch unread count:', error);
    }
  }, [user]);

  // Initial load
  useEffect(() => {
    if (user) {
      fetchNotifications(true);
      fetchUnreadCount();
    }
  }, [user]);

  // Socket.IO connection for real-time notifications
  useEffect(() => {
    if (!user || !token) return;

    const SOCKET_URL = ((import.meta as any).env?.VITE_API_URL as string)?.replace('/api', '') || 'http://localhost:3001';

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      console.log('Notification socket connected');
    });

    socket.on('notification', (notification: Notification) => {
      setNotifications(prev => [notification, ...prev]);
      setUnreadCount(prev => prev + 1);

      // Play notification sound (optional)
      try {
        const audio = new Audio('/notification.mp3');
        audio.volume = 0.5;
        audio.play().catch(() => {});
      } catch {}
    });

    socket.on('notification:count', ({ count }: { count: number }) => {
      setUnreadCount(count);
    });

    socket.on('disconnect', () => {
      console.log('Notification socket disconnected');
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user, token]);

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Mark as read
  const handleMarkAsRead = async (id: string) => {
    try {
      await notificationService.markAsRead(id);
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  // Mark all as read
  const handleMarkAllAsRead = async () => {
    try {
      await notificationService.markAllAsRead();
      setNotifications(prev =>
        prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() }))
      );
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  // Delete notification
  const handleDelete = async (id: string) => {
    try {
      await notificationService.deleteNotification(id);
      const notification = notifications.find(n => n.id === id);
      setNotifications(prev => prev.filter(n => n.id !== id));
      if (notification && !notification.read_at) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error('Failed to delete notification:', error);
    }
  };

  // Clear all notifications
  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to clear all notifications?')) return;

    try {
      await notificationService.clearAll();
      setNotifications([]);
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to clear notifications:', error);
    }
  };

  // Handle notification click - navigate directly to the relevant page
  const handleNotificationClick = (notification: Notification) => {
    // Mark as read first
    if (!notification.read_at) {
      handleMarkAsRead(notification.id);
    }

    // Navigate to the relevant page
    if (onNavigate) {
      onNavigate(notification);
    }

    // Close the panel
    setIsOpen(false);
  };

  if (!user) return null;

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-xs font-medium rounded-full flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-96 max-h-[32rem] bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Notifications</h3>
            <div className="flex items-center gap-1">
              <button
                onClick={() => fetchNotifications(true)}
                className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllAsRead}
                  className="p-1.5 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                  title="Mark all as read"
                >
                  <CheckCheck className="w-4 h-4" />
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={handleClearAll}
                  className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Clear all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Notifications List */}
          <div className="overflow-y-auto max-h-[24rem]">
            {loading && notifications.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                <Bell className="w-12 h-12 text-gray-300 mb-3" />
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {notifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onMarkAsRead={handleMarkAsRead}
                    onDelete={handleDelete}
                    onClick={handleNotificationClick}
                  />
                ))}
              </div>
            )}

            {/* Load More */}
            {hasMore && notifications.length > 0 && (
              <div className="p-3 border-t border-gray-100">
                <button
                  onClick={() => fetchNotifications(false)}
                  disabled={loading}
                  className="w-full py-2 text-sm text-purple-600 hover:text-purple-700 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-50"
                >
                  {loading ? 'Loading...' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

export default NotificationsPanel;
