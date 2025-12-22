import { apiClient } from '../client';
import { API_CONFIG } from '../config';
import { User } from './authService';

const userService = {
  async getAllUsers(): Promise<User[]> {
    return apiClient.get<User[]>(API_CONFIG.ENDPOINTS.USERS.GET_ALL);
  },

  async getAllProviders(params?: { q?: string; page?: number; limit?: number }): Promise<{ data: User[]; meta?: any }> {
    const url = new URL(API_CONFIG.ENDPOINTS.PROVIDERS.GET_ALL as string);
    if (params?.q) url.searchParams.set('q', params.q);
    if (params?.page) url.searchParams.set('page', params.page.toString());
    if (params?.limit) url.searchParams.set('limit', params.limit.toString());
    const resp = await apiClient.get<{ data: User[]; meta?: any }>(url.toString());
    // Normalize property `profile_image` -> `image` for UI compatibility
    const data = (resp.data || []).map((u: any) => ({ ...u, image: u.profile_image || (u as any).image }));
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

  async uploadProfileImage(id: string, file: File): Promise<User> {
    const fd = new FormData();
    fd.append('profile', file);
    try {
      const resp = await apiClient.postForm<User>(API_CONFIG.ENDPOINTS.USERS.UPLOAD_PROFILE(id), fd);
      console.log('uploadProfileImage response', resp);
      return resp;
    } catch (err) {
      console.error('uploadProfileImage error', err);
      throw err;
    }
  },

  async uploadPortfolioImages(id: string, files: File[]): Promise<User> {
    const fd = new FormData();
    files.forEach((f) => fd.append('images', f));
    try {
      const resp = await apiClient.postForm<User>(API_CONFIG.ENDPOINTS.USERS.UPLOAD_PORTFOLIO(id), fd);
      console.log('uploadPortfolioImages response', resp);
      return resp;
    } catch (err) {
      console.error('uploadPortfolioImages error', err);
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
