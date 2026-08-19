import { apiClient } from '../client';
import { API_CONFIG } from '../config';

/** Messages fetched per page. Mirrors the default in routes/support.ts. */
export const SUPPORT_PAGE_SIZE = 50;

export type SupportCategory = 'booking' | 'payment' | 'account' | 'other';
export type SupportAttachmentType = 'image' | 'video' | 'file' | null;

export interface SupportTicket {
  id: string;
  user_id: string;
  booking_id: string | null;
  subject: string;
  message: string;
  status: 'open' | 'in_progress' | 'resolved';
  category: SupportCategory | null;
  admin_reply: string | null;
  replied_by: string | null;
  replied_at: string | null;
  created_at: string;
  updated_at: string;
  service_title?: string | null;
  last_message?: string | null;
  last_message_at?: string | null;
  unread_count?: number;
  user_name?: string;
  user_email?: string;
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  sender_id: string | null;
  sender_role: 'user' | 'admin' | 'system';
  content: string | null;
  attachment_url: string | null;
  attachment_type: SupportAttachmentType;
  attachment_name: string | null;
  created_at: string;
  read_at: string | null;
}

export interface SupportTicketsResponse {
  data: SupportTicket[];
  meta: { total: number; limit: number; offset: number };
}

export interface SupportBooking {
  id: string;
  status: string;
  start_date: string | null;
  service_title: string | null;
}

const supportService = {
  async createTicket(data: { message: string; category?: SupportCategory; booking_id?: string }): Promise<{ ticket: SupportTicket; message: SupportMessage }> {
    const resp = await apiClient.post<{ data: { ticket: SupportTicket; message: SupportMessage } }>('/support/tickets', data);
    return resp.data;
  },

  async getMyTickets(limit = 20, offset = 0): Promise<SupportTicketsResponse> {
    return apiClient.get<SupportTicketsResponse>(`/support/tickets/my?limit=${limit}&offset=${offset}`);
  },

  async getMyBookings(): Promise<SupportBooking[]> {
    const resp = await apiClient.get<{ data: SupportBooking[] }>('/support/bookings');
    return resp.data;
  },

  /**
   * One page of a ticket's thread, oldest-first within the page.
   *
   * `offset` counts backwards from the newest message, so offset = messages already
   * held fetches the page before them.
   */
  async getMessages(
    ticketId: string,
    limit = SUPPORT_PAGE_SIZE,
    offset = 0
  ): Promise<{ ticket: SupportTicket; messages: SupportMessage[]; hasMore: boolean }> {
    const resp = await apiClient.get<{
      data: { ticket: SupportTicket; messages: SupportMessage[]; hasMore?: boolean };
    }>(`/support/tickets/${ticketId}/messages?limit=${limit}&offset=${offset}`);
    return { ...resp.data, hasMore: Boolean(resp.data.hasMore) };
  },

  async sendMessage(params: { ticketId: string; content?: string; file?: File }): Promise<SupportMessage> {
    const form = new FormData();
    if (params.content && params.content.trim()) {
      form.append('content', params.content.trim());
    }
    if (params.file) {
      form.append('file', params.file);
    }

    // Goes straight at the backend rather than through apiClient (which resolves against
    // the relative /api base, i.e. Vercel's rewrite in production) - same as every other
    // upload flow (userService, bookingService). Vercel caps a proxied body at 4.5MB,
    // well under the 10MB an attachment is allowed to be, so a message with a real
    // attachment would fail there even though it passed every other check.
    const directUrl = `${API_CONFIG.DIRECT_UPLOAD_URL}/support/tickets/${params.ticketId}/messages`;
    const token = localStorage.getItem('authToken');
    const response = await fetch(directUrl, {
      method: 'POST',
      body: form,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    });

    if (!response.ok) {
      let errorText = `API Error: ${response.status} ${response.statusText}`;
      try {
        const errBody = await response.json();
        if (errBody?.error) errorText = errBody.error;
        else if (errBody?.message) errorText = errBody.message;
      } catch {
        // ignore JSON parse errors - keep the generic message
      }
      throw new Error(errorText);
    }

    const body = await response.json();
    return body.data;
  },
};

export default supportService;
