import { apiClient } from '../client';
import { API_CONFIG } from '../config';
import { User } from './authService';

const userService = {
  async getAllUsers(): Promise<User[]> {
    return apiClient.get<User[]>(API_CONFIG.ENDPOINTS.USERS.GET_ALL);
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
};

export default userService;
