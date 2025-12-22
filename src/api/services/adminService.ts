import { apiClient } from '../client';

// Types
export interface MetricsOverview {
  users: {
    total: number;
    thisMonth: number;
    growth: number;
  };
  providers: {
    total: number;
    verified: number;
    thisMonth: number;
  };
  bookings: {
    total: number;
    thisMonth: number;
    completed: number;
    cancelled: number;
    pending: number;
  };
  revenue: {
    total: number;
    commission: number;
    thisMonth: number;
    thisMonthCommission: number;
    growth: number;
  };
  activeUsers: number;
  pendingActions: {
    verifications: number;
    disputes: number;
    reviews: number;
  };
}

export interface ChartDataPoint {
  date: string;
  revenue?: number;
  commission?: number;
  transactions?: number;
  total?: number;
  completed?: number;
  cancelled?: number;
  pending?: number;
  clients?: number;
  providers?: number;
}

export interface CategoryMetric {
  category: string;
  providers: number;
  bookings: number;
  revenue: number;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  profile_image: string | null;
  category: string | null;
  is_verified: boolean;
  verification_status: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  booking_count: number;
  avg_rating: number;
}

export interface AdminUserDetail extends AdminUser {
  bookings_as_client: number;
  bookings_as_provider: number;
  review_count: number;
  total_spent: number;
  total_earned: number;
  recentActivity: Array<{
    type: string;
    id: string;
    status: string;
    created_at: string;
  }>;
}

export interface PendingVerification {
  id: string;
  email: string;
  name: string;
  profile_image: string | null;
  category: string | null;
  bio: string | null;
  years_experience: number | null;
  location: string | null;
  verification_status: string;
  verification_documents: any;
  created_at: string;
  service_count: number;
}

export interface AdminReview {
  id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  comment: string;
  moderation_status: string;
  moderation_reason: string | null;
  is_visible: boolean;
  created_at: string;
  reviewer_name: string;
  reviewer_email: string;
  reviewee_name: string;
  reviewee_email: string;
  booking_id: string | null;
  service_title: string | null;
}

export interface AdminDispute {
  id: string;
  booking_id: string | null;
  raised_by: string;
  against_user: string;
  type: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  evidence: any;
  resolution: string | null;
  resolution_type: string | null;
  refund_amount: number | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  raised_by_name: string;
  raised_by_email: string;
  against_name: string;
  against_email: string;
  assigned_to_name: string | null;
  service_title: string | null;
}

export interface DisputeComment {
  id: string;
  dispute_id: string;
  user_id: string;
  comment: string;
  is_internal: boolean;
  created_at: string;
  user_name: string;
  user_role: string;
}

export interface AdminBooking {
  id: string;
  client_id: string;
  provider_id: string;
  service_id: string;
  start_date: string;
  end_date: string;
  status: string;
  total_price: number;
  created_at: string;
  client_name: string;
  client_email: string;
  provider_name: string;
  provider_email: string;
  service_title: string;
  service_price: number;
  payment_status: string | null;
  payment_amount: number | null;
}

export interface AdminPayment {
  id: string;
  booking_id: string;
  client_id: string;
  provider_id: string;
  gross_amount: number;
  commission_amount: number;
  net_provider_amount: number;
  status: string;
  stripe_payment_intent_id: string;
  paid_at: string | null;
  created_at: string;
  client_name: string;
  provider_name: string;
  service_title: string | null;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_values: any;
  new_values: any;
  ip_address: string | null;
  user_agent: string | null;
  metadata: any;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    limit: number;
    offset: number;
  };
}

