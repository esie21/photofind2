import { useState, useEffect } from 'react';
import { CreditCard, Shield, CheckCircle, XCircle, Loader2, AlertCircle } from 'lucide-react';
import paymentService, { PaymentIntentResponse } from '../api/services/paymentService';

interface PaymentSummaryProps {
  bookingId: string;
  serviceName: string;
  providerName: string;
  totalAmount: number;
  onPaymentSuccess: () => void;
  onPaymentFailed: (error: string) => void;
  onCancel: () => void;
}

type PaymentStatus = 'idle' | 'creating' | 'ready' | 'processing' | 'succeeded' | 'failed';

export function PaymentSummary({
  bookingId,
  serviceName,
  providerName,
  totalAmount,
  onPaymentSuccess,
  onPaymentFailed,
  onCancel,
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

  const commissionRate = 0.15;
  const commissionAmount = Math.round(totalAmount * commissionRate * 100) / 100;
  const providerAmount = Math.round((totalAmount - commissionAmount) * 100) / 100;

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
      setError(err.message || 'Failed to create payment');
      setStatus('failed');
    }
  };

  const handlePayment = async () => {
    if (!paymentIntent) {
      setError('Payment not initialized');
      return;
    }

    // Validate card details
    if (!cardDetails.number || !cardDetails.expMonth || !cardDetails.expYear || !cardDetails.cvc) {
      setError('Please fill in all card details');
      return;
    }

    setStatus('processing');
    setError(null);

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

      // Step 2: Attach payment method to intent
      const attachResult = await paymentService.attachPaymentMethod(
        paymentIntent.payment_intent_id,
        paymentMethodId
      );

      // Step 3: Handle 3DS if required
      if (attachResult.next_action?.type === 'redirect') {
        // Redirect to 3DS authentication
        window.location.href = attachResult.next_action.redirect!.url;
        return;
      }

      // Step 4: Confirm payment
      const confirmResult = await paymentService.confirmPayment(paymentIntent.payment_intent_id);

      if (confirmResult.status === 'succeeded') {
        setStatus('succeeded');
        setTimeout(() => onPaymentSuccess(), 2000);
      } else if (confirmResult.status === 'failed') {
        setStatus('failed');
        setError('Payment failed. Please try again.');
        onPaymentFailed('Payment failed');
      } else {
        // Payment still processing
        setStatus('processing');
        // Poll for status
        pollPaymentStatus(paymentIntent.payment_intent_id);
      }
    } catch (err: any) {
      setStatus('failed');
      setError(err.message || 'Payment failed');
      onPaymentFailed(err.message || 'Payment failed');
    }
  };

  const pollPaymentStatus = async (intentId: string, attempts = 0) => {
    if (attempts >= 10) {
      setError('Payment verification timed out. Please check your payment history.');
      setStatus('failed');
      return;
    }

    try {
      const result = await paymentService.confirmPayment(intentId);

      if (result.status === 'succeeded') {
        setStatus('succeeded');
        setTimeout(() => onPaymentSuccess(), 2000);
      } else if (result.status === 'failed') {
        setStatus('failed');
        setError('Payment failed');
      } else {
        // Continue polling
        setTimeout(() => pollPaymentStatus(intentId, attempts + 1), 3000);
      }
    } catch (err) {
      setTimeout(() => pollPaymentStatus(intentId, attempts + 1), 3000);
    }
  };

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
            <span className="text-gray-600">Platform Fee (15%)</span>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Card Number</label>
            <input
              type="text"
              placeholder="4343 4343 4343 4345"
              value={cardDetails.number}
              onChange={(e) => setCardDetails({ ...cardDetails, number: formatCardNumber(e.target.value) })}
              maxLength={19}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
            />
            <p className="text-xs text-gray-400 mt-1">Use test card: 4343 4343 4343 4345</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
              <input
                type="text"
                placeholder="MM"
                value={cardDetails.expMonth}
                onChange={(e) => setCardDetails({ ...cardDetails, expMonth: e.target.value.replace(/\D/g, '').slice(0, 2) })}
                maxLength={2}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
              <input
                type="text"
                placeholder="YY"
                value={cardDetails.expYear}
                onChange={(e) => setCardDetails({ ...cardDetails, expYear: e.target.value.replace(/\D/g, '').slice(0, 2) })}
                maxLength={2}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CVC</label>
              <input
                type="text"
                placeholder="123"
                value={cardDetails.cvc}
                onChange={(e) => setCardDetails({ ...cardDetails, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                maxLength={4}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="space-y-3">
        {(status === 'ready' || status === 'failed') && (
          <button
            onClick={handlePayment}
            disabled={status === 'processing'}
            className="w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'processing' ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <CreditCard className="w-5 h-5" />
                Pay PHP {totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </>
            )}
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

        {status !== 'succeeded' && status !== 'processing' && (
          <button
            onClick={onCancel}
            className="w-full py-3 text-gray-600 hover:text-gray-800 transition-colors"
          >
            Cancel
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
