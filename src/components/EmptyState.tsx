import React, { ReactNode } from 'react';
import { Calendar, Camera, MessageSquare, Bell, Search, ShoppingBag, Star, Users, Wallet, FileText } from 'lucide-react';

type EmptyStateType =
  | 'bookings'
  | 'messages'
  | 'notifications'
  | 'search'
  | 'services'
  | 'reviews'
  | 'providers'
  | 'wallet'
  | 'generic';

interface EmptyStateProps {
  type?: EmptyStateType;
  title?: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

const emptyStateConfig: Record<EmptyStateType, { icon: any; title: string; description: string; color: string }> = {
  bookings: {
    icon: Calendar,
    title: 'No bookings yet',
    description: 'Your upcoming and past bookings will appear here once you book a service.',
    color: 'purple',
  },
  messages: {
    icon: MessageSquare,
    title: 'No messages',
    description: 'Start a conversation with a service provider to see your messages here.',
    color: 'blue',
  },
  notifications: {
    icon: Bell,
    title: 'All caught up!',
    description: "You don't have any notifications right now.",
    color: 'green',
  },
  search: {
    icon: Search,
    title: 'No results found',
    description: 'Try adjusting your search or filters to find what you\'re looking for.',
    color: 'gray',
  },
  services: {
    icon: Camera,
    title: 'No services yet',
    description: 'Add your first service package to start receiving bookings.',
    color: 'pink',
  },
  reviews: {
    icon: Star,
    title: 'No reviews yet',
    description: 'Reviews from your clients will appear here after completed bookings.',
    color: 'yellow',
  },
  providers: {
    icon: Users,
    title: 'No providers found',
    description: 'We couldn\'t find any providers matching your criteria.',
    color: 'indigo',
  },
  wallet: {
    icon: Wallet,
    title: 'No transactions',
    description: 'Your earnings and transaction history will appear here.',
    color: 'emerald',
  },
  generic: {
    icon: FileText,
    title: 'Nothing here yet',
    description: 'There\'s no data to display at the moment.',
    color: 'gray',
  },
};

const colorClasses: Record<string, { bg: string; icon: string; ring: string }> = {
  purple: { bg: 'bg-purple-50', icon: 'text-purple-400', ring: 'ring-purple-100' },
  blue: { bg: 'bg-blue-50', icon: 'text-blue-400', ring: 'ring-blue-100' },
  green: { bg: 'bg-green-50', icon: 'text-green-400', ring: 'ring-green-100' },
  gray: { bg: 'bg-gray-50', icon: 'text-gray-400', ring: 'ring-gray-100' },
  pink: { bg: 'bg-pink-50', icon: 'text-pink-400', ring: 'ring-pink-100' },
  yellow: { bg: 'bg-yellow-50', icon: 'text-yellow-500', ring: 'ring-yellow-100' },
  indigo: { bg: 'bg-indigo-50', icon: 'text-indigo-400', ring: 'ring-indigo-100' },
  emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-400', ring: 'ring-emerald-100' },
};

export function EmptyState({ type = 'generic', title, description, action, icon }: EmptyStateProps) {
  const config = emptyStateConfig[type];
  const colors = colorClasses[config.color];
  const IconComponent = config.icon;

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {/* Decorative background circles */}
      <div className="relative mb-6">
        <div className={`absolute -inset-4 ${colors.bg} rounded-full opacity-50 blur-xl`} />
        <div className={`relative w-20 h-20 ${colors.bg} rounded-full flex items-center justify-center ring-8 ${colors.ring}`}>
          {icon ? (
            icon
          ) : (
            <IconComponent className={`w-10 h-10 ${colors.icon}`} strokeWidth={1.5} />
          )}
        </div>
      </div>

      {/* Content */}
      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        {title || config.title}
      </h3>
      <p className="text-sm text-gray-500 max-w-sm mb-6">
        {description || config.description}
      </p>

      {/* Optional action button */}
      {action && (
        <div className="mt-2">
          {action}
        </div>
      )}
    </div>
  );
}

// Inline empty state for smaller areas
export function InlineEmptyState({
  icon: IconComponent = FileText,
  message = 'No items to display',
  className = ''
}: {
  icon?: React.ComponentType<{ className?: string }>;
  message?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center py-8 text-center ${className}`}>
      <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
        <IconComponent className="w-6 h-6 text-gray-400" />
      </div>
      <p className="text-sm text-gray-500">{message}</p>
    </div>
  );
}

export default EmptyState;
