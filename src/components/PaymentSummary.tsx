import { useState, useEffect, useRef } from 'react';
import { CreditCard, Shield, CheckCircle, XCircle, Loader2, AlertCircle, QrCode, Download, Clock } from 'lucide-react';
import paymentService, { PaymentIntentResponse } from '../api/services/paymentService';
import { ApiError } from '../api/client';

interface PaymentSummaryProps {
  bookingId: string;
  serviceName: string;
  providerName: string;
  totalAmount: number;
  onPaymentSuccess: () => void;
  onPaymentFailed: (error: string) => void;
  onCancel: () => void;
  /** Called when the server says this booking is already paid - see 'already_paid'. */
  onAlreadyPaid?: () => void;
  /**
   * Reports whether it is currently safe to dismiss this modal from outside (Escape,
   * clicking the backdrop) - the same question the in-form Cancel button below already
   * answers for itself. A parent that wires Escape/backdrop-close to onCancel without
   * checking this can let a client dismiss the modal mid-payment, which is exactly the
   * "paid but the list still says unpaid" bug the missing Cancel button was guarding
   * against.
   */
  onCloseabilityChange?: (canClose: boolean) => void;
}

// 'verifying' is separate from 'failed' on purpose. Once a card has been attached the
// money may already be captured, so a later hiccup while checking the status must never
// be reported as "Payment Failed" - that is the state that had clients paying twice.
// 'awaiting_qr' is its own state rather than a flavour of 'processing': a QR is on screen,
// nothing has been captured, and the client has something to DO. 'qr_expired' is likewise
// not 'failed' - nothing was refused, the code simply timed out unscanned, and calling it
// a failure would tell someone their payment was declined when it never happened.
type PaymentStatus =
  | 'idle' | 'creating' | 'ready' | 'processing' | 'verifying'
  | 'awaiting_qr' | 'qr_expired'
  | 'succeeded' | 'failed' | 'already_paid';

type PayMethod = 'card' | 'qrph';

