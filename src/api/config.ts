const API_URL = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3001/api';

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
    },
    // Bookings endpoints
    BOOKINGS: {
      GET_ALL: `${API_URL}/bookings`,
      CREATE: `${API_URL}/bookings`,
      GET_BY_ID: (id: string) => `${API_URL}/bookings/${id}`,
      UPDATE: (id: string) => `${API_URL}/bookings/${id}`,
      DELETE: (id: string) => `${API_URL}/bookings/${id}`,
    },
    // Services endpoints
    SERVICES: {
      GET_ALL: `${API_URL}/services`,
      CREATE: `${API_URL}/services`,
      GET_BY_ID: (id: string) => `${API_URL}/services/${id}`,
      UPDATE: (id: string) => `${API_URL}/services/${id}`,
      DELETE: (id: string) => `${API_URL}/services/${id}`,
    },
    // Admin endpoints
    ADMIN: {
      STATS: `${API_URL}/admin/stats`,
    },
  },
};
