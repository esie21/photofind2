// In production, use relative path (goes through Vercel rewrite)
// In development, use localhost
const API_BASE = import.meta.env.PROD
  ? '/api'
  : (import.meta.env.VITE_API_URL || 'http://localhost:3001/api');

// Direct backend URL for file uploads (bypasses Vercel's 4.5MB body size limit)
const DIRECT_BACKEND_URL = import.meta.env.PROD
  ? 'https://photofind2-production.up.railway.app/api'
  : (import.meta.env.VITE_API_URL || 'http://localhost:3001/api');

// Static files URL (for uploaded images, evidence photos, etc.)
// Always use direct backend URL to avoid Vercel proxy issues with static files
const STATIC_BASE_URL = import.meta.env.PROD
  ? 'https://photofind2-production.up.railway.app/uploads'
  : 'http://localhost:3001/uploads';

/**
 * Get the full URL for an uploaded file
 * Works in both development (localhost) and production (Railway)
 * @param filePath - The file path stored in database (e.g., "bookings/uuid/filename.png" or just "filename.png")
 * @returns Full URL to the file
 */
export function getUploadUrl(filePath: string | null | undefined): string {
  if (!filePath) return '';
  // If already a full URL, return as-is
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath;
  }
  // Remove leading slash if present to avoid double slashes
  const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  return `${STATIC_BASE_URL}/${cleanPath}`;
}

export const API_CONFIG = {
  BASE_URL: API_BASE,
  DIRECT_UPLOAD_URL: DIRECT_BACKEND_URL,
  STATIC_URL: STATIC_BASE_URL,
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
      DISPUTED: '/bookings/disputed',
      GET_BY_ID: (id: string) => `/bookings/${id}`,
      UPDATE: (id: string) => `/bookings/${id}`,
      DELETE: (id: string) => `/bookings/${id}`,
      COMPLETE: (id: string) => `/bookings/${id}/complete`,
      CONFIRM: (id: string) => `/bookings/${id}/confirm`,
      EVIDENCE: (id: string) => `/bookings/${id}/evidence`,
      RESOLVE_DISPUTE: (id: string) => `/bookings/${id}/resolve-dispute`,
      RESCHEDULE: (id: string) => `/bookings/${id}/reschedule`,
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