export function PaymentSummary({
  bookingId,
  serviceName,
  providerName,
  totalAmount,
  onPaymentSuccess,
  onPaymentFailed,
  onCancel,
  onAlreadyPaid,
  onCloseabilityChange,
}: PaymentSummaryProps) {
  const [status, setStatus] = useState<PaymentStatus>('idle');
  // Single source of truth for "is the outcome of this payment still unknown" - used
  // both to show/hide the Cancel button below and to tell the parent whether Escape /
  // backdrop-click may dismiss the whole modal.
  // 'awaiting_qr' is excluded for the same reason 'processing' is. A client who scans, pays,
  // and has the modal dismissed from under them before the poll notices ends up with a paid
  // booking their list still shows as unpaid - the exact bug the Cancel guard exists for.
  // The QR panel offers its own explicit Cancel instead, so this blocks the accidental
  // dismissals (Escape, backdrop) without trapping anyone.
  const canClose =
    status !== 'succeeded' && status !== 'processing' && status !== 'verifying' &&
    status !== 'already_paid' && status !== 'awaiting_qr';
  useEffect(() => {
    onCloseabilityChange?.(canClose);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canClose]);
  const [error, setError] = useState<string | null>(null);
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntentResponse | null>(null);
  const [cardDetails, setCardDetails] = useState({
    number: '',
    expMonth: '',
    expYear: '',
    cvc: '',
  });
  // Per-field messages. "Please fill in all card details" used to go into `error`, which
  // is only rendered while status === 'failed' - so clicking Pay with an empty form
  // looked like the button did nothing at all.
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});

  // Derived, not chosen. QR Ph is the only method on offer, so there is nothing to pick
  // and no chooser to render - the server says what the intent accepts and this follows.
  // The card branch survives only for the PAYMONGO_QRPH_ENABLED=false outage fallback.
  //
  // Defaults to card when the server said nothing, which is the pre-QR-Ph behaviour: a
  // response without the field cannot be assumed to accept qrph, and guessing wrong there
  // means attaching a method the intent will refuse.
  const offeredMethods = paymentIntent?.payment_methods ?? null;
  const payMethod: PayMethod = offeredMethods?.includes('qrph') ? 'qrph' : 'card';
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  // Read inside the polling loop, which is a recursive setTimeout chain and would otherwise
  // close over the values from the render that started it.
  const qrExpiresAtRef = useRef<string | null>(null);
  // When to give up polling, as an absolute timestamp. Separate from the displayed expiry
  // because the two answer different questions: the countdown may be unknown (the server
  // omitted it), but the loop must still terminate - an unknown expiry previously meant
  // polling every 4s for as long as the component stayed mounted.
  const pollDeadlineRef = useRef<number>(0);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  // Show the split the server actually applied. The rate is configurable via
  // PLATFORM_COMMISSION_RATE on the backend, so hardcoding it here meant the breakdown
  // shown to the client could quietly disagree with what was really charged. The local
  // calculation is only a placeholder for the moment before the intent resolves.
  const FALLBACK_COMMISSION_RATE = 0.15;
  const fallbackCommission = Math.round(totalAmount * FALLBACK_COMMISSION_RATE * 100) / 100;
  const commissionAmount = paymentIntent?.commission ?? fallbackCommission;
  const providerAmount = paymentIntent?.provider_amount ?? Math.round((totalAmount - fallbackCommission) * 100) / 100;
  const commissionRate = totalAmount > 0 ? commissionAmount / totalAmount : FALLBACK_COMMISSION_RATE;

  // Create payment intent on mount
  useEffect(() => {
    createPaymentIntent();
  }, [bookingId]);

  const createPaymentIntent = async () => {
    setStatus('creating');
    setError(null);

    try {
      const intent = await paymentService.createPaymentIntent(bookingId);
      setPaymentIntent(intent);
      setStatus('ready');
    } catch (err: any) {
      // "Already paid" is not a payment failure - it means this booking was settled
      // (usually by the click before this one) and the list that offered the Pay button
      // was out of date. Showing it as a failure is what convinced clients their money
      // had not gone through, so they paid again.
      if (err instanceof ApiError && (err.status === 409 || err.body?.already_paid)) {
        setStatus('already_paid');
        setError(null);
        later(() => (onAlreadyPaid || onCancel)(), 2500);
        return;
      }
      setError(err.message || 'Failed to create payment');
      setStatus('failed');
    }
  };

  const validateCard = () => {
    const next: Record<string, string> = {};
    const digits = cardDetails.number.replace(/\s/g, '');
    if (!digits) next.number = 'Enter your card number';
    else if (digits.length < 13) next.number = 'That card number looks too short';

    const month = parseInt(cardDetails.expMonth, 10);
    if (!cardDetails.expMonth) next.expMonth = 'Required';
    else if (!(month >= 1 && month <= 12)) next.expMonth = '01-12';

    if (!cardDetails.expYear) next.expYear = 'Required';
    if (!cardDetails.cvc) next.cvc = 'Required';
    else if (cardDetails.cvc.length < 3) next.cvc = '3-4 digits';

    setCardErrors(next);
    return Object.keys(next).length === 0;
  };

  const handlePayment = async () => {
    if (!paymentIntent) {
      setError('Payment not initialized');
      return;
    }

    if (!validateCard()) return;

    setStatus('processing');
    setError(null);

    // Whether the card made it as far as the intent. Once it has, a later error means
    // "we don't know the outcome", not "the payment failed".
    let attached = false;

    try {
      // In production, you would use PayMongo.js SDK to create the payment method
      // For sandbox testing, we'll simulate the flow

      // Step 1: Create payment method (in real app, use PayMongo.js)
      const paymentMethodResponse = await fetch('https://api.paymongo.com/v1/payment_methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${btoa(paymentIntent.public_key + ':')}`,
        },
        body: JSON.stringify({
          data: {
            attributes: {
              type: 'card',
              details: {
                card_number: cardDetails.number.replace(/\s/g, ''),
                exp_month: parseInt(cardDetails.expMonth),
                exp_year: parseInt(cardDetails.expYear),
                cvc: cardDetails.cvc,
              },
            },
          },
        }),
      });

      const paymentMethodData = await paymentMethodResponse.json();

      if (!paymentMethodResponse.ok) {
        throw new Error(paymentMethodData.errors?.[0]?.detail || 'Failed to create payment method');
      }

      const paymentMethodId = paymentMethodData.data.id;

      // Step 2: Attach payment method to intent. Everything up to here is safe to report
      // as a plain failure - no money can have moved yet. Past this line it can have, so
      // the catch below stops calling it a failure.
      const attachResult = await paymentService.attachPaymentMethod(
        paymentIntent.payment_intent_id,
        paymentMethodId
      );
      attached = true;

      // Step 3: Handle 3DS if required
      if (attachResult.next_action?.type === 'redirect') {
        // Redirect to 3DS authentication
        window.location.href = attachResult.next_action.redirect!.url;
        return;
      }

      // Step 4: A card that doesn't need 3D Secure resolves right here, and the server
      // has already marked the payment succeeded and credited the provider before it
      // answered. Believe that instead of requiring a second /confirm round-trip: when
      // that extra call failed, a completed payment was shown as "Payment Failed", the
      // client cancelled, and the next attempt hit "already paid".
      if (attachResult.status === 'succeeded') {
        markSucceeded();
        return;
      }

      // Otherwise the intent is still open - find out where it got to.
      verifyPayment(paymentIntent.payment_intent_id);
    } catch (err: any) {
      const message = err?.message || 'Payment failed';
      if (attached) {
        // The card was accepted; only the status check went wrong. Claiming failure here
        // would be telling the client their money didn't move when it may well have.
        setStatus('verifying');
        setError(null);
        verifyPayment(paymentIntent.payment_intent_id);
        return;
      }
      setStatus('failed');
      setError(message);
      onPaymentFailed(message);
    }
  };

  const markSucceeded = () => {
    setStatus('succeeded');
    later(() => onPaymentSuccess(), 2000);
  };

  // Polls until PayMongo settles one way or the other. Runs after the card is attached,
  // so a network error is a reason to keep checking, never a reason to report failure -
  // only the server actually saying 'failed' is that.
  const verifyPayment = async (intentId: string, attempts = 0) => {
    setStatus(s => (s === 'succeeded' ? s : 'verifying'));

    if (attempts >= 10) {
      setError("We couldn't confirm this payment yet. It may still complete - check your Bookings page in a minute before trying again.");
      return;
    }

    try {
      const result = await paymentService.confirmPayment(intentId);

      if (result.status === 'succeeded') {
        markSucceeded();
      } else if (result.status === 'failed') {
        setStatus('failed');
        setError('The payment did not go through. You can try again with another card.');
        onPaymentFailed('Payment failed');
      } else {
        later(() => verifyPayment(intentId, attempts + 1), 3000);
      }
    } catch {
      later(() => verifyPayment(intentId, attempts + 1), 3000);
    }
  };

  // ---- QR Ph -------------------------------------------------------------------------
  //
  // Nothing here is a redirect. The server mints and attaches the code, this renders it,
  // and the client pays in their own banking or e-wallet app - so the only way to learn the
  // outcome is to ask. /confirm is polled rather than PayMongo directly, because the server
  // is what has to record the payment and credit the provider; the webhook usually gets
  // there first and /confirm then simply agrees.
  const QR_POLL_MS = 4000;
  // Keeps polling a little past expiry so a payment made in the last second is still seen
  // rather than being reported as an expired code.
  const QR_EXPIRY_GRACE_MS = 20000;
  // Backstop deadline used only when the server sent no expiry at all. Comfortably longer
  // than the 15 minutes the server asks PayMongo for, so it never cuts a live code short.
  const QR_POLL_FALLBACK_MS = 20 * 60 * 1000;

  const pollQrPayment = async (intentId: string) => {
    try {
      const result = await paymentService.confirmPayment(intentId);

      if (result.status === 'succeeded') {
        markSucceeded();
        return;
      }
      if (result.status === 'failed') {
        setStatus('failed');
        setError('The payment did not go through. You can try again.');
        onPaymentFailed('Payment failed');
        return;
      }
      // The server put this payment back to awaiting-a-method: the code expired unscanned,
      // or PayMongo dropped it. Not a failure, and deliberately not reported as one.
      if (result.status === 'awaiting_payment_method') {
        setQrImage(null);
        setStatus('qr_expired');
        return;
      }
    } catch {
      // A network blip while a QR is live is not an outcome. Fall through and ask again.
    }

    // Local stop condition, so a client whose expiry passed while the server was
    // unreachable is not left watching a dead code forever - and so the loop always ends.
    if (Date.now() > pollDeadlineRef.current) {
      setQrImage(null);
      setStatus('qr_expired');
      return;
    }

    later(() => pollQrPayment(intentId), QR_POLL_MS);
  };

  const startQrPhPayment = async () => {
    if (!paymentIntent) {
      setError('Payment not initialized');
      setStatus('failed');
      return;
    }

    setStatus('processing');
    setError(null);

    try {
      const result = await paymentService.attachQrPh(paymentIntent.payment_intent_id);

      if (result.status === 'succeeded') {
        markSucceeded();
        return;
      }

      const image = result.next_action?.code?.image_url || null;
      if (!image) {
        // Attached, but with no code to show. The method is on the intent at this point, so
        // this is not a clean failure - hand it to the poller instead of claiming one.
        setStatus('verifying');
        verifyPayment(paymentIntent.payment_intent_id);
        return;
      }

      setQrImage(image);
      setQrExpiresAt(result.qr_expires_at ?? null);
      qrExpiresAtRef.current = result.qr_expires_at ?? null;
      // The server always sends qr_expires_at for a qrph attach; the fallback is here so
      // that the loop's termination does not depend on that staying true. No countdown is
      // shown in that case rather than inventing one - a fabricated clock counting down to
      // the wrong moment is worse than no clock.
      const expiryMs = result.qr_expires_at ? new Date(result.qr_expires_at).getTime() : NaN;
      pollDeadlineRef.current = Number.isFinite(expiryMs)
        ? expiryMs + QR_EXPIRY_GRACE_MS
        : Date.now() + QR_POLL_FALLBACK_MS;
      setStatus('awaiting_qr');
      later(() => pollQrPayment(paymentIntent.payment_intent_id), QR_POLL_MS);
    } catch (err: any) {
      // The server refusing qrph while also being the thing that offered it means the
      // switch was flipped between the two calls. There is deliberately no "use a card
      // instead" here: this intent was created with qrph as its only allowed method, so a
      // card could not be attached to it even if the form were shown. Starting over is the
      // honest option, and "Try Again" below re-creates the intent under the new config.
      if (err instanceof ApiError && (err.status === 503 || err.body?.qrph_unavailable)) {
        setStatus('failed');
        setError("QR Ph isn't available right now. Please try again in a moment.");
        return;
      }

      // Split the same way the card path splits it. A 4xx means the request was refused and
      // no method was attached, which is a clean "try again". Anything else - a 5xx, a
      // dropped connection - leaves it genuinely unknown whether a code was attached, and
      // the one thing that must not happen is telling a client it failed when it may not
      // have.
      const definitelyNotAttached = err instanceof ApiError && err.status >= 400 && err.status < 500;
      if (definitelyNotAttached) {
        setStatus('failed');
        setError(err.message || 'Could not start the QR Ph payment.');
        return;
      }
      setStatus('verifying');
      setError(null);
      verifyPayment(paymentIntent.payment_intent_id);
    }
  };

  // Countdown for the code on screen. Derived from the expiry rather than counted down from
  // a fixed number, so a backgrounded tab that misses ticks still shows the right time when
  // it comes back.
  useEffect(() => {
    if (status !== 'awaiting_qr' || !qrExpiresAt) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => {
      const ms = new Date(qrExpiresAt).getTime() - Date.now();
      setSecondsLeft(Math.max(0, Math.ceil(ms / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status, qrExpiresAt]);

  const formatCountdown = (total: number) => {
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const payNow = () => (payMethod === 'qrph' ? startQrPhPayment() : handlePayment());

  // Typing in a field clears that field's complaint, so the form stops shouting as soon
  // as it is being fixed.
  const setCardField = (field: keyof typeof cardDetails, value: string) => {
    setCardDetails(d => ({ ...d, [field]: value }));
    setCardErrors(e => (e[field] ? { ...e, [field]: '' } : e));
  };

  const cardFieldClass = (field: string) =>
    `w-full px-4 py-3 border rounded-xl focus:ring-2 focus:border-transparent outline-none ${
      cardErrors[field] ? 'border-red-400 focus:ring-red-500' : 'border-gray-200 focus:ring-purple-500'
    }`;

  const formatCardNumber = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    const matches = v.match(/\d{4,16}/g);
    const match = (matches && matches[0]) || '';
    const parts = [];
    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }
    return parts.length ? parts.join(' ') : value;
  };

  return (
    <div className="modal-card modal-card--md modal-card--plain p-6">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CreditCard className="w-8 h-8 text-purple-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Payment Summary</h2>
        <p className="text-sm text-gray-500 mt-1">Secure payment powered by PayMongo</p>
      </div>

      {/* Order Details */}
      <div className="bg-gray-50 rounded-xl p-4 mb-6">
        <div className="flex justify-between items-start mb-3">
          <div>
            <p className="text-sm font-medium text-gray-900">{serviceName}</p>
            <p className="text-xs text-gray-500">by {providerName}</p>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Service Fee</span>
            <span className="text-gray-900">PHP {totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Platform Fee ({Math.round(commissionRate * 100)}%)</span>
            <span className="text-gray-900">PHP {commissionAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between text-sm border-t border-gray-200 pt-2 mt-2">
            <span className="text-gray-600">Provider Receives</span>
            <span className="text-gray-500">PHP {providerAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between font-semibold text-base border-t border-gray-200 pt-2 mt-2">
            <span className="text-gray-900">Total</span>
            <span className="text-purple-600">PHP {totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>

      {/* Status Messages */}
      {status === 'creating' && (
        <div className="flex items-center justify-center gap-2 text-gray-600 mb-6">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Initializing payment...</span>
        </div>
      )}

      {status === 'succeeded' && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-6 h-6 text-green-600" />
            <div>
              <p className="font-medium text-green-800">Payment Successful!</p>
              <p className="text-sm text-green-600">Your booking has been confirmed.</p>
            </div>
          </div>
        </div>
      )}

      {/* Already settled - not a failure, and deliberately styled as good news. */}
      {status === 'already_paid' && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-6 h-6 text-green-600" />
            <div>
              <p className="font-medium text-green-800">This booking is already paid</p>
              <p className="text-sm text-green-600">
                Your earlier payment went through, so there's nothing left to pay. Refreshing your bookings.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Outcome not known yet. The card has been accepted at this point, so this must
          never read as a failure - the client would pay a second time. */}
      {status === 'verifying' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            {error ? (
              <AlertCircle className="w-6 h-6 text-blue-600 flex-shrink-0" />
            ) : (
              <Loader2 className="w-6 h-6 text-blue-600 animate-spin flex-shrink-0" />
            )}
            <div>
              <p className="font-medium text-blue-800">
                {error ? 'Still confirming your payment' : 'Confirming your payment...'}
              </p>
              <p className="text-sm text-blue-700">
                {error || "Your card has been submitted. Don't close this window or pay again while we check."}
              </p>
            </div>
          </div>
        </div>
      )}

      {status === 'failed' && error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-3">
            <XCircle className="w-6 h-6 text-red-600" />
            <div>
              <p className="font-medium text-red-800">Payment Failed</p>
              <p className="text-sm text-red-600">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* QR Ph is the only method, so there is nothing to choose - but the client should
          still know what is about to happen before a code with a clock on it appears. */}
      {payMethod === 'qrph' && (status === 'ready' || status === 'failed') && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <QrCode className="w-5 h-5 text-gray-500 flex-shrink-0" />
            <p className="text-sm text-gray-600">
              You&apos;ll get a QR code to scan with GCash, Maya or your bank&apos;s app. Nothing is
              charged until you confirm it there.
            </p>
          </div>
        </div>
      )}

      {/* Card Form */}
      {(status === 'ready' || status === 'failed') && payMethod === 'card' && (
        <div className="space-y-4 mb-6">
          <div>
            <label htmlFor="card-number" className="block text-sm font-medium text-gray-700 mb-1">Card Number</label>
            <input
              id="card-number"
              type="text"
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="4343 4343 4343 4345"
              value={cardDetails.number}
              onChange={(e) => setCardField('number', formatCardNumber(e.target.value))}
              maxLength={19}
              className={cardFieldClass('number')}
            />
            {cardErrors.number
              ? <p className="text-xs text-red-600 mt-1">{cardErrors.number}</p>
              : <p className="text-xs text-gray-400 mt-1">Use test card: 4343 4343 4343 4345</p>}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="card-month" className="block text-sm font-medium text-gray-700 mb-1">Month</label>
              <input
                id="card-month"
                type="text"
                inputMode="numeric"
                autoComplete="cc-exp-month"
                placeholder="MM"
                value={cardDetails.expMonth}
                onChange={(e) => setCardField('expMonth', e.target.value.replace(/\D/g, '').slice(0, 2))}
                maxLength={2}
                className={cardFieldClass('expMonth')}
              />
              {cardErrors.expMonth && <p className="text-xs text-red-600 mt-1">{cardErrors.expMonth}</p>}
            </div>
            <div>
              <label htmlFor="card-year" className="block text-sm font-medium text-gray-700 mb-1">Year</label>
              <input
                id="card-year"
                type="text"
                inputMode="numeric"
                autoComplete="cc-exp-year"
                placeholder="YY"
                value={cardDetails.expYear}
                onChange={(e) => setCardField('expYear', e.target.value.replace(/\D/g, '').slice(0, 2))}
                maxLength={2}
                className={cardFieldClass('expYear')}
              />
              {cardErrors.expYear && <p className="text-xs text-red-600 mt-1">{cardErrors.expYear}</p>}
            </div>
            <div>
              <label htmlFor="card-cvc" className="block text-sm font-medium text-gray-700 mb-1">CVC</label>
              <input
                id="card-cvc"
                type="text"
                inputMode="numeric"
                autoComplete="cc-csc"
                placeholder="123"
                value={cardDetails.cvc}
                onChange={(e) => setCardField('cvc', e.target.value.replace(/\D/g, '').slice(0, 4))}
                maxLength={4}
                className={cardFieldClass('cvc')}
              />
              {cardErrors.cvc && <p className="text-xs text-red-600 mt-1">{cardErrors.cvc}</p>}
            </div>
          </div>
        </div>
      )}

      {/* The code itself. `image_url` is a base64 data URI, so there is no network fetch
          here and nothing to fail - it either rendered or the server never sent one. */}
      {status === 'awaiting_qr' && qrImage && (
        <div className="qrph mb-6">
          <p className="qrph__title">Scan to pay PHP {totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
          <p className="qrph__hint">
            Open GCash, Maya or your bank's app, choose Scan QR, and point it at this code.
          </p>

          <div className="qrph__frame">
            <img src={qrImage} alt="QR Ph code for this payment" className="qrph__image" />
          </div>

          {secondsLeft !== null && (
            <p className={`qrph__timer${secondsLeft <= 60 ? ' qrph__timer--urgent' : ''}`}>
              <Clock className="w-4 h-4" />
              {secondsLeft > 0
                ? <>Code expires in <strong>{formatCountdown(secondsLeft)}</strong></>
                : <>This code has expired</>}
            </p>
          )}

          {/* Paying on the same phone that shows the code: you cannot scan your own
              screen, so the way through is to save the image and use the banking app's
              "scan from gallery" / "upload QR" option. Offered to everyone rather than
              sniffing for a phone - it is equally the answer for a client who wants to
              pay from a different device. */}
          <a href={qrImage} download={`photofind-qr-booking-${bookingId}.png`} className="qrph__save">
            <Download className="w-4 h-4" />
            Paying on this phone? Save the code
          </a>
          <p className="qrph__hint qrph__hint--small">
            Then in your banking app choose Scan QR and pick it from your gallery.
          </p>

          <p className="qrph__watching">
            <Loader2 className="w-4 h-4 animate-spin" />
            Waiting for your payment - this updates on its own.
          </p>
        </div>
      )}

      {/* Expired, which is not failed: nothing was refused and no money moved. */}
      {status === 'qr_expired' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <Clock className="w-6 h-6 text-blue-600 flex-shrink-0" />
            <div>
              <p className="font-medium text-blue-800">That QR code expired</p>
              <p className="text-sm text-blue-700">
                Nothing was charged, and your booking is still held. Get a fresh code to pay.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="space-y-3">
        {(status === 'ready' || status === 'failed') && (
          <button
            onClick={payNow}
            className="w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors font-medium flex items-center justify-center gap-2"
          >
            {payMethod === 'qrph' ? <QrCode className="w-5 h-5" /> : <CreditCard className="w-5 h-5" />}
            {/* "Show QR code", not "Pay": pressing this does not move money, it fetches a
                code. Labelling it Pay would have people expect to be charged on click and
                wonder whether the scan afterwards was a second payment. */}
            {payMethod === 'qrph'
              ? `Show QR code for PHP ${totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
              : `Pay PHP ${totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`}
          </button>
        )}

        {status === 'qr_expired' && (
          <>
            <button
              onClick={startQrPhPayment}
              className="w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors font-medium flex items-center justify-center gap-2"
            >
              <QrCode className="w-5 h-5" />
              Get a new QR code
            </button>
          </>
        )}

        {status === 'processing' && (
          <button
            disabled
            className="w-full py-3 bg-purple-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Loader2 className="w-5 h-5 animate-spin" />
            Processing...
          </button>
        )}

        {status === 'failed' && (
          <button
            onClick={createPaymentIntent}
            className="w-full py-3 border border-purple-600 text-purple-600 rounded-xl hover:bg-purple-50 transition-colors font-medium"
          >
            Try Again
          </button>
        )}

        {/* canClose excludes 'awaiting_qr' so Escape and backdrop clicks cannot dismiss a
            live code mid-scan, but a client who has changed their mind must not be stuck
            for fifteen minutes - so the way out is here, as a deliberate press.

            There is deliberately no "pay by card instead" while a code is live, and NOT
            because PayMongo refuses it: test mode on 2026-09-28 showed attaching a card to
            an intent that already holds a live QR Ph code returns 200 and settles the
            intent immediately. It is left out on purpose. This panel actively tells people
            to SAVE the QR image to their gallery, so a saved code outliving the switch is
            the expected case, not a freak one - and "client pays by card, then scans the
            code still sitting in their photos" is a double-charge shape. Whether PayMongo
            would refuse that second payment against a succeeded intent is exactly the thing
            not yet verified, so the door stays shut until it is. Switching after expiry
            (the qr_expired panel) has no such window. */}
        {status === 'awaiting_qr' && (
          <button
            onClick={onCancel}
            className="w-full py-3 text-gray-600 hover:text-gray-800 transition-colors"
          >
            Cancel and close
          </button>
        )}

        {/* No Cancel while the outcome is unknown: closing here is what left the client
            with a paid booking their list still showed as unpaid. */}
        {canClose && (
          <button
            onClick={onCancel}
            className="w-full py-3 text-gray-600 hover:text-gray-800 transition-colors"
          >
            Cancel
          </button>
        )}

        {status === 'verifying' && error && (
          // Only offered once polling has given up, and it closes through the
          // already-paid path so the list is re-read rather than trusted.
          <button
            onClick={() => (onAlreadyPaid || onCancel)()}
            className="w-full py-3 border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-100 transition-colors font-medium"
          >
            Check my bookings
          </button>
        )}
      </div>

      {/* Security Badge */}
      <div className="flex items-center justify-center gap-2 mt-6 text-xs text-gray-400">
        <Shield className="w-4 h-4" />
        <span>Secured by PayMongo</span>
      </div>

      {/* Card-specific, so only shown on the outage fallback path that can render a card
          form at all. It used to tell every client to type a test card number on a screen
          with no card form on it. */}
      {payMethod === 'card' && (
      <div className="mt-4 p-3 bg-blue-50 rounded-lg">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5" />
          <div className="text-xs text-blue-700">
            <p className="font-medium">Sandbox Mode</p>
            <p>Use test card: 4343 4343 4343 4345, any future date, any CVC</p>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
