import { Calendar, CreditCard, MessageSquare, CheckCircle, XCircle, PhilippinePeso, Star, Bell, Trash2 } from 'lucide-react';
import { Notification, NotificationType } from '../api/services/notificationService';

interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead?: (id: string) => void;
  onDelete?: (id: string) => void;
  onClick?: (notification: Notification) => void;
  isNew?: boolean;
}

const typeConfig: Record<NotificationType, { icon: any; color: string; bgColor: string }> = {
  booking_request: { icon: Calendar, color: 'text-blue-600', bgColor: 'bg-blue-100' },
  booking_accepted: { icon: CheckCircle, color: 'text-green-600', bgColor: 'bg-green-100' },
  booking_rejected: { icon: XCircle, color: 'text-red-600', bgColor: 'bg-red-100' },
  booking_cancelled: { icon: XCircle, color: 'text-gray-600', bgColor: 'bg-gray-100' },
  booking_completed: { icon: CheckCircle, color: 'text-purple-600', bgColor: 'bg-purple-100' },
  payment_received: { icon: PhilippinePeso, color: 'text-green-600', bgColor: 'bg-green-100' },
  payment_failed: { icon: CreditCard, color: 'text-red-600', bgColor: 'bg-red-100' },
  payout_approved: { icon: PhilippinePeso, color: 'text-blue-600', bgColor: 'bg-blue-100' },
  payout_completed: { icon: PhilippinePeso, color: 'text-green-600', bgColor: 'bg-green-100' },
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
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function NotificationItem({ notification, onMarkAsRead, onDelete, onClick, isNew }: NotificationItemProps) {
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
      className={`group relative flex items-start gap-3 py-3 pl-3 pr-2 border-l-[3px] cursor-pointer transition-colors duration-700 ${
        isNew
          ? 'border-purple-500 bg-purple-100'
          : isUnread
            ? 'border-purple-400 bg-purple-50/70 hover:bg-purple-100/70'
            : 'border-transparent hover:bg-gray-50'
      }`}
    >
      <div className={`w-9 h-9 rounded-full ${config.bgColor} flex items-center justify-center flex-shrink-0`}>
        <Icon className={`w-4 h-4 ${config.color}`} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`text-sm ${isUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-600'}`}>
            {notification.title}
          </span>
          <span className="text-xs text-gray-400 flex-shrink-0">{formatTimeAgo(notification.created_at)}</span>
        </div>
        <p className={`text-sm line-clamp-2 mt-0.5 ${isUnread ? 'text-gray-700' : 'text-gray-500'}`}>
          {notification.message}
        </p>
      </div>

      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(notification.id);
          }}
          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 self-center"
          title="Delete notification"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export default NotificationItem;
