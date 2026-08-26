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
  booking_mode?: 'request';
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
  reschedule_pending_approval?: boolean;
  reschedule_previous_start_date?: string | null;
  reschedule_previous_end_date?: string | null;
  // Dual confirmation fields
  provider_completed_at?: string | null;
  client_confirmed_at?: string | null;
  completion_notes?: string | null;
  dispute_raised?: boolean;
  dispute_reason?: string | null;
  dispute_response?: string | null;
  dispute_response_at?: string | null;
  // Payment
  /** 'online' pays through PayMongo before the shoot; 'cash' is handed over on the day. */
  payment_method?: 'online' | 'cash';
  payment_status?: 'unpaid' | 'pending' | 'paid' | 'failed';
  payment_due_at?: string | null;
  /** Set once the provider records that the cash arrived. */
  cash_confirmed_at?: string | null;
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
  /** True for photos attached after a dispute was raised, false for completion photos. */
  is_dispute_evidence?: boolean;
  /** Which side of the booking filed this, resolved server-side. */
  uploader_role?: 'client' | 'provider' | 'other';
}

export interface DisputedBooking extends Booking {
  client_email?: string;
  provider_email?: string;
  client_user_id?: string;
  provider_user_id?: string;
  /** The provider's completion photos. */
  evidence: BookingEvidence[];
  /** Photos either party attached after the dispute was raised. */
  dispute_evidence?: BookingEvidence[];
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
  slot_ids?: string[];
  duration_minutes?: number;
  /**
   * Defaults to 'online'. The server re-checks the service's accepts_cash flag, so
   * asking for 'cash' on a service that hasn't opted in is refused there rather than
   * being taken on trust from here.
   */
  payment_method?: 'online' | 'cash';
}

export interface CashConfirmationResult {
  booking_id: string;
  payment_id: string;
  payment_status: 'paid';
  payment_method: 'cash';
  gross_amount: number;
  commission_charged: number;
  available_balance: number;
  outstanding_commission: number;
}

/**
 * POST a multipart body straight at the backend, bypassing the Vercel proxy's 4.5MB
 * body limit. Shared by completion and dispute evidence uploads so both surface the
 * backend's own error text rather than a bare status code.
 */
async function postMultipart<T>(path: string, formData: FormData): Promise<T> {
  const token = localStorage.getItem('authToken');
  const response = await fetch(`${API_CONFIG.DIRECT_UPLOAD_URL}${path}`, {
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

  /**
   * Provider-only: record that the client paid in cash on the day.
   *
   * This is what marks a cash booking paid - there is no online payment to settle. It
   * also charges the platform commission to the provider's wallet, because the platform
   * never handled the money it is owed a cut of.
   */
  async confirmCashPayment(id: string): Promise<CashConfirmationResult> {
    const resp = await apiClient.post<{ data: CashConfirmationResult; message: string }>(
      (API_CONFIG.ENDPOINTS.BOOKINGS as any).CONFIRM_CASH(id),
      {}
    );
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

  /**
   * Confirm a reschedule proposed by the other party
   */
  async approveReschedule(id: string): Promise<{ data: Booking; message: string }> {
    return apiClient.put<{ data: Booking; message: string }>(
      (API_CONFIG.ENDPOINTS.BOOKINGS as any).RESCHEDULE_APPROVE(id),
      {}
    );
  },

  /**
   * Decline a reschedule proposed by the other party; reverts to the original time
   */
  async rejectReschedule(id: string): Promise<{ data: Booking; message: string }> {
    return apiClient.put<{ data: Booking; message: string }>(
      (API_CONFIG.ENDPOINTS.BOOKINGS as any).RESCHEDULE_REJECT(id),
      {}
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

    return postMultipart<{ data: Booking; message: string }>(
      API_CONFIG.ENDPOINTS.BOOKINGS.COMPLETE(id),
      formData
    );
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
   * Attach photos to an open dispute. Available to both the client and the provider -
   * unlike completeBooking, which is provider-only - so an admin sees both sides.
   */
  async uploadDisputeEvidence(
    id: string,
    files: File[],
    caption?: string
  ): Promise<{ data: BookingEvidence[]; message: string }> {
    const formData = new FormData();
    files.forEach((file) => formData.append('evidence', file));
    if (caption?.trim()) formData.append('caption', caption.trim());

    return postMultipart<{ data: BookingEvidence[]; message: string }>(
      API_CONFIG.ENDPOINTS.BOOKINGS.DISPUTE_EVIDENCE(id),
      formData
    );
  },

  /**
   * Provider states their side of an open dispute. Re-submitting replaces the previous
   * response.
   */
  async submitDisputeResponse(id: string, response: string): Promise<{ data: Booking; message: string }> {
    return apiClient.put<{ data: Booking; message: string }>(
      API_CONFIG.ENDPOINTS.BOOKINGS.DISPUTE_RESPONSE(id),
      { response }
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
