import { apiClient } from '../client';
import { API_CONFIG } from '../config';

export interface Service {
  id: string;
  providerId: string;
  title: string;
  description: string;
  price: number;
  category: string;
  images: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateServiceData {
  title: string;
  description: string;
  price: number;
  category: string;
  images?: string[];
}

const serviceService = {
  async getAllServices(): Promise<Service[]> {
    return apiClient.get<Service[]>(API_CONFIG.ENDPOINTS.SERVICES.GET_ALL);
  },

  async getServiceById(id: string): Promise<Service> {
    return apiClient.get<Service>(
      API_CONFIG.ENDPOINTS.SERVICES.GET_BY_ID(id)
    );
  },

  async createService(data: CreateServiceData): Promise<Service> {
    return apiClient.post<Service>(
      API_CONFIG.ENDPOINTS.SERVICES.CREATE,
      data
    );
  },

  async updateService(id: string, data: Partial<Service>): Promise<Service> {
    return apiClient.put<Service>(
      API_CONFIG.ENDPOINTS.SERVICES.UPDATE(id),
      data
    );
  },

  async deleteService(id: string): Promise<void> {
    return apiClient.delete<void>(API_CONFIG.ENDPOINTS.SERVICES.DELETE(id));
  },
};

export default serviceService;
