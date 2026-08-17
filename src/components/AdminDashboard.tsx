import React, { useState, useEffect, useRef } from 'react';
import { useModal } from '../hooks/useModal';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { useAuth } from '../context/AuthContext';
import adminService, {
  MetricsOverview, ChartDataPoint, CategoryMetric,
  AdminUser, PendingVerification, AdminReview, AdminDispute, AuditLog, AdminSupportTicket
} from '../api/services/adminService';
import { Users, PhilippinePeso, TrendingUp, AlertCircle, Search, Filter, Eye, X, CheckCircle, XCircle, Clock, Shield, FileText, Download, MessageSquare } from 'lucide-react';
import { BookingDisputesPanel } from './BookingDisputesPanel';
import { SupportChat } from './SupportChat';
import { getUploadUrl, API_CONFIG } from '../api/config';
import { io as createSocket } from 'socket.io-client';

type TabType = 'overview' | 'users' | 'providers' | 'reviews' | 'booking_disputes' | 'disputes' | 'audit' | 'support';

/**
 * A user's avatar, falling back to their initial.
 *
 * Both admin lists used to render `profile_image` straight into an <img src>. It holds
 * a path relative to the uploads root ("users/<id>/avatar/x.webp"), so the browser
 * resolved it against the page origin instead of the upload host and it 404'd - while
 * accounts whose photo is an absolute Google/Unsplash URL kept working, which is why
 * only some avatars appeared broken. Every other view in the app already goes through
 * getUploadUrl.
 *
 * A failed load falls back to the same initial a photoless account gets, rather than the
 * browser's broken-image glyph - a file that has gone missing from disk (the uploads
 * tree is not in git) should not look different from never having uploaded one.
 */
function AdminAvatar({ src, name, className, textClassName }: {
  src?: string | null;
  name?: string | null;
  className: string;
  textClassName: string;
}) {
  const [failed, setFailed] = useState(false);
  const resolved = src ? getUploadUrl(src) : '';

  return (
    <div className={`${className} bg-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0`}>
      {resolved && !failed ? (
        <img
          src={resolved}
          alt=""
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={`text-gray-500 font-medium ${textClassName}`}>{name?.charAt(0) || '?'}</span>
      )}
    </div>
  );
}

