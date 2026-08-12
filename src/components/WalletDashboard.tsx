import { useState, useEffect } from 'react';
import { Wallet, ArrowUpRight, ArrowDownLeft, Clock, CheckCircle, XCircle, Loader2, RefreshCw, TrendingUp, History, AlertCircle } from 'lucide-react';
import walletService, { payoutService, Wallet as WalletType, Transaction, Payout } from '../api/services/walletService';
import { PayoutRequestForm } from './PayoutRequestForm';
import { useToast } from '../context/ToastContext';

const DEFAULT_MINIMUM_PAYOUT = 500;
const DEFAULT_MAX_CONCURRENT_PAYOUTS = 3;

// Every amount on this page goes through here. toLocaleString with only a minimum set
// let float dust print in full ("PHP 1,234.5600000000001"), and a wallet row missing a
// column threw inside render because `wallet?.available_balance.toLocaleString()` only
// guards against the wallet being absent, not the number.
const php = (value: number | null | undefined) =>
  `PHP ${(Number(value) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// What the provider asked us to send the money to, read back out of the stored details.
const describeDestination = (payout: Payout): string | null => {
  const details = payout.payout_details;
  if (!details) return null;
  const account = String(details.account_number || details.phone_number || '').trim();
  const bank = String(details.bank_name || '').trim();
  if (!account) return bank || null;
  return bank ? `${bank} ${account}` : account;
};

export function WalletDashboard() {
  const toast = useToast();
  const [wallet, setWallet] = useState<WalletType | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions' | 'payouts'>('overview');
  const [showPayoutForm, setShowPayoutForm] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Which row is asking "cancel this?", and which one is mid-request. Cancel used to be
  // a bare confirm()/alert() pair with no in-flight guard, so a second click fired a
  // second DELETE and the provider was shown the 409 from it as a raw browser alert.
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const [walletData, transactionsData, payoutsData] = await Promise.all([
        walletService.getMyWallet(),
        walletService.getTransactions(20, 0),
        payoutService.getMyPayouts(20, 0),
      ]);

      setWallet(walletData);
      setTransactions(transactionsData.data);
      setPayouts(payoutsData.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load wallet data');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const handlePayoutSuccess = () => {
    setShowPayoutForm(false);
    toast.success('Payout requested', 'The amount is on hold until an admin processes it.');
    fetchData();
  };

  const handleCancelPayout = async (payoutId: string) => {
    if (cancellingId) return;
    setCancellingId(payoutId);

    try {
      const result = await payoutService.cancelPayout(payoutId);
      setConfirmingCancelId(null);
      toast.success(
        'Payout cancelled',
        result.refunded_amount > 0
          ? `${php(result.refunded_amount)} is back in your available balance.`
          : 'The request has been withdrawn.'
      );
      await fetchData();
    } catch (err: any) {
      toast.error('Could not cancel payout', err?.message || 'Please try again.');
      // Re-read the list: the most likely reason a cancel fails is that the request has
      // already moved on to approved or been cancelled elsewhere.
      await fetchData();
    } finally {
      setCancellingId(null);
    }
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'payment_received':
        return <ArrowDownLeft className="w-5 h-5 text-green-600" />;
      case 'payout_requested':
      case 'payout_completed':
        return <ArrowUpRight className="w-5 h-5 text-red-600" />;
      case 'payout_cancelled':
        return <XCircle className="w-5 h-5 text-gray-600" />;
      default:
        return <Clock className="w-5 h-5 text-gray-600" />;
    }
  };

  const getTransactionColor = (type: string) => {
    switch (type) {
      case 'payment_received':
        return 'text-green-600';
      case 'payout_requested':
      case 'payout_completed':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  const getPayoutStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-700">Pending</span>;
      case 'approved':
        return <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-700">Approved</span>;
      case 'processing':
        return <span className="px-2 py-1 text-xs rounded-full bg-purple-100 text-purple-700">Processing</span>;
      case 'completed':
        return <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-700">Completed</span>;
      case 'rejected':
      case 'failed':
        return <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-700">{status}</span>;
      default:
        return <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-700">{status}</span>;
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Why the Request Payout button is or isn't available. The button was simply greyed
  // out below the minimum with nothing said about it, and the concurrent-request limit
  // wasn't reflected here at all - the provider met it as a rejection after filling in
  // the entire form, even though pending_payouts_count was already on screen's data.
  const availableBalance = Number(wallet?.available_balance) || 0;
  const minimumPayout = Number(wallet?.minimum_payout_amount) || DEFAULT_MINIMUM_PAYOUT;
  const maxConcurrentPayouts = Number(wallet?.max_concurrent_payouts) || DEFAULT_MAX_CONCURRENT_PAYOUTS;
  const pendingPayoutsCount = Number(wallet?.pending_payouts_count) || 0;
  const atPayoutLimit = pendingPayoutsCount >= maxConcurrentPayouts;
  const belowMinimum = availableBalance < minimumPayout;
  const payoutBlockedReason = atPayoutLimit
    ? `You have ${pendingPayoutsCount} payout requests in progress, the most allowed at once. Cancel a pending request or wait for one to be processed.`
    : belowMinimum
      ? `You need at least ${php(minimumPayout)} available to request a payout. You have ${php(availableBalance)}.`
      : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <XCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
        <p className="text-red-700">{error}</p>
        <button
          onClick={fetchData}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-gray-900">Wallet</h2>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-purple-600 to-purple-700 rounded-2xl p-6 text-white">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-white/20 rounded-lg">
              <Wallet className="w-6 h-6" />
            </div>
            <span className="text-purple-100">Available Balance</span>
          </div>
          <p className="text-3xl font-bold">{php(wallet?.available_balance)}</p>
          <p className="text-sm text-purple-200 mt-2">
            {pendingPayoutsCount > 0
              ? `${php(wallet?.pending_payouts_total)} already requested`
              : 'Ready to withdraw'}
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <Clock className="w-6 h-6 text-yellow-600" />
            </div>
            <span className="text-gray-600">Pending Balance</span>
          </div>
          <p className="text-3xl font-bold text-gray-900">{php(wallet?.pending_balance)}</p>
          <p className="text-sm text-gray-500 mt-2">Released after service completion</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-green-100 rounded-lg">
              <TrendingUp className="w-6 h-6 text-green-600" />
            </div>
            <span className="text-gray-600">Total Earnings</span>
          </div>
          <p className="text-3xl font-bold text-gray-900">{php(wallet?.total_earnings)}</p>
          <p className="text-sm text-gray-500 mt-2">Paid out: {php(wallet?.total_paid_out)}</p>
        </div>
      </div>

      {/* Request Payout */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-2 text-sm text-gray-600">
          {payoutBlockedReason ? (
            <>
              <AlertCircle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
              <p>{payoutBlockedReason}</p>
            </>
          ) : pendingPayoutsCount > 0 ? (
            <>
              <Clock className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
              <p>
                {pendingPayoutsCount} of {maxConcurrentPayouts} payout requests in progress,
                totalling {php(wallet?.pending_payouts_total)}.
              </p>
            </>
          ) : (
            <span />
          )}
        </div>
        <button
          onClick={() => setShowPayoutForm(true)}
          disabled={!!payoutBlockedReason}
          title={payoutBlockedReason || undefined}
          className="px-6 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 flex-shrink-0"
        >
          <ArrowUpRight className="w-5 h-5" />
          Request Payout
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 overflow-x-auto">
        <nav className="flex gap-4 sm:gap-6 min-w-max">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'transactions', label: 'Transactions' },
            { id: 'payouts', label: 'Payouts' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Transactions */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-gray-900">Recent Transactions</h3>
              <button
                onClick={() => setActiveTab('transactions')}
                className="text-sm text-purple-600 hover:text-purple-700"
              >
                View All
              </button>
            </div>
            <div className="space-y-3">
              {transactions.slice(0, 5).map((tx) => (
                <div key={tx.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div className="flex items-center gap-3">
                    {getTransactionIcon(tx.type)}
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {tx.type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                      </p>
                      <p className="text-xs text-gray-500">{formatDate(tx.created_at)}</p>
                    </div>
                  </div>
                  <p className={`font-medium ${getTransactionColor(tx.type)}`}>
                    {tx.amount > 0 ? '+' : ''}{php(tx.amount)}
                  </p>
                </div>
              ))}
              {transactions.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">No transactions yet</p>
              )}
            </div>
          </div>

          {/* Recent Payouts */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-gray-900">Recent Payouts</h3>
              <button
                onClick={() => setActiveTab('payouts')}
                className="text-sm text-purple-600 hover:text-purple-700"
              >
                View All
              </button>
            </div>
            <div className="space-y-3">
              {payouts.slice(0, 5).map((payout) => (
                <div key={payout.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div className="flex items-center gap-3">
                    <ArrowUpRight className="w-5 h-5 text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{php(payout.amount)}</p>
                      <p className="text-xs text-gray-500">
                        {payout.payout_method?.replace(/_/g, ' ')}
                      </p>
                    </div>
                  </div>
                  {getPayoutStatusBadge(payout.status)}
                </div>
              ))}
              {payouts.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">No payout requests yet</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'transactions' && (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Description</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Balance After</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {getTransactionIcon(tx.type)}
                        <span className="text-sm text-gray-900">
                          {tx.type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-600 max-w-xs truncate">{tx.description}</p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`font-medium ${getTransactionColor(tx.type)}`}>
                        {tx.amount > 0 ? '+' : ''}{php(tx.amount)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {php(tx.balance_after)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(tx.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {transactions.length === 0 && (
              <div className="text-center py-12">
                <History className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No transactions yet</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'payouts' && (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Sent to</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Requested</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {payouts.map((payout) => (
                  <tr key={payout.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                      {php(payout.amount)}
                    </td>
                    {/* The destination was never shown anywhere after the request was
                        made, so a provider had no way to check where their money was
                        being sent - or to spot a typo while the request was still
                        cancellable. */}
                    <td className="px-6 py-4 text-sm text-gray-600">
                      <p className="whitespace-nowrap">{payout.payout_method?.replace(/_/g, ' ')}</p>
                      {describeDestination(payout) && (
                        <p className="text-xs text-gray-500 font-mono break-all">{describeDestination(payout)}</p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {getPayoutStatusBadge(payout.status)}
                      {payout.rejection_reason && (
                        <p className="text-xs text-red-500 mt-1">{payout.rejection_reason}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(payout.requested_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {payout.status === 'pending' && (
                        confirmingCancelId === payout.id ? (
                          // Replaces the browser confirm() dialog, which was the only
                          // native prompt left in this flow.
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-600">Cancel and refund?</span>
                            <button
                              onClick={() => handleCancelPayout(payout.id)}
                              disabled={cancellingId === payout.id}
                              className="text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {cancellingId === payout.id ? 'Cancelling...' : 'Yes'}
                            </button>
                            <button
                              onClick={() => setConfirmingCancelId(null)}
                              disabled={cancellingId === payout.id}
                              className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmingCancelId(payout.id)}
                            className="text-sm text-red-600 hover:text-red-700"
                          >
                            Cancel
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {payouts.length === 0 && (
              <div className="text-center py-12">
                <ArrowUpRight className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No payout requests yet</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Payout Request Modal. The form owns its own backdrop now, so it can scroll when
          it is taller than the viewport and can refuse to close mid-submit. */}
      {showPayoutForm && wallet && (
        <PayoutRequestForm
          availableBalance={availableBalance}
          minimumPayout={minimumPayout}
          onSuccess={handlePayoutSuccess}
          onCancel={() => setShowPayoutForm(false)}
        />
      )}
    </div>
  );
}
