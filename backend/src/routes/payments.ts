import express, { Request, Response } from 'express';
import { pool } from '../config/database';
import { verifyToken } from '../middleware/auth';
import crypto from 'crypto';
import { notificationService } from '../services/notificationService';

const router = express.Router();

// PayMongo API configuration
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY || '';
const PAYMONGO_PUBLIC_KEY = process.env.PAYMONGO_PUBLIC_KEY || '';
const PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET || '';
const PAYMONGO_API_URL = 'https://api.paymongo.com/v1';

// Commission rate (configurable)
const PLATFORM_COMMISSION_RATE = parseFloat(process.env.PLATFORM_COMMISSION_RATE || '0.15'); // 15%

// Minimum payout amount
const MINIMUM_PAYOUT_AMOUNT = parseFloat(process.env.MINIMUM_PAYOUT_AMOUNT || '500'); // 500 PHP

// PayMongo API response types
interface PayMongoError {
  detail?: string;
  code?: string;
}

interface PayMongoResponse {
  data: {
    id: string;
    type: string;
    attributes: {
      amount: number;
      currency: string;
      status: string;
      client_key?: string;
      payment_method_type?: string;
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
async function paymongoRequest(endpoint: string, method: string, data?: any, idempotencyKey?: string): Promise<PayMongoResponse> {
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

// Helper to ensure provider has a wallet
async function ensureProviderWallet(providerId: string): Promise<string> {
  const existing = await pool.query(
    'SELECT id FROM wallets WHERE provider_id::text = $1',
    [providerId]
  );

  if (existing.rows[0]) {
    return existing.rows[0].id;
  }

  const created = await pool.query(
    'INSERT INTO wallets (provider_id) VALUES ($1) RETURNING id',
    [providerId]
  );

  return created.rows[0].id;
}

// Generate idempotency key for payment - deterministic to prevent duplicate payments
function generateIdempotencyKey(bookingId: string, clientId: string): string {
  // Use only bookingId and clientId to ensure same booking+client always gets same key
  return `payment_${bookingId}_${clientId}`;
}

// Create payment intent for a booking
router.post('/create-intent', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const clientId = req.userId;
  const { booking_id } = req.body;

  if (!clientId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!booking_id) {
    return res.status(400).json({ error: 'booking_id is required' });
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    // Get booking details with provider's user_id and service price
    const bookingRes = await dbClient.query(
      `SELECT b.*, s.title as service_title, s.price as service_price, p.user_id as provider_user_id
       FROM bookings b
       LEFT JOIN services s ON s.id::text = b.service_id::text
       LEFT JOIN providers p ON p.id::text = b.provider_id::text
       WHERE b.id::text = $1`,
      [booking_id]
    );
    const booking = bookingRes.rows[0];

    if (!booking) {
      await dbClient.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Verify client owns this booking
    if (String(booking.client_id) !== String(clientId)) {
      await dbClient.query('ROLLBACK');
      return res.status(403).json({ error: 'Access denied' });
    }

    // Validate payment amount against service price (prevent underpayment)
    const bookingPrice = parseFloat(booking.total_price || 0);
    const servicePrice = parseFloat(booking.service_price || 0);
    if (servicePrice > 0 && bookingPrice < servicePrice) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({
        error: 'Payment amount is less than the service price',
        expected: servicePrice,
        received: bookingPrice
      });
    }

    // Check if payment already exists
    const existingPayment = await dbClient.query(
      'SELECT * FROM payments WHERE booking_id::text = $1',
      [booking_id]
    );

    if (existingPayment.rows[0]) {
      const payment = existingPayment.rows[0];

      // If already succeeded, return error
      if (payment.status === 'succeeded') {
        await dbClient.query('ROLLBACK');
        return res.status(400).json({ error: 'Payment already completed for this booking' });
      }

      // If pending/processing, return existing payment intent
      if (payment.status === 'pending' || payment.status === 'processing') {
        await dbClient.query('ROLLBACK');
        return res.json({
          data: {
            payment_id: payment.id,
            payment_intent_id: payment.paymongo_payment_intent_id,
            client_key: payment.paymongo_client_key,
            amount: parseFloat(payment.gross_amount),
            status: payment.status,
          }
        });
      }
    }

    // Calculate amounts
    const grossAmount = parseFloat(booking.total_price || 0);
    if (grossAmount <= 0) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid booking amount' });
    }

    const commissionAmount = Math.round(grossAmount * PLATFORM_COMMISSION_RATE * 100) / 100;
    const netProviderAmount = Math.round((grossAmount - commissionAmount) * 100) / 100;

    // Generate idempotency key
    const idempotencyKey = generateIdempotencyKey(booking_id, clientId);

    // Create PayMongo Payment Intent
    // Amount in PayMongo is in cents (smallest currency unit)
    const amountInCents = Math.round(grossAmount * 100);

    let paymentIntentData;
    try {
      paymentIntentData = await paymongoRequest('/payment_intents', 'POST', {
        data: {
          attributes: {
            amount: amountInCents,
            payment_method_allowed: ['card', 'gcash', 'grab_pay', 'paymaya'],
            payment_method_options: {
              card: {
                request_three_d_secure: 'any'
              }
            },
            currency: 'PHP',
            capture_type: 'automatic',
            description: `Payment for ${booking.service_title || 'Service'} - Booking #${booking_id}`,
            statement_descriptor: 'PHOTOFIND',
            metadata: {
              booking_id: booking_id,
              client_id: clientId,
              provider_id: String(booking.provider_user_id || booking.provider_id),
            }
          }
        }
      }, idempotencyKey);
    } catch (paymongoError: any) {
      await dbClient.query('ROLLBACK');
      console.error('PayMongo error:', paymongoError);
      return res.status(500).json({ error: 'Failed to create payment intent', detail: paymongoError.message });
    }

    const paymentIntent = paymentIntentData.data;

    // Store payment record (use provider_user_id which references users table)
    const providerUserId = booking.provider_user_id || booking.provider_id;
    const paymentRes = await dbClient.query(
      `INSERT INTO payments (
        booking_id, client_id, provider_id,
        paymongo_payment_intent_id, idempotency_key,
        gross_amount, commission_rate, commission_amount, net_provider_amount,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
      RETURNING *`,
      [
        booking_id,
        clientId,
        providerUserId,
        paymentIntent.id,
        idempotencyKey,
        grossAmount,
        PLATFORM_COMMISSION_RATE,
        commissionAmount,
        netProviderAmount,
      ]
    );

    // Update booking payment status
    await dbClient.query(
      `UPDATE bookings SET payment_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id::text = $1`,
      [booking_id]
    );

    await dbClient.query('COMMIT');

    return res.status(201).json({
      data: {
        payment_id: paymentRes.rows[0].id,
        payment_intent_id: paymentIntent.id,
        client_key: paymentIntent.attributes.client_key,
        amount: grossAmount,
        commission: commissionAmount,
        provider_amount: netProviderAmount,
        status: 'pending',
        public_key: PAYMONGO_PUBLIC_KEY,
      }
    });
  } catch (error: any) {
    await dbClient.query('ROLLBACK');
    console.error('Error creating payment intent:', error);
    return res.status(500).json({ error: 'Failed to create payment intent', detail: error.message });
  } finally {
    dbClient.release();
  }
});

// Attach payment method to payment intent
router.post('/attach-method', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const clientId = req.userId;
  const { payment_intent_id, payment_method_id } = req.body;

  if (!clientId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!payment_intent_id || !payment_method_id) {
    return res.status(400).json({ error: 'payment_intent_id and payment_method_id are required' });
  }

  try {
    // Verify payment belongs to client
    const paymentRes = await pool.query(
      'SELECT * FROM payments WHERE paymongo_payment_intent_id = $1',
      [payment_intent_id]
    );

    if (!paymentRes.rows[0]) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (String(paymentRes.rows[0].client_id) !== String(clientId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Attach payment method to intent
    const result = await paymongoRequest(`/payment_intents/${payment_intent_id}/attach`, 'POST', {
      data: {
        attributes: {
          payment_method: payment_method_id,
          return_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/callback`,
        }
      }
    });

    const updatedIntent = result.data;

    // Update payment record
    await pool.query(
      `UPDATE payments
       SET paymongo_payment_method_id = $1,
           payment_method_type = $2,
           status = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE paymongo_payment_intent_id = $4`,
      [
        payment_method_id,
        updatedIntent.attributes.payment_method_type || 'card',
        updatedIntent.attributes.status === 'succeeded' ? 'succeeded' : 'processing',
        payment_intent_id
      ]
    );

    return res.json({
      data: {
        status: updatedIntent.attributes.status,
        next_action: updatedIntent.attributes.next_action,
      }
    });
  } catch (error: any) {
    console.error('Error attaching payment method:', error);
    return res.status(500).json({ error: 'Failed to attach payment method', detail: error.message });
  }
});

// Confirm payment (check status)
router.post('/confirm', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const clientId = req.userId;
  const { payment_intent_id } = req.body;

  if (!clientId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!payment_intent_id) {
    return res.status(400).json({ error: 'payment_intent_id is required' });
  }

  const dbClient = await pool.connect();
  try {
    // Get payment record
    const paymentRes = await dbClient.query(
      'SELECT * FROM payments WHERE paymongo_payment_intent_id = $1',
      [payment_intent_id]
    );

    if (!paymentRes.rows[0]) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = paymentRes.rows[0];

    if (String(payment.client_id) !== String(clientId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check PayMongo status
    const result = await paymongoRequest(`/payment_intents/${payment_intent_id}`, 'GET');
    const paymentIntent = result.data;
    const status = paymentIntent.attributes.status;

    if (status === 'succeeded' && payment.status !== 'succeeded') {
      await dbClient.query('BEGIN');

      // Update payment status
      await dbClient.query(
        `UPDATE payments
         SET status = 'succeeded',
             paid_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $1`,
        [payment.id]
      );

      // Update booking payment status
      await dbClient.query(
        `UPDATE bookings SET payment_status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id::text = $1`,
        [payment.booking_id]
      );

      // Credit provider wallet (to pending balance until service completion)
      const walletId = await ensureProviderWallet(String(payment.provider_id));

      // Lock wallet row to prevent race conditions with concurrent payments
      const walletLockRes = await dbClient.query(
        'SELECT id, pending_balance FROM wallets WHERE id::text = $1 FOR UPDATE',
        [walletId]
      );

      if (!walletLockRes.rows[0]) {
        await dbClient.query('ROLLBACK');
        return res.status(500).json({ error: 'Wallet not found' });
      }

      const currentPending = parseFloat(walletLockRes.rows[0].pending_balance) || 0;
      const newPending = currentPending + parseFloat(payment.net_provider_amount);

      // Add to pending balance
      await dbClient.query(
        `UPDATE wallets
         SET pending_balance = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $2`,
        [newPending, walletId]
      );

      // Use newly calculated balance for transaction record
      const walletRes = { rows: [{ pending_balance: newPending }] };

      // Record transaction
      await dbClient.query(
        `INSERT INTO transactions (wallet_id, payment_id, type, amount, balance_after, reference_id, description)
         VALUES ($1, $2, 'payment_received', $3, $4, $5, $6)`,
        [
          walletId,
          payment.id,
          payment.net_provider_amount,
          walletRes.rows[0].pending_balance,
          payment_intent_id,
          `Payment received for booking #${payment.booking_id} (after ${PLATFORM_COMMISSION_RATE * 100}% commission)`
        ]
      );

      await dbClient.query('COMMIT');

      // Notify provider of payment received
      try {
        const clientInfo = await pool.query('SELECT name FROM users WHERE id::text = $1', [payment.client_id]);
        const bookingInfo = await pool.query(
          `SELECT s.title FROM bookings b LEFT JOIN services s ON s.id::text = b.service_id::text WHERE b.id::text = $1`,
          [payment.booking_id]
        );
        const clientName = clientInfo.rows[0]?.name || 'Client';
        const serviceTitle = bookingInfo.rows[0]?.title || 'service';

        await notificationService.notifyPaymentReceived(
          String(payment.provider_id),
          String(payment.client_id),
          parseFloat(payment.net_provider_amount),
          clientName,
          String(payment.booking_id)
        );
      } catch (notifError) {
        console.error('Failed to send payment notification:', notifError);
      }
    } else if (status === 'failed') {
      await dbClient.query(
        `UPDATE payments
         SET status = 'failed',
             failure_reason = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $2`,
        [paymentIntent.attributes.last_payment_error?.message || 'Payment failed', payment.id]
      );

      await dbClient.query(
        `UPDATE bookings SET payment_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id::text = $1`,
        [payment.booking_id]
      );

      // Notify client of payment failure
      try {
        const bookingInfo = await pool.query(
          `SELECT s.title FROM bookings b LEFT JOIN services s ON s.id::text = b.service_id::text WHERE b.id::text = $1`,
          [payment.booking_id]
        );
        const serviceTitle = bookingInfo.rows[0]?.title || 'service';

        await notificationService.notifyPaymentFailed(
          String(payment.client_id),
          String(payment.provider_id),
          String(payment.booking_id),
          paymentIntent.attributes.last_payment_error?.message || 'Payment could not be processed'
        );
      } catch (notifError) {
        console.error('Failed to send payment failure notification:', notifError);
      }
    }

    return res.json({
      data: {
        payment_id: payment.id,
        status: status,
        paid_at: status === 'succeeded' ? new Date().toISOString() : null,
      }
    });
  } catch (error: any) {
    await dbClient.query('ROLLBACK');
    console.error('Error confirming payment:', error);
    return res.status(500).json({ error: 'Failed to confirm payment', detail: error.message });
  } finally {
    dbClient.release();
  }
});

// PayMongo Webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  const signature = req.headers['paymongo-signature'] as string;

  if (!signature || !PAYMONGO_WEBHOOK_SECRET) {
    console.log('Webhook: Missing signature or secret');
    return res.status(400).json({ error: 'Missing signature' });
  }

  // Verify webhook signature
  const payload = req.body.toString();
  const [timestampPart, signaturePart] = signature.split(',');
  const timestamp = timestampPart?.split('=')[1];
  const receivedSignature = signaturePart?.split('=')[1];

  if (!timestamp || !receivedSignature) {
    return res.status(400).json({ error: 'Invalid signature format' });
  }

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac('sha256', PAYMONGO_WEBHOOK_SECRET)
    .update(signedPayload)
    .digest('hex');

  if (receivedSignature !== expectedSignature) {
    console.log('Webhook: Signature mismatch');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const event = JSON.parse(payload);
  const eventType = event.data?.attributes?.type;
  const eventData = event.data?.attributes?.data;

  console.log('PayMongo webhook received:', eventType);

  const dbClient = await pool.connect();
  try {
    if (eventType === 'payment_intent.succeeded') {
      const paymentIntentId = eventData?.id;

      await dbClient.query('BEGIN');

      const paymentRes = await dbClient.query(
        'SELECT * FROM payments WHERE paymongo_payment_intent_id = $1',
        [paymentIntentId]
      );

      if (paymentRes.rows[0] && paymentRes.rows[0].status !== 'succeeded') {
        const payment = paymentRes.rows[0];

        // Update payment status
        await dbClient.query(
          `UPDATE payments
           SET status = 'succeeded',
               paid_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id::text = $1`,
          [payment.id]
        );

        // Update booking
        await dbClient.query(
          `UPDATE bookings SET payment_status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id::text = $1`,
          [payment.booking_id]
        );

        // Credit provider wallet
        const walletId = await ensureProviderWallet(String(payment.provider_id));

        await dbClient.query(
          `UPDATE wallets
           SET pending_balance = pending_balance + $1, updated_at = CURRENT_TIMESTAMP
           WHERE id::text = $2`,
          [payment.net_provider_amount, walletId]
        );

        const walletRes = await dbClient.query(
          'SELECT pending_balance FROM wallets WHERE id::text = $1',
          [walletId]
        );

        await dbClient.query(
          `INSERT INTO transactions (wallet_id, payment_id, type, amount, balance_after, reference_id, description)
           VALUES ($1, $2, 'payment_received', $3, $4, $5, $6)`,
          [
            walletId,
            payment.id,
            payment.net_provider_amount,
            walletRes.rows[0].pending_balance,
            paymentIntentId,
            `Payment received for booking #${payment.booking_id}`
          ]
        );

        // Notify provider of payment received (via webhook)
        try {
          const clientInfo = await dbClient.query('SELECT name FROM users WHERE id::text = $1', [payment.client_id]);
          const bookingInfo = await dbClient.query(
            `SELECT s.title FROM bookings b LEFT JOIN services s ON s.id::text = b.service_id::text WHERE b.id::text = $1`,
            [payment.booking_id]
          );
          const clientName = clientInfo.rows[0]?.name || 'Client';
          const serviceTitle = bookingInfo.rows[0]?.title || 'service';

          await notificationService.notifyPaymentReceived(
            String(payment.provider_id),
            String(payment.client_id),
            parseFloat(payment.net_provider_amount),
            clientName,
            String(payment.booking_id)
          );
        } catch (notifError) {
          console.error('Failed to send webhook payment notification:', notifError);
        }
      }

      await dbClient.query('COMMIT');
    } else if (eventType === 'payment_intent.failed') {
      const paymentIntentId = eventData?.id;

      // Get payment info before updating
      const paymentRes = await dbClient.query(
        'SELECT * FROM payments WHERE paymongo_payment_intent_id = $1',
        [paymentIntentId]
      );

      await dbClient.query(
        `UPDATE payments
         SET status = 'failed',
             failure_reason = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE paymongo_payment_intent_id = $2`,
        [eventData?.attributes?.last_payment_error?.message || 'Payment failed', paymentIntentId]
      );

      // Notify client of payment failure (via webhook)
      if (paymentRes.rows[0]) {
        const payment = paymentRes.rows[0];
        try {
          const bookingInfo = await dbClient.query(
            `SELECT s.title FROM bookings b LEFT JOIN services s ON s.id::text = b.service_id::text WHERE b.id::text = $1`,
            [payment.booking_id]
          );
          const serviceTitle = bookingInfo.rows[0]?.title || 'service';

          await notificationService.notifyPaymentFailed(
            String(payment.client_id),
            String(payment.provider_id),
            String(payment.booking_id),
            eventData?.attributes?.last_payment_error?.message || 'Payment could not be processed'
          );
        } catch (notifError) {
          console.error('Failed to send webhook payment failure notification:', notifError);
        }
      }
    }

    return res.json({ received: true });
  } catch (error: any) {
    await dbClient.query('ROLLBACK');
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  } finally {
    dbClient.release();
  }
});

// Get payment details
router.get('/:id', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const userId = req.userId;
  const paymentId = req.params.id;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const paymentRes = await pool.query(
      `SELECT p.*, b.start_date, b.end_date, s.title as service_title,
              u.name as provider_name
       FROM payments p
       JOIN bookings b ON b.id::text = p.booking_id::text
       LEFT JOIN services s ON s.id::text = b.service_id::text
       LEFT JOIN users u ON u.id::text = p.provider_id::text
       WHERE p.id::text = $1`,
      [paymentId]
    );

    if (!paymentRes.rows[0]) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = paymentRes.rows[0];

    // Check access
    if (String(payment.client_id) !== userId && String(payment.provider_id) !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.json({ data: payment });
  } catch (error: any) {
    console.error('Error fetching payment:', error);
    return res.status(500).json({ error: 'Failed to fetch payment' });
  }
});

// Get payment for a booking
router.get('/booking/:bookingId', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const userId = req.userId;
  const bookingId = req.params.bookingId;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const paymentRes = await pool.query(
      `SELECT p.*, b.start_date, b.end_date, s.title as service_title
       FROM payments p
       JOIN bookings b ON b.id::text = p.booking_id::text
       LEFT JOIN services s ON s.id::text = b.service_id::text
       WHERE p.booking_id::text = $1`,
      [bookingId]
    );

    if (!paymentRes.rows[0]) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = paymentRes.rows[0];

    // Check access
    if (String(payment.client_id) !== userId && String(payment.provider_id) !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.json({ data: payment });
  } catch (error: any) {
    console.error('Error fetching payment:', error);
    return res.status(500).json({ error: 'Failed to fetch payment' });
  }
});

// Get client's payment history
router.get('/client/history', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const clientId = req.userId;

  if (!clientId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const paymentsRes = await pool.query(
      `SELECT p.*, s.title as service_title, u.name as provider_name
       FROM payments p
       JOIN bookings b ON b.id::text = p.booking_id::text
       LEFT JOIN services s ON s.id::text = b.service_id::text
       LEFT JOIN users u ON u.id::text = p.provider_id::text
       WHERE p.client_id::text = $1
       ORDER BY p.created_at DESC`,
      [clientId]
    );

    return res.json({ data: paymentsRes.rows });
  } catch (error: any) {
    console.error('Error fetching payment history:', error);
    return res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});

export default router;
