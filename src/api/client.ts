import { API_CONFIG } from './config';

interface RequestOptions extends RequestInit {
  headers?: Record<string, string>;
  isForm?: boolean;
}

/**
 * Thrown for any non-2xx response. `message` stays exactly what it always was - the
 * server's `error` string - so existing `err.message` handling is unaffected; `status`
 * and `body` are additions for callers that need to tell one 4xx apart from another
 * rather than pattern-matching on prose. PaymentSummary uses it to distinguish "this
 * booking is already paid" from a genuine payment failure.
 */
export class ApiError extends Error {
  status: number;
  body: any;

  constructor(message: string, status: number, body: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
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

  // Get CSRF token from cookie
  private getCsrfToken(): string | null {
    const match = document.cookie.match(/csrf_token=([^;]+)/);
    return match ? match[1] : null;
  }

  private getHeaders(isForm = false): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    // Add CSRF token for state-changing requests
    const csrfToken = this.getCsrfToken();
    if (csrfToken) {
      headers['x-csrf-token'] = csrfToken;
    }

    return headers;
  }

  private resolveUrl(url: string): string {
    // If URL starts with http:// or https://, use as-is
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    // Otherwise, prepend the base URL
    const baseUrl = API_CONFIG.BASE_URL.replace(/\/$/, '');
    const path = url.startsWith('/') ? url : `/${url}`;
    return `${baseUrl}${path}`;
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

      const resolvedUrl = this.resolveUrl(url);
      const response = await fetch(resolvedUrl, {
        ...options,
        headers,
        credentials: 'include', // Include cookies for CSRF and auth
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Unauthorized - clear token (UI/Context should handle redirect)
          this.setToken(null);
        }
        let errorText = `API Error: ${response.status} ${response.statusText}`;
        let errBody: any = null;
        try {
          errBody = await response.json();
          if (errBody?.error) errorText = errBody.error;
          else if (errBody?.message) errorText = errBody.message;
        } catch (e) {
          // ignore JSON parse errors - keep original error text
        }
        throw new ApiError(errorText, response.status, errBody);
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

  async delete<T>(url: string, data?: unknown): Promise<T> {
    return this.request<T>(url, {
      method: 'DELETE',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async patch<T>(url: string, data?: unknown): Promise<T> {
    return this.request<T>(url, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  }
}




export const apiClient = new APIClient();
