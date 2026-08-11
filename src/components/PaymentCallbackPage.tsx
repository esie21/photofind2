import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Loader2, AlertCircle } from 'lucide-react';
import paymentService from '../api/services/paymentService';

interface PaymentCallbackPageProps {
  onDone: () => void;
}

type State = 'checking' | 'succeeded' | 'failed' | 'processing' | 'missing';

/**
 * Landing page for PayMongo's 3D Secure redirect.
 *
 * create-intent sets `request_three_d_secure: 'any'`, so every card payment goes through
 * 3DS: PaymentSummary sends the browser to the bank, and the bank sends it back to
 * `${FRONTEND_URL}/payment/callback`. Nothing used to handle that path, so the client
 * landed on their dashboard with no idea whether the payment worked and /confirm was
 * never called - locally, with no public webhook URL, that meant nothing settled the
 * payment at all.
 */
export function PaymentCallbackPage({ onDone }: PaymentCallbackPageProps) {
  const [state, setState] = useState<State>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // PayMongo appends the intent id to the return_url.
    const params = new URLSearchParams(window.location.search);
    const intentId = params.get('payment_intent_id') || params.get('payment_intent');

    if (!intentId) {
      setState('missing');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const result = await paymentService.confirmPayment(intentId);
        if (cancelled) return;
        if (result.status === 'succeeded') setState('succeeded');
        else if (result.status === 'failed') setState('failed');
        else setState('processing');
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Could not confirm the payment');
        setState('failed');
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const body = {
    checking: {
      icon: <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />,
      title: 'Confirming your payment…',
      text: 'Hang on while we check with PayMongo.',
    },
    succeeded: {
      icon: <CheckCircle className="w-8 h-8 text-green-600" />,
      title: 'Payment complete',
      text: 'Your booking is paid and confirmed.',
    },
    processing: {
      icon: <AlertCircle className="w-8 h-8 text-amber-600" />,
      title: 'Payment still processing',
      text: "Your bank hasn't finished yet. This can take a minute — check your Bookings page shortly.",
    },
    failed: {
      icon: <XCircle className="w-8 h-8 text-red-600" />,
      title: 'Payment failed',
      text: error || 'The payment did not go through. You can try again from your Bookings page.',
    },
    missing: {
      icon: <AlertCircle className="w-8 h-8 text-amber-600" />,
      title: "We couldn't identify that payment",
      text: 'The confirmation link was missing its payment reference. Open your Bookings page to check the status.',
    },
  }[state];

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full text-center">
        <div className="flex justify-center mb-4">{body.icon}</div>
        <h1 className="text-lg font-semibold text-gray-900 mb-2">{body.title}</h1>
        <p className="text-sm text-gray-600 mb-6">{body.text}</p>
        <button
          onClick={onDone}
          disabled={state === 'checking'}
          className="w-full px-4 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-50"
        >
          Go to my bookings
        </button>
      </div>
    </div>
  );
}

export default PaymentCallbackPage;
