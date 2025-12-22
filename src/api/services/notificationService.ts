import { apiClient } from '../client';

export type NotificationType =
  | 'booking_request'
  | 'booking_accepted'
  | 'booking_rejected'
  | 'booking_cancelled'
  | 'booking_completed'
  | 'payment_received'
  | 'payment_failed'
  | 'payout_approved'
  | 'payout_completed'
  | 'payout_rejected'
  | 'new_message'
  | 'new_review'
  | 'system';

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
  read_at: string | null;
  created_at: string;
}

export interface NotificationsResponse {
  data: Notification[];
  meta: {
    limit: number;
    offset: number;
    total: number;
  };
}

const notificationService = {
  // Get notifications for current user
  async getNotifications(options?: {
    limit?: number;
    offset?: number;
    unreadOnly?: boolean;
  }): Promise<NotificationsResponse> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    if (options?.unreadOnly) params.set('unread', 'true');

    const url = `/notifications${params.toString() ? `?${params.toString()}` : ''}`;
    return apiClient.get<NotificationsResponse>(url);
  },

  // Get unread count
  async getUnreadCount(): Promise<{ count: number }> {
    return apiClient.get<{ count: number }>('/notifications/unread-count');
  },

  // Mark single notification as read
  async markAsRead(notificationId: string): Promise<{ data: Notification }> {
    return apiClient.patch<{ data: Notification }>(`/notifications/${notificationId}/read`, {});
  },

  // Mark all notifications as read
  async markAllAsRead(): Promise<{ message: string; count: number }> {
    return apiClient.patch<{ message: string; count: number }>('/notifications/read-all', {});
  },

  // Delete a notification
  async deleteNotification(notificationId: string): Promise<{ message: string }> {
    return apiClient.delete<{ message: string }>(`/notifications/${notificationId}`);
  },

  // Clear all notifications
  async clearAll(): Promise<{ message: string; count: number }> {
    return apiClient.delete<{ message: string; count: number }>('/notifications');
  },
};

export default notificationService;
