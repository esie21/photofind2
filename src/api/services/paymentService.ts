import { apiClient } from '../client';

export interface Payment {
  id: string;
  booking_id: string;
  client_id: string;
  provider_id: string;
  paymongo_payment_intent_id: string;
  paymongo_payment_method_id?: string;
  gross_amount: number;
  commission_rate: number;
  commission_amount: number;
  net_provider_amount: number;
  currency: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'refunded';
  payment_method_type?: string;
  failure_reason?: string;
  paid_at?: string;
  created_at: string;
  updated_at: string;
  service_title?: string;
  provider_name?: string;
}

export interface PaymentIntentResponse {
  payment_id: string;
  payment_intent_id: string;
  client_key: string;
  amount: number;
  commission: number;
  provider_amount: number;
  status: string;
  public_key: string;
}

export interface AttachMethodResponse {
  status: string;
  next_action?: {
    type: string;
    redirect?: {
      url: string;
      return_url: string;
    };
  };
}

const paymentService = {
  // Create a payment intent for a booking
  async createPaymentIntent(bookingId: string): Promise<PaymentIntentResponse> {
    const resp = await apiClient.post<{ data: PaymentIntentResponse }>('/payments/create-intent', {
      booking_id: bookingId,
    });
    return resp.data;
  },

  // Attach a payment method to a payment intent
  async attachPaymentMethod(paymentIntentId: string, paymentMethodId: string): Promise<AttachMethodResponse> {
    const resp = await apiClient.post<{ data: AttachMethodResponse }>('/payments/attach-method', {
      payment_intent_id: paymentIntentId,
      payment_method_id: paymentMethodId,
    });
    return resp.data;
  },

  // Confirm/check payment status
  async confirmPayment(paymentIntentId: string): Promise<{ payment_id: string; status: string; paid_at: string | null }> {
    const resp = await apiClient.post<{ data: { payment_id: string; status: string; paid_at: string | null } }>('/payments/confirm', {
      payment_intent_id: paymentIntentId,
    });
    return resp.data;
  },

  // Get payment details by ID
  async getPayment(paymentId: string): Promise<Payment> {
    const resp = await apiClient.get<{ data: Payment }>(`/payments/${paymentId}`);
    return resp.data;
  },

  // Get payment for a booking
  async getPaymentByBooking(bookingId: string): Promise<Payment> {
    const resp = await apiClient.get<{ data: Payment }>(`/payments/booking/${bookingId}`);
    return resp.data;
  },

  // Get client's payment history
  async getClientPaymentHistory(): Promise<Payment[]> {
    const resp = await apiClient.get<{ data: Payment[] }>('/payments/client/history');
    return resp.data;
  },
};

export default paymentService;
