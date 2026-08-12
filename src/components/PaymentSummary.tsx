import { useState, useEffect, useRef } from 'react';
import { CreditCard, Shield, CheckCircle, XCircle, Loader2, AlertCircle } from 'lucide-react';
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
}

// 'verifying' is separate from 'failed' on purpose. Once a card has been attached the
// money may already be captured, so a later hiccup while checking the status must never
// be reported as "Payment Failed" - that is the state that had clients paying twice.
type PaymentStatus = 'idle' | 'creating' | 'ready' | 'processing' | 'verifying' | 'succeeded' | 'failed' | 'already_paid';

export function PaymentSummary({
  bookingId,
  serviceName,
  providerName,
  totalAmount,
  onPaymentSuccess,
  onPaymentFailed,
  onCancel,
  onAlreadyPaid,
}: PaymentSummaryProps) {
  const [status, setStatus] = useState<PaymentStatus>('idle');
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
    <div className="bg-white rounded-2xl shadow-lg p-6 max-w-md mx-auto">
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

      {/* Card Form */}
      {(status === 'ready' || status === 'failed') && (
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

      {/* Actions */}
      <div className="space-y-3">
        {(status === 'ready' || status === 'failed') && (
          <button
            onClick={handlePayment}
            className="w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors font-medium flex items-center justify-center gap-2"
          >
            <CreditCard className="w-5 h-5" />
            Pay PHP {totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
          </button>
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

        {/* No Cancel while the outcome is unknown: closing here is what left the client
            with a paid booking their list still showed as unpaid. */}
        {status !== 'succeeded' && status !== 'processing' && status !== 'verifying' && status !== 'already_paid' && (
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

      {/* Test Card Info */}
      <div className="mt-4 p-3 bg-blue-50 rounded-lg">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5" />
          <div className="text-xs text-blue-700">
            <p className="font-medium">Sandbox Mode</p>
            <p>Use test card: 4343 4343 4343 4345, any future date, any CVC</p>
          </div>
        </div>
      </div>
    </div>
  );
}
