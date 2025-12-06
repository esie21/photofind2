import { apiClient } from '../client';
import { API_CONFIG } from '../config';

export interface Booking {
  id: string;
  clientId: string;
  providerId: string;
  serviceId: string;
  startDate: string;
  endDate: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  totalPrice: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBookingData {
  provider_id: number;
  service_id: number;
  start_date: string;
  end_date: string;
  total_price: number;
}

const bookingService = {
  async getAllBookings(): Promise<Booking[]> {
    return apiClient.get<Booking[]>(API_CONFIG.ENDPOINTS.BOOKINGS.GET_ALL);
  },

  async getBookingById(id: string): Promise<Booking> {
    return apiClient.get<Booking>(
      API_CONFIG.ENDPOINTS.BOOKINGS.GET_BY_ID(id)
    );
  },

  async createBooking(data: CreateBookingData): Promise<Booking> {
    return apiClient.post<{ data: Booking }>(
      API_CONFIG.ENDPOINTS.BOOKINGS.CREATE,
      data
    ).then(response => response.data);
  },

  async updateBooking(id: string, data: Partial<Booking>): Promise<Booking> {
    return apiClient.put<Booking>(
      API_CONFIG.ENDPOINTS.BOOKINGS.UPDATE(id),
      data
    );
  },

  async deleteBooking(id: string): Promise<void> {
    return apiClient.delete<void>(API_CONFIG.ENDPOINTS.BOOKINGS.DELETE(id));
  },
};

export default bookingService;
