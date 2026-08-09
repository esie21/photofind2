import { apiClient } from '../client';
import { API_CONFIG } from '../config';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface SignupData extends LoginCredentials {
  name: string;
  role: 'client' | 'provider' | 'admin';
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

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'client' | 'provider' | 'admin';
  createdAt?: string;
  profile_image?: string;
  portfolio_images?: string[];
  bio?: string;
  years_experience?: number;
  location?: string;
  category?: string;
  title?: string;
  is_verified?: boolean;
  verification_status?: 'unsubmitted' | 'pending' | 'approved' | 'rejected' | string;
  verification_documents?: Array<{ path: string; original_name: string; uploaded_at: string }> | null;
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