// Admin Service
const adminService = {
  // Metrics
  async getMetricsOverview(): Promise<MetricsOverview> {
    const resp = await apiClient.get<{ data: MetricsOverview }>('/admin/metrics/overview');
    return resp.data;
  },

  async getRevenueChart(period: 'week' | 'month' | 'year' = 'month'): Promise<ChartDataPoint[]> {
    const resp = await apiClient.get<{ data: ChartDataPoint[] }>(`/admin/metrics/revenue-chart?period=${period}`);
    return resp.data;
  },

  async getBookingsChart(period: 'week' | 'month' | 'year' = 'month'): Promise<ChartDataPoint[]> {
    const resp = await apiClient.get<{ data: ChartDataPoint[] }>(`/admin/metrics/bookings-chart?period=${period}`);
    return resp.data;
  },

  async getUsersChart(period: 'week' | 'month' | 'year' = 'month'): Promise<ChartDataPoint[]> {
    const resp = await apiClient.get<{ data: ChartDataPoint[] }>(`/admin/metrics/users-chart?period=${period}`);
    return resp.data;
  },

  async getCategoryMetrics(): Promise<CategoryMetric[]> {
    const resp = await apiClient.get<{ data: CategoryMetric[] }>('/admin/metrics/categories');
    return resp.data;
  },

  // Users
  async getUsers(params: {
    search?: string;
    role?: string;
    status?: string;
    verified?: string;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortOrder?: string;
  } = {}): Promise<PaginatedResponse<AdminUser>> {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) searchParams.append(key, String(value));
    });
    return apiClient.get<PaginatedResponse<AdminUser>>(`/admin/users?${searchParams.toString()}`);
  },

  async getUserById(id: string): Promise<AdminUserDetail> {
    const resp = await apiClient.get<{ data: AdminUserDetail }>(`/admin/users/${id}`);
    return resp.data;
  },

  async deleteUser(id: string, reason?: string): Promise<void> {
    await apiClient.delete<{ message: string }>(`/admin/users/${id}`);
  },

  async restoreUser(id: string): Promise<void> {
    await apiClient.post<{ message: string }>(`/admin/users/${id}/restore`);
  },

  // Provider Verification
  async getPendingVerifications(): Promise<PendingVerification[]> {
    const resp = await apiClient.get<{ data: PendingVerification[] }>('/admin/providers/pending-verification');
    return resp.data;
  },

  async verifyProvider(id: string): Promise<void> {
    await apiClient.post<{ message: string }>(`/admin/providers/${id}/verify`);
  },

  async rejectProvider(id: string, reason: string): Promise<void> {
    await apiClient.post<{ message: string }>(`/admin/providers/${id}/reject`, { reason });
  },

  // Reviews
  async getReviews(params: {
    status?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<PaginatedResponse<AdminReview>> {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) searchParams.append(key, String(value));
    });
    return apiClient.get<PaginatedResponse<AdminReview>>(`/admin/reviews?${searchParams.toString()}`);
  },

  async moderateReview(id: string, action: 'approve' | 'reject' | 'flag', reason?: string): Promise<void> {
    await apiClient.patch<{ message: string }>(`/admin/reviews/${id}/moderate`, { action, reason });
  },

  async deleteReview(id: string, reason?: string): Promise<void> {
    await apiClient.delete<{ message: string }>(`/admin/reviews/${id}`);
  },

  // Disputes
  async getDisputes(params: {
    status?: string;
    priority?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<PaginatedResponse<AdminDispute>> {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) searchParams.append(key, String(value));
    });
    return apiClient.get<PaginatedResponse<AdminDispute>>(`/admin/disputes?${searchParams.toString()}`);
  },

  async getDisputeById(id: string): Promise<AdminDispute & { comments: DisputeComment[] }> {
    const resp = await apiClient.get<{ data: AdminDispute & { comments: DisputeComment[] } }>(`/admin/disputes/${id}`);
    return resp.data;
  },

  async updateDispute(id: string, data: { status?: string; priority?: string; assigned_to?: string | null }): Promise<void> {
    await apiClient.patch<{ message: string }>(`/admin/disputes/${id}`, data);
  },

  async resolveDispute(id: string, data: { resolution: string; resolution_type: string; refund_amount?: number }): Promise<void> {
    await apiClient.post<{ message: string }>(`/admin/disputes/${id}/resolve`, data);
  },

  async addDisputeComment(id: string, comment: string, isInternal: boolean = true): Promise<DisputeComment> {
    const resp = await apiClient.post<{ data: DisputeComment }>(`/admin/disputes/${id}/comments`, {
      comment,
      is_internal: isInternal,
    });
    return resp.data;
  },

  // Bookings
  async getBookings(params: {
    status?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<PaginatedResponse<AdminBooking>> {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) searchParams.append(key, String(value));
    });
    return apiClient.get<PaginatedResponse<AdminBooking>>(`/admin/bookings?${searchParams.toString()}`);
  },

  // Payments
  async getPayments(params: {
    status?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<PaginatedResponse<AdminPayment>> {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) searchParams.append(key, String(value));
    });
    return apiClient.get<PaginatedResponse<AdminPayment>>(`/admin/payments?${searchParams.toString()}`);
  },

  // Audit Logs
  async getAuditLogs(params: {
    userId?: string;
    action?: string;
    entityType?: string;
    entityId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<PaginatedResponse<AuditLog>> {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) searchParams.append(key, String(value));
    });
    return apiClient.get<PaginatedResponse<AuditLog>>(`/admin/audit-logs?${searchParams.toString()}`);
  },
};

export default adminService;
