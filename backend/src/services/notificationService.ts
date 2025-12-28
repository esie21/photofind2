import pool from '../config/database';
import { Server as SocketIOServer } from 'socket.io';

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

export interface CreateNotificationParams {
  userId: string | number;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
}

class NotificationService {
  private io: SocketIOServer | null = null;

  // Set the Socket.IO instance
  setSocketIO(io: SocketIOServer) {
    this.io = io;
  }

  // Create and send a notification
  async create(params: CreateNotificationParams): Promise<any> {
    const { userId, type, title, message, data } = params;

    try {
      const result = await pool.query(
        `INSERT INTO notifications (user_id, type, title, message, data)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, type, title, message, data, read_at, created_at`,
        [userId, type, title, message, data || null]
      );

      let notification = result.rows[0];

      // Parse data if it's a string (backwards compatibility)
      if (notification.data && typeof notification.data === 'string') {
        try {
          notification.data = JSON.parse(notification.data);
        } catch (e) {
          // Keep as-is if parsing fails
        }
      }

      // Emit real-time notification via Socket.IO
      if (this.io) {
        // Emit to user's personal room
        this.io.to(`user:${userId}`).emit('notification', notification);
        // Also emit unread count update
        const countResult = await pool.query(
          `SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
          [userId]
        );
        this.io.to(`user:${userId}`).emit('notification:count', {
          count: parseInt(countResult.rows[0].count)
        });
      }

      return notification;
    } catch (error) {
      console.error('Error creating notification:', error);
      throw error;
    }
  }

  // Create multiple notifications at once
  async createMany(notifications: CreateNotificationParams[]): Promise<any[]> {
    const results = await Promise.all(
      notifications.map(params => this.create(params))
    );
    return results;
  }

  // Helper methods for common notification types

  async notifyBookingRequest(
    providerId: string | number,
    clientId: string | number,
    clientName: string,
    bookingId: string | number,
    serviceName: string
  ) {
    return this.create({
      userId: providerId,
      type: 'booking_request',
      title: 'New Booking Request',
      message: `${clientName} requested to book "${serviceName}"`,
      data: { booking_id: bookingId, client_id: clientId, client_name: clientName }
    });
  }

  async notifyBookingAccepted(
    clientId: string | number,
    providerId: string | number,
    providerName: string,
    bookingId: string | number
  ) {
    return this.create({
      userId: clientId,
      type: 'booking_accepted',
      title: 'Booking Accepted',
      message: `${providerName} accepted your booking request`,
      data: { booking_id: bookingId, provider_id: providerId, provider_name: providerName }
    });
  }

  async notifyBookingRejected(
    clientId: string | number,
    providerId: string | number,
    providerName: string,
    bookingId: string | number,
    reason?: string
  ) {
    return this.create({
      userId: clientId,
      type: 'booking_rejected',
      title: 'Booking Declined',
      message: `${providerName} declined your booking request${reason ? `: ${reason}` : ''}`,
      data: { booking_id: bookingId, provider_id: providerId, provider_name: providerName, reason }
    });
  }

  async notifyBookingCancelled(
    userId: string | number,
    otherPartyId: string | number,
    cancelledBy: string,
    bookingId: string | number
  ) {
    return this.create({
      userId,
      type: 'booking_cancelled',
      title: 'Booking Cancelled',
      message: `Booking was cancelled by ${cancelledBy}`,
      data: { booking_id: bookingId, other_party_id: otherPartyId, cancelled_by: cancelledBy }
    });
  }

  async notifyBookingCompleted(
    userId: string | number,
    otherPartyId: string | number,
    bookingId: string | number,
    serviceName: string
  ) {
    return this.create({
      userId,
      type: 'booking_completed',
      title: 'Booking Completed',
      message: `Your booking for "${serviceName}" has been completed`,
      data: { booking_id: bookingId, other_party_id: otherPartyId }
    });
  }

  async notifyPaymentReceived(
    providerId: string | number,
    clientId: string | number,
    amount: number,
    clientName: string,
    bookingId: string | number
  ) {
    return this.create({
      userId: providerId,
      type: 'payment_received',
      title: 'Payment Received',
      message: `You received PHP ${amount.toLocaleString()} from ${clientName}`,
      data: { booking_id: bookingId, client_id: clientId, amount, client_name: clientName }
    });
  }

  async notifyPaymentFailed(
    clientId: string | number,
    providerId: string | number,
    bookingId: string | number,
    reason?: string
  ) {
    return this.create({
      userId: clientId,
      type: 'payment_failed',
      title: 'Payment Failed',
      message: `Your payment could not be processed${reason ? `: ${reason}` : ''}`,
      data: { booking_id: bookingId, provider_id: providerId, reason }
    });
  }

  async notifyPayoutApproved(
    providerId: string | number,
    amount: number,
    payoutId: string | number
  ) {
    return this.create({
      userId: providerId,
      type: 'payout_approved',
      title: 'Payout Approved',
      message: `Your payout request of PHP ${amount.toLocaleString()} has been approved`,
      data: { payout_id: payoutId, amount }
    });
  }

  async notifyPayoutCompleted(
    providerId: string | number,
    amount: number,
    payoutId: string | number
  ) {
    return this.create({
      userId: providerId,
      type: 'payout_completed',
      title: 'Payout Sent',
      message: `PHP ${amount.toLocaleString()} has been sent to your account`,
      data: { payout_id: payoutId, amount }
    });
  }

  async notifyPayoutRejected(
    providerId: string | number,
    amount: number,
    payoutId: string | number,
    reason: string
  ) {
    return this.create({
      userId: providerId,
      type: 'payout_rejected',
      title: 'Payout Rejected',
      message: `Your payout request was rejected: ${reason}`,
      data: { payout_id: payoutId, amount, reason }
    });
  }

  async notifyNewMessage(
    userId: string | number,
    senderId: string | number,
    senderName: string,
    chatId: string | number,
    messagePreview: string,
    bookingId?: string | number
  ) {
    return this.create({
      userId,
      type: 'new_message',
      title: 'New Message',
      message: `${senderName}: ${messagePreview.substring(0, 50)}${messagePreview.length > 50 ? '...' : ''}`,
      data: {
        chat_id: chatId,
        sender_id: senderId,
        sender_name: senderName,
        booking_id: bookingId
      }
    });
  }

  async notifyNewReview(
    providerId: string | number,
    clientId: string | number,
    clientName: string,
    rating: number,
    bookingId: string | number
  ) {
    return this.create({
      userId: providerId,
      type: 'new_review',
      title: 'New Review',
      message: `${clientName} left you a ${rating}-star review`,
      data: { booking_id: bookingId, client_id: clientId, rating, client_name: clientName }
    });
  }

  async notifySystem(
    userId: string | number,
    title: string,
    message: string,
    data?: Record<string, any>
  ) {
    return this.create({
      userId,
      type: 'system',
      title,
      message,
      data
    });
  }
}

// Export singleton instance
export const notificationService = new NotificationService();
export default notificationService;
