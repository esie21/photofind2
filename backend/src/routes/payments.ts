import express, { Request, Response } from 'express';
import { pool } from '../config/database';
import { verifyToken } from '../middleware/auth';
import crypto from 'crypto';
import { notificationService } from '../services/notificationService';
import { settlePaymentSuccess } from '../services/walletService';
import { paymongoRequest, PayMongoResponse } from '../services/paymongoService';
import { PLATFORM_COMMISSION_RATE } from '../config/commissionConfig';
import { isPriceAcceptable } from '../config/pricingConfig';
import { allowedPaymentMethods, QRPH_ENABLED, QRPH_EXPIRY_SECONDS } from '../config/paymentConfig';

const router = express.Router();

// PayMongo API configuration
const PAYMONGO_PUBLIC_KEY = process.env.PAYMONGO_PUBLIC_KEY || '';
const PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET || '';

// Commission rate - shared with bookings.ts price validation, see commissionConfig.ts

// Idempotency key for a payment attempt.
//
// Deterministic per (booking, client, attempt), so a double-submitted request for the
// same attempt makes PayMongo return the intent it already created instead of opening a
// second one. The attempt number is what makes a genuine retry different: after a failed
// attempt the client needs a NEW intent, and reusing the first key would hand back the
// one that just failed. Attempt 1 keeps the original key shape so rows written before
// retries were possible keep matching their own PayMongo intent.
function generateIdempotencyKey(bookingId: string, clientId: string, attempt: number): string {
  const base = `payment_${bookingId}_${clientId}`;
  return attempt <= 1 ? base : `${base}_r${attempt}`;
}

