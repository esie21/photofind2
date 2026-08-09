import { apiClient } from '../client';

export interface SupportTicket {
  id: string;
  user_id: string;
  booking_id: string | null;
  subject: string;
  message: string;
  status: 'open' | 'in_progress' | 'resolved';
  admin_reply: string | null;
  replied_by: string | null;
  replied_at: string | null;
  created_at: string;
  updated_at: string;
  service_title?: string | null;
}

export interface SupportTicketsResponse {
  data: SupportTicket[];
  meta: { total: number; limit: number; offset: number };
}

const supportService = {
  async createTicket(data: { subject: string; message: string; booking_id?: string }): Promise<SupportTicket> {
    const resp = await apiClient.post<{ data: SupportTicket }>('/support/tickets', data);
    return resp.data;
  },

  async getMyTickets(limit = 20, offset = 0): Promise<SupportTicketsResponse> {
    return apiClient.get<SupportTicketsResponse>(`/support/tickets/my?limit=${limit}&offset=${offset}`);
  },
};

export default supportService;
