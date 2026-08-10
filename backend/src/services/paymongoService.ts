const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY || '';
const PAYMONGO_API_URL = 'https://api.paymongo.com/v1';

export interface PayMongoError {
  detail?: string;
  code?: string;
}

export interface PayMongoResponse {
  data: {
    id: string;
    type: string;
    attributes: {
      amount: number;
      currency: string;
      status: string;
      client_key?: string;
      payment_method_type?: string;
      payments?: Array<{ id: string; attributes?: any }>;
      next_action?: {
        type: string;
        redirect?: {
          url: string;
          return_url: string;
        };
      };
      last_payment_error?: {
        message?: string;
      };
      [key: string]: any;
    };
  };
  errors?: PayMongoError[];
}

// Helper function for PayMongo API calls
export async function paymongoRequest(endpoint: string, method: string, data?: any, idempotencyKey?: string): Promise<PayMongoResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ':').toString('base64')}`,
  };

  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  const response = await fetch(`${PAYMONGO_API_URL}${endpoint}`, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  const result = await response.json() as PayMongoResponse;

  if (!response.ok) {
    console.error('PayMongo API Error:', result);
    throw new Error(result.errors?.[0]?.detail || 'PayMongo API error');
  }

  return result;
}

export type PayMongoRefundReason = 'duplicate' | 'fraudulent' | 'requested_by_customer' | 'others';

// Issues a refund against an underlying PayMongo payment (not a payment_intent).
// amountCentavos must be in the smallest currency unit, same convention as payment_intents.
export async function createRefund(
  paymentId: string,
  amountCentavos: number,
  reason: PayMongoRefundReason,
  notes: string,
  idempotencyKey: string
): Promise<PayMongoResponse> {
  return paymongoRequest('/refunds', 'POST', {
    data: {
      attributes: {
        amount: amountCentavos,
        payment_id: paymentId,
        reason,
        notes,
      }
    }
  }, idempotencyKey);
}
