import { apiClient } from '../client';
import { API_CONFIG } from '../config';

export interface ConversationUser {
  id: string; // Changed to string for UUID
  name: string;
  profile_image?: string | null;
}

export interface ChatMessage {
  id: number;
  conversation_id: number;
  sender_id: string; // Changed to string for UUID
  content: string;
  created_at: string;
  read_at?: string | null;
}

export interface Conversation {
  id: number;
  user_a: string; // Changed to string for UUID
  user_b: string; // Changed to string for UUID
  created_at: string;
  updated_at: string;
  other_user?: ConversationUser | null;
  last_message?: ChatMessage | null;
}

const messageService = {
  async startConversation(otherUserId: string): Promise<Conversation> {
    return apiClient.post<Conversation>(
      API_CONFIG.ENDPOINTS.MESSAGES.START_CONVERSATION,
      { other_user_id: otherUserId }
    );
  },

  async listConversations(): Promise<Conversation[]> {
    const res = await apiClient.get<{ data: Conversation[] }>(
      API_CONFIG.ENDPOINTS.MESSAGES.CONVERSATIONS
    );
    return res.data || [];
  },

  async getMessages(
    conversationId: number | string,
    limit = 50
  ): Promise<ChatMessage[]> {
    const url = API_CONFIG.ENDPOINTS.MESSAGES.CONVERSATION_MESSAGES(conversationId);
    const fullUrl = `${url}?limit=${limit}`;
    const res = await apiClient.get<{ data: ChatMessage[] }>(fullUrl);
    return res.data || [];
  },

  async sendMessage(
    conversationId: number | string,
    content: string
  ): Promise<ChatMessage> {
    return apiClient.post<ChatMessage>(
      API_CONFIG.ENDPOINTS.MESSAGES.SEND,
      {
        conversation_id: conversationId,
        content,
      }
    );
  },
};

export default messageService;