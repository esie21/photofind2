import { apiClient } from '../client';
import { API_CONFIG } from '../config';

export interface Booking {
  id: string;
  clientId: string;
  providerId: string;
  serviceId: string;
  startDate: string;
  endDate: string;
  status: 'pending' | 'accepted' | 'rejected' | 'confirmed' | 'completed' | 'cancelled' | 'awaiting_confirmation' | 'disputed';
  booking_mode?: 'instant' | 'request';
  accepted_at?: string | null;
  rejected_at?: string | null;
  cancelled_at?: string | null;
  completed_at?: string | null;
  rescheduled_at?: string | null;
  rescheduled_by?: string | null;
  reschedule_reason?: string | null;
  original_start_date?: string | null;
  original_end_date?: string | null;
  reschedule_count?: number;
  // Dual confirmation fields
  provider_completed_at?: string | null;
  client_confirmed_at?: string | null;
  completion_notes?: string | null;
  dispute_raised?: boolean;
  dispute_reason?: string | null;
  // Related data
  service_title?: string;
  client_name?: string;
  provider_name?: string;
  totalPrice: number;
  createdAt: string;
  updatedAt: string;
}

export interface BookingEvidence {
  id: string;
  booking_id: string;
  uploaded_by: string;
  uploaded_by_name?: string;
  evidence_type: 'before' | 'after' | 'during' | 'other';
  file_url: string;
  caption?: string;
  uploaded_at: string;
}

export interface DisputedBooking extends Booking {
  client_email?: string;
  provider_email?: string;
  evidence: BookingEvidence[];
}

export interface RescheduleBookingData {
  start_date: string;
  end_date: string;
  reason?: string;
}

export interface CreateBookingData {
  provider_id: string | number;
  service_id: string | number;
  start_date: string;
  end_date?: string;
  total_price: number;
  booking_mode?: 'instant' | 'request';
  slot_ids?: string[];
  duration_minutes?: number;
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

  async rescheduleBooking(id: string, data: RescheduleBookingData): Promise<{ data: Booking; message: string }> {
    return apiClient.put<{ data: Booking; message: string }>(
      API_CONFIG.ENDPOINTS.BOOKINGS.RESCHEDULE(id),
      data
    );
  },

  // ==================== DUAL CONFIRMATION METHODS ====================

  /**
   * Provider completes booking with evidence photos
   * Uses direct backend URL to bypass Vercel's 4.5MB body size limit
   */
  async completeBooking(
    id: string,
    evidenceFiles: File[],
    notes?: string,
    evidenceTypes?: string[]
  ): Promise<{ data: Booking; message: string }> {
    const formData = new FormData();

    evidenceFiles.forEach((file) => {
      formData.append('evidence', file);
    });

    if (notes) {
      formData.append('notes', notes);
    }

    if (evidenceTypes && evidenceTypes.length > 0) {
      formData.append('evidence_types', JSON.stringify(evidenceTypes));
    }

    // Use direct backend URL for file uploads (bypasses Vercel proxy limits)
    const directUrl = `${API_CONFIG.DIRECT_UPLOAD_URL}${API_CONFIG.ENDPOINTS.BOOKINGS.COMPLETE(id)}`;

    const token = localStorage.getItem('authToken');
    const response = await fetch(directUrl, {
      method: 'POST',
      body: formData,
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
        else if (errJson?.message) errorText = errJson.message;
      } catch (e) {
        // ignore JSON parse errors
      }
      throw new Error(errorText);
    }

    return response.json();
  },

  /**
   * Client confirms or disputes booking completion
   */
  async confirmBooking(
    id: string,
    confirmed: boolean,
    disputeReason?: string
  ): Promise<{ data: Booking; message: string }> {
    return apiClient.put<{ data: Booking; message: string }>(
      API_CONFIG.ENDPOINTS.BOOKINGS.CONFIRM(id),
      { confirmed, dispute_reason: disputeReason }
    );
  },

  /**
   * Get evidence for a booking
   */
  async getBookingEvidence(id: string): Promise<BookingEvidence[]> {
    const resp = await apiClient.get<{ data: BookingEvidence[] }>(
      API_CONFIG.ENDPOINTS.BOOKINGS.EVIDENCE(id)
    );
    return resp.data;
  },

  /**
   * Get all disputed bookings (admin only)
   */
  async getDisputedBookings(): Promise<DisputedBooking[]> {
    const resp = await apiClient.get<{ data: DisputedBooking[] }>(
      API_CONFIG.ENDPOINTS.BOOKINGS.DISPUTED
    );
    return resp.data;
  },

  /**
   * Admin resolves a dispute
   */
  async resolveDispute(
    id: string,
    resolution: string,
    resolvedInFavorOf: 'client' | 'provider',
    refundPercentage?: number
  ): Promise<{ data: Booking; message: string; details?: { released_to_provider: number; refunded_to_client: number; refund_percentage: number } }> {
    return apiClient.put<{ data: Booking; message: string; details?: { released_to_provider: number; refunded_to_client: number; refund_percentage: number } }>(
      API_CONFIG.ENDPOINTS.BOOKINGS.RESOLVE_DISPUTE(id),
      {
        resolution,
        resolved_in_favor_of: resolvedInFavorOf,
        refund_percentage: refundPercentage
      }
    );
  },
};

export default bookingService;
