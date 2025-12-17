import { apiClient } from '../client';
import { API_CONFIG } from '../config';

export interface Booking {
  id: string;
  clientId: string;
  providerId: string;
  serviceId: string;
  startDate: string;
  endDate: string;
  status: 'pending' | 'accepted' | 'rejected' | 'confirmed' | 'completed' | 'cancelled';
  booking_mode?: 'instant' | 'request';
  accepted_at?: string | null;
  rejected_at?: string | null;
  cancelled_at?: string | null;
  completed_at?: string | null;
  totalPrice: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBookingData {
  provider_id: number;
  service_id: number;
  start_date: string;
  end_date?: string;
  total_price: number;
  booking_mode?: 'instant' | 'request';
}

const bookingService = {
  async getAllBookings(): Promise<Booking[]> {
    const resp = await apiClient.get<{ data: Booking[] }>(API_CONFIG.ENDPOINTS.BOOKINGS.GET_ALL);
    return resp.data;
  },

  async getMyBookings(): Promise<Booking[]> {
    const resp = await apiClient.get<{ data: Booking[] }>((API_CONFIG.ENDPOINTS.BOOKINGS as any).MY);
    return resp.data;
  },

  async getMyProviderBookings(): Promise<Booking[]> {
    const resp = await apiClient.get<{ data: Booking[] }>((API_CONFIG.ENDPOINTS.BOOKINGS as any).PROVIDER_MY);
    return resp.data;
  },

  async getBookingById(id: string): Promise<Booking> {
    const resp = await apiClient.get<{ data: Booking }>(API_CONFIG.ENDPOINTS.BOOKINGS.GET_BY_ID(id));
    return resp.data;
  },

  async createBooking(data: CreateBookingData): Promise<Booking> {
    return apiClient.post<{ data: Booking }>(
      API_CONFIG.ENDPOINTS.BOOKINGS.CREATE,
      data
    ).then(response => response.data);
  },

  async updateBooking(id: string, data: Partial<Booking>): Promise<Booking> {
    const resp = await apiClient.put<{ data: Booking }>(API_CONFIG.ENDPOINTS.BOOKINGS.UPDATE(id), data);
    return resp.data;
  },

  async deleteBooking(id: string): Promise<void> {
    return apiClient.delete<void>(API_CONFIG.ENDPOINTS.BOOKINGS.DELETE(id));
  },
};

export default bookingService;
