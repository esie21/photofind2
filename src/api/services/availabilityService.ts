import { apiClient } from '../client';

// Legacy types (backward compatibility)
export interface AvailabilitySlot {
  id: number | string;
  provider_id: number | string;
  start_time: string;
  end_time: string;
  is_bookable: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ProviderTimeslotsResponse {
  provider_id: number | string;
  date: string;
  duration_minutes?: number;
  time_slots?: string[];
  slots?: Array<{
    id: string;
    start: string;
    end: string;
    status: string;
  }>;
}

// New types for enhanced availability system
export interface AvailabilityRule {
  id: string;
  provider_id: string;
  day_of_week: number; // 0-6 (Sunday-Saturday)
  start_time: string; // HH:MM
  end_time: string; // HH:MM
  slot_duration: number; // minutes
  buffer_minutes: number;
  is_active: boolean;
  created_at: string;
}

export interface AvailabilityOverride {
  id: string;
  provider_id: string;
  override_date: string; // YYYY-MM-DD
  is_available: boolean;
  start_time?: string;
  end_time?: string;
  reason?: string;
  created_at: string;
}

export interface TimeSlot {
  id: string;
  provider_id: string;
  start_datetime: string;
  end_datetime: string;
  status: 'available' | 'held' | 'booked';
  held_by?: string;
  hold_expires_at?: string;
  booking_id?: string;
  is_held?: boolean;
}

export interface CalendarDay {
  date: string;
  available_count: number;
  held_count: number;
  booked_count: number;
  total_count: number;
}

export interface CalendarData {
  month: number;
  year: number;
  days: CalendarDay[];
  overrides: Array<{
    override_date: string;
    is_available: boolean;
    reason?: string;
  }>;
}

export interface HoldResponse {
  slots: TimeSlot[];
  hold_expires_at: string;
  hold_duration_minutes: number;
}

export interface BookingFromSlotResponse {
  booking: {
    id: string;
    client_id: string;
    provider_id: string;
    service_id: string;
    start_date: string;
    end_date: string;
    status: string;
    total_price: number;
  };
  slots: string[];
}

// Day names for display
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const availabilityService = {
  // ==================== LEGACY METHODS (backward compatibility) ====================

  async getProviderTimeslots(params: {
    providerId: string | number;
    date: string;
    service_id?: string | number;
  }): Promise<ProviderTimeslotsResponse> {
    let url = `/availability/providers/${params.providerId}/timeslots?date=${params.date}`;
    if (params.service_id !== undefined) {
      url += `&service_id=${params.service_id}`;
    }

    const resp = await apiClient.get<{ data: ProviderTimeslotsResponse }>(url);
    return resp.data;
  },

  async getProviderSlots(params: {
    providerId: string | number;
    from?: string;
    to?: string;
  }): Promise<AvailabilitySlot[]> {
    let url = `/availability/providers/${params.providerId}/slots`;
    const searchParams = new URLSearchParams();
    if (params.from) searchParams.set('from', params.from);
    if (params.to) searchParams.set('to', params.to);
    if (searchParams.toString()) url += `?${searchParams.toString()}`;

    const resp = await apiClient.get<{ data: AvailabilitySlot[] }>(url);
    return resp.data;
  },

  async createSlot(data: {
    start_time: string;
    end_time: string;
    is_bookable?: boolean;
  }): Promise<AvailabilitySlot> {
    const resp = await apiClient.post<{ data: AvailabilitySlot }>(
      '/availability',
      data
    );
    return resp.data;
  },

  async updateSlot(
    id: string | number,
    data: Partial<Pick<AvailabilitySlot, 'start_time' | 'end_time' | 'is_bookable'>>
  ): Promise<AvailabilitySlot> {
    const resp = await apiClient.put<{ data: AvailabilitySlot }>(
      `/availability/${id}`,
      data
    );
    return resp.data;
  },

  async deleteSlot(id: string | number): Promise<{ success: true } | void> {
    return apiClient.delete(`/availability/${id}`);
  },

  // ==================== AVAILABILITY RULES ====================

  async getRules(providerId: string): Promise<AvailabilityRule[]> {
    const resp = await apiClient.get<{ data: AvailabilityRule[] }>(`/availability/rules/${providerId}`);
    return resp.data;
  },

  async saveRules(rules: Array<{
    day_of_week: number;
    start_time: string;
    end_time: string;
    slot_duration?: number;
    buffer_minutes?: number;
  }>): Promise<AvailabilityRule[]> {
    const resp = await apiClient.post<{ data: AvailabilityRule[] }>('/availability/rules', { rules });
    return resp.data;
  },

  async deleteRule(ruleId: string): Promise<void> {
    await apiClient.delete(`/availability/rules/${ruleId}`);
  },

  // ==================== AVAILABILITY OVERRIDES ====================

  async getOverrides(providerId: string, from?: string, to?: string): Promise<AvailabilityOverride[]> {
    let url = `/availability/overrides/${providerId}`;
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    if (params.toString()) url += `?${params.toString()}`;

    const resp = await apiClient.get<{ data: AvailabilityOverride[] }>(url);
    return resp.data;
  },

  async saveOverride(override: {
    override_date: string;
    is_available: boolean;
    start_time?: string;
    end_time?: string;
    reason?: string;
  }): Promise<AvailabilityOverride> {
    const resp = await apiClient.post<{ data: AvailabilityOverride }>('/availability/overrides', override);
    return resp.data;
  },

  async deleteOverride(overrideId: string): Promise<void> {
    await apiClient.delete(`/availability/overrides/${overrideId}`);
  },

  // ==================== TIME SLOTS ====================

  async getSlots(providerId: string, date?: string): Promise<TimeSlot[]> {
    let url = `/availability/slots/${providerId}`;
    if (date) url += `?date=${date}`;

    const resp = await apiClient.get<{ data: TimeSlot[] }>(url);
    return resp.data;
  },

  async getAvailableSlots(providerId: string, date: string): Promise<{
    provider_id: string;
    date: string;
    slots: Array<{
      id: string;
      start: string;
      end: string;
      status: string;
    }>;
  }> {
    const resp = await apiClient.get<{ data: { provider_id: string; date: string; slots: any[] } }>(
      `/availability/providers/${providerId}/timeslots?date=${date}`
    );
    return resp.data;
  },

  async getCalendar(providerId: string, month: number, year: number): Promise<CalendarData> {
    const resp = await apiClient.get<{ data: CalendarData }>(
      `/availability/calendar/${providerId}?month=${month}&year=${year}`
    );
    return resp.data;
  },

  // ==================== SLOT HOLDING ====================

  async holdSlot(slotId: string): Promise<HoldResponse> {
    const resp = await apiClient.post<{ data: HoldResponse }>('/availability/slots/hold', {
      slot_id: slotId,
    });
    return resp.data;
  },

  async holdSlots(slotIds: string[]): Promise<HoldResponse> {
    const resp = await apiClient.post<{ data: HoldResponse }>('/availability/slots/hold', {
      slot_ids: slotIds,
    });
    return resp.data;
  },

  async releaseSlot(slotId: string): Promise<void> {
    await apiClient.post('/availability/slots/release', { slot_id: slotId });
  },

  async releaseSlots(slotIds: string[]): Promise<void> {
    await apiClient.post('/availability/slots/release', { slot_ids: slotIds });
  },

  async releaseAllHolds(): Promise<void> {
    await apiClient.post('/availability/slots/release', {});
  },

  // ==================== BOOKING FROM SLOTS ====================

  async bookSlots(slotIds: string[], serviceId?: string, notes?: string): Promise<BookingFromSlotResponse> {
    const resp = await apiClient.post<{ data: BookingFromSlotResponse }>('/availability/slots/book', {
      slot_ids: slotIds,
      service_id: serviceId,
      notes,
    });
    return resp.data;
  },

  async bookSlot(slotId: string, serviceId?: string, notes?: string): Promise<BookingFromSlotResponse> {
    const resp = await apiClient.post<{ data: BookingFromSlotResponse }>('/availability/slots/book', {
      slot_id: slotId,
      service_id: serviceId,
      notes,
    });
    return resp.data;
  },

  // ==================== UTILITIES ====================

  formatTime(time: string): string {
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  },

  formatDateTime(datetime: string): string {
    const date = new Date(datetime);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  },

  formatSlotTime(datetime: string): string {
    const date = new Date(datetime);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  },

  getDayName(dayOfWeek: number, short = false): string {
    return short ? DAY_NAMES_SHORT[dayOfWeek] : DAY_NAMES[dayOfWeek];
  },

  calculateDuration(startTime: string, endTime: string): number {
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    return (endH * 60 + endM) - (startH * 60 + startM);
  },

  getDefaultSchedule(): Array<{
    day_of_week: number;
    start_time: string;
    end_time: string;
    slot_duration: number;
    buffer_minutes: number;
  }> {
    return [1, 2, 3, 4, 5].map(day => ({
      day_of_week: day,
      start_time: '09:00',
      end_time: '17:00',
      slot_duration: 60,
      buffer_minutes: 0,
    }));
  },
};

export default availabilityService;
