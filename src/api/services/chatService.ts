import { apiClient } from '../client';
import { API_CONFIG } from '../config';

export type ChatAttachmentType = 'image' | 'file' | null;

export interface BookingChatMessage {
  id: number;
  chat_id: number;
  sender_id: number | null;
  content: string | null;
  attachment_url: string | null;
  attachment_type: ChatAttachmentType;
  attachment_name: string | null;
  is_system: boolean;
  created_at: string;
  read_at: string | null;
}

export interface BookingChatHistoryResponse {
  data: {
    chat: {
      id: number;
      booking_id: number;
      user_a: number;
      user_b: number;
    };
    messages: BookingChatMessage[];
  };
}

const chatService = {
  async getHistory(bookingId: number | string, limit = 100): Promise<BookingChatHistoryResponse['data']> {
    const url = `${API_CONFIG.ENDPOINTS.CHAT.HISTORY}?booking_id=${bookingId}&limit=${limit}`;
    const res = await apiClient.get<BookingChatHistoryResponse>(url);
    return res.data;
  },

  async sendMessage(params: {
    bookingId: number | string;
    content?: string;
    file?: File;
  }): Promise<{ data: BookingChatMessage }> {
    const form = new FormData();
    form.append('booking_id', String(params.bookingId));
    if (params.content && params.content.trim()) {
      form.append('content', params.content.trim());
    }
    if (params.file) {
      form.append('file', params.file);
    }

    return apiClient.postForm<{ data: BookingChatMessage }>(
      API_CONFIG.ENDPOINTS.CHAT.SEND,
      form
    );
  },
};

export default chatService;
