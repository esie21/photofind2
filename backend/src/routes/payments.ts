import express, { Request, Response } from 'express';
import { pool } from '../config/database';
import { verifyToken } from '../middleware/auth';
import crypto from 'crypto';
import { notificationService } from '../services/notificationService';
import { settlePaymentSuccess } from '../services/walletService';
import { paymongoRequest, PayMongoResponse } from '../services/paymongoService';
import { PLATFORM_COMMISSION_RATE } from '../config/commissionConfig';
import { isPriceAcceptable } from '../config/pricingConfig';

const router = express.Router();

// PayMongo API configuration
const PAYMONGO_PUBLIC_KEY = process.env.PAYMONGO_PUBLIC_KEY || '';
const PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET || '';

// Commission rate - shared with bookings.ts price validation, see commissionConfig.ts

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

    // Payment only opens once the provider has accepted. Every booking starts as
    // 'pending' now, so this is what actually enforces "pay after confirmation" -
    // hiding the button in the UI alone would leave the endpoint open. It also
    // closes an existing hole: without a status check a client could pay for a
    // booking that was already cancelled or rejected, putting money into escrow
    // for work nobody is going to do.
    const bookingStatus = String(booking.status);
    if (!['accepted', 'confirmed'].includes(bookingStatus)) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({
        error: bookingStatus === 'pending'
          ? 'This booking is still waiting for the provider to confirm it.'
          : `Cannot pay for a ${bookingStatus} booking`,
      });
    }

    // The payment window closes even if the sweep that cancels expired bookings hasn't
    // run yet, so the deadline is honoured to the minute. Without this a client could pay
    // for a slot that finished days ago and expect the provider to honour it.
    if (booking.payment_due_at && new Date(booking.payment_due_at) < new Date()) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({
        error: 'The payment window for this booking has closed and the slot has been released. Please book again.',
        payment_window_closed: true,
        payment_due_at: booking.payment_due_at,
      });
    }

    // Re-check the stored price against the floor it was judged against when the
    // booking was created.
    //
    // This endpoint takes no client-supplied price - booking_id is the only input - so
    // this is defence in depth against a total_price that reached the row by some route
    // other than POST /bookings' validation. It deliberately compares against the
    // stored min_price_at_booking rather than re-deriving a minimum from the service
    // as it stands now: an earlier version compared against the flat, unscaled
    // services.price, which rejected every hourly booking legitimately shorter than one
    // full unit, and any re-derivation would also start rejecting honest bookings the
    // moment a provider edited their rates. Rows created before that column existed
    // carry NULL and are covered by the > 0 check alone.
    const bookingPrice = parseFloat(booking.total_price || 0);
    if (bookingPrice <= 0) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'This booking has no valid price to charge.' });
    }

    const minAtBooking = booking.min_price_at_booking === null || booking.min_price_at_booking === undefined
      ? null
      : parseFloat(booking.min_price_at_booking);
    if (minAtBooking !== null && !isNaN(minAtBooking) && !isPriceAcceptable(bookingPrice, minAtBooking)) {
      await dbClient.query('ROLLBACK');
      console.error(
        `Refusing payment intent for booking ${booking_id}: stored total_price ${bookingPrice} is below its own recorded minimum ${minAtBooking}`
      );
      return res.status(400).json({ error: 'This booking has no valid price to charge.' });
    }

    // A booking can accumulate several payment rows - a new one is inserted below
    // whenever the previous attempt ended 'failed'. So "has this already been paid?"
    // has to be asked of ALL of them, not of whichever row Postgres happens to return
    // first: reading rows[0] from an unordered query could hand back the failed
    // attempt, fall through both guards, and let the client be charged a second time.
    const settledPayment = await dbClient.query(
      `SELECT id, paid_at FROM payments WHERE booking_id::text = $1 AND status = 'succeeded' LIMIT 1`,
      [booking_id]
    );
    if (settledPayment.rows[0]) {
      await dbClient.query('ROLLBACK');
      // 409, not 400: nothing about the request is malformed - the client is asking to pay
      // for something that is already paid, which usually means its booking list is stale.
      // The flag lets the UI say so and refresh, instead of rendering this as a payment
      // failure and leaving the client convinced their money didn't arrive.
      return res.status(409).json({
        error: 'This booking has already been paid.',
        already_paid: true,
        payment_id: settledPayment.rows[0].id,
        paid_at: settledPayment.rows[0].paid_at,
      });
    }

    // Otherwise reuse the most recent still-open attempt, if there is one.
    const openPayment = await dbClient.query(
      `SELECT * FROM payments
       WHERE booking_id::text = $1 AND status IN ('pending', 'processing')
       ORDER BY created_at DESC
       LIMIT 1`,
      [booking_id]
    );

    if (openPayment.rows[0]) {
      const payment = openPayment.rows[0];
      await dbClient.query('ROLLBACK');
      // Must return the same shape as the fresh-intent response below. PaymentSummary
      // authenticates to PayMongo with `btoa(public_key + ':')`, so omitting public_key
      // here made every retry send "Basic undefined:" and fail with a 401 - once a
      // client closed the payment modal they could never pay for that booking again.
      const reusedGross = parseFloat(payment.gross_amount);
      return res.json({
        data: {
          payment_id: payment.id,
          payment_intent_id: payment.paymongo_payment_intent_id,
          client_key: payment.paymongo_client_key,
          amount: reusedGross,
          commission: parseFloat(payment.commission_amount),
          provider_amount: parseFloat(payment.net_provider_amount),
          status: payment.status,
          public_key: PAYMONGO_PUBLIC_KEY,
        }
      });
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
    const paymentRecord = paymentRes.rows[0];

    // Re-check the booking here too, not just at create-intent. An intent obtained
    // while the booking was accepted stays attachable afterwards, so without this a
    // client could capture money into escrow for a booking that has since been
    // cancelled or rejected.
    const attachBookingRes = await pool.query(
      'SELECT status, payment_due_at FROM bookings WHERE id::text = $1',
      [String(paymentRecord.booking_id)]
    );
    const attachBookingStatus = String(attachBookingRes.rows[0]?.status || '');
    if (!['accepted', 'confirmed'].includes(attachBookingStatus)) {
      return res.status(400).json({
        error: attachBookingStatus === 'pending'
          ? 'This booking is still waiting for the provider to confirm it.'
          : `Cannot pay for a ${attachBookingStatus || 'missing'} booking`,
      });
    }

    // Re-checked here as well as at create-intent: an intent obtained just before the
    // deadline stays attachable afterwards otherwise.
    const attachDueAt = attachBookingRes.rows[0]?.payment_due_at;
    if (attachDueAt && new Date(attachDueAt) < new Date()) {
      return res.status(400).json({
        error: 'The payment window for this booking has closed and the slot has been released.',
        payment_window_closed: true,
      });
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
    const capturedPaymentId = updatedIntent.attributes.payments?.[0]?.id || null;
    const newStatus = updatedIntent.attributes.status === 'succeeded' ? 'succeeded' : 'processing';

    // A card without 3D Secure can resolve to 'succeeded' right here, synchronously -
    // wrap the status update and settlement in a transaction so both land atomically.
    const dbClient = await pool.connect();
    let settleResult: Awaited<ReturnType<typeof settlePaymentSuccess>> = { settled: false, creditedAmount: 0 };
    try {
      await dbClient.query('BEGIN');

      await dbClient.query(
        `UPDATE payments
         SET paymongo_payment_method_id = $1,
             payment_method_type = $2,
             status = $3,
             paymongo_payment_id = COALESCE($5, paymongo_payment_id),
             paid_at = CASE WHEN $3::varchar = 'succeeded' THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END,
             updated_at = CURRENT_TIMESTAMP
         WHERE paymongo_payment_intent_id = $4`,
        [
          payment_method_id,
          updatedIntent.attributes.payment_method_type || 'card',
          newStatus,
          payment_intent_id,
          capturedPaymentId
        ]
      );

      if (newStatus === 'succeeded') {
        settleResult = await settlePaymentSuccess(dbClient, String(paymentRecord.id));
      }

      await dbClient.query('COMMIT');
    } catch (txError) {
      await dbClient.query('ROLLBACK');
      throw txError;
    } finally {
      dbClient.release();
    }

    if (settleResult.settled) {
      try {
        const clientInfo = await pool.query('SELECT name FROM users WHERE id::text = $1', [settleResult.clientId]);
        await notificationService.notifyPaymentReceived(
          String(settleResult.providerId),
          String(settleResult.clientId),
          settleResult.creditedAmount,
          clientInfo.rows[0]?.name || 'Client',
          String(settleResult.bookingId)
        );
      } catch (notifError) {
        console.error('Failed to send payment notification (attach-method):', notifError);
      }
    }

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

    if (status === 'succeeded') {
      await dbClient.query('BEGIN');

      // Re-fetch and lock the payment row. attach-method (for cards that don't need
      // 3D Secure) or the webhook may already have marked this 'succeeded' - the
      // status update below is an idempotent no-op in that case, and
      // settlePaymentSuccess's own atomic claim (not this row lock) is what actually
      // prevents crediting the wallet twice across all three paths.
      const lockedRes = await dbClient.query(
        'SELECT * FROM payments WHERE id::text = $1 FOR UPDATE',
        [payment.id]
      );
      const lockedPayment = lockedRes.rows[0];
      const capturedPaymentId = paymentIntent.attributes.payments?.[0]?.id || null;

      await dbClient.query(
        `UPDATE payments
         SET status = 'succeeded',
             paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
             paymongo_payment_id = COALESCE($2, paymongo_payment_id),
             updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $1`,
        [lockedPayment.id, capturedPaymentId]
      );

      const settleResult = await settlePaymentSuccess(dbClient, String(lockedPayment.id));

      await dbClient.query('COMMIT');

      if (settleResult.settled) {
        try {
          const clientInfo = await pool.query('SELECT name FROM users WHERE id::text = $1', [settleResult.clientId]);
          await notificationService.notifyPaymentReceived(
            String(settleResult.providerId),
            String(settleResult.clientId),
            settleResult.creditedAmount,
            clientInfo.rows[0]?.name || 'Client',
            String(settleResult.bookingId)
          );
        } catch (notifError) {
          console.error('Failed to send payment notification:', notifError);
        }
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

      // Lock the payment row - attach-method (for cards that don't need 3D Secure) or
      // the client's /confirm call may already have marked this 'succeeded'. The
      // status update below is an idempotent no-op in that case; settlePaymentSuccess's
      // own atomic claim is what actually prevents crediting the wallet twice.
      const paymentRes = await dbClient.query(
        'SELECT * FROM payments WHERE paymongo_payment_intent_id = $1 FOR UPDATE',
        [paymentIntentId]
      );

      let settleResult: { settled: boolean; creditedAmount: number; bookingId?: string; providerId?: string; clientId?: string } = { settled: false, creditedAmount: 0 };

      if (paymentRes.rows[0]) {
        const payment = paymentRes.rows[0];
        const capturedPaymentId = eventData?.attributes?.payments?.[0]?.id || null;

        await dbClient.query(
          `UPDATE payments
           SET status = 'succeeded',
               paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
               paymongo_payment_id = COALESCE($2, paymongo_payment_id),
               updated_at = CURRENT_TIMESTAMP
           WHERE id::text = $1`,
          [payment.id, capturedPaymentId]
        );

        settleResult = await settlePaymentSuccess(dbClient, String(payment.id));
      }

      await dbClient.query('COMMIT');

      if (settleResult.settled) {
        try {
          const clientInfo = await pool.query('SELECT name FROM users WHERE id::text = $1', [settleResult.clientId]);
          await notificationService.notifyPaymentReceived(
            String(settleResult.providerId),
            String(settleResult.clientId),
            settleResult.creditedAmount,
            clientInfo.rows[0]?.name || 'Client',
            String(settleResult.bookingId)
          );
        } catch (notifError) {
          console.error('Failed to send webhook payment notification:', notifError);
        }
      }
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
