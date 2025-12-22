import { apiClient } from '../client';

export interface Wallet {
  id: string;
  provider_id: string;
  available_balance: number;
  pending_balance: number;
  total_earnings: number;
  total_paid_out: number;
  pending_payouts_count: number;
  pending_payouts_total: number;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  wallet_id: string;
  payment_id?: string;
  payout_id?: string;
  type: 'payment_received' | 'commission_deducted' | 'payout_requested' | 'payout_completed' | 'payout_cancelled' | 'refund' | 'adjustment';
  amount: number;
  balance_after: number;
  reference_id?: string;
  description?: string;
  created_at: string;
  booking_id?: string;
}

export interface Payout {
  id: string;
  provider_id: string;
  wallet_id: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected' | 'processing' | 'completed' | 'failed';
  payout_method: string;
  payout_details?: Record<string, any>;
  rejection_reason?: string;
  admin_notes?: string;
  requested_at: string;
  processed_at?: string;
  completed_at?: string;
  provider_name?: string;
  provider_email?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    limit: number;
    offset: number;
  };
}

const walletService = {
  // Get provider's wallet
  async getMyWallet(): Promise<Wallet> {
    const resp = await apiClient.get<{ data: Wallet }>('/wallet/my');
    return resp.data;
  },

  // Get wallet by provider ID (admin)
  async getWalletByProvider(providerId: string): Promise<Wallet> {
    const resp = await apiClient.get<{ data: Wallet }>(`/wallet/provider/${providerId}`);
    return resp.data;
  },

  // Get wallet transactions
  async getTransactions(limit = 50, offset = 0): Promise<PaginatedResponse<Transaction>> {
    const resp = await apiClient.get<PaginatedResponse<Transaction>>(`/wallet/transactions?limit=${limit}&offset=${offset}`);
    return resp;
  },

  // Release pending balance for a completed booking
  async releasePendingBalance(bookingId: string): Promise<{
    released_amount: number;
    new_available_balance: number;
    new_pending_balance: number;
  }> {
    const resp = await apiClient.post<{ data: { released_amount: number; new_available_balance: number; new_pending_balance: number } }>('/wallet/release-pending', {
      booking_id: bookingId,
    });
    return resp.data;
  },

  // Admin: Adjust wallet balance
  async adjustWallet(providerId: string, amount: number, type: 'available' | 'pending', description?: string): Promise<{
    wallet_id: string;
    adjustment: number;
    balance_type: string;
    new_balance: number;
  }> {
    const resp = await apiClient.post<{ data: { wallet_id: string; adjustment: number; balance_type: string; new_balance: number } }>('/wallet/adjust', {
      provider_id: providerId,
      amount,
      type,
      description,
    });
    return resp.data;
  },
};

export const payoutService = {
  // Request a payout
  async requestPayout(amount: number, payoutMethod: string, payoutDetails?: Record<string, any>): Promise<Payout & { new_available_balance: number }> {
    const resp = await apiClient.post<{ data: Payout & { new_available_balance: number } }>('/payouts/request', {
      amount,
      payout_method: payoutMethod,
      payout_details: payoutDetails,
    });
    return resp.data;
  },

  // Get my payouts
  async getMyPayouts(limit = 50, offset = 0, status?: string): Promise<PaginatedResponse<Payout>> {
    let url = `/payouts/my?limit=${limit}&offset=${offset}`;
    if (status) url += `&status=${status}`;
    const resp = await apiClient.get<PaginatedResponse<Payout>>(url);
    return resp;
  },

  // Get specific payout
  async getPayout(payoutId: string): Promise<Payout> {
    const resp = await apiClient.get<{ data: Payout }>(`/payouts/${payoutId}`);
    return resp.data;
  },

  // Admin: Get all payouts
  async getAllPayouts(limit = 50, offset = 0, status?: string): Promise<PaginatedResponse<Payout>> {
    let url = `/payouts?limit=${limit}&offset=${offset}`;
    if (status) url += `&status=${status}`;
    const resp = await apiClient.get<PaginatedResponse<Payout>>(url);
    return resp;
  },

  // Admin: Update payout status
  async updatePayoutStatus(payoutId: string, status: string, adminNotes?: string, rejectionReason?: string): Promise<Payout> {
    const resp = await apiClient.patch<{ data: Payout }>(`/payouts/${payoutId}/status`, {
      status,
      admin_notes: adminNotes,
      rejection_reason: rejectionReason,
    });
    return resp.data;
  },

  // Cancel payout request
  async cancelPayout(payoutId: string): Promise<{
    message: string;
    refunded_amount: number;
    new_available_balance: number;
  }> {
    const resp = await apiClient.delete<{ data: { message: string; refunded_amount: number; new_available_balance: number } }>(`/payouts/${payoutId}`);
    return resp.data;
  },
};

export default walletService;
