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

  async deleteUser(id: string): Promise<void> {
    return apiClient.delete<void>(API_CONFIG.ENDPOINTS.USERS.DELETE(id));
  },
};

export default userService;
