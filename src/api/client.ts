import { API_CONFIG } from './config';

interface RequestOptions extends RequestInit {
  headers?: Record<string, string>;
  isForm?: boolean;
}

class APIClient {
  private token: string | null = null;

  constructor() {
    // Try to get token from localStorage on initialization
    this.token = localStorage.getItem('authToken');
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('authToken', token);
    } else {
      localStorage.removeItem('authToken');
    }
  }

  private getHeaders(isForm = false): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return headers;
  }

  async request<T>(
    url: string,
    options: RequestOptions = {}
  ): Promise<T> {
    try {
      const isForm = options.isForm || false;
      const headers = {
        ...this.getHeaders(isForm),
        ...options.headers,
      } as Record<string,string>;
      if (isForm) {
        // Remove Content-Type for FormData so browser sets it with boundary
        delete headers['Content-Type'];
      }

      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Unauthorized - clear token (UI/Context should handle redirect)
          this.setToken(null);
        }
        let errorText = `API Error: ${response.status} ${response.statusText}`;
        try {
          const errJson = await response.json();
          if (errJson?.error) errorText = errJson.error;
          else if (errJson?.message) errorText = errJson.message;
        } catch (e) {
          // ignore JSON parse errors - keep original error text
        }
        throw new Error(errorText);
      }

      return await response.json();
    } catch (error) {
      console.error('API Request Error:', error);
      throw error;
    }
  }

  async get<T>(url: string): Promise<T> {
    return this.request<T>(url, { method: 'GET' });
  }

  async post<T>(url: string, data?: unknown): Promise<T> {
    return this.request<T>(url, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async postForm<T>(url: string, formData: FormData): Promise<T> {
    return this.request<T>(url, {
      method: 'POST',
      body: formData,
      isForm: true,
    });
  }

  async put<T>(url: string, data?: unknown): Promise<T> {
    return this.request<T>(url, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete<T>(url: string): Promise<T> {
    return this.request<T>(url, { method: 'DELETE' });
  }
}

export const apiClient = new APIClient();
