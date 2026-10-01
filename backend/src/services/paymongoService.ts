import { PAYMONGO_SECRET_KEY } from '../config/paymongoConfig';

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
        // QR Ph. Field names confirmed against test mode on 2026-09-28, because the
        // published reference pages for this shape are 404 at the time of writing:
        //   { id, amount, label, test_url, image_url, expires_at }
        // and next_action.type is "consume_qr" (NOT the "present_qr_code" the guides say).
        // `image_url` is a base64 data URI - `data:image/png;base64,...`, ~14 kB - meant to
        // go straight into an <img src>; there is nothing to fetch.
        code?: {
          id?: string;
          amount?: number;
          label?: string | null;
          /** Test mode only: a hosted page that simulates the customer paying. */
          test_url?: string;
          image_url?: string;
          /** RFC3339, with nanosecond precision. Date parses it, truncating to ms. */
          expires_at?: string;
          [key: string]: any;
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

// How long one PayMongo call may take before it is abandoned.
//
// There was no limit at all. fetch waits indefinitely, and create-intent makes its PayMongo
// call while holding a FOR UPDATE lock on the booking - so a hung gateway connection held
// that lock, and the client's Pay button spun, for as long as the socket stayed open.
// Abandoning a POST is safe here: create-intent and refunds send a deterministic
// Idempotency-Key, so the retry gets back whatever the abandoned call created, and an
// abandoned attach is reconciled by /confirm reading the intent's real status.
const PAYMONGO_TIMEOUT_MS = parseInt(process.env.PAYMONGO_TIMEOUT_MS || '15000', 10) || 15000;

/**
 * A failed PayMongo call, with enough attached for a caller to answer honestly.
 *
 * `message` is PayMongo's own detail and is for server logs and admin tooling. It is not
 * meant for clients: it can describe our account's configuration ("qrph is not enabled for
 * this merchant") rather than anything the client did.
 */
export class PayMongoApiError extends Error {
  /** HTTP status from PayMongo; 0 when no response arrived (timeout or network failure). */
  readonly status: number;
  readonly code: string | null;
  readonly timedOut: boolean;

  constructor(message: string, status: number, code: string | null, timedOut = false) {
    super(message);
    this.name = 'PayMongoApiError';
    this.status = status;
    this.code = code;
    this.timedOut = timedOut;
  }

  /** True when the gateway, not the request, is at fault - worth "try again in a moment". */
  get isGatewayProblem(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 429;
  }
}

async function sendOnce(
  endpoint: string,
  method: string,
  data: any,
  idempotencyKey: string | undefined
): Promise<PayMongoResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ':').toString('base64')}`,
  };

  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  let response: globalThis.Response;
  try {
    response = await fetch(`${PAYMONGO_API_URL}${endpoint}`, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(PAYMONGO_TIMEOUT_MS),
    });
  } catch (networkError: any) {
    const timedOut = networkError?.name === 'TimeoutError' || networkError?.name === 'AbortError';
    console.error(
      `PayMongo ${method} ${endpoint} ${timedOut ? `timed out after ${PAYMONGO_TIMEOUT_MS}ms` : 'failed to connect'}:`,
      networkError?.message
    );
    throw new PayMongoApiError(
      timedOut ? 'PayMongo did not respond in time' : `Could not reach PayMongo: ${networkError?.message}`,
      0,
      null,
      timedOut
    );
  }

  // Read as text first. A gateway or load-balancer error in front of PayMongo comes back
  // as an HTML page, and response.json() on that threw a SyntaxError ("Unexpected token <")
  // that hid the real HTTP status from every log and caller.
  const raw = await response.text();
  let result: PayMongoResponse | null = null;
  try {
    result = raw ? (JSON.parse(raw) as PayMongoResponse) : null;
  } catch {
    result = null;
  }

  if (!response.ok || !result) {
    const first = result?.errors?.[0];
    console.error(
      `PayMongo ${method} ${endpoint} -> HTTP ${response.status}:`,
      result ? JSON.stringify(result.errors || result) : raw.slice(0, 300)
    );
    throw new PayMongoApiError(
      first?.detail || `PayMongo returned HTTP ${response.status}${result ? '' : ' with a non-JSON body'}`,
      response.status,
      first?.code || null
    );
  }

  return result;
}

// Helper function for PayMongo API calls
//
// Reads (GET) are retried once on a gateway problem: they change nothing, and /confirm and
// the resume path in create-intent would otherwise fail a client over one dropped packet.
// Writes are never retried here - even with an idempotency key, the caller is the one that
// knows whether a second attempt is wanted.
export async function paymongoRequest(endpoint: string, method: string, data?: any, idempotencyKey?: string): Promise<PayMongoResponse> {
  try {
    return await sendOnce(endpoint, method, data, idempotencyKey);
  } catch (error) {
    if (method === 'GET' && error instanceof PayMongoApiError && error.isGatewayProblem) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return sendOnce(endpoint, method, data, idempotencyKey);
    }
    throw error;
  }
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
