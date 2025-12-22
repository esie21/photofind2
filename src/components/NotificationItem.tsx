import { Calendar, CreditCard, MessageSquare, CheckCircle, XCircle, DollarSign, Star, Bell, Trash2 } from 'lucide-react';
import { Notification, NotificationType } from '../api/services/notificationService';

interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead?: (id: string) => void;
  onDelete?: (id: string) => void;
  onClick?: (notification: Notification) => void;
}

const typeConfig: Record<NotificationType, { icon: any; color: string; bgColor: string }> = {
  booking_request: { icon: Calendar, color: 'text-blue-600', bgColor: 'bg-blue-100' },
  booking_accepted: { icon: CheckCircle, color: 'text-green-600', bgColor: 'bg-green-100' },
  booking_rejected: { icon: XCircle, color: 'text-red-600', bgColor: 'bg-red-100' },
  booking_cancelled: { icon: XCircle, color: 'text-gray-600', bgColor: 'bg-gray-100' },
  booking_completed: { icon: CheckCircle, color: 'text-purple-600', bgColor: 'bg-purple-100' },
  payment_received: { icon: DollarSign, color: 'text-green-600', bgColor: 'bg-green-100' },
  payment_failed: { icon: CreditCard, color: 'text-red-600', bgColor: 'bg-red-100' },
  payout_approved: { icon: DollarSign, color: 'text-blue-600', bgColor: 'bg-blue-100' },
  payout_completed: { icon: DollarSign, color: 'text-green-600', bgColor: 'bg-green-100' },
  payout_rejected: { icon: XCircle, color: 'text-red-600', bgColor: 'bg-red-100' },
  new_message: { icon: MessageSquare, color: 'text-purple-600', bgColor: 'bg-purple-100' },
  new_review: { icon: Star, color: 'text-yellow-600', bgColor: 'bg-yellow-100' },
  system: { icon: Bell, color: 'text-gray-600', bgColor: 'bg-gray-100' },
};

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function NotificationItem({ notification, onMarkAsRead, onDelete, onClick }: NotificationItemProps) {
  const config = typeConfig[notification.type] || typeConfig.system;
  const Icon = config.icon;
  const isUnread = !notification.read_at;

  const handleClick = () => {
    if (isUnread && onMarkAsRead) {
      onMarkAsRead(notification.id);
    }
    if (onClick) {
      onClick(notification);
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`group flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
        isUnread ? 'bg-purple-50 hover:bg-purple-100' : 'hover:bg-gray-50'
      }`}
    >
      <div className={`p-2 rounded-lg ${config.bgColor} flex-shrink-0`}>
        <Icon className={`w-4 h-4 ${config.color}`} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h4 className={`text-sm ${isUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
            {notification.title}
          </h4>
          {isUnread && (
            <span className="w-2 h-2 rounded-full bg-purple-600 flex-shrink-0 mt-1.5" />
          )}
        </div>
        <p className="text-sm text-gray-600 line-clamp-2 mt-0.5">
          {notification.message}
        </p>
        <span className="text-xs text-gray-400 mt-1 block">
          {formatTimeAgo(notification.created_at)}
        </span>
      </div>

      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(notification.id);
          }}
          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
          title="Delete notification"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export default NotificationItem;
