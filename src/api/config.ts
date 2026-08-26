// Both environments use a relative path so the browser only ever talks to one origin:
// in production Vercel rewrites /api to the backend, in development Vite's dev-server
// proxy (see vite.config.ts) forwards it to localhost:3001.
const API_BASE = import.meta.env.PROD
  ? '/api'
  : (import.meta.env.VITE_API_URL || '/api');

// Direct backend URL for file uploads (bypasses Vercel's 4.5MB body size limit).
// Only production needs to skip the rewrite - the dev proxy streams uploads fine.
const DIRECT_BACKEND_URL = import.meta.env.PROD
  ? 'https://photofind2-production.up.railway.app/api'
  : (import.meta.env.VITE_API_URL || '/api');

// Static files URL (for uploaded images, evidence photos, etc.)
// Production points straight at the backend to avoid Vercel proxy issues with static
// files; development goes through the dev-server proxy.
const STATIC_BASE_URL = import.meta.env.PROD
  ? 'https://photofind2-production.up.railway.app/uploads'
  : '/uploads';

// Origin for Socket.IO connections. Callers used to derive this by stripping "/api" off
// BASE_URL, which now yields an empty string in development - socket.io-client does not
// resolve "" to the current origin reliably, so state it explicitly instead. Production
// keeps exactly the value it resolved to before.
const SOCKET_BASE_URL = import.meta.env.PROD
  ? API_BASE.replace(/\/api$/i, '')
  : (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');

/**
 * Get the full URL for an uploaded file
 * Works in both development (localhost) and production (Railway)
 * @param filePath - The file path stored in database (e.g., "bookings/uuid/filename.png" or just "filename.png")
 * @returns Full URL to the file
 */
export function getUploadUrl(filePath: string | null | undefined): string {
  if (!filePath) return '';

  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    // Some rows have an absolute URL to a specific backend host baked in (e.g.
    // "http://localhost:3001/uploads/..."), which breaks anywhere that host isn't
    // reachable - notably production. Re-point those at the current environment's
    // upload host. Genuinely external images (Google, Unsplash, ...) are left alone.
    const uploadsAt = filePath.indexOf('/uploads/');
    if (uploadsAt !== -1) {
      return `${STATIC_BASE_URL}/${filePath.slice(uploadsAt + '/uploads/'.length)}`;
    }
    return filePath;
  }

  // Remove leading slash if present to avoid double slashes
  const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  return `${STATIC_BASE_URL}/${cleanPath}`;
}

/**
 * The inverse of getUploadUrl: turns any stored or display form of an upload back into
 * the bare path the database holds ("users/<id>/portfolio/123.jpg").
 *
 * Mirrors normaliseStoredPath in backend/src/routes/users.ts. Needed because
 * portfolio_meta is keyed by the stored path, while the image list a client is holding
 * may be a display URL - looking metadata up with the wrong one silently finds nothing.
 */
export function getStoredPath(filePath: string | null | undefined): string {
  let v = String(filePath ?? '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) {
    const at = v.indexOf('/uploads/');
    if (at === -1) return v; // genuinely external
    v = v.slice(at);
  }
  v = v.replace(/^\/+/, '');
  while (/^uploads\//i.test(v)) v = v.replace(/^uploads\//i, '');
  return v;
}

export const API_CONFIG = {
  BASE_URL: API_BASE,
  DIRECT_UPLOAD_URL: DIRECT_BACKEND_URL,
  STATIC_URL: STATIC_BASE_URL,
  SOCKET_URL: SOCKET_BASE_URL,
  // Endpoints are RELATIVE paths - BASE_URL is prepended by apiClient
  ENDPOINTS: {
    // Auth endpoints
    AUTH: {
      LOGIN: '/auth/login',
      SIGNUP: '/auth/signup',
      LOGOUT: '/auth/logout',
      ME: '/auth/me',
      GOOGLE: '/auth/google',
      CHANGE_PASSWORD: '/auth/change-password',
    },
    // Users endpoints
    USERS: {
      GET_ALL: '/users',
      GET_BY_ID: (id: string) => `/users/${id}`,
      UPDATE: (id: string) => `/users/${id}`,
      DELETE: (id: string) => `/users/${id}`,
      UPLOAD_PROFILE: (id: string) => `/users/${id}/upload/profile`,
      UPLOAD_PORTFOLIO: (id: string) => `/users/${id}/upload/portfolio`,
      UPLOAD_PORTFOLIO_PREVIEW: (id: string) => `/users/${id}/upload/portfolio-preview`,
      UPLOAD_VERIFICATION: (id: string) => `/users/${id}/upload/verification`,
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
      CONFIRM_CASH: (id: string) => `/bookings/${id}/confirm-cash`,
      EVIDENCE: (id: string) => `/bookings/${id}/evidence`,
      DISPUTE_EVIDENCE: (id: string) => `/bookings/${id}/dispute-evidence`,
      DISPUTE_RESPONSE: (id: string) => `/bookings/${id}/dispute-response`,
      RESOLVE_DISPUTE: (id: string) => `/bookings/${id}/resolve-dispute`,
      RESCHEDULE: (id: string) => `/bookings/${id}/reschedule`,
      RESCHEDULE_APPROVE: (id: string) => `/bookings/${id}/reschedule/approve`,
      RESCHEDULE_REJECT: (id: string) => `/bookings/${id}/reschedule/reject`,
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
