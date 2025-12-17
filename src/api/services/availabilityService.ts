import { apiClient } from '../client';
import { API_CONFIG } from '../config';

export interface AvailabilitySlot {
  id: number | string;
  provider_id: number;
  start_time: string;
  end_time: string;
  is_bookable: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ProviderTimeslotsResponse {
  provider_id: number;
  date: string;
  duration_minutes: number;
  time_slots: string[];
}

const availabilityService = {
  async getProviderTimeslots(params: {
    providerId: string | number;
    date: string;
    service_id?: string | number;
  }): Promise<ProviderTimeslotsResponse> {
    const url = new URL(API_CONFIG.ENDPOINTS.AVAILABILITY.PROVIDER_TIMESLOTS(params.providerId));
    url.searchParams.set('date', params.date);
    if (params.service_id !== undefined) {
      url.searchParams.set('service_id', String(params.service_id));
    }

    const resp = await apiClient.get<{ data: ProviderTimeslotsResponse }>(url.toString());
    return resp.data;
  },

  async getProviderSlots(params: {
    providerId: string | number;
    from?: string;
    to?: string;
  }): Promise<AvailabilitySlot[]> {
    const url = new URL(API_CONFIG.ENDPOINTS.AVAILABILITY.PROVIDER_SLOTS(params.providerId));
    if (params.from) url.searchParams.set('from', params.from);
    if (params.to) url.searchParams.set('to', params.to);

    const resp = await apiClient.get<{ data: AvailabilitySlot[] }>(url.toString());
    return resp.data;
  },

  async createSlot(data: {
    start_time: string;
    end_time: string;
    is_bookable?: boolean;
  }): Promise<AvailabilitySlot> {
    const resp = await apiClient.post<{ data: AvailabilitySlot }>(
      API_CONFIG.ENDPOINTS.AVAILABILITY.CREATE,
      data
    );
    return resp.data;
  },

  async updateSlot(
    id: string | number,
    data: Partial<Pick<AvailabilitySlot, 'start_time' | 'end_time' | 'is_bookable'>>
  ): Promise<AvailabilitySlot> {
    const resp = await apiClient.put<{ data: AvailabilitySlot }>(
      API_CONFIG.ENDPOINTS.AVAILABILITY.UPDATE(id),
      data
    );
    return resp.data;
  },

  async deleteSlot(id: string | number): Promise<{ success: true } | void> {
    return apiClient.delete(API_CONFIG.ENDPOINTS.AVAILABILITY.DELETE(id));
  },
};

export default availabilityService;
