import { apiClient } from '../client';

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

  async getMessages(ticketId: string, limit = 200): Promise<{ ticket: SupportTicket; messages: SupportMessage[] }> {
    const resp = await apiClient.get<{ data: { ticket: SupportTicket; messages: SupportMessage[] } }>(
      `/support/tickets/${ticketId}/messages?limit=${limit}`
    );
    return resp.data;
  },

  async sendMessage(params: { ticketId: string; content?: string; file?: File }): Promise<SupportMessage> {
    const form = new FormData();
    if (params.content && params.content.trim()) {
      form.append('content', params.content.trim());
    }
    if (params.file) {
      form.append('file', params.file);
    }
    const resp = await apiClient.postForm<{ data: SupportMessage }>(
      `/support/tickets/${params.ticketId}/messages`,
      form
    );
    return resp.data;
  },
};

export default supportService;
