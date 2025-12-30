// In production, use relative path (goes through Vercel rewrite)
// In development, use localhost
const API_BASE = import.meta.env.PROD
  ? '/api'
  : (import.meta.env.VITE_API_URL || 'http://localhost:3001/api');

export const API_CONFIG = {
  BASE_URL: API_BASE,
  // Endpoints are RELATIVE paths - BASE_URL is prepended by apiClient
  ENDPOINTS: {
    // Auth endpoints
    AUTH: {
      LOGIN: '/auth/login',
      SIGNUP: '/auth/signup',
      LOGOUT: '/auth/logout',
      ME: '/auth/me',
    },
    // Users endpoints
    USERS: {
      GET_ALL: '/users',
      GET_BY_ID: (id: string) => `/users/${id}`,
      UPDATE: (id: string) => `/users/${id}`,
      DELETE: (id: string) => `/users/${id}`,
      UPLOAD_PROFILE: (id: string) => `/users/${id}/upload/profile`,
      UPLOAD_PORTFOLIO: (id: string) => `/users/${id}/upload/portfolio`,
    },
    // Providers endpoints
    PROVIDERS: {
      GET_ALL: '/providers',
    },
    // Bookings endpoints
    BOOKINGS: {
      GET_ALL: '/bookings',
      CREATE: '/bookings',
      MY: '/bookings/my',
      PROVIDER_MY: '/bookings/provider/my',
      GET_BY_ID: (id: string) => `/bookings/${id}`,
      UPDATE: (id: string) => `/bookings/${id}`,
      DELETE: (id: string) => `/bookings/${id}`,
    },
    AVAILABILITY: {
      PROVIDER_SLOTS: (providerId: string | number) => `/availability/providers/${providerId}/slots`,
      PROVIDER_TIMESLOTS: (providerId: string | number) => `/availability/providers/${providerId}/timeslots`,
      CREATE: '/availability',
      UPDATE: (id: string | number) => `/availability/${id}`,
      DELETE: (id: string | number) => `/availability/${id}`,
    },
    // Services endpoints
    SERVICES: {
      GET_ALL: '/services',
      GET_BY_PROVIDER: (providerId: string | number) => `/services/provider/${providerId}`,
      CREATE: '/services',
      GET_BY_ID: (id: string) => `/services/${id}`,
      UPDATE: (id: string) => `/services/${id}`,
      DELETE: (id: string) => `/services/${id}`,
    },
    // Messaging endpoints
    MESSAGES: {
      CONVERSATIONS: '/messages/conversations',
      CONVERSATION_MESSAGES: (conversationId: string | number) =>
        `/messages/conversations/${conversationId}/messages`,
      START_CONVERSATION: '/messages/conversations',
      SEND: '/messages',
    },
    CHAT: {
      HISTORY: '/chat/history',
      SEND: '/chat/send',
    },
    // Admin endpoints
    ADMIN: {
      STATS: '/admin/stats',
    },
  },
};
