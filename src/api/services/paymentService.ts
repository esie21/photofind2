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
  /**
   * The online methods this intent will actually accept, decided by the server. QR Ph is
   * the only one in normal operation; the card/e-wallet list appears only when QR Ph has
   * been switched off for an outage. Read from the intent itself when an existing payment
   * is resumed, so a client is never offered a method their in-flight intent predates.
   */
  payment_methods?: string[];
}

export interface AttachMethodResponse {
  status: string;
  next_action?: {
    type: string;
    redirect?: {
      url: string;
      return_url: string;
    };
    /** QR Ph. `image_url` is a base64 data URI meant to go straight into an <img src>. */
    code?: {
      image_url?: string;
      [key: string]: unknown;
    };
  };
  /**
   * QR Ph only. When the code stops being scannable, as an ISO timestamp, computed by the
   * server from the expiry it asked PayMongo for. A countdown hint for the UI - the
   * authority on an expired code is the server saying so, not this clock.
   */
  qr_expires_at?: string | null;
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

  // Ask the server to mint and attach a QR Ph payment method.
  //
  // No payment_method_id, unlike the card path: a card has to be turned into a payment
  // method in the browser so the number never reaches our server, while QR Ph has no
  // sensitive input at all and is created server-side, which is what keeps the code's
  // expiry out of the client's hands.
  async attachQrPh(paymentIntentId: string): Promise<AttachMethodResponse> {
    const resp = await apiClient.post<{ data: AttachMethodResponse }>('/payments/attach-method', {
      payment_intent_id: paymentIntentId,
      method: 'qrph',
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
