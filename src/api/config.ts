// Use environment variable or fallback to localhost for development
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export const API_CONFIG = {
  BASE_URL: API_URL,
  ENDPOINTS: {
    // Auth endpoints
    AUTH: {
      LOGIN: `${API_URL}/auth/login`,
      SIGNUP: `${API_URL}/auth/signup`,
      LOGOUT: `${API_URL}/auth/logout`,
      ME: `${API_URL}/auth/me`,
    },
    // Users endpoints
    USERS: {
      GET_ALL: `${API_URL}/users`,
      GET_BY_ID: (id: string) => `${API_URL}/users/${id}`,
      UPDATE: (id: string) => `${API_URL}/users/${id}`,
      DELETE: (id: string) => `${API_URL}/users/${id}`,
      UPLOAD_PROFILE: (id: string) => `${API_URL}/users/${id}/upload/profile`,
      UPLOAD_PORTFOLIO: (id: string) => `${API_URL}/users/${id}/upload/portfolio`,
    },
    // Providers endpoints
    PROVIDERS: {
      GET_ALL: `${API_URL}/providers`,
    },
    // Bookings endpoints
    BOOKINGS: {
      GET_ALL: `${API_URL}/bookings`,
      CREATE: `${API_URL}/bookings`,
      MY: `${API_URL}/bookings/my`,
      PROVIDER_MY: `${API_URL}/bookings/provider/my`,
      GET_BY_ID: (id: string) => `${API_URL}/bookings/${id}`,
      UPDATE: (id: string) => `${API_URL}/bookings/${id}`,
      DELETE: (id: string) => `${API_URL}/bookings/${id}`,
    },
    AVAILABILITY: {
      PROVIDER_SLOTS: (providerId: string | number) => `${API_URL}/availability/providers/${providerId}/slots`,
      PROVIDER_TIMESLOTS: (providerId: string | number) => `${API_URL}/availability/providers/${providerId}/timeslots`,
      CREATE: `${API_URL}/availability`,
      UPDATE: (id: string | number) => `${API_URL}/availability/${id}`,
      DELETE: (id: string | number) => `${API_URL}/availability/${id}`,
    },
    // Services endpoints
    SERVICES: {
      GET_ALL: `${API_URL}/services`,
      GET_BY_PROVIDER: (providerId: string | number) => `${API_URL}/services/provider/${providerId}`,
      CREATE: `${API_URL}/services`,
      GET_BY_ID: (id: string) => `${API_URL}/services/${id}`,
      UPDATE: (id: string) => `${API_URL}/services/${id}`,
      DELETE: (id: string) => `${API_URL}/services/${id}`,
    },
    // Messaging endpoints
    MESSAGES: {
      CONVERSATIONS: `${API_URL}/messages/conversations`,
      CONVERSATION_MESSAGES: (conversationId: string | number) =>
        `${API_URL}/messages/conversations/${conversationId}/messages`,
      START_CONVERSATION: `${API_URL}/messages/conversations`,
      SEND: `${API_URL}/messages`,
    },
    CHAT: {
      HISTORY: `${API_URL}/chat/history`,
      SEND: `${API_URL}/chat/send`,
    },
    // Admin endpoints
    ADMIN: {
      STATS: `${API_URL}/admin/stats`,
    },
  },
};
