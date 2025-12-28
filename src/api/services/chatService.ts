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

export interface ChatInfo {
  chat_id: number;
  booking_id: number | null;
  booking: {
    id: number;
    client_id: number;
    provider_id: number;
    service_title: string;
    client_name: string;
    provider_name: string;
  } | null;
}

export interface DirectChatResponse {
  data: {
    chat_id: number;
    recipient: { id: string; name: string };
  };
}

export interface DirectChatHistoryResponse {
  data: {
    chat: { id: number; user_a: string; user_b: string } | null;
    messages: BookingChatMessage[];
  };
}

const chatService = {
  // Booking-based chat methods
  async getHistory(bookingId: number | string, limit = 100): Promise<BookingChatHistoryResponse['data']> {
    const url = `${API_CONFIG.ENDPOINTS.CHAT.HISTORY}?booking_id=${bookingId}&limit=${limit}`;
    const res = await apiClient.get<BookingChatHistoryResponse>(url);
    return res.data;
  },

  async getChatInfo(chatId: number | string): Promise<ChatInfo> {
    const res = await apiClient.get<{ data: ChatInfo }>(`/chat/info/${chatId}`);
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

  // Direct messaging methods (no booking required)
  async createDirectChat(recipientId: string): Promise<DirectChatResponse['data']> {
    const res = await apiClient.post<DirectChatResponse>('/chat/direct', { recipient_id: recipientId });
    return res.data;
  },

  async getDirectHistory(recipientId: string, limit = 100): Promise<DirectChatHistoryResponse['data']> {
    const res = await apiClient.get<DirectChatHistoryResponse>(`/chat/direct/${recipientId}/history?limit=${limit}`);
    return res.data;
  },

  async sendDirectMessage(params: {
    recipientId: string;
    content?: string;
    file?: File;
  }): Promise<{ data: BookingChatMessage }> {
    const form = new FormData();
    if (params.content && params.content.trim()) {
      form.append('content', params.content.trim());
    }
    if (params.file) {
      form.append('file', params.file);
    }

    return apiClient.postForm<{ data: BookingChatMessage }>(
      `/chat/direct/${params.recipientId}/send`,
      form
    );
  },
};

export default chatService;
