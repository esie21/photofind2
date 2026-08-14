import { apiClient } from '../client';
import { API_CONFIG, getUploadUrl } from '../config';
import { User } from './authService';

/**
 * POSTs a FormData upload and reports progress.
 *
 * fetch() cannot do this - it exposes no upload progress event - so a 20-image batch on
 * a phone showed an indefinite "Uploading..." with no sign it was still alive. XHR is
 * the only browser API that reports bytes sent, so uploads (and only uploads) use it.
 */
function postFormData<T>(
  url: string,
  formData: FormData,
  onProgress?: (percent: number) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.withCredentials = true;

    const token = localStorage.getItem('authToken');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        // lengthComputable is false when the body size is unknown; reporting 0% forever
        // would be worse than reporting nothing, so leave the caller's last value alone.
        if (e.lengthComputable && e.total > 0) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
    }

    xhr.onload = () => {
      let parsed: any = null;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON body - handled below */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed as T);
      } else {
        reject(new Error(parsed?.error || `API Error: ${xhr.status} ${xhr.statusText}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error while uploading. Check your connection.'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));

    xhr.send(formData);
  });
}

const userService = {
  async getAllUsers(): Promise<User[]> {
    return apiClient.get<User[]>(API_CONFIG.ENDPOINTS.USERS.GET_ALL);
  },

  async getAllProviders(params?: { q?: string; category?: string; sort?: string; page?: number; limit?: number }): Promise<{ data: User[]; meta?: any }> {
    const searchParams = new URLSearchParams();
    if (params?.q) searchParams.set('q', params.q);
    if (params?.category && params.category !== 'all') searchParams.set('category', params.category);
    if (params?.sort && params.sort !== 'recommended') searchParams.set('sort', params.sort);
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    const queryString = searchParams.toString();
    const url = queryString
      ? `${API_CONFIG.ENDPOINTS.PROVIDERS.GET_ALL}?${queryString}`
      : API_CONFIG.ENDPOINTS.PROVIDERS.GET_ALL;
    const resp = await apiClient.get<{ data: User[]; meta?: any }>(url);
    // Normalize property `profile_image` -> `image` for UI compatibility, resolving it
    // to the current environment's upload host (stored values may be bare paths or
    // absolute URLs pinned to a different backend host).
    const data = (resp.data || []).map((u: any) => {
      const raw = u.profile_image || (u as any).image;
      return { ...u, image: raw ? getUploadUrl(raw) : raw };
    });
    return { data, meta: resp.meta };
  },

  async getUserById(id: string): Promise<User> {
    return apiClient.get<User>(API_CONFIG.ENDPOINTS.USERS.GET_BY_ID(id));
  },

  async updateUser(id: string, data: Partial<User>): Promise<User> {
    return apiClient.put<User>(
      API_CONFIG.ENDPOINTS.USERS.UPDATE(id),
      data
    );
  },

  async uploadProfileImage(
    id: string,
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<User> {
    const fd = new FormData();
    fd.append('profile', file);
    // Use direct backend URL for file uploads (bypasses Vercel proxy limits)
    const directUrl = `${API_CONFIG.DIRECT_UPLOAD_URL}${API_CONFIG.ENDPOINTS.USERS.UPLOAD_PROFILE(id)}`;
    return postFormData<User>(directUrl, fd, onProgress);
  },

  async uploadPortfolioImages(
    id: string,
    files: File[],
    onProgress?: (percent: number) => void
  ): Promise<User> {
    const fd = new FormData();
    files.forEach((f) => fd.append('images', f));
    // Use direct backend URL for file uploads (bypasses Vercel proxy limits)
    const directUrl = `${API_CONFIG.DIRECT_UPLOAD_URL}${API_CONFIG.ENDPOINTS.USERS.UPLOAD_PORTFOLIO(id)}`;
    return postFormData<User>(directUrl, fd, onProgress);
  },

  /**
   * Attaches a derived preview to a portfolio item already on the server: a video's
   * poster frame, or a photo's gallery-sized thumbnail.
   *
   * Its own request, naming the item it belongs to, rather than riding along with the
   * upload: pairing by position in a batch would attach the wrong preview to the wrong
   * item as soon as one file was rejected.
   */
  async uploadPortfolioPreview(
    id: string,
    target: string,
    preview: {
      kind: 'poster' | 'thumb';
      file: File;
      duration?: number;
      width?: number;
      height?: number;
    }
  ): Promise<User> {
    const fd = new FormData();
    fd.append('preview', preview.file);
    fd.append('target', target);
    fd.append('kind', preview.kind);
    if (preview.duration) fd.append('duration', String(Math.round(preview.duration)));
    if (preview.width) fd.append('width', String(Math.round(preview.width)));
    if (preview.height) fd.append('height', String(Math.round(preview.height)));
    const directUrl = `${API_CONFIG.DIRECT_UPLOAD_URL}${API_CONFIG.ENDPOINTS.USERS.UPLOAD_PORTFOLIO_PREVIEW(id)}`;
    return postFormData<User>(directUrl, fd);
  },

  async uploadVerificationDocuments(id: string, files: File[]): Promise<{
    id: string;
    verification_status: string;
    verification_documents: Array<{ path: string; original_name: string; uploaded_at: string }>;
  }> {
    const fd = new FormData();
    files.forEach((f) => fd.append('documents', f));
    try {
      // Use direct backend URL for file uploads (bypasses Vercel proxy limits)
      const directUrl = `${API_CONFIG.DIRECT_UPLOAD_URL}${API_CONFIG.ENDPOINTS.USERS.UPLOAD_VERIFICATION(id)}`;
      const token = localStorage.getItem('authToken');
      const response = await fetch(directUrl, {
        method: 'POST',
        body: fd,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
      });

      if (!response.ok) {
        let errorText = `API Error: ${response.status} ${response.statusText}`;
        try {
          const errJson = await response.json();
          if (errJson?.error) errorText = errJson.error;
        } catch (e) {}
        throw new Error(errorText);
      }

      return await response.json();
    } catch (err) {
      console.error('uploadVerificationDocuments error', err);
      throw err;
    }
  },

  async deleteUser(id: string): Promise<void> {
    return apiClient.delete<void>(API_CONFIG.ENDPOINTS.USERS.DELETE(id));
  },

  async getCategoryStats(): Promise<{
    data: { name: string; count: number }[];
    meta: { total_providers: number; total_categories: number };
  }> {
    return apiClient.get('/providers/categories/stats');
  },
};

export default userService;