export function AdminDashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Overview state
  const [metrics, setMetrics] = useState<MetricsOverview | null>(null);
  const [revenueChart, setRevenueChart] = useState<ChartDataPoint[]>([]);
  const [bookingsChart, setBookingsChart] = useState<ChartDataPoint[]>([]);
  const [usersChart, setUsersChart] = useState<ChartDataPoint[]>([]);
  const [categoryMetrics, setCategoryMetrics] = useState<CategoryMetric[]>([]);
  const [chartPeriod, setChartPeriod] = useState<'week' | 'month' | 'year'>('month');

  // Users state
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('all');
  const [userStatusFilter, setUserStatusFilter] = useState('active');
  const [userPage, setUserPage] = useState(0);

  // Verifications state
  const [pendingVerifications, setPendingVerifications] = useState<PendingVerification[]>([]);
  const [verificationsTotal, setVerificationsTotal] = useState(0);
  const [verificationPage, setVerificationPage] = useState(0);

  // Reviews state
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [reviewsTotal, setReviewsTotal] = useState(0);
  const [reviewStatusFilter, setReviewStatusFilter] = useState('pending');
  const [reviewPage, setReviewPage] = useState(0);

  // Disputes state
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [disputesTotal, setDisputesTotal] = useState(0);
  const [disputeStatusFilter, setDisputeStatusFilter] = useState('all');
  const [disputePriorityFilter, setDisputePriorityFilter] = useState('');
  const [disputePage, setDisputePage] = useState(0);

  // Audit logs state
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditLogsTotal, setAuditLogsTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(0);
  const [auditActionFilter, setAuditActionFilter] = useState('all');
  const [auditEntityFilter, setAuditEntityFilter] = useState('all');
  const [auditStartDate, setAuditStartDate] = useState('');
  const [auditEndDate, setAuditEndDate] = useState('');
  // getLogs has accepted a userId filter since it was written; nothing in this tab ever
  // sent one, so seeing everything one actor did meant paging through the whole table by
  // eye. Label is kept alongside the id purely for display - the id is what's sent.
  const [auditUserFilter, setAuditUserFilter] = useState<{ id: string; label: string } | null>(null);
  const [auditOptions, setAuditOptions] = useState<{ actions: string[]; entityTypes: string[] }>({ actions: [], entityTypes: [] });
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);
  const [exportingAudit, setExportingAudit] = useState(false);

  // Support tickets state
  const [supportTickets, setSupportTickets] = useState<AdminSupportTicket[]>([]);
  const [supportTicketsTotal, setSupportTicketsTotal] = useState(0);
  const [supportStatusFilter, setSupportStatusFilter] = useState('open');
  const [supportPage, setSupportPage] = useState(0);
  const [selectedSupportTicketId, setSelectedSupportTicketId] = useState<string | null>(null);

  // Modal states
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showResolveModal, setShowResolveModal] = useState<AdminDispute | null>(null);
  const [resolution, setResolution] = useState({ text: '', type: 'no_action', refundAmount: 0 });
  const [showReviewActionModal, setShowReviewActionModal] = useState<{ id: string; action: 'reject' | 'flag' | 'delete' } | null>(null);

  // Escape and scroll-locking for the three modals written inline below. `enabled`
  // is what lets these be declared unconditionally up here while only taking effect
  // when their modal is actually showing. closeOnBackdrop is off for all three: each
  // holds a typed reason/resolution an admin can lose to a stray click outside the
  // card, so the JSX below spreads these props instead of hand-rolling its own
  // backdrop handler that would ignore that.
  const closeRejectModal = () => { setShowRejectModal(null); setRejectReason(''); };
  const closeReviewActionModal = () => { setShowReviewActionModal(null); setReviewActionReason(''); };
  const closeResolveModal = () => { setShowResolveModal(null); setResolution({ text: '', type: 'no_action', refundAmount: 0 }); };
  const rejectModal = useModal(closeRejectModal, { enabled: !!showRejectModal, closeOnBackdrop: false, label: 'Reject verification' });
  const reviewActionModal = useModal(closeReviewActionModal, { enabled: !!showReviewActionModal, closeOnBackdrop: false, label: 'Review action' });
  const resolveModal = useModal(closeResolveModal, { enabled: !!showResolveModal, closeOnBackdrop: false, label: 'Resolve dispute' });
  const [reviewActionReason, setReviewActionReason] = useState('');

  const ITEMS_PER_PAGE = 20;
  const COLORS = ['#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];

  useEffect(() => {
    if (user?.role === 'admin') {
      loadTabData();
    }
  }, [activeTab, chartPeriod, userSearch, userRoleFilter, userStatusFilter, userPage, verificationPage,
    reviewStatusFilter, reviewPage, disputeStatusFilter, disputePriorityFilter, disputePage, auditPage,
    auditActionFilter, auditEntityFilter, auditStartDate, auditEndDate,
    supportStatusFilter, supportPage, auditUserFilter, user]);

  const loadTabData = async () => {
    setLoading(true);
    setError(null);
    try {
      switch (activeTab) {
        case 'overview': await loadOverviewData(); break;
        case 'users': await loadUsersData(); break;
        case 'providers': await loadVerificationsData(); break;
        case 'reviews': await loadReviewsData(); break;
        case 'disputes': await loadDisputesData(); break;
        case 'audit': await loadAuditData(); break;
        case 'support': await loadSupportTicketsData(); break;
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const loadOverviewData = async () => {
    const [metricsData, revenueData, bookingsData, usersData, categories] = await Promise.all([
      adminService.getMetricsOverview(),
      adminService.getRevenueChart(chartPeriod),
      adminService.getBookingsChart(chartPeriod),
      adminService.getUsersChart(chartPeriod),
      adminService.getCategoryMetrics(),
    ]);
    setMetrics(metricsData);
    setRevenueChart(revenueData);
    setBookingsChart(bookingsData);
    setUsersChart(usersData);
    setCategoryMetrics(categories);
  };

  const loadUsersData = async () => {
    const resp = await adminService.getUsers({
      search: userSearch || undefined,
      role: userRoleFilter !== 'all' ? userRoleFilter : undefined,
      status: userStatusFilter,
      limit: ITEMS_PER_PAGE,
      offset: userPage * ITEMS_PER_PAGE,
    });
    setUsers(resp.data);
    setUsersTotal(resp.meta.total);
  };

  const loadVerificationsData = async () => {
    const resp = await adminService.getPendingVerifications({
      limit: ITEMS_PER_PAGE,
      offset: verificationPage * ITEMS_PER_PAGE,
    });
    setPendingVerifications(resp.data);
    setVerificationsTotal(resp.meta.total);
  };

  const loadReviewsData = async () => {
    const resp = await adminService.getReviews({
      status: reviewStatusFilter !== 'all' ? reviewStatusFilter : undefined,
      limit: ITEMS_PER_PAGE,
      offset: reviewPage * ITEMS_PER_PAGE,
    });
    setReviews(resp.data);
    setReviewsTotal(resp.meta.total);
  };

  const loadDisputesData = async () => {
    const resp = await adminService.getDisputes({
      status: disputeStatusFilter !== 'all' ? disputeStatusFilter : undefined,
      priority: disputePriorityFilter || undefined,
      limit: ITEMS_PER_PAGE,
      offset: disputePage * ITEMS_PER_PAGE,
    });
    setDisputes(resp.data);
    setDisputesTotal(resp.meta.total);
  };

  // The backend has supported these filters all along - the tab just never sent them.
  // `endDate` is pushed to the end of the chosen day so an inclusive range behaves the
  // way a reader expects.
  const auditFilters = () => ({
    userId: auditUserFilter?.id || undefined,
    action: auditActionFilter !== 'all' ? auditActionFilter : undefined,
    entityType: auditEntityFilter !== 'all' ? auditEntityFilter : undefined,
    startDate: auditStartDate || undefined,
    endDate: auditEndDate ? `${auditEndDate}T23:59:59` : undefined,
  });

  const loadAuditData = async () => {
    const resp = await adminService.getAuditLogs({
      ...auditFilters(),
      limit: ITEMS_PER_PAGE,
      offset: auditPage * ITEMS_PER_PAGE,
    });
    setAuditLogs(resp.data);
    setAuditLogsTotal(resp.meta.total);

    // Populate the dropdowns from what is actually in the table, once.
    if (auditOptions.actions.length === 0) {
      try {
        setAuditOptions(await adminService.getAuditLogActions());
      } catch (err) {
        console.error('Failed to load audit filter options', err);
      }
    }
  };

  // Hard ceiling on a single export, so a runaway filter (or none at all) on a table
  // that's been accumulating for years can't page forever. Comfortably above anything
  // an admin would actually need in one CSV; if it's hit, the export is flagged as
  // incomplete rather than silently passed off as the full record.
  const MAX_EXPORT_ROWS = 5000;
  const AUDIT_EXPORT_PAGE_SIZE = 200; // mirrors auditService.MAX_PAGE_SIZE server-side

  const exportAuditCsv = async () => {
    setExportingAudit(true);
    try {
      // A single page silently dropped everything past the server's 200-row cap - an
      // export whose entire point is being the complete record was quietly missing rows
      // whenever a filter matched more than that. Page through every match instead, up
      // to MAX_EXPORT_ROWS.
      const filters = auditFilters();
      const rows: typeof auditLogs = [];
      let offset = 0;
      let truncated = false;
      while (rows.length < MAX_EXPORT_ROWS) {
        const resp = await adminService.getAuditLogs({ ...filters, limit: AUDIT_EXPORT_PAGE_SIZE, offset });
        rows.push(...resp.data);
        offset += AUDIT_EXPORT_PAGE_SIZE;
        if (offset >= resp.meta.total || resp.data.length === 0) break;
        if (rows.length >= MAX_EXPORT_ROWS) {
          truncated = true;
          break;
        }
      }

      const escape = (v: any) => {
        const str = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
        return `"${str.replace(/"/g, '""')}"`;
      };
      const header = ['Timestamp', 'User', 'Email', 'Action', 'Entity Type', 'Entity ID', 'IP Address', 'Old Values', 'New Values', 'Metadata'];
      const csvRows = rows.map(l => [
        l.created_at, l.user_name || 'System', l.user_email || '', l.action,
        l.entity_type, l.entity_id || '', l.ip_address || '',
        l.old_values, l.new_values, l.metadata || (l as any).details,
      ].map(escape).join(','));
      const csv = [header.map(escape).join(','), ...csvRows].join('\r\n');

      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}${truncated ? '-partial' : ''}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      if (truncated) {
        setError(`Export stopped at ${MAX_EXPORT_ROWS} rows - narrow the filters (date range, action, or user) to get a complete export of a larger match.`);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to export audit logs');
    } finally {
      setExportingAudit(false);
    }
  };

  const loadSupportTicketsData = async () => {
    const resp = await adminService.getSupportTickets({
      status: supportStatusFilter !== 'all' ? supportStatusFilter : undefined,
      limit: ITEMS_PER_PAGE,
      offset: supportPage * ITEMS_PER_PAGE,
    });
    setSupportTickets(resp.data);
    setSupportTicketsTotal(resp.meta.total);
    setSelectedSupportTicketId((prev) => {
      if (prev && resp.data.some((t) => t.id === prev)) return prev;
      return resp.data[0]?.id || null;
    });
  };

  // Held in refs so the socket handler below - registered once for the life of the
  // admin session - always sees the current tab and filter/page instead of whatever
  // they were when the connection was opened.
  const loadSupportTicketsDataRef = useRef(loadSupportTicketsData);
  loadSupportTicketsDataRef.current = loadSupportTicketsData;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  // A new ticket, or a reply on one nobody has open, used to sit invisible in the queue
  // until an admin happened to change the status filter or page - the list was only ever
  // fetched on those triggers. This keeps it live while the Support tab is open.
  useEffect(() => {
    if (user?.role !== 'admin') return undefined;
    const token = localStorage.getItem('authToken');
    if (!token) return undefined;

    const socket = createSocket(API_CONFIG.SOCKET_URL, {
      transports: ['websocket'],
      auth: { token },
    });

    let refreshTimer: number | null = null;
    socket.on('support:queue_update', () => {
      if (activeTabRef.current !== 'support') return;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        loadSupportTicketsDataRef.current().catch(() => {});
      }, 800);
    });

    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      socket.disconnect();
    };
  }, [user?.role]);

  // Action handlers
  const handleVerifyProvider = async (id: string) => {
    if (!confirm('Approve this provider? They will be marked Verified and get a Verified badge visible to clients.')) return;
    try {
      await adminService.verifyProvider(id);
      await loadVerificationsData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRejectProvider = async () => {
    if (!showRejectModal) return;
    try {
      await adminService.rejectProvider(showRejectModal, rejectReason);
      setShowRejectModal(null);
      setRejectReason('');
      await loadVerificationsData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleModerateReview = async (id: string, action: 'approve' | 'reject' | 'flag') => {
    try {
      await adminService.moderateReview(id, action);
      await loadReviewsData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const openReviewActionModal = (id: string, action: 'reject' | 'flag' | 'delete') => {
    setShowReviewActionModal({ id, action });
    setReviewActionReason('');
  };

  const handleReviewActionConfirm = async () => {
    if (!showReviewActionModal) return;
    const { id, action } = showReviewActionModal;
    try {
      if (action === 'delete') {
        await adminService.deleteReview(id, reviewActionReason || undefined);
      } else {
        await adminService.moderateReview(id, action, reviewActionReason || undefined);
      }
      setShowReviewActionModal(null);
      setReviewActionReason('');
      await loadReviewsData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleSupportStatusChange = async (id: string, status: string) => {
    try {
      await adminService.updateSupportTicket(id, { status });
      await loadSupportTicketsData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    try {
      await adminService.deleteUser(id);
      await loadUsersData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRestoreUser = async (id: string) => {
    try {
      await adminService.restoreUser(id);
      await loadUsersData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleUpdateDisputeStatus = async (id: string, status: string) => {
    try {
      await adminService.updateDispute(id, { status });
      await loadDisputesData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const downloadCSV = (data: any[], filename: string) => {
    if (data.length === 0) {
      alert('No data to export');
      return;
    }

    // Get headers from first object
    const headers = Object.keys(data[0]);

    // Create CSV content
    const csvContent = [
      headers.join(','), // Header row
      ...data.map(row =>
        headers.map(header => {
          const value = row[header];
          // Handle null/undefined
          if (value === null || value === undefined) return '';
          // Escape quotes and wrap in quotes if contains comma, quote, or newline
          const stringValue = String(value);
          if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        }).join(',')
      )
    ].join('\n');

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportUsers = () => {
    const exportData = users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      verified: u.is_verified ? 'Yes' : 'No',
      bookings: u.booking_count,
      rating: u.avg_rating ? parseFloat(String(u.avg_rating)).toFixed(1) : 'N/A',
      joined: formatDate(u.created_at),
      status: u.deleted_at ? 'Deleted' : 'Active'
    }));
    downloadCSV(exportData, `users-export-${new Date().toISOString().split('T')[0]}.csv`);
  };

  const handleResolveDispute = async () => {
    if (!showResolveModal) return;
    try {
      await adminService.resolveDispute(showResolveModal.id, {
        resolution: resolution.text,
        resolution_type: resolution.type,
        refund_amount: resolution.refundAmount || undefined,
      });
      setShowResolveModal(null);
      setResolution({ text: '', type: 'no_action', refundAmount: 0 });
      await loadDisputesData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const formatCurrency = (amount: number) => `₱${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatDate = (date: string) => new Date(date).toLocaleDateString();
  const formatDateTime = (date: string) => new Date(date).toLocaleString();

  if (!user || user.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <Shield className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900">Access Denied</h2>
          <p className="text-sm text-gray-600">You must be an admin to view this page.</p>
        </div>
      </div>
    );
  }

  const renderMetricCard = (title: string, value: string | number, subtitle?: string, trend?: number, Icon?: React.ElementType, color?: string) => (
    <div className="bg-white rounded-2xl p-6 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        {Icon && (
          <div className={`w-12 h-12 rounded-xl bg-${color || 'purple'}-100 flex items-center justify-center`}>
            <Icon className={`w-6 h-6 text-${color || 'purple'}-600`} />
          </div>
        )}
        {trend !== undefined && (
          <span className={`text-sm font-medium ${trend >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {trend >= 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
      <div className="text-2xl font-semibold text-gray-900 mb-1">{value}</div>
      <div className="text-sm text-gray-600">{title}</div>
      {subtitle && <div className="text-xs text-gray-500 mt-1">{subtitle}</div>}
    </div>
  );

  const renderOverview = () => {
    if (!metrics) return null;

    return (
      <div className="space-y-6">
        {/* Pending Actions Alert */}
        {(metrics.pendingActions.verifications > 0 || metrics.pendingActions.disputes > 0 || metrics.pendingActions.reviews > 0 || metrics.pendingActions.supportTickets > 0) && (
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-xl">
            <div className="flex items-center">
              <AlertCircle className="h-5 w-5 text-yellow-400 mr-3" />
              <div className="text-sm text-yellow-700">
                <strong>Pending Actions: </strong>
                {metrics.pendingActions.verifications > 0 && <span className="mr-3">{metrics.pendingActions.verifications} verifications</span>}
                {metrics.pendingActions.disputes > 0 && <span className="mr-3">{metrics.pendingActions.disputes} disputes</span>}
                {metrics.pendingActions.reviews > 0 && <span className="mr-3">{metrics.pendingActions.reviews} reviews</span>}
                {metrics.pendingActions.supportTickets > 0 && <span>{metrics.pendingActions.supportTickets} support tickets</span>}
              </div>
            </div>
          </div>
        )}

        {/* Metrics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {renderMetricCard('Total Users', metrics.users.total.toLocaleString(), `${metrics.users.thisMonth} this month`, metrics.users.growth, Users, 'blue')}
          {renderMetricCard('Total Providers', metrics.providers.total.toLocaleString(), `${metrics.providers.verified} verified`, undefined, Users, 'purple')}
          {renderMetricCard('Total Revenue', formatCurrency(metrics.revenue.total), `${formatCurrency(metrics.revenue.thisMonth)} this month`, metrics.revenue.growth, PhilippinePeso, 'green')}
          {renderMetricCard('Platform Commission', formatCurrency(metrics.revenue.commission), undefined, undefined, TrendingUp, 'indigo')}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {renderMetricCard('Total Bookings', metrics.bookings.total.toLocaleString(), `${metrics.bookings.thisMonth} this month`)}
          {renderMetricCard('Completed', metrics.bookings.completed.toLocaleString(), undefined, undefined, CheckCircle, 'green')}
          {renderMetricCard('Pending', metrics.bookings.pending.toLocaleString(), undefined, undefined, Clock, 'yellow')}
          {renderMetricCard('Active Users (30d)', metrics.activeUsers.toLocaleString())}
        </div>

        {/* Chart Period Selector */}
        <div className="flex justify-end">
          <div className="bg-white rounded-xl shadow-sm p-1 flex gap-1">
            {(['week', 'month', 'year'] as const).map((period) => (
              <button
                key={period}
                onClick={() => setChartPeriod(period)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${chartPeriod === period
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                  }`}
              >
                {period.charAt(0).toUpperCase() + period.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Revenue Chart */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Revenue Over Time</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={revenueChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                <Legend />
                <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="commission" name="Commission" stroke="#22c55e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Bookings Chart */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Bookings Overview</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={bookingsChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="completed" name="Completed" fill="#22c55e" stackId="a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="pending" name="Pending" fill="#f59e0b" stackId="a" />
                <Bar dataKey="cancelled" name="Cancelled" fill="#ef4444" stackId="a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Users Growth Chart */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-medium text-gray-900 mb-4">User Growth</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={usersChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="clients" name="Clients" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="providers" name="Providers" stroke="#22c55e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Category Distribution */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Revenue by Category</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={categoryMetrics}
                  dataKey="revenue"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={({ category, percent }) => `${category} (${(percent * 100).toFixed(0)}%)`}
                  labelLine={{ stroke: '#888', strokeWidth: 1 }}
                >
                  {categoryMetrics.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    );
  };

  const renderUsers = () => (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-2xl p-4 shadow-sm flex flex-wrap gap-4">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search users..."
            value={userSearch}
            onChange={(e) => { setUserSearch(e.target.value); setUserPage(0); }}
            className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
          />
        </div>
        <select
          value={userRoleFilter}
          onChange={(e) => { setUserRoleFilter(e.target.value); setUserPage(0); }}
          className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"
        >
          <option value="all">All Roles</option>
          <option value="client">Client</option>
          <option value="provider">Provider</option>
          <option value="admin">Admin</option>
        </select>
        <select
          value={userStatusFilter}
          onChange={(e) => { setUserStatusFilter(e.target.value); setUserPage(0); }}
          className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"
        >
          <option value="active">Active</option>
          <option value="deleted">Deleted</option>
        </select>
        <button
          onClick={handleExportUsers}
          className="px-4 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors flex items-center gap-2 font-medium"
        >
          <Download className="w-5 h-5" />
          Export CSV
        </button>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-4 px-6 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">User</th>
                <th className="text-left py-4 px-6 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Role</th>
                <th className="text-left py-4 px-6 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Status</th>
                <th className="text-left py-4 px-6 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Bookings</th>
                <th className="text-left py-4 px-6 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Rating</th>
                <th className="text-left py-4 px-6 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Joined</th>
                <th className="text-left py-4 px-6 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => (
                <tr key={u.id} className={`hover:bg-gray-50 ${u.deleted_at ? 'bg-red-50' : ''}`}>
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-3">
                      <AdminAvatar
                        src={u.profile_image}
                        name={u.name}
                        className="w-10 h-10 rounded-full"
                        textClassName=""
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{u.name}</p>
                        <p className="text-xs text-gray-500">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-6">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                        u.role === 'provider' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-700'
                      }`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="py-4 px-6">
                    {u.deleted_at ? (
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700">Deleted</span>
                    ) : u.is_verified ? (
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700">Verified</span>
                    ) : (
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-700">Unverified</span>
                    )}
                  </td>
                  <td className="py-4 px-6 text-sm text-gray-600">{u.booking_count}</td>
                  <td className="py-4 px-6 text-sm text-gray-600">
                    {u.avg_rating ? parseFloat(String(u.avg_rating)).toFixed(1) : '-'}
                  </td>
                  <td className="py-4 px-6 text-sm text-gray-600">{formatDate(u.created_at)}</td>
                  <td className="py-4 px-6">
                    {/*{u.deleted_at ? (
                      <button onClick={() => handleRestoreUser(u.id)} className="text-green-600 hover:text-green-700 text-sm font-medium">
                        Restore
                      </button>
                    ) : (
                      <button onClick={() => handleDeleteUser(u.id)} className="text-red-600 hover:text-red-700 text-sm font-medium">
                        Delete
                      </button>
                    )}*/}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">
          Showing {Math.min(userPage * ITEMS_PER_PAGE + 1, usersTotal)} to {Math.min((userPage + 1) * ITEMS_PER_PAGE, usersTotal)} of {usersTotal}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setUserPage(p => Math.max(0, p - 1))}
            disabled={userPage === 0}
            className="px-4 py-2 border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50"
          >
            Previous
          </button>
          <button
            onClick={() => setUserPage(p => p + 1)}
            disabled={(userPage + 1) * ITEMS_PER_PAGE >= usersTotal}
            className="px-4 py-2 border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );

  const renderProviders = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">Pending Provider Verifications</h2>
        <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm font-medium">
          {verificationsTotal} pending
        </span>
      </div>

      {pendingVerifications.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
          <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">All caught up!</h3>
          <p className="text-gray-500">No pending verifications at the moment.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {pendingVerifications.map((provider) => (
            <div key={provider.id} className="bg-white rounded-2xl shadow-sm p-6">
              <div className="flex gap-4">
                <AdminAvatar
                  src={provider.profile_image}
                  name={provider.name}
                  className="w-20 h-20 rounded-xl"
                  textClassName="text-2xl"
                />
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-medium text-gray-900">{provider.name}</h3>
                  <p className="text-sm text-gray-500">{provider.email}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {provider.category && (
                      <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-full">{provider.category}</span>
                    )}
                    {provider.location && (
                      <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-full">{provider.location}</span>
                    )}
                    {provider.years_experience && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-600 rounded-full">{provider.years_experience} yrs exp</span>
                    )}
                    <span className="px-2 py-1 bg-green-100 text-green-600 rounded-full">{provider.service_count} services</span>
                  </div>
                </div>
              </div>
              {provider.bio && (
                <p className="mt-3 text-sm text-gray-600 line-clamp-2">{provider.bio}</p>
              )}
              <p className="mt-2 text-xs text-gray-400">Applied: {formatDate(provider.created_at)}</p>

              {/* Submitted verification documents */}
              <div className="mt-3">
                <p className="text-xs font-medium text-gray-500 mb-1.5">Submitted Documents</p>
                {Array.isArray(provider.verification_documents) && provider.verification_documents.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {provider.verification_documents.map((doc: { path: string; original_name: string }, index: number) => (
                      <a
                        key={index}
                        href={getUploadUrl(doc.path)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-700 hover:bg-gray-50"
                      >
                        <FileText className="w-3.5 h-3.5 text-gray-400" />
                        <span className="truncate max-w-[140px]">{doc.original_name}</span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    No documents submitted
                  </p>
                )}
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => handleVerifyProvider(provider.id)}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium flex items-center justify-center gap-2"
                >
                  <CheckCircle className="w-4 h-4" />
                  Approve
                </button>
                <button
                  onClick={() => setShowRejectModal(provider.id)}
                  className="flex-1 px-4 py-2 border border-red-600 text-red-600 rounded-lg hover:bg-red-50 transition-colors text-sm font-medium flex items-center justify-center gap-2"
                >
                  <XCircle className="w-4 h-4" />
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {verificationsTotal > 0 && (
        <div className="flex justify-between items-center">
          <p className="text-sm text-gray-500">
            Showing {Math.min(verificationPage * ITEMS_PER_PAGE + 1, verificationsTotal)} to {Math.min((verificationPage + 1) * ITEMS_PER_PAGE, verificationsTotal)} of {verificationsTotal}
          </p>
          <div className="flex gap-2">
            <button onClick={() => setVerificationPage(p => Math.max(0, p - 1))} disabled={verificationPage === 0} className="px-4 py-2 border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50">Previous</button>
            <button onClick={() => setVerificationPage(p => p + 1)} disabled={(verificationPage + 1) * ITEMS_PER_PAGE >= verificationsTotal} className="px-4 py-2 border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50">Next</button>
          </div>
        </div>
      )}
    </div>
  );

  const renderReviews = () => (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-2xl p-4 shadow-sm flex gap-4">
        <select
          value={reviewStatusFilter}
          onChange={(e) => { setReviewStatusFilter(e.target.value); setReviewPage(0); }}
          className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"
        >
          <option value="all">All Reviews</option>
          <option value="pending">Pending</option>
          <option value="flagged">Flagged</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Reviews List */}
      <div className="space-y-4">
        {reviews.map((review) => (
          <div key={review.id} className={`bg-white rounded-2xl shadow-sm p-6 ${review.moderation_status === 'flagged' ? 'border-l-4 border-red-500' :
              review.moderation_status === 'pending' ? 'border-l-4 border-yellow-500' : ''
            }`}>
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-gray-900">{review.reviewer_name}</span>
                  <span className="text-gray-400">reviewed</span>
                  <span className="font-medium text-gray-900">{review.reviewee_name}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {review.service_title && `${review.service_title} • `}
                  {formatDate(review.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-yellow-500 font-medium">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span>
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${review.moderation_status === 'approved' ? 'bg-green-100 text-green-700' :
                    review.moderation_status === 'rejected' ? 'bg-red-100 text-red-700' :
                      review.moderation_status === 'flagged' ? 'bg-orange-100 text-orange-700' :
                        'bg-yellow-100 text-yellow-700'
                  }`}>
                  {review.moderation_status}
                </span>
              </div>
            </div>
            <p className="mt-3 text-gray-700">{review.comment}</p>
            {review.moderation_reason && (
              <p className="mt-2 text-sm text-gray-500">
                <span className="font-medium">Reason:</span> {review.moderation_reason}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {review.moderation_status !== 'approved' && (
                <button
                  onClick={() => handleModerateReview(review.id, 'approve')}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
                >
                  Approve
                </button>
              )}
              {review.moderation_status !== 'rejected' && (
                <button
                  onClick={() => openReviewActionModal(review.id, 'reject')}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium"
                >
                  Reject
                </button>
              )}
              {review.moderation_status !== 'flagged' && (
                <button
                  onClick={() => openReviewActionModal(review.id, 'flag')}
                  className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm font-medium"
                >
                  Flag
                </button>
              )}
              <button
                onClick={() => openReviewActionModal(review.id, 'delete')}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 text-sm font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {reviews.length === 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-12 text-center text-gray-500">
            No reviews found for this filter.
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">
          Showing {Math.min(reviewPage * ITEMS_PER_PAGE + 1, reviewsTotal)} to {Math.min((reviewPage + 1) * ITEMS_PER_PAGE, reviewsTotal)} of {reviewsTotal}
        </p>
        <div className="flex gap-2">
          <button onClick={() => setReviewPage(p => Math.max(0, p - 1))} disabled={reviewPage === 0} className="px-4 py-2 border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50">Previous</button>
          <button onClick={() => setReviewPage(p => p + 1)} disabled={(reviewPage + 1) * ITEMS_PER_PAGE >= reviewsTotal} className="px-4 py-2 border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50">Next</button>
        </div>
      </div>
    </div>
  );

  const renderDisputes = () => (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-2xl p-4 shadow-sm flex flex-wrap gap-4">
        <select
          value={disputeStatusFilter}
          onChange={(e) => { setDisputeStatusFilter(e.target.value); setDisputePage(0); }}
          className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"
        >
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="under_review">Under Review</option>
          <option value="escalated">Escalated</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <select
          value={disputePriorityFilter}
          onChange={(e) => { setDisputePriorityFilter(e.target.value); setDisputePage(0); }}
          className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"
        >
          <option value="">All Priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Disputes List */}
      <div className="space-y-4">
        {disputes.map((dispute) => (
          <div key={dispute.id} className={`bg-white rounded-2xl shadow-sm p-6 border-l-4 ${dispute.priority === 'urgent' ? 'border-red-500' :
              dispute.priority === 'high' ? 'border-orange-500' :
                dispute.priority === 'normal' ? 'border-blue-500' :
                  'border-gray-300'
            }`}>
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-medium text-lg text-gray-900">{dispute.title}</h3>
                <p className="text-sm text-gray-500 mt-1">
                  {dispute.raised_by_name} vs {dispute.against_name}
                  {dispute.service_title && ` • ${dispute.service_title}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${dispute.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                    dispute.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                      dispute.priority === 'normal' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-700'
                  }`}>
                  {dispute.priority}
                </span>
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${dispute.status === 'open' ? 'bg-yellow-100 text-yellow-700' :
                    dispute.status === 'under_review' ? 'bg-blue-100 text-blue-700' :
                      dispute.status === 'escalated' ? 'bg-red-100 text-red-700' :
                        dispute.status === 'resolved' ? 'bg-green-100 text-green-700' :
                          'bg-gray-100 text-gray-700'
                  }`}>
                  {dispute.status.replace('_', ' ')}
                </span>
              </div>
            </div>
            <p className="mt-3 text-gray-700 line-clamp-2">{dispute.description}</p>
            <p className="mt-2 text-xs text-gray-400">
              Created: {formatDateTime(dispute.created_at)}
              {dispute.assigned_to_name && ` • Assigned to: ${dispute.assigned_to_name}`}
            </p>
            {dispute.status !== 'resolved' && dispute.status !== 'closed' && (
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => setShowResolveModal(dispute)}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
                >
                  Resolve
                </button>
                <button
                  onClick={() => handleUpdateDisputeStatus(dispute.id, 'under_review')}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                >
                  Mark Under Review
                </button>
                <button
                  onClick={() => handleUpdateDisputeStatus(dispute.id, 'escalated')}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium"
                >
                  Escalate
                </button>
              </div>
            )}
            {dispute.resolution && (
              <div className="mt-4 p-3 bg-green-50 rounded-xl">
                <p className="text-sm font-medium text-green-800">Resolution: {dispute.resolution_type}</p>
                <p className="text-sm text-green-700">{dispute.resolution}</p>
                {dispute.refund_amount && <p className="text-sm text-green-700">Refund: {formatCurrency(dispute.refund_amount)}</p>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">
          Showing {Math.min(disputePage * ITEMS_PER_PAGE + 1, disputesTotal)} to {Math.min((disputePage + 1) * ITEMS_PER_PAGE, disputesTotal)} of {disputesTotal}
        </p>
        <div className="flex gap-2">
          <button onClick={() => setDisputePage(p => Math.max(0, p - 1))} disabled={disputePage === 0} className="px-4 py-2 border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50">Previous</button>
          <button onClick={() => setDisputePage(p => p + 1)} disabled={(disputePage + 1) * ITEMS_PER_PAGE >= disputesTotal} className="px-4 py-2 border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50">Next</button>
        </div>
      </div>
    </div>
  );

  const renderAuditLogs = () => (
    <div className="space-y-4">
      {/* Filters. getLogs has supported all of these since it was written; the tab just
          never sent them, so an admin could only page blindly through everything. */}
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Action</label>
            <select
              value={auditActionFilter}
              onChange={(e) => { setAuditActionFilter(e.target.value); setAuditPage(0); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            >
              <option value="all">All actions</option>
              {auditOptions.actions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Entity</label>
            <select
              value={auditEntityFilter}
              onChange={(e) => { setAuditEntityFilter(e.target.value); setAuditPage(0); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            >
              <option value="all">All entities</option>
              {auditOptions.entityTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="min-w-[150px]">
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">From</label>
            <input
              type="date"
              value={auditStartDate}
              onChange={(e) => { setAuditStartDate(e.target.value); setAuditPage(0); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
          <div className="min-w-[150px]">
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">To</label>
            <input
              type="date"
              value={auditEndDate}
              onChange={(e) => { setAuditEndDate(e.target.value); setAuditPage(0); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
          <button
            onClick={() => {
              setAuditActionFilter('all'); setAuditEntityFilter('all');
              setAuditStartDate(''); setAuditEndDate(''); setAuditUserFilter(null); setAuditPage(0);
            }}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
          >
            Reset
          </button>
          <button
            onClick={exportAuditCsv}
            disabled={exportingAudit || auditLogsTotal === 0}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            {exportingAudit ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
        {auditUserFilter && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-gray-500">Filtered to actor:</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
              {auditUserFilter.label}
              <button
                type="button"
                onClick={() => { setAuditUserFilter(null); setAuditPage(0); }}
                aria-label="Clear actor filter"
                className="hover:text-purple-900"
              >
                ×
              </button>
            </span>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-4 px-6 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Timestamp</th>
                <th className="text-left py-4 px-6 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">User</th>
                <th className="text-left py-4 px-6 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Action</th>
                <th className="text-left py-4 px-6 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Entity</th>
                <th className="text-left py-4 px-6 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {auditLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-10 px-6 text-center text-sm text-gray-500">
                    No audit entries match these filters.
                  </td>
                </tr>
              )}
              {auditLogs.map((log) => (
                <React.Fragment key={log.id}>
                <tr
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => setExpandedAuditId(expandedAuditId === log.id ? null : log.id)}
                >
                  <td className="py-4 px-6 text-sm text-gray-500">{formatDateTime(log.created_at)}</td>
                  <td className="py-4 px-6">
                    {log.user_id ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAuditUserFilter({ id: log.user_id!, label: log.user_name || log.user_email || log.user_id! });
                          setAuditPage(0);
                        }}
                        title="Filter to this actor"
                        className="text-sm font-medium text-gray-900 hover:text-purple-700 hover:underline text-left"
                      >
                        {log.user_name || 'Unknown'}
                      </button>
                    ) : (
                      <div className="text-sm font-medium text-gray-900">System</div>
                    )}
                    <div className="text-xs text-gray-500">{log.user_email || '-'}</div>
                  </td>
                  <td className="py-4 px-6">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${log.action.includes('delete') ? 'bg-red-100 text-red-700' :
                        log.action.includes('create') ? 'bg-green-100 text-green-700' :
                          log.action.includes('update') || log.action.includes('verify') ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-700'
                      }`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-sm text-gray-600">
                    {log.entity_type}
                    {log.entity_id && ` #${log.entity_id.slice(0, 8)}`}
                  </td>
                  <td className="py-4 px-6 text-sm text-gray-500">{log.ip_address || '-'}</td>
                </tr>
                {expandedAuditId === log.id && (
                  <tr className="bg-gray-50">
                    <td colSpan={5} className="px-6 py-4">
                      {/* The point of an audit log. These columns are populated on
                          almost every row but were never rendered anywhere. */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs font-medium text-gray-500 uppercase mb-1">Before</p>
                          <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-white border border-gray-200 rounded-lg p-3 max-h-64 overflow-auto">
                            {log.old_values ? JSON.stringify(log.old_values, null, 2) : '—'}
                          </pre>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-500 uppercase mb-1">After</p>
                          <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-white border border-gray-200 rounded-lg p-3 max-h-64 overflow-auto">
                            {log.new_values ? JSON.stringify(log.new_values, null, 2) : '—'}
                          </pre>
                        </div>
                      </div>
                      {/* Older rows put their payload in a legacy `details` column before
                          `metadata` replaced it; fall back so those still render. */}
                      {(log.metadata || (log as any).details) && (
                        <div className="mt-4">
                          <p className="text-xs font-medium text-gray-500 uppercase mb-1">Details</p>
                          <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-white border border-gray-200 rounded-lg p-3 max-h-64 overflow-auto">
                            {JSON.stringify(log.metadata || (log as any).details, null, 2)}
                          </pre>
                        </div>
                      )}
                      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-500">
                        <p><span className="font-medium">Entity ID:</span> {log.entity_id || '—'}</p>
                        <p className="break-all"><span className="font-medium">User agent:</span> {log.user_agent || '—'}</p>
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">
          Showing {Math.min(auditPage * ITEMS_PER_PAGE + 1, auditLogsTotal)} to {Math.min((auditPage + 1) * ITEMS_PER_PAGE, auditLogsTotal)} of {auditLogsTotal}
        </p>
        <div className="flex gap-2">
          <button onClick={() => setAuditPage(p => Math.max(0, p - 1))} disabled={auditPage === 0} className="px-4 py-2 border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50">Previous</button>
          <button onClick={() => setAuditPage(p => p + 1)} disabled={(auditPage + 1) * ITEMS_PER_PAGE >= auditLogsTotal} className="px-4 py-2 border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50">Next</button>
        </div>
      </div>
    </div>
  );

  const SUPPORT_STATUS_BADGE: Record<string, { label: string; className: string }> = {
    open: { label: 'Open', className: 'bg-yellow-100 text-yellow-700' },
    in_progress: { label: 'In Progress', className: 'bg-blue-100 text-blue-700' },
    resolved: { label: 'Resolved', className: 'bg-green-100 text-green-700' },
  };

  const renderSupport = () => (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-2xl p-4 shadow-sm flex gap-4">
        <select
          value={supportStatusFilter}
          onChange={(e) => { setSupportStatusFilter(e.target.value); setSupportPage(0); }}
          className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"
        >
          <option value="all">All Tickets</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 items-start">
        {/* Ticket list */}
        <div className="bg-white rounded-2xl shadow-sm p-2 space-y-1 max-h-[640px] overflow-y-auto">
          {supportTickets.map((ticket) => {
            const badge = SUPPORT_STATUS_BADGE[ticket.status] || SUPPORT_STATUS_BADGE.open;
            const isSelected = ticket.id === selectedSupportTicketId;
            return (
              <button
                key={ticket.id}
                onClick={() => setSelectedSupportTicketId(ticket.id)}
                className={`w-full text-left p-3 rounded-xl transition-colors ${isSelected ? 'bg-purple-50 border border-purple-200' : 'hover:bg-gray-50 border border-transparent'}`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-900 truncate">{ticket.user_name}</span>
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full flex-shrink-0 ${badge.className}`}>{badge.label}</span>
                </div>
                <p className="text-xs text-gray-500 truncate mb-1">{ticket.subject}</p>
                <p className="text-xs text-gray-400 truncate">{ticket.last_message || ticket.message}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-gray-400">{formatDate(ticket.last_message_at || ticket.created_at)}</span>
                  {(ticket.unread_count || 0) > 0 && <span className="w-2 h-2 rounded-full bg-purple-600" />}
                </div>
              </button>
            );
          })}
          {supportTickets.length === 0 && (
            <div className="p-8 text-center text-gray-500 text-sm">No support tickets found for this filter.</div>
          )}
        </div>

        {/* Thread + status controls */}
        <div className="space-y-3">
          {selectedSupportTicketId && (
            <div className="bg-white rounded-2xl shadow-sm p-3 flex flex-wrap gap-2">
              <button
                onClick={() => handleSupportStatusChange(selectedSupportTicketId, 'open')}
                className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 text-xs font-medium"
              >
                Mark Open
              </button>
              <button
                onClick={() => handleSupportStatusChange(selectedSupportTicketId, 'in_progress')}
                className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 text-xs font-medium"
              >
                Mark In Progress
              </button>
              <button
                onClick={() => handleSupportStatusChange(selectedSupportTicketId, 'resolved')}
                className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 text-xs font-medium"
              >
                Mark Resolved
              </button>
            </div>
          )}
          {/* Refresh the queue as the thread moves - a reply changes a ticket's status
              and its unread count, and the list was otherwise frozen at page load. */}
          <SupportChat
            mode="admin"
            ticketId={selectedSupportTicketId}
            onActivity={() => { loadSupportTicketsData().catch(() => {}); }}
            className="h-[560px]"
          />
        </div>
      </div>

      {/* Pagination */}
      {supportTicketsTotal > 0 && (
        <div className="flex justify-between items-center">
          <p className="text-sm text-gray-500">
            Showing {Math.min(supportPage * ITEMS_PER_PAGE + 1, supportTicketsTotal)} to {Math.min((supportPage + 1) * ITEMS_PER_PAGE, supportTicketsTotal)} of {supportTicketsTotal}
          </p>
          <div className="flex gap-2">
            <button onClick={() => setSupportPage(p => Math.max(0, p - 1))} disabled={supportPage === 0} className="px-4 py-2 border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50">Previous</button>
            <button onClick={() => setSupportPage(p => p + 1)} disabled={(supportPage + 1) * ITEMS_PER_PAGE >= supportTicketsTotal} className="px-4 py-2 border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50">Next</button>
          </div>
        </div>
      )}
    </div>
  );

  const tabs: { id: TabType; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'Users' },
    { id: 'providers', label: 'Verifications' },
    { id: 'reviews', label: 'Reviews' },
    { id: 'booking_disputes', label: 'Booking Disputes' },
    { id: 'disputes', label: 'Disputes' },
    { id: 'audit', label: 'Audit Logs' },
    { id: 'support', label: 'Support' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Admin Dashboard</h1>
          <p className="text-gray-600">Manage users, providers, and platform operations</p>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-2xl shadow-sm p-2 mb-6 flex gap-2 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-6 py-3 rounded-xl whitespace-nowrap transition-all text-sm font-medium ${activeTab === tab.id
                  ? 'bg-purple-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
          </div>
        ) : error ? (
          <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-r-xl">
            <p className="text-red-700">{error}</p>
            <button onClick={loadTabData} className="mt-2 text-red-600 underline text-sm">Retry</button>
          </div>
        ) : (
          <>
            {activeTab === 'overview' && renderOverview()}
            {activeTab === 'users' && renderUsers()}
            {activeTab === 'providers' && renderProviders()}
            {activeTab === 'reviews' && renderReviews()}
            {activeTab === 'booking_disputes' && <BookingDisputesPanel onRefresh={loadTabData} />}
            {activeTab === 'disputes' && renderDisputes()}
            {activeTab === 'audit' && renderAuditLogs()}
            {activeTab === 'support' && renderSupport()}
          </>
        )}
      </div>

      {/* Reject Provider Modal */}
      {showRejectModal && (
        <div className="modal-overlay" {...rejectModal.overlayProps}>
          <div className="modal-card modal-card--md modal-card--plain p-6" {...rejectModal.cardProps}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Reject Verification</h3>
              <button onClick={() => { setShowRejectModal(null); setRejectReason(''); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection..."
              className="w-full border border-gray-200 rounded-xl p-3 h-32 focus:ring-2 focus:ring-purple-500 outline-none"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button onClick={() => { setShowRejectModal(null); setRejectReason(''); }} className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleRejectProvider} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">Reject</button>
            </div>
          </div>
        </div>
      )}

      {/* Review Action Modal (Reject / Flag / Delete) */}
      {showReviewActionModal && (
        <div className="modal-overlay" {...reviewActionModal.overlayProps}>
          <div className="modal-card modal-card--md modal-card--plain p-6" {...reviewActionModal.cardProps}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                {showReviewActionModal.action === 'reject' ? 'Reject Review' :
                  showReviewActionModal.action === 'flag' ? 'Flag Review' : 'Delete Review'}
              </h3>
              <button onClick={() => { setShowReviewActionModal(null); setReviewActionReason(''); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <textarea
              value={reviewActionReason}
              onChange={(e) => setReviewActionReason(e.target.value)}
              placeholder="Reason (optional)..."
              className="w-full border border-gray-200 rounded-xl p-3 h-32 focus:ring-2 focus:ring-purple-500 outline-none"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button onClick={() => { setShowReviewActionModal(null); setReviewActionReason(''); }} className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button
                onClick={handleReviewActionConfirm}
                className={`px-4 py-2 text-white rounded-lg ${showReviewActionModal.action === 'flag' ? 'bg-orange-600 hover:bg-orange-700' : 'bg-red-600 hover:bg-red-700'}`}
              >
                {showReviewActionModal.action === 'reject' ? 'Reject' : showReviewActionModal.action === 'flag' ? 'Flag' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resolve Dispute Modal */}
      {showResolveModal && (
        <div className="modal-overlay" {...resolveModal.overlayProps}>
          <div className="modal-card modal-card--lg modal-card--plain p-6" {...resolveModal.cardProps}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Resolve Dispute</h3>
              <button onClick={() => { setShowResolveModal(null); setResolution({ text: '', type: 'no_action', refundAmount: 0 }); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Resolution Type</label>
                <select
                  value={resolution.type}
                  onChange={(e) => setResolution({ ...resolution, type: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl p-3 focus:ring-2 focus:ring-purple-500 outline-none"
                >
                  <option value="no_action">No Action Required</option>
                  <option value="warning_issued">Warning Issued</option>
                  <option value="partial_refund">Partial Refund</option>
                  <option value="full_refund">Full Refund</option>
                  <option value="account_suspended">Account Suspended</option>
                </select>
              </div>
              {(resolution.type === 'partial_refund' || resolution.type === 'full_refund') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Refund Amount</label>
                  <input
                    type="number"
                    value={resolution.refundAmount}
                    onChange={(e) => setResolution({ ...resolution, refundAmount: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-gray-200 rounded-xl p-3 focus:ring-2 focus:ring-purple-500 outline-none"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Resolution Details</label>
                <textarea
                  value={resolution.text}
                  onChange={(e) => setResolution({ ...resolution, text: e.target.value })}
                  placeholder="Describe the resolution..."
                  className="w-full border border-gray-200 rounded-xl p-3 h-32 focus:ring-2 focus:ring-purple-500 outline-none"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => { setShowResolveModal(null); setResolution({ text: '', type: 'no_action', refundAmount: 0 }); }} className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleResolveDispute} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">Resolve Dispute</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;
