import { apiClient } from '../client';
import { API_CONFIG } from '../config';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface SignupData extends LoginCredentials {
  name: string;
  role: 'client' | 'provider' | 'admin';
  termsAccepted: boolean;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: 'client' | 'provider' | 'admin';
  };
}

export interface GoogleAuthResponse extends AuthResponse {
  needsRole?: boolean;
  profile?: {
    email: string;
    name: string;
    picture?: string | null;
  };
}

/**
 * Per-image portfolio metadata, keyed by the image's stored path (use getStoredPath()
 * from api/config to derive the key from whatever form of the path you are holding).
 */
export interface PortfolioImageMeta {
  caption?: string;
  album?: string;
  /** Describes the image for screen readers. Falls back to the caption when unset. */
  alt?: string;
  /** Provider-defined labels, e.g. "Bridal", "Kitchen", "Before". */
  tags?: string[];
  /** Stored path of the item this one is the "after" of, for a before/after pair. */
  before?: string;
  /** Video only: stored path of the still frame shown before it plays. */
  poster?: string;
  /** Video only: length in seconds. */
  duration?: number;
  /** Photo only: stored path of the small copy the galleries render. */
  thumb?: string;
  /** Intrinsic size of the original, so a gallery can reserve its space before it loads. */
  width?: number;
  height?: number;
}

export type PortfolioMeta = Record<string, PortfolioImageMeta>;

/**
 * Per-project metadata, keyed by the album name that PortfolioImageMeta.album holds.
 * See users.portfolio_albums. Every field is optional: an album with no entry here still
 * renders from its images alone.
 */
export interface PortfolioAlbumMeta {
  /** The brief: what the job was. Shown on the project card. */
  description?: string;
  /**
   * Legacy: one of CATEGORY_OPTIONS. Still read and shown, but new projects use `tags`,
   * since that list does not fit every trade on the platform.
   */
  category?: string;
  /** Provider-defined labels for the job, e.g. "Debut", "Aircon cleaning". */
  tags?: string[];
  /** What the provider did on this job, e.g. ["Catering", "Grazing table"]. */
  services?: string[];
  /** Where the work happened. Shown on the card beside the date. */
  location?: string;
  /** ISO date (YYYY-MM-DD) the work was done, or the start of a range. */
  done_on?: string;
  /** End of a date range (YYYY-MM-DD). Only set when different from done_on. */
  date_end?: string;
  /** Optional details. Free text so they fit any trade. */
  client_type?: string;
  duration?: string;
  price_range?: string;
  outcome?: string;
  /** The job is best shown as before/after pairs (repairs, cleaning, makeup, renovation). */
  before_after?: boolean;
  /** Stored path of the item to lead with. Falls back to the album's first item. */
  cover?: string;
  /** Position on the public grid. */
  order?: number;
}

export type PortfolioAlbums = Record<string, PortfolioAlbumMeta>;

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'client' | 'provider' | 'admin';
  createdAt?: string;
  profile_image?: string;
  portfolio_images?: string[];
  /** Caption/album for each portfolio image, keyed by its stored path. */
  portfolio_meta?: PortfolioMeta;
  /** Title, context and cover for each project, keyed by album name. */
  portfolio_albums?: PortfolioAlbums;
  /** Stored path of the chosen profile cover. '' or absent means choose automatically. */
  portfolio_cover?: string | null;
  bio?: string;
  years_experience?: number;
  location?: string;
  category?: string;
  title?: string;
  is_verified?: boolean;
  verification_status?: 'unsubmitted' | 'pending' | 'approved' | 'rejected' | string;
  verification_documents?: Array<{ path: string; original_name: string; uploaded_at: string }> | null;
  /** False for a Google account that has never set a real password - see routes/auth.ts. */
  has_password?: boolean;
  /** When this user last accepted the terms. */
  terms_accepted_at?: string | null;
  /** Which version of the terms they accepted, e.g. '2026-08-10'. */
  terms_version?: string | null;
  /**
   * Whether the terms have changed since they last accepted. Decided server-side - the
   * client can't be the judge of what the current version is.
   */
  terms_acceptance_required?: boolean;
  /** The version currently in force, per the server. */
  current_terms_version?: string;
}

const authService = {
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await apiClient.post<AuthResponse>(
      API_CONFIG.ENDPOINTS.AUTH.LOGIN,
      credentials
    );
    // automatically set token in client
    if (response?.token) {
      apiClient.setToken(response.token);
    }
    return response;
  },

  async signup(data: SignupData): Promise<AuthResponse> {
    const response = await apiClient.post<AuthResponse>(
      API_CONFIG.ENDPOINTS.AUTH.SIGNUP,
      data
    );
    if (response?.token) {
      apiClient.setToken(response.token);
    }
    return response;
  },

  async loginWithGoogle(data: {
    credential: string;
    role?: 'client' | 'provider';
    intent: 'login' | 'signup';
    termsAccepted?: boolean;
  }): Promise<GoogleAuthResponse> {
    const response = await apiClient.post<GoogleAuthResponse>(
      API_CONFIG.ENDPOINTS.AUTH.GOOGLE,
      data
    );
    if (response?.token) {
      apiClient.setToken(response.token);
    }
    return response;
  },

  async logout(): Promise<void> {
    apiClient.setToken(null);
      // Optionally notify backend
    try {
      await apiClient.post(API_CONFIG.ENDPOINTS.AUTH.LOGOUT);
    } catch (error) {
      console.log('Logout notification failed, but clearing local token');
    }
  },

  async getCurrentUser(): Promise<User> {
    return apiClient.get<User>(API_CONFIG.ENDPOINTS.AUTH.ME);
  },

  async changePassword(data: { currentPassword?: string; newPassword: string }): Promise<void> {
    await apiClient.post<{ success: boolean }>(API_CONFIG.ENDPOINTS.AUTH.CHANGE_PASSWORD, data);
  },

  /**
   * Records acceptance of the current terms and returns the refreshed user.
   *
   * Sends no version - the server stamps whichever one it is serving, so a client
   * cannot claim to have accepted a document it never showed.
   */
  async acceptTerms(): Promise<User> {
    const resp = await apiClient.post<{ data: User }>(API_CONFIG.ENDPOINTS.AUTH.ACCEPT_TERMS, {});
    return resp.data;
  },

  setToken(token: string | null) {
    apiClient.setToken(token);
  },

  getToken(): string | null {
    return localStorage.getItem('authToken');
  },

  isAuthenticated(): boolean {
    return !!this.getToken();
  },
};

export default authService;
