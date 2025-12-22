import { useState } from 'react';
import { ArrowUpRight, X, Loader2, AlertCircle, CheckCircle, Building2, Smartphone, Wallet } from 'lucide-react';
import { payoutService } from '../api/services/walletService';

interface PayoutRequestFormProps {
  availableBalance: number;
  onSuccess: () => void;
  onCancel: () => void;
}

type PayoutMethod = 'bank_transfer' | 'gcash' | 'paymaya';

const MINIMUM_PAYOUT = 500;

export function PayoutRequestForm({ availableBalance, onSuccess, onCancel }: PayoutRequestFormProps) {
  const [amount, setAmount] = useState('');
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod>('gcash');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Bank transfer details
  const [bankDetails, setBankDetails] = useState({
    bank_name: '',
    account_name: '',
    account_number: '',
  });

  // E-wallet details
  const [ewalletDetails, setEwalletDetails] = useState({
    phone_number: '',
    account_name: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const payoutAmount = parseFloat(amount);

    if (isNaN(payoutAmount) || payoutAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (payoutAmount < MINIMUM_PAYOUT) {
      setError(`Minimum payout amount is PHP ${MINIMUM_PAYOUT}`);
      return;
    }

    if (payoutAmount > availableBalance) {
      setError('Amount exceeds available balance');
      return;
    }

    // Validate payout details
    let payoutDetails: Record<string, any>;
    if (payoutMethod === 'bank_transfer') {
      if (!bankDetails.bank_name || !bankDetails.account_name || !bankDetails.account_number) {
        setError('Please fill in all bank details');
        return;
      }
      payoutDetails = bankDetails;
    } else {
      if (!ewalletDetails.phone_number || !ewalletDetails.account_name) {
        setError('Please fill in all e-wallet details');
        return;
      }
      payoutDetails = ewalletDetails;
    }

    setLoading(true);

    try {
      await payoutService.requestPayout(payoutAmount, payoutMethod, payoutDetails);
      setSuccess(true);
      setTimeout(() => {
        onSuccess();
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to request payout');
    } finally {
      setLoading(false);
    }
  };

  const handleMaxAmount = () => {
    setAmount(availableBalance.toString());
  };

  if (success) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-8 h-8 text-green-600" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">Payout Requested!</h3>
        <p className="text-gray-600">
          Your payout request for PHP {parseFloat(amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })} has been submitted.
        </p>
        <p className="text-sm text-gray-500 mt-2">
          You'll receive your funds within 1-3 business days after approval.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg max-w-md w-full">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 rounded-lg">
            <ArrowUpRight className="w-5 h-5 text-purple-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">Request Payout</h3>
        </div>
        <button
          onClick={onCancel}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        {/* Available Balance */}
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-sm text-gray-600 mb-1">Available Balance</p>
          <p className="text-2xl font-bold text-gray-900">
            PHP {availableBalance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
          </p>
        </div>

        {/* Amount Input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Payout Amount
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">PHP</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              min={MINIMUM_PAYOUT}
              max={availableBalance}
              step="0.01"
              className="w-full pl-14 pr-20 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
            />
            <button
              type="button"
              onClick={handleMaxAmount}
              className="absolute right-3 top-1/2 -translate-y-1/2 px-3 py-1 text-xs font-medium text-purple-600 bg-purple-50 rounded-lg hover:bg-purple-100"
            >
              MAX
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Minimum: PHP {MINIMUM_PAYOUT.toLocaleString()}
          </p>
        </div>

        {/* Payout Method */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Payout Method
          </label>
          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setPayoutMethod('gcash')}
              className={`p-4 rounded-xl border-2 transition-colors ${
                payoutMethod === 'gcash'
                  ? 'border-purple-600 bg-purple-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <Smartphone className={`w-6 h-6 mx-auto mb-2 ${payoutMethod === 'gcash' ? 'text-purple-600' : 'text-gray-400'}`} />
              <p className={`text-sm font-medium ${payoutMethod === 'gcash' ? 'text-purple-600' : 'text-gray-600'}`}>GCash</p>
            </button>
            <button
              type="button"
              onClick={() => setPayoutMethod('paymaya')}
              className={`p-4 rounded-xl border-2 transition-colors ${
                payoutMethod === 'paymaya'
                  ? 'border-purple-600 bg-purple-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <Wallet className={`w-6 h-6 mx-auto mb-2 ${payoutMethod === 'paymaya' ? 'text-purple-600' : 'text-gray-400'}`} />
              <p className={`text-sm font-medium ${payoutMethod === 'paymaya' ? 'text-purple-600' : 'text-gray-600'}`}>PayMaya</p>
            </button>
            <button
              type="button"
              onClick={() => setPayoutMethod('bank_transfer')}
              className={`p-4 rounded-xl border-2 transition-colors ${
                payoutMethod === 'bank_transfer'
                  ? 'border-purple-600 bg-purple-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <Building2 className={`w-6 h-6 mx-auto mb-2 ${payoutMethod === 'bank_transfer' ? 'text-purple-600' : 'text-gray-400'}`} />
              <p className={`text-sm font-medium ${payoutMethod === 'bank_transfer' ? 'text-purple-600' : 'text-gray-600'}`}>Bank</p>
            </button>
          </div>
        </div>

        {/* Payout Details */}
        {payoutMethod === 'bank_transfer' ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
              <select
                value={bankDetails.bank_name}
                onChange={(e) => setBankDetails({ ...bankDetails, bank_name: e.target.value })}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
              >
                <option value="">Select bank</option>
                <option value="BDO">BDO</option>
                <option value="BPI">BPI</option>
                <option value="Metrobank">Metrobank</option>
                <option value="UnionBank">UnionBank</option>
                <option value="LandBank">LandBank</option>
                <option value="PNB">PNB</option>
                <option value="RCBC">RCBC</option>
                <option value="Security Bank">Security Bank</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
              <input
                type="text"
                value={bankDetails.account_name}
                onChange={(e) => setBankDetails({ ...bankDetails, account_name: e.target.value })}
                placeholder="Juan Dela Cruz"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Account Number</label>
              <input
                type="text"
                value={bankDetails.account_number}
                onChange={(e) => setBankDetails({ ...bankDetails, account_number: e.target.value })}
                placeholder="1234567890"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
              <input
                type="tel"
                value={ewalletDetails.phone_number}
                onChange={(e) => setEwalletDetails({ ...ewalletDetails, phone_number: e.target.value })}
                placeholder="09123456789"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
              <input
                type="text"
                value={ewalletDetails.account_name}
                onChange={(e) => setEwalletDetails({ ...ewalletDetails, account_name: e.target.value })}
                placeholder="Juan Dela Cruz"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
              />
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

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading || !amount || parseFloat(amount) < MINIMUM_PAYOUT}
          className="w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <ArrowUpRight className="w-5 h-5" />
              Request Payout
            </>
          )}
        </button>

        {/* Info */}
        <p className="text-xs text-gray-500 text-center">
          Payouts are typically processed within 1-3 business days.
        </p>
      </form>
    </div>
  );
}