// Which payment intent a `payment.paid` event is talking about.
//
// The two success events are shaped differently, and mixing them up is silent money loss.
// For payment_intent.succeeded, eventData.id IS the intent (pi_...) and the payment id is
// under attributes.payments[]. For payment.paid, eventData.id is the PAYMENT (pay_...) and
// the intent is a field on it. Reading eventData.id as an intent id for payment.paid would
// match no row, and the handler would no-op on a payment that really happened.
//
// The metadata fallback is ours, not PayMongo's: create-intent stamps booking_id into the
// intent's metadata, and PayMongo copies intent metadata onto the payment. So if the field
// name ever moves we can still find the booking. Worth the few lines - the alternative
// failure is a client who paid, a provider who was never credited, and nothing in the
// database explaining why.
function resolveIntentRef(eventData: any): { intentId: string | null; bookingId: string | null } {
  const attrs = eventData?.attributes || {};
  const candidates = [
    attrs.payment_intent_id,
    attrs.payment_intent?.id,
    attrs.payment_intent,
    // qrph.expired's documented payload shape could not be confirmed (PayMongo's own
    // reference pages for it 404 as of 2026-09-28), so accept the object itself being the
    // intent. The pi_ prefix check is what keeps that from mistaking a payment or a
    // payment-method id for an intent id and updating nothing while reporting success.
    typeof eventData?.id === 'string' && eventData.id.startsWith('pi_') ? eventData.id : null,
  ];
  const intentId = candidates.find((c) => typeof c === 'string' && c.length > 0) || null;
  const bookingId = attrs.metadata?.booking_id != null ? String(attrs.metadata.booking_id) : null;
  return { intentId: (intentId as string) || null, bookingId };
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

    // Get booking details with provider's user_id and service price.
    //
    // FOR UPDATE OF b serialises this endpoint per booking. Without it two calls - a
    // double-clicked Pay button, or the page and a retry racing - could both read the
    // same state, both find no open attempt and both open a PayMongo intent. The
    // idempotency key stops that becoming two charges, but only when both calls derive
    // the same attempt number, which they can only do if they don't overlap.
    const bookingRes = await dbClient.query(
      `SELECT b.*, s.title as service_title, s.price as service_price, p.user_id as provider_user_id
       FROM bookings b
       LEFT JOIN services s ON s.id::text = b.service_id::text
       LEFT JOIN providers p ON p.id::text = b.provider_id::text
       WHERE b.id::text = $1
       FOR UPDATE OF b`,
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
    // A cash booking has no online payment to make. Without this the client could pay
    // by card here AND hand over cash on the day, and the provider - who has no way of
    // knowing an online payment landed for a booking marked 'cash' - would be paid
    // twice for one shoot. Switching method after the fact is deliberately not
    // supported: it would need the provider's agreement, not just the client's.
    if (String(booking.payment_method || 'online') === 'cash') {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({
        error: 'This booking is set to be paid in cash on the day, so there is nothing to pay online.',
        payment_method: 'cash',
      });
    }

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

    // Everything this booking has ever tried to pay with, locked for the rest of the
    // transaction so two create-intent calls for the same booking can't both decide they
    // are the first one. `unique_booking_payment` means there is at most one row today;
    // the ordering makes the choice below deterministic either way rather than depending
    // on a schema constraint holding.
    const existingPayments = await dbClient.query(
      `SELECT * FROM payments
       WHERE booking_id::text = $1
       ORDER BY CASE status WHEN 'succeeded' THEN 0 ELSE 1 END, created_at DESC
       FOR UPDATE`,
      [booking_id]
    );

    const settledPayment = existingPayments.rows.find((p: any) => String(p.status) === 'succeeded');
    if (settledPayment) {
      await dbClient.query('ROLLBACK');
      // 409, not 400: nothing about the request is malformed - the client is asking to pay
      // for something that is already paid, which usually means its booking list is stale.
      // The flag lets the UI say so and refresh, instead of rendering this as a payment
      // failure and leaving the client convinced their money didn't arrive.
      return res.status(409).json({
        error: 'This booking has already been paid.',
        already_paid: true,
        payment_id: settledPayment.id,
        paid_at: settledPayment.paid_at,
      });
    }

    // Money that has already been sent back cannot be re-collected against the same row -
    // the refund bookkeeping on it would be overwritten and the ledger would stop
    // explaining itself. This only happens on a booking whose dispute was resolved with a
    // refund, which is not a booking anyone should be paying for again anyway.
    const refundedPayment = existingPayments.rows.find((p: any) =>
      ['refunded', 'partially_refunded'].includes(String(p.status))
    );
    if (refundedPayment) {
      await dbClient.query('ROLLBACK');
      return res.status(409).json({
        error: 'This booking has already been refunded and cannot be paid for again. Please make a new booking.',
        already_refunded: true,
      });
    }

    // Reuse a still-open attempt rather than opening a second one.
    const openPayment = existingPayments.rows.find((p: any) =>
      ['pending', 'processing'].includes(String(p.status))
    );

    if (openPayment) {
      // Rows written before paymongo_client_key existed have none stored, and the client
      // key is what PaymentSummary needs to attach a payment method - without it the
      // reopened modal renders a form that can never be submitted. Read it back off the
      // intent and keep it, so this heals once per row instead of on every reopen.
      let clientKey = openPayment.paymongo_client_key || null;

      // Which methods THIS intent was opened with - not necessarily what the config offers
      // now. An intent created before PAYMONGO_QRPH_ENABLED was flipped keeps the list it
      // was created with, and PayMongo will refuse a method that is not on it. Telling the
      // client the current config instead would offer them a method this intent cannot
      // accept, and since create-intent resumes rather than replaces an open payment, the
      // retry would land right back here - a client permanently unable to pay.
      let resumeMethods: string[] | null = null;

      // Now fetched whenever an intent is resumed, not only when the client key is missing:
      // the allowed list has to come from the intent itself. One extra call on reopening a
      // payment, which is a deliberate user action rather than a hot path.
      if (openPayment.paymongo_payment_intent_id) {
        try {
          const intentRes = await paymongoRequest(
            `/payment_intents/${openPayment.paymongo_payment_intent_id}`,
            'GET'
          );
          const attrs = intentRes.data.attributes;
          const allowed = (attrs as { payment_method_allowed?: unknown }).payment_method_allowed;
          if (Array.isArray(allowed) && allowed.length > 0) {
            resumeMethods = allowed.map(String);
          }
          if (!clientKey) {
            clientKey = attrs.client_key || null;
            if (clientKey) {
              await dbClient.query(
                `UPDATE payments SET paymongo_client_key = $2, updated_at = CURRENT_TIMESTAMP WHERE id::text = $1`,
                [String(openPayment.id), clientKey]
              );
            }
          }
        } catch (lookupError: any) {
          console.error('Could not read the payment intent back:', lookupError?.message);
        }
      }

      if (!clientKey) {
        await dbClient.query('ROLLBACK');
        return res.status(502).json({
          error: 'Could not resume the existing payment for this booking. Please try again in a moment.',
        });
      }

      await dbClient.query('COMMIT');
      // Must return the same shape as the fresh-intent response below. PaymentSummary
      // authenticates to PayMongo with `btoa(public_key + ':')`, so omitting public_key
      // here made every retry send "Basic undefined:" and fail with a 401 - once a
      // client closed the payment modal they could never pay for that booking again.
      return res.json({
        data: {
          payment_id: openPayment.id,
          payment_intent_id: openPayment.paymongo_payment_intent_id,
          client_key: clientKey,
          amount: parseFloat(openPayment.gross_amount),
          commission: parseFloat(openPayment.commission_amount),
          provider_amount: parseFloat(openPayment.net_provider_amount),
          status: openPayment.status,
          public_key: PAYMONGO_PUBLIC_KEY,
          // What the CLIENT may render a control for. The intent's own list when we could
          // read it, the current config otherwise.
          payment_methods: resumeMethods || allowedPaymentMethods(),
        }
      });
    }

    // Whatever is left is a dead attempt - 'failed', or 'cancelled' by the expiry sweep.
    // Its row is the one that gets reused; see the note on payments.attempt_count.
    const deadAttempt = existingPayments.rows[0] || null;

    // Calculate amounts
    const grossAmount = parseFloat(booking.total_price || 0);
    if (grossAmount <= 0) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid booking amount' });
    }

    const commissionAmount = Math.round(grossAmount * PLATFORM_COMMISSION_RATE * 100) / 100;
    const netProviderAmount = Math.round((grossAmount - commissionAmount) * 100) / 100;

    // Generate idempotency key for this attempt
    const attemptNumber = deadAttempt ? (parseInt(deadAttempt.attempt_count, 10) || 1) + 1 : 1;
    const idempotencyKey = generateIdempotencyKey(booking_id, clientId, attemptNumber);

    // Create PayMongo Payment Intent
    // Amount in PayMongo is in cents (smallest currency unit)
    const amountInCents = Math.round(grossAmount * 100);

    let paymentIntentData;
    try {
      paymentIntentData = await paymongoRequest('/payment_intents', 'POST', {
        data: {
          attributes: {
            amount: amountInCents,
            // Includes 'qrph' unless PAYMONGO_QRPH_ENABLED=false - see paymentConfig.ts
            // for why that switch exists.
            payment_method_allowed: allowedPaymentMethods(),
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

    // Store payment record (use provider_user_id which references users table).
    //
    // A booking gets one payments row for its whole life: `unique_booking_payment` and the
    // UNIQUE on idempotency_key both say so. A retry after a declined card therefore has to
    // update that row rather than insert beside it - the old code inserted, violated both
    // constraints and returned 500, which is why a client who was declined once could never
    // pay for that booking again. The refund columns are deliberately left alone: nothing
    // reaches here with a refund recorded (that is a 409 above), so there is nothing to
    // clear, and blanking them blind would erase history if that ever stopped being true.
    const providerUserId = booking.provider_user_id || booking.provider_id;
    const paymentRes = deadAttempt
      ? await dbClient.query(
          `UPDATE payments
           SET client_id = $2,
               provider_id = $3,
               paymongo_payment_intent_id = $4,
               paymongo_client_key = $5,
               idempotency_key = $6,
               gross_amount = $7,
               commission_rate = $8,
               commission_amount = $9,
               net_provider_amount = $10,
               status = 'pending',
               attempt_count = $11,
               failure_reason = NULL,
               paymongo_payment_method_id = NULL,
               payment_method_type = NULL,
               paid_at = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id::text = $1
           RETURNING *`,
          [
            String(deadAttempt.id),
            clientId,
            providerUserId,
            paymentIntent.id,
            paymentIntent.attributes.client_key || null,
            idempotencyKey,
            grossAmount,
            PLATFORM_COMMISSION_RATE,
            commissionAmount,
            netProviderAmount,
            attemptNumber,
          ]
        )
      : await dbClient.query(
          `INSERT INTO payments (
            booking_id, client_id, provider_id,
            paymongo_payment_intent_id, paymongo_client_key, idempotency_key,
            gross_amount, commission_rate, commission_amount, net_provider_amount,
            status, attempt_count
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)
          RETURNING *`,
          [
            booking_id,
            clientId,
            providerUserId,
            paymentIntent.id,
            paymentIntent.attributes.client_key || null,
            idempotencyKey,
            grossAmount,
            PLATFORM_COMMISSION_RATE,
            commissionAmount,
            netProviderAmount,
            attemptNumber,
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
        // The UI renders whatever is in here and nothing else, so the server stays the one
        // place that decides which methods exist.
        payment_methods: allowedPaymentMethods(),
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
  // Two shapes. `payment_method_id` is the card path: the browser creates the payment
  // method directly against PayMongo with the public key, because raw card numbers must
  // never reach this server. `method: 'qrph'` is the opposite - a QR Ph method carries no
  // sensitive input at all, so it is minted here instead, which keeps expiry_seconds under
  // server control rather than letting a caller ask for a 9000-second code.
  const { payment_intent_id, payment_method_id, method } = req.body;
  const wantsQrph = method === 'qrph';

  if (!clientId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!payment_intent_id || (!payment_method_id && !wantsQrph)) {
    return res.status(400).json({
      error: "payment_intent_id is required, with either payment_method_id or method: 'qrph'",
    });
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

    // Mint the QR Ph method now that the booking, ownership and deadline checks above have
    // passed - creating it earlier would leave an orphan method behind on every refusal.
    let attachMethodId: string = payment_method_id;
    if (wantsQrph) {
      if (!QRPH_ENABLED) {
        // 503, not 400: the request is perfectly valid, the capability is switched off.
        return res.status(503).json({
          error: 'QR Ph is not available right now. Please pay by card instead.',
          qrph_unavailable: true,
        });
      }
      const qrphMethod = await paymongoRequest('/payment_methods', 'POST', {
        data: {
          attributes: {
            type: 'qrph',
            expiry_seconds: QRPH_EXPIRY_SECONDS,
          }
        }
      });
      attachMethodId = qrphMethod.data.id;
    }

    // Attach payment method to intent
    const result = await paymongoRequest(`/payment_intents/${payment_intent_id}/attach`, 'POST', {
      data: {
        attributes: {
          payment_method: attachMethodId,
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
          attachMethodId,
          // The `|| 'card'` default predates there being any other method, and would have
          // filed every QR Ph payment in the books as a card payment. Card behaviour is
          // unchanged; only the fallback for a qrph attach is different.
          updatedIntent.attributes.payment_method_type || (wantsQrph ? 'qrph' : 'card'),
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

    // PayMongo's own expiry, when it sends one. Test mode confirmed it does:
    // next_action.code.expires_at, RFC3339. Preferred over computing now + expiry_seconds,
    // which was only ever an estimate of a clock PayMongo starts on its own side - the two
    // drift by however long the attach round-trip took.
    //
    // Normalised through Date so the nanosecond precision PayMongo emits
    // ("...:06.142489286Z") reaches the browser as ordinary milliseconds, and so a
    // malformed value falls back rather than becoming a NaN countdown.
    //
    // Still only a countdown hint: the authority on an expired code is the qrph.expired
    // webhook and the awaiting_payment_method branch of /confirm, never this timestamp.
    let qrExpiresAt: string | null = null;
    if (wantsQrph) {
      const reported = updatedIntent.attributes.next_action?.code?.expires_at;
      const reportedMs = reported ? new Date(reported).getTime() : NaN;
      qrExpiresAt = Number.isFinite(reportedMs)
        ? new Date(reportedMs).toISOString()
        : new Date(Date.now() + QRPH_EXPIRY_SECONDS * 1000).toISOString();
    }

    return res.json({
      data: {
        status: updatedIntent.attributes.status,
        next_action: updatedIntent.attributes.next_action,
        qr_expires_at: qrExpiresAt,
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
    } else if (status === 'awaiting_payment_method') {
      // The intent has no usable method on it any more: a QR Ph code that expired
      // unscanned, or a method PayMongo rejected. The INTENT is still fine, so this is a
      // reopen, not a failure - see the qrph.expired note in the webhook handler for why
      // 'pending' and not 'failed'.
      //
      // This branch is the safety net that needs no webhook at all. The client is already
      // polling /confirm while a QR is on screen, so an expiry is noticed here even if the
      // webhook never arrives, is misconfigured, or carries a payload we could not map.
      // It also covers a card whose 3D Secure was abandoned, which previously left the row
      // stuck at 'processing' with a dead payment method id attached to it.
      const reopened = await dbClient.query(
        `UPDATE payments
         SET status = 'pending',
             paymongo_payment_method_id = NULL,
             payment_method_type = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $1
           AND status = 'processing'
         RETURNING id`,
        [payment.id]
      );

      if ((reopened.rowCount ?? 0) > 0) {
        console.log(`Payment ${payment.id} reopened for retry - intent is awaiting a payment method.`);
      }
    } else if (status === 'failed') {
      // Guarded the same way as the webhook's failed branch: this row may already have
      // settled via attach-method or the webhook while this request was in flight, and a
      // payment that has been credited to a provider's wallet must not be walked back to
      // 'failed' here. See the longer note in the webhook handler.
      const failedUpdate = await dbClient.query(
        `UPDATE payments
         SET status = 'failed',
             failure_reason = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $2
           AND status <> 'succeeded'
         RETURNING id`,
        [paymentIntent.attributes.last_payment_error?.message || 'Payment failed', payment.id]
      );
      // pg types rowCount as number | null; null means "no count available", which for
      // an UPDATE ... RETURNING is indistinguishable from nothing having matched.
      const failedRowCount = failedUpdate.rowCount ?? 0;

      // The booking is only marked unpaid if this attempt really is the booking's current
      // state. A booking can carry several payment rows - a fresh one is inserted for each
      // retry after a failure - so an older attempt reporting failure must not overwrite
      // payment_status for a booking a later attempt already paid for.
      if (failedRowCount > 0) {
        await dbClient.query(
          `UPDATE bookings b
           SET payment_status = 'failed', updated_at = CURRENT_TIMESTAMP
           WHERE b.id::text = $1
             AND NOT EXISTS (
               SELECT 1 FROM payments p
               WHERE p.booking_id::text = b.id::text AND p.status = 'succeeded'
             )`,
          [payment.booking_id]
        );
      }

      // Notify client of payment failure - only if the row actually moved to 'failed'.
      if (failedRowCount > 0) {
        try {
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
    }

    return res.json({
      data: {
        payment_id: payment.id,
        status: status,
        paid_at: status === 'succeeded' ? new Date().toISOString() : null,
      }
    });
  } catch (error: any) {
    // Only the succeeded path opens a transaction here; every other route through this
    // handler (a 404, a 403, a still-pending intent, a failed one) never issues BEGIN. A
    // throwing ROLLBACK would then mask the actual error with an unrelated one.
    try {
      await dbClient.query('ROLLBACK');
    } catch (_rollbackError) {
      /* no transaction was open */
    }
    console.error('Error confirming payment:', error);
    return res.status(500).json({ error: 'Failed to confirm payment', detail: error.message });
  } finally {
    dbClient.release();
  }
});

// PayMongo Webhook handler
// How far out of date a webhook's own timestamp may be before it is refused. A valid
// signature stays valid forever on its own, so without this anyone who ever observed one
// delivery could replay it later; PayMongo retries a failed delivery for a while, so the
// window has to be generous enough not to reject an honest retry.
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 15 * 60;

// Compares two hex digests without leaking, through timing, how far along they matched.
function signaturesMatch(received: string, expected: string): boolean {
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws outright on a length mismatch, which would 500 instead of 400.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// The raw body parser is mounted in server.ts, ahead of express.json - see the comment
// there. Leaving express.raw here too is harmless (it no-ops once the body is parsed) and
// keeps the route's requirement visible at the route itself.
router.post('/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  const signature = req.headers['paymongo-signature'] as string;

  if (!signature || !PAYMONGO_WEBHOOK_SECRET) {
    console.log('Webhook: Missing signature or secret');
    return res.status(400).json({ error: 'Missing signature' });
  }

  // If this is not a Buffer, some middleware parsed the body before we got here and the
  // exact bytes PayMongo signed are gone. Say so, rather than hashing "[object Object]"
  // and reporting it as a signature mismatch - that misdirection is what hid this for so
  // long, since a misconfigured parser and a forged request looked identical from here.
  if (!Buffer.isBuffer(req.body)) {
    console.error(
      'Webhook: body was already parsed before reaching this route, so the raw bytes the ' +
      'signature covers are unavailable. Check that express.raw for /api/payments/webhook ' +
      'is still mounted before express.json in server.ts.'
    );
    return res.status(500).json({ error: 'Webhook misconfigured' });
  }

  // Verify webhook signature.
  //
  // The header is a comma-separated list of key=value pairs: `t=<unix>,te=<test sig>,
  // li=<live sig>`. This used to read the second pair positionally and treat it as "the"
  // signature, which only works in test mode - in live mode `te` is empty and the real
  // digest is in `li`, so every live webhook failed the format check. Parse by name and
  // accept whichever digest is actually populated.
  const payload = req.body.toString('utf8');
  const signatureParts = new Map<string, string>();
  for (const part of signature.split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) signatureParts.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }

  const timestamp = signatureParts.get('t');
  const candidateSignatures = [signatureParts.get('li'), signatureParts.get('te')].filter(
    (s): s is string => Boolean(s)
  );

  if (!timestamp || candidateSignatures.length === 0) {
    return res.status(400).json({ error: 'Invalid signature format' });
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return res.status(400).json({ error: 'Invalid signature format' });
  }

  const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (ageSeconds > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
    console.warn(`Webhook: rejected, timestamp is ${Math.round(ageSeconds)}s out of date`);
    return res.status(400).json({ error: 'Signature timestamp out of range' });
  }

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac('sha256', PAYMONGO_WEBHOOK_SECRET)
    .update(signedPayload)
    .digest('hex');

  if (!candidateSignatures.some((candidate) => signaturesMatch(candidate, expectedSignature))) {
    console.log('Webhook: Signature mismatch');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const event = JSON.parse(payload);
  const eventType = event.data?.attributes?.type;
  const eventData = event.data?.attributes?.data;

  console.log('PayMongo webhook received:', eventType);

  const dbClient = await pool.connect();
  try {
    // QR Ph confirms as `payment.paid`, not `payment_intent.succeeded`. Both are handled
    // here, and handling both is safe rather than merely tolerable: settlePaymentSuccess
    // claims the row with `wallet_credited_at IS NULL`, so if PayMongo sends both for the
    // same payment the second one credits nothing. Handling only one of them was the real
    // risk - a scanned, paid QR that nothing ever recorded.
    if (eventType === 'payment_intent.succeeded' || eventType === 'payment.paid') {
      const isPaymentEvent = eventType === 'payment.paid';
      const fromPaymentEvent = isPaymentEvent
        ? resolveIntentRef(eventData)
        : { intentId: null, bookingId: null };

      let paymentIntentId = isPaymentEvent ? fromPaymentEvent.intentId : eventData?.id;

      // Fall back to the booking stamped in our own metadata. Restricted to rows that are
      // still open: a booking with a settled payment must not be re-resolved by a stray
      // event, and 'succeeded' is excluded rather than relied on being absent.
      if (!paymentIntentId && fromPaymentEvent.bookingId) {
        const byBooking = await dbClient.query(
          `SELECT paymongo_payment_intent_id FROM payments
           WHERE booking_id::text = $1 AND status IN ('pending', 'processing')
           ORDER BY updated_at DESC LIMIT 1`,
          [fromPaymentEvent.bookingId]
        );
        paymentIntentId = byBooking.rows[0]?.paymongo_payment_intent_id || null;
        if (paymentIntentId) {
          console.warn(
            `Webhook: ${eventType} carried no payment_intent_id; resolved via metadata.booking_id ` +
            `${fromPaymentEvent.bookingId} to intent ${paymentIntentId}.`
          );
        }
      }

      if (!paymentIntentId) {
        // Deliberately not a 500. PayMongo retries 5xx, and a payload we cannot map will
        // not become mappable on the tenth attempt - it would just retry until it gave up
        // and then be just as lost. console.error so it is findable, with the payment id
        // so it can be reconciled against the PayMongo dashboard by hand.
        console.error(
          `Webhook: ${eventType} could not be mapped to a payment intent. PayMongo object ` +
          `id=${eventData?.id || 'unknown'}. This payment may have succeeded WITHOUT being ` +
          'recorded - reconcile it manually.'
        );
        return res.json({ received: true });
      }

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
        // payment.paid's own object IS the payment; payment_intent.succeeded nests it.
        const capturedPaymentId = isPaymentEvent
          ? (eventData?.id || null)
          : (eventData?.attributes?.payments?.[0]?.id || null);

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

      // `AND status <> 'succeeded'` is what stops a late or retried failure event from
      // unwinding a payment that already settled. Webhook deliveries are not ordered and
      // are retried on our own 5xx, so a failed attempt's event can legitimately arrive
      // after a later attempt on the same intent succeeded. Without the guard that event
      // marked a settled payment 'failed' and flipped the booking to unpaid, while the
      // provider's wallet - credited by settlePaymentSuccess, which is keyed off its own
      // wallet_credited_at claim and never reads this back - stayed credited. The books
      // then disagreed with themselves with no way to tell which side was right.
      const failedUpdate = await dbClient.query(
        `UPDATE payments
         SET status = 'failed',
             failure_reason = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE paymongo_payment_intent_id = $2
           AND status <> 'succeeded'
         RETURNING id`,
        [eventData?.attributes?.last_payment_error?.message || 'Payment failed', paymentIntentId]
      );
      const failedRowCount = failedUpdate.rowCount ?? 0;

      if (failedRowCount === 0) {
        console.log(
          `Webhook: payment_intent.failed for ${paymentIntentId} ignored - no matching payment, ` +
          'or it has already succeeded.'
        );
      }

      // Notify client of payment failure (via webhook). Only when the row actually moved
      // to 'failed': telling a client their payment failed for a booking they have paid
      // for is worse than saying nothing.
      if (paymentRes.rows[0] && failedRowCount > 0) {
        const payment = paymentRes.rows[0];
        try {
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
    } else if (eventType === 'qrph.expired') {
      // A QR Ph code that was never scanned. PayMongo detaches the expired payment method
      // and puts the intent back to awaiting_payment_method, so the INTENT is still good -
      // a fresh QR, or a card, can be attached to it.
      //
      // Hence 'pending' rather than 'failed'. create-intent treats pending/processing as an
      // open attempt and resumes the same intent (see the openPayment branch), which is
      // exactly what should happen. Marking it 'failed' would make it a dead attempt,
      // throwing away a perfectly reusable intent and burning an attempt number - and
      // 'failed' also drives the client's "Payment Failed" copy, which would tell someone
      // their payment was refused when in truth they simply took too long to scan.
      const ref = resolveIntentRef(eventData);
      let expiredIntentId = ref.intentId;

      if (!expiredIntentId && ref.bookingId) {
        const byBooking = await dbClient.query(
          `SELECT paymongo_payment_intent_id FROM payments
           WHERE booking_id::text = $1 AND status = 'processing'
           ORDER BY updated_at DESC LIMIT 1`,
          [ref.bookingId]
        );
        expiredIntentId = byBooking.rows[0]?.paymongo_payment_intent_id || null;
      }

      if (!expiredIntentId) {
        // Benign compared with a lost payment: the row stays 'processing' and the client's
        // own polling of /confirm sees the intent back at awaiting_payment_method and
        // recovers. Logged rather than 500'd for the same reason as above - a payload we
        // cannot map will not map on a retry.
        console.warn(
          `Webhook: qrph.expired could not be mapped to a payment intent (object id=` +
          `${eventData?.id || 'unknown'}); leaving the payment row for /confirm to reconcile.`
        );
        return res.json({ received: true });
      }

      // `status = 'processing'` is the precise guard, not `<> 'succeeded'`: a row that is
      // already 'pending' needs nothing, a 'succeeded' one must never be reopened (the
      // client can pay in the last second before expiry), and 'failed' or 'cancelled'
      // should not be resurrected by a late expiry event.
      const reset = await dbClient.query(
        `UPDATE payments
         SET status = 'pending',
             paymongo_payment_method_id = NULL,
             payment_method_type = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE paymongo_payment_intent_id = $1
           AND status = 'processing'
         RETURNING id`,
        [expiredIntentId]
      );

      if ((reset.rowCount ?? 0) === 0) {
        console.log(
          `Webhook: qrph.expired for ${expiredIntentId} changed nothing - the payment is no ` +
          'longer processing (already paid, retried, or cancelled).'
        );
      }
    }

    return res.json({ received: true });
  } catch (error: any) {
    // Only the succeeded branch opens a transaction, so this can fire with none in
    // progress - and a throwing ROLLBACK here would replace the real error below with a
    // meaningless one. 500 is deliberate: PayMongo retries on it, which is exactly what
    // should happen to a delivery we failed to record.
    try {
      await dbClient.query('ROLLBACK');
    } catch (_rollbackError) {
      /* no transaction was open */
    }
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
    // This took rows[0] from an unordered result. `unique_booking_payment` means there is
    // only one row per booking today, so the ordering is belt-and-braces - but it is the
    // difference between "correct" and "correct by accident", and the constraint being
    // there at all is what this file used to get wrong (see create-intent). Rank the
    // settled payment first, then the newest of whatever is left.
    const paymentRes = await pool.query(
      `SELECT p.*, b.start_date, b.end_date, s.title as service_title
       FROM payments p
       JOIN bookings b ON b.id::text = p.booking_id::text
       LEFT JOIN services s ON s.id::text = b.service_id::text
       WHERE p.booking_id::text = $1
       ORDER BY
         CASE p.status
           WHEN 'succeeded' THEN 0
           WHEN 'processing' THEN 1
           WHEN 'pending' THEN 2
           ELSE 3
         END,
         p.created_at DESC
       LIMIT 1`,
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
