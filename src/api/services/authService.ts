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

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'client' | 'provider' | 'admin';
  createdAt?: string;
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
