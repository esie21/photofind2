import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, X, Loader2, AlertCircle, CheckCircle, Building2, Smartphone, Wallet, ArrowLeft } from 'lucide-react';
import { payoutService } from '../api/services/walletService';
import { useModal } from '../hooks/useModal';

interface PayoutRequestFormProps {
  availableBalance: number;
  minimumPayout: number;
  onSuccess: () => void;
  onCancel: () => void;
}

type PayoutMethod = 'bank_transfer' | 'gcash' | 'paymaya';

const METHOD_LABEL: Record<PayoutMethod, string> = {
  gcash: 'GCash',
  paymaya: 'PayMaya',
  bank_transfer: 'Bank transfer',
};

const BANKS = ['BDO', 'BPI', 'Metrobank', 'UnionBank', 'LandBank', 'PNB', 'RCBC', 'Security Bank', 'Other'];

// maximumFractionDigits matters: with only a minimum set, a balance carrying float dust
// renders as "PHP 1,234.5600000000001".
const php = (value: number) =>
  `PHP ${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Always round *down* to the centavo. The MAX button used to fill in
// availableBalance.toString(), which on a balance with more than two decimals produced a
// value the input's own step="0.01" then rejected - the browser refused to submit the
// form and explained why with "the two nearest valid values are 1234.56 and 1234.57".
const floorCentavos = (value: number) => Math.floor(value * 100) / 100;

// Deliberately mirrors normalisePhMobile() in backend/src/config/payoutConfig.ts. This
// copy is here to tell the provider what's wrong while they type; the backend's copy is
// what actually guards the stored number.
const normalisePhMobile = (value: string): string | null => {
  const digits = value.replace(/[\s()\-]/g, '');
  const match = /^(?:\+?63|0)(9\d{9})$/.exec(digits);
  return match ? `0${match[1]}` : null;
};

export function PayoutRequestForm({ availableBalance, minimumPayout, onSuccess, onCancel }: PayoutRequestFormProps) {
  const [step, setStep] = useState<'details' | 'review'>('details');
  const [amount, setAmount] = useState('');
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod>('gcash');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Field errors stay hidden until a field has been visited or the step has been
  // submitted, so the form doesn't shout at someone who has only just opened it.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showAllErrors, setShowAllErrors] = useState(false);

  const [bankDetails, setBankDetails] = useState({
    bank_name: '',
    bank_name_other: '',
    account_name: '',
    account_number: '',
  });

  const [ewalletDetails, setEwalletDetails] = useState({
    phone_number: '',
    account_name: '',
  });

  const amountRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Escape, the backdrop and the scroll lock all come from useModal, which every modal
  // in the app now shares. Inert while submitting or on the success screen.
  const { overlayProps, cardProps } = useModal(onCancel, {
    closeOnEscape: !loading && !success,
    closeOnBackdrop: !loading && !success,
    labelledBy: 'payout-form-title',
  });

  useEffect(() => {
    amountRef.current?.focus();
  }, []);

  // Cleared on unmount - the success screen's auto-close used to fire into a component
  // that could already be gone.
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const parsedAmount = parseFloat(amount);
  const hasAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const remainingBalance = hasAmount ? Math.max(0, floorCentavos(availableBalance - parsedAmount)) : availableBalance;

  const accountName = (payoutMethod === 'bank_transfer' ? bankDetails.account_name : ewalletDetails.account_name).trim();
  const bankName = bankDetails.bank_name === 'Other' ? bankDetails.bank_name_other.trim() : bankDetails.bank_name;
  const accountNumber = bankDetails.account_number.replace(/[\s\-]/g, '');
  const normalisedPhone = normalisePhMobile(ewalletDetails.phone_number);

  // One validation pass drives the inline messages, the Continue button and the review
  // step. Previously the button only checked the amount against the minimum, so a form
  // with an empty phone number or an amount over the balance looked perfectly
  // submittable and only failed once the request came back.
  const errors = useMemo(() => {
    const next: Record<string, string> = {};

    if (!amount.trim()) {
      next.amount = 'Enter an amount';
    } else if (!hasAmount) {
      next.amount = 'Enter a valid amount';
    } else if (parsedAmount < minimumPayout) {
      next.amount = `The minimum payout is ${php(minimumPayout)}`;
    } else if (parsedAmount > availableBalance) {
      next.amount = `That is more than your available balance of ${php(availableBalance)}`;
    }

    if (accountName.length < 2) {
      next.account_name = "Enter the account holder's name";
    }

    if (payoutMethod === 'bank_transfer') {
      if (!bankDetails.bank_name) {
        next.bank_name = 'Choose your bank';
      } else if (bankDetails.bank_name === 'Other' && !bankDetails.bank_name_other.trim()) {
        // Picking "Other" used to store the literal word "Other" as the bank name,
        // leaving the admin with no idea where to send the money.
        next.bank_name_other = 'Enter your bank name';
      }
      if (!accountNumber) {
        next.account_number = 'Enter your account number';
      } else if (!/^\d{6,20}$/.test(accountNumber)) {
        next.account_number = 'Account numbers are 6 to 20 digits';
      }
    } else if (!ewalletDetails.phone_number.trim()) {
      next.phone_number = 'Enter your mobile number';
    } else if (!normalisedPhone) {
      next.phone_number = 'Use a Philippine mobile number, e.g. 09171234567';
    }

    return next;
  }, [amount, hasAmount, parsedAmount, minimumPayout, availableBalance, accountName, payoutMethod,
    bankDetails.bank_name, bankDetails.bank_name_other, accountNumber, ewalletDetails.phone_number, normalisedPhone]);

  const isValid = Object.keys(errors).length === 0;
  const errorFor = (field: string) => ((touched[field] || showAllErrors) ? errors[field] : undefined);

  const destination = payoutMethod === 'bank_transfer'
    ? { channel: bankName || 'Bank transfer', account: accountNumber, name: accountName }
    : { channel: METHOD_LABEL[payoutMethod], account: normalisedPhone || ewalletDetails.phone_number.trim(), name: accountName };

  const handleAmountChange = (raw: string) => {
    // The amount is parsed here rather than by type="number". The native control brought
    // min/max/step validation with it, and the browser's own "please enter a valid value"
    // tooltip fired before handleSubmit ever ran - so none of the messages this form
    // takes the trouble to write were reachable.
    const cleaned = raw.replace(/[^\d.]/g, '');
    const [whole, ...rest] = cleaned.split('.');
    const next = rest.length > 0 ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
    setAmount(next.slice(0, 12));
  };

  const fillAmount = (fraction: number) => {
    const value = floorCentavos(availableBalance * fraction);
    setAmount(value > 0 ? value.toFixed(2) : '');
    setTouched(t => ({ ...t, amount: true }));
  };

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isValid) {
      setShowAllErrors(true);
      return;
    }
    setStep('review');
  };

  const handleConfirm = async () => {
    setError(null);
    setLoading(true);

    const payoutDetails = payoutMethod === 'bank_transfer'
      ? { bank_name: bankName, account_name: accountName, account_number: accountNumber }
      : { phone_number: destination.account, account_name: accountName };

    try {
      await payoutService.requestPayout(parsedAmount, payoutMethod, payoutDetails);
      setSuccess(true);
      closeTimer.current = setTimeout(onSuccess, 2500);
    } catch (err: any) {
      // Back to the form with the message attached - the balance may have moved in
      // another tab, or the request may have hit the concurrent-request limit.
      setError(err?.message || 'Failed to request payout');
      setStep('details');
    } finally {
      setLoading(false);
    }
  };

  const fieldClass = (field: string) =>
    `w-full px-4 py-3 border rounded-xl focus:ring-2 focus:border-transparent outline-none ${
      errorFor(field) ? 'border-red-400 focus:ring-red-500' : 'border-gray-200 focus:ring-purple-500'
    }`;

  const FieldError = ({ field }: { field: string }) => {
    const message = errorFor(field);
    if (!message) return null;
    return <p className="text-xs text-red-600 mt-1">{message}</p>;
  };

  const body = success ? (
    <div className="p-8 text-center">
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <CheckCircle className="w-8 h-8 text-green-600" />
      </div>
      <h3 className="text-xl font-semibold text-gray-900 mb-2">Payout requested</h3>
      <p className="text-gray-600">
        {php(parsedAmount)} is on its way to your {destination.channel} account ending {destination.account.slice(-4)}.
      </p>
      <p className="text-sm text-gray-500 mt-2">
        The amount is now on hold and no longer part of your available balance. You'll receive
        your funds within 1-3 business days after approval.
      </p>
      <button
        onClick={onSuccess}
        className="mt-6 w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors font-medium"
      >
        Done
      </button>
    </div>
  ) : step === 'review' ? (
    <div className="p-6 space-y-6">
      {/* A payout can't be edited once it exists - only cancelled while it is still
          pending - and a mistyped account number is money sent to a stranger. This step
          is the last point at which that is cheap to catch. */}
      <div className="bg-purple-50 rounded-xl p-4 text-center">
        <p className="text-sm text-gray-600 mb-1">You are requesting</p>
        <p className="text-3xl font-bold text-gray-900">{php(parsedAmount)}</p>
      </div>

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <span className="text-sm text-gray-500">Method</span>
          <span className="text-sm font-medium text-gray-900 text-right">{destination.channel}</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <span className="text-sm text-gray-500">
            {payoutMethod === 'bank_transfer' ? 'Account number' : 'Mobile number'}
          </span>
          <span className="text-sm font-medium text-gray-900 text-right font-mono break-all">{destination.account}</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <span className="text-sm text-gray-500">Account name</span>
          <span className="text-sm font-medium text-gray-900 text-right">{destination.name}</span>
        </div>
        <div className="flex items-start justify-between gap-4 pt-3 border-t border-gray-200">
          <span className="text-sm text-gray-500">Balance after request</span>
          <span className="text-sm font-medium text-gray-900 text-right">{php(remainingBalance)}</span>
        </div>
      </div>

      <div className="bg-amber-100 rounded-xl p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-amber-700">
          Check the account details carefully. Once a payout is approved the transfer cannot
          be reversed, and we can't recover money sent to the wrong account.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setStep('details')}
          disabled={loading}
          className="px-4 py-3 border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-100 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={loading}
          className="flex-1 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <ArrowUpRight className="w-5 h-5" />
              Confirm payout
            </>
          )}
        </button>
      </div>
    </div>
  ) : (
    <form onSubmit={handleContinue} noValidate className="p-6 space-y-6">
      {/* Available Balance */}
      <div className="bg-gray-50 rounded-xl p-4">
        <p className="text-sm text-gray-600 mb-1">Available Balance</p>
        <p className="text-2xl font-bold text-gray-900">{php(availableBalance)}</p>
      </div>

      {/* Amount Input */}
      <div>
        <label htmlFor="payout-amount" className="block text-sm font-medium text-gray-700 mb-2">
          Payout Amount
        </label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">PHP</span>
          <input
            id="payout-amount"
            ref={amountRef}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            onBlur={() => setTouched(t => ({ ...t, amount: true }))}
            placeholder="0.00"
            className={`${fieldClass('amount')} pl-14`}
          />
        </div>
        <FieldError field="amount" />
        <div className="flex items-center gap-2 mt-2">
          {/* Quick amounts, so reaching a valid figure doesn't mean doing arithmetic
              against a balance printed elsewhere on the screen. */}
          {[0.25, 0.5, 1].map((fraction) => (
            <button
              key={fraction}
              type="button"
              onClick={() => fillAmount(fraction)}
              disabled={floorCentavos(availableBalance * fraction) < minimumPayout}
              className="px-3 py-1 text-xs font-medium text-purple-600 bg-purple-50 rounded-lg hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {fraction === 1 ? 'MAX' : `${fraction * 100}%`}
            </button>
          ))}
          <span className="text-xs text-gray-500 ml-auto">
            Minimum {php(minimumPayout)}
          </span>
        </div>
        {hasAmount && !errors.amount && (
          <p className="text-xs text-gray-500 mt-2">
            Balance after this request: {php(remainingBalance)}
          </p>
        )}
      </div>

      {/* Payout Method */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Payout Method</label>
        <div className="grid grid-cols-3 gap-3">
          {([
            { id: 'gcash' as const, Icon: Smartphone },
            { id: 'paymaya' as const, Icon: Wallet },
            { id: 'bank_transfer' as const, Icon: Building2 },
          ]).map(({ id, Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={payoutMethod === id}
              onClick={() => { setPayoutMethod(id); setShowAllErrors(false); }}
              className={`p-4 rounded-xl border-2 transition-colors ${
                payoutMethod === id ? 'border-purple-600 bg-purple-50' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <Icon className={`w-6 h-6 mx-auto mb-2 ${payoutMethod === id ? 'text-purple-600' : 'text-gray-400'}`} />
              <p className={`text-sm font-medium ${payoutMethod === id ? 'text-purple-600' : 'text-gray-600'}`}>
                {id === 'bank_transfer' ? 'Bank' : METHOD_LABEL[id]}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Payout Details */}
      {payoutMethod === 'bank_transfer' ? (
        <div className="space-y-4">
          <div>
            <label htmlFor="payout-bank" className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
            <select
              id="payout-bank"
              value={bankDetails.bank_name}
              onChange={(e) => setBankDetails({ ...bankDetails, bank_name: e.target.value })}
              onBlur={() => setTouched(t => ({ ...t, bank_name: true }))}
              className={fieldClass('bank_name')}
            >
              <option value="">Select bank</option>
              {BANKS.map(bank => <option key={bank} value={bank}>{bank}</option>)}
            </select>
            <FieldError field="bank_name" />
          </div>
          {bankDetails.bank_name === 'Other' && (
            <div>
              <label htmlFor="payout-bank-other" className="block text-sm font-medium text-gray-700 mb-1">
                Which bank?
              </label>
              <input
                id="payout-bank-other"
                type="text"
                value={bankDetails.bank_name_other}
                onChange={(e) => setBankDetails({ ...bankDetails, bank_name_other: e.target.value })}
                onBlur={() => setTouched(t => ({ ...t, bank_name_other: true }))}
                placeholder="e.g. China Bank"
                className={fieldClass('bank_name_other')}
              />
              <FieldError field="bank_name_other" />
            </div>
          )}
          <div>
            <label htmlFor="payout-account-name" className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
            <input
              id="payout-account-name"
              type="text"
              value={bankDetails.account_name}
              onChange={(e) => setBankDetails({ ...bankDetails, account_name: e.target.value })}
              onBlur={() => setTouched(t => ({ ...t, account_name: true }))}
              placeholder="Juan Dela Cruz"
              className={fieldClass('account_name')}
            />
            <FieldError field="account_name" />
          </div>
          <div>
            <label htmlFor="payout-account-number" className="block text-sm font-medium text-gray-700 mb-1">Account Number</label>
            <input
              id="payout-account-number"
              type="text"
              inputMode="numeric"
              value={bankDetails.account_number}
              onChange={(e) => setBankDetails({ ...bankDetails, account_number: e.target.value })}
              onBlur={() => setTouched(t => ({ ...t, account_number: true }))}
              placeholder="1234567890"
              className={fieldClass('account_number')}
            />
            <FieldError field="account_number" />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label htmlFor="payout-phone" className="block text-sm font-medium text-gray-700 mb-1">
              {METHOD_LABEL[payoutMethod]} Number
            </label>
            <input
              id="payout-phone"
              type="tel"
              inputMode="tel"
              value={ewalletDetails.phone_number}
              onChange={(e) => setEwalletDetails({ ...ewalletDetails, phone_number: e.target.value })}
              onBlur={() => setTouched(t => ({ ...t, phone_number: true }))}
              placeholder="09123456789"
              className={fieldClass('phone_number')}
            />
            <FieldError field="phone_number" />
            {/* GCash and PayMaya are separate accounts; the number carried over when the
                method was switched, which is an easy way to send money nowhere. */}
            <p className="text-xs text-gray-500 mt-1">
              The mobile number registered to your {METHOD_LABEL[payoutMethod]} account.
            </p>
          </div>
          <div>
            <label htmlFor="payout-ewallet-name" className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
            <input
              id="payout-ewallet-name"
              type="text"
              value={ewalletDetails.account_name}
              onChange={(e) => setEwalletDetails({ ...ewalletDetails, account_name: e.target.value })}
              onBlur={() => setTouched(t => ({ ...t, account_name: true }))}
              placeholder="Juan Dela Cruz"
              className={fieldClass('account_name')}
            />
            <FieldError field="account_name" />
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {showAllErrors && !isValid && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">Check the highlighted fields before continuing.</p>
        </div>
      )}

      {/* Deliberately not disabled while the form is incomplete: a greyed-out button that
          doesn't say what is missing is the thing this form used to do. Pressing it
          reveals every outstanding problem at once instead. */}
      <button
        type="submit"
        className="w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors font-medium flex items-center justify-center gap-2"
      >
        Review request
      </button>

      <p className="text-xs text-gray-500 text-center">
        Payouts are typically processed within 1-3 business days.
      </p>
    </form>
  );

  return (
    <div className="modal-overlay" {...overlayProps}>
      <div className="modal-card modal-card--md modal-card--plain" {...cardProps}>
        {!success && (
          <div className="modal-header flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <ArrowUpRight className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <h3 id="payout-form-title" className="text-lg font-semibold text-gray-900">
                    {step === 'review' ? 'Confirm Payout' : 'Request Payout'}
                  </h3>
                  <p className="text-xs text-gray-500">Step {step === 'review' ? 2 : 1} of 2</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                aria-label="Close"
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
        )}
        {body}
      </div>
    </div>
  );
}
