import { useState, useEffect, useCallback, useRef } from 'react';
import { Download, Calendar, Loader2, AlertCircle } from 'lucide-react';
import adminService, { ReportSummary, AdminBooking, AdminPayment } from '../api/services/adminService';

/**
 * Financial and booking reports for one date range.
 *
 * A separate component rather than another render function on AdminDashboard, which is
 * already 1685 lines and where BookingDisputesPanel set the precedent. It loads its own
 * data for the same reason: a report is driven by a date range nothing else on the
 * dashboard shares, so threading that through the shared loadTabData switch would couple
 * every other tab's refresh to it.
 *
 * Every peso figure here comes from GET /admin/reports/summary, which deliberately reuses
 * the overview metrics' own revenue expressions. Nothing is recomputed in the browser - a
 * report that arrives at a different total from the dashboard above it is worse than no
 * report, and client-side arithmetic over a paginated table is the usual way that happens.
 */

const PESO = (n: number) =>
  `₱${(n ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Manila, not the viewer's clock. An admin travelling, or a browser set to UTC, must still
// get the same "this month" the server will report on - and the server resolves these day
// strings as Asia/Manila days.
const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

// Arithmetic on the Y-M-D parts through Date.UTC, never on a local Date: constructing
// `new Date(2026, 8, 1)` in a browser west of Manila lands on the previous day and shifts
// every preset by one.
const shiftDays = (ymd: string, days: number) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const monthStart = (ymd: string) => `${ymd.slice(0, 7)}-01`;

type PresetId = 'this_month' | 'last_month' | 'last_30' | 'last_90' | 'custom';

const presetRange = (id: PresetId): { from: string; to: string } | null => {
  const today = manilaToday();
  switch (id) {
    case 'this_month': return { from: monthStart(today), to: today };
    case 'last_month': {
      const lastDayOfPrev = shiftDays(monthStart(today), -1);
      return { from: monthStart(lastDayOfPrev), to: lastDayOfPrev };
    }
    case 'last_30': return { from: shiftDays(today, -29), to: today };
    case 'last_90': return { from: shiftDays(today, -89), to: today };
    default: return null;
  }
};

const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'last_30', label: 'Last 30 days' },
  { id: 'last_90', label: 'Last 90 days' },
  { id: 'custom', label: 'Custom' },
];

const ROWS_PER_PAGE = 25;
// Same ceiling and the same honesty as the audit-log export: if a range matches more than
// this, the file is named '-partial' rather than passed off as the complete record.
const MAX_EXPORT_ROWS = 5000;
const EXPORT_PAGE_SIZE = 100;

const METHOD_LABELS: Record<string, string> = {
  qrph: 'QR Ph',
  card: 'Card',
  gcash: 'GCash',
  grab_pay: 'GrabPay',
  paymaya: 'PayMaya',
  unknown: 'Not recorded',
};

const methodLabel = (raw: string | null | undefined) =>
  METHOD_LABELS[raw ?? 'unknown'] ?? raw ?? 'Not recorded';

const csvEscape = (v: unknown) => {
  const str = v === null || v === undefined ? '' : String(v);
  return `"${str.replace(/"/g, '""')}"`;
};

const saveCsv = (header: string[], rows: string[][], filename: string) => {
  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
  // A BOM, so Excel on Windows reads the peso sign and accented provider names as UTF-8
  // instead of mojibake. Without it a report full of Filipino names opens visibly broken.
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const manilaDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' });

export function AdminReportsPanel() {
  const initial = presetRange('this_month')!;
  const [preset, setPreset] = useState<PresetId>('this_month');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  const [summary, setSummary] = useState<ReportSummary | null>(null);

  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [paymentsTotal, setPaymentsTotal] = useState(0);
  const [paymentsPage, setPaymentsPage] = useState(0);
  const [paymentStatus, setPaymentStatus] = useState('all');

  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [bookingsTotal, setBookingsTotal] = useState(0);
  const [bookingsPage, setBookingsPage] = useState(0);
  const [bookingStatus, setBookingStatus] = useState('all');

  // One flag per concern, because they no longer load together. The panel-level spinner
  // follows the summary only; the tables stay on screen and just disable their paging.
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'payments' | 'bookings' | null>(null);

  // Generation counters. Each loader stamps its request and drops the response if a newer
  // one has started since - without this, clicking "Last 90 days" then "This month" could
  // leave the slower 90-day figures on screen under a header saying "This month", looking
  // settled because the first request's finally had already cleared the spinner.
  const summaryReq = useRef(0);
  const paymentsReq = useRef(0);
  const bookingsReq = useRef(0);

  const applyPreset = (id: PresetId) => {
    setPreset(id);
    const range = presetRange(id);
    if (range) {
      setFrom(range.from);
      setTo(range.to);
    }
    setPaymentsPage(0);
    setBookingsPage(0);
  };

  // Three loaders, not one.
  //
  // They were a single callback whose deps included both page numbers, so turning a page on
  // the payments table re-ran the summary aggregation and the bookings query as well - three
  // round-trips and two pointless aggregate scans for a page click. They share only the date
  // range, so that is all they share here.
  const loadSummary = useCallback(async () => {
    const id = ++summaryReq.current;
    setSummaryLoading(true);
    try {
      const data = await adminService.getReportSummary(from, to);
      if (id !== summaryReq.current) return;
      setSummary(data);
      setError(null);
    } catch (err: any) {
      if (id !== summaryReq.current) return;
      // Cleared, not left behind. The render guard used to be `!loading && summary`, so a
      // range the server rejected ("range must be 366 days or fewer") showed its error
      // message directly above the PREVIOUS period's revenue and commission tiles, with the
      // date inputs displaying the range that had just been refused. Figures nobody asked
      // for, presented as the answer.
      setSummary(null);
      // The server says what is actually wrong with the range; that is more use than a
      // generic message, so it is shown as-is.
      setError(err?.message || 'Failed to load the report');
    } finally {
      if (id === summaryReq.current) setSummaryLoading(false);
    }
  }, [from, to]);

  const loadPayments = useCallback(async () => {
    const id = ++paymentsReq.current;
    setPaymentsLoading(true);
    try {
      const resp = await adminService.getPayments({
        from,
        to,
        status: paymentStatus !== 'all' ? paymentStatus : undefined,
        limit: ROWS_PER_PAGE,
        offset: paymentsPage * ROWS_PER_PAGE,
      });
      if (id !== paymentsReq.current) return;
      setPayments(resp.data);
      setPaymentsTotal(resp.meta.total);
    } catch (err: any) {
      if (id !== paymentsReq.current) return;
      setPayments([]);
      setPaymentsTotal(0);
      setError(err?.message || 'Failed to load payments');
    } finally {
      if (id === paymentsReq.current) setPaymentsLoading(false);
    }
  }, [from, to, paymentStatus, paymentsPage]);

  const loadBookings = useCallback(async () => {
    const id = ++bookingsReq.current;
    setBookingsLoading(true);
    try {
      const resp = await adminService.getBookings({
        from,
        to,
        status: bookingStatus !== 'all' ? bookingStatus : undefined,
        limit: ROWS_PER_PAGE,
        offset: bookingsPage * ROWS_PER_PAGE,
      });
      if (id !== bookingsReq.current) return;
      setBookings(resp.data);
      setBookingsTotal(resp.meta.total);
    } catch (err: any) {
      if (id !== bookingsReq.current) return;
      setBookings([]);
      setBookingsTotal(0);
      setError(err?.message || 'Failed to load bookings');
    } finally {
      if (id === bookingsReq.current) setBookingsLoading(false);
    }
  }, [from, to, bookingStatus, bookingsPage]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadPayments(); }, [loadPayments]);
  useEffect(() => { loadBookings(); }, [loadBookings]);

  const exportRows = async <T,>(
    kind: 'payments' | 'bookings',
    fetchPage: (limit: number, offset: number) => Promise<{ data: T[]; meta: { total: number } }>,
    header: string[],
    toRow: (row: T) => string[],
  ) => {
    setExporting(kind);
    setError(null);
    try {
      // Paged, because the export is meant to cover the whole range while the table on
      // screen is only its first 25 rows.
      const rows: T[] = [];
      let offset = 0;
      let truncated = false;
      while (rows.length < MAX_EXPORT_ROWS) {
        const resp = await fetchPage(EXPORT_PAGE_SIZE, offset);
        rows.push(...resp.data);
        offset += EXPORT_PAGE_SIZE;
        if (offset >= resp.meta.total || resp.data.length === 0) break;
        if (rows.length >= MAX_EXPORT_ROWS) {
          truncated = true;
          break;
        }
      }
      saveCsv(
        header,
        rows.map(toRow),
        `photofind-${kind}-${from}-to-${to}${truncated ? '-partial' : ''}.csv`,
      );
      if (truncated) {
        setError(`Export stopped at ${MAX_EXPORT_ROWS} rows - narrow the date range for a complete file.`);
      }
    } catch (err: any) {
      setError(err?.message || `Failed to export ${kind}`);
    } finally {
      setExporting(null);
    }
  };

  const exportPayments = () =>
    exportRows<AdminPayment>(
      'payments',
      (limit, offset) =>
        adminService.getPayments({
          from,
          to,
          status: paymentStatus !== 'all' ? paymentStatus : undefined,
          limit,
          offset,
        }),
      ['Payment ID', 'Booking ID', 'Paid at', 'Created at', 'Status', 'Method', 'Client',
       'Provider', 'Service', 'Gross', 'Refunded', 'Commission', 'Provider net'],
      (p) => [
        p.id,
        p.booking_id ?? '',
        p.paid_at ?? '',
        p.created_at,
        p.status,
        methodLabel(p.payment_method_type),
        p.client_name,
        p.provider_name,
        p.service_title ?? '',
        String(p.gross_amount ?? ''),
        String(p.refunded_amount ?? 0),
        String(p.commission_amount ?? ''),
        String(p.net_provider_amount ?? ''),
      ],
    );

  const exportBookings = () =>
    exportRows<AdminBooking>(
      'bookings',
      (limit, offset) =>
        adminService.getBookings({
          from,
          to,
          status: bookingStatus !== 'all' ? bookingStatus : undefined,
          limit,
          offset,
        }),
      ['Booking ID', 'Created at', 'Starts', 'Status', 'Payment status', 'Client',
       'Client email', 'Provider', 'Provider email', 'Service', 'Total price'],
      (b) => [
        b.id,
        b.created_at,
        b.start_date ?? '',
        b.status,
        b.payment_status ?? 'unpaid',
        b.client_name,
        b.client_email,
        b.provider_name,
        b.provider_email,
        b.service_title ?? '',
        String(b.total_price ?? ''),
      ],
    );

  const methodTotal = summary?.byMethod.reduce((acc, m) => acc + m.net, 0) ?? 0;

  return (
    <div className="space-y-6">
      {/* Reporting period */}
      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-5 h-5 text-gray-500" />
          <h3 className="font-semibold text-gray-900">Reporting period</h3>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p.id)}
              aria-pressed={preset === p.id}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                preset === p.id
                  ? 'bg-purple-600 text-white'
                  : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="report-from" className="text-sm text-gray-600">From</label>
          <input
            id="report-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => { setPreset('custom'); setFrom(e.target.value); setPaymentsPage(0); setBookingsPage(0); }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <label htmlFor="report-to" className="text-sm text-gray-600">To</label>
          <input
            id="report-to"
            type="date"
            value={to}
            min={from}
            max={manilaToday()}
            onChange={(e) => { setPreset('custom'); setTo(e.target.value); setPaymentsPage(0); setBookingsPage(0); }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <span className="text-xs text-gray-500">
            Days are counted in Philippine time (UTC+8), and both ends are included.
          </span>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      {summaryLoading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
        </div>
      )}

      {!summaryLoading && summary && (
        <>
          {/* Each figure says whose money it is. "Revenue" on its own has been read as the
              platform's own earnings, which it is not - the commission line is. */}
          <p className="text-sm text-gray-500">
            Covering {summary.range.from} to {summary.range.to} ({summary.range.timezone})
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Collected (net of refunds)</p>
              <p className="text-xl font-semibold text-gray-900">{PESO(summary.revenue.net)}</p>
              <p className="text-xs text-gray-500 mt-1">
                {PESO(summary.revenue.gross)} charged, {PESO(summary.revenue.refunded)} refunded
              </p>
            </div>
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Platform commission</p>
              <p className="text-xl font-semibold text-purple-600">{PESO(summary.revenue.commission)}</p>
              <p className="text-xs text-gray-500 mt-1">what PhotoFind earned</p>
            </div>
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Providers&apos; share</p>
              <p className="text-xl font-semibold text-gray-900">{PESO(summary.revenue.providerNet)}</p>
              <p className="text-xs text-gray-500 mt-1">owed to or already paid out to providers</p>
            </div>
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Settled payments</p>
              <p className="text-xl font-semibold text-gray-900">{summary.revenue.settledCount}</p>
              <p className="text-xs text-gray-500 mt-1">
                {Object.entries(summary.paymentsByStatus)
                  .filter(([s]) => s !== 'succeeded')
                  .map(([s, n]) => `${n} ${s.replace(/_/g, ' ')}`)
                  .join(', ') || 'no other attempts'}
              </p>
            </div>
          </div>

          {/* Where the card-to-QR-Ph shift shows up. */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-4">How clients paid</h3>
            {summary.byMethod.length === 0 ? (
              <p className="text-sm text-gray-500">No settled payments in this period.</p>
            ) : (
              <div className="space-y-3">
                {summary.byMethod.map((m) => (
                  <div key={m.method}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-700">{methodLabel(m.method)}</span>
                      <span className="text-gray-900">
                        {PESO(m.net)} - {m.count} payment{m.count === 1 ? '' : 's'}
                      </span>
                    </div>
                    {/* Inline width: a utility class for an arbitrary percentage cannot
                        exist in a prebuilt stylesheet with no Tailwind build behind it. */}
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className="bg-purple-600 rounded-full h-2"
                        style={{ width: methodTotal > 0 ? `${Math.max(2, (m.net / methodTotal) * 100)}%` : '0%' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-4">Bookings created in this period</h3>
            {Object.keys(summary.bookingsByStatus).length === 0 ? (
              <p className="text-sm text-gray-500">No bookings were created in this period.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {Object.entries(summary.bookingsByStatus).map(([status, count]) => (
                  <span
                    key={status}
                    className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700"
                  >
                    <span className="font-semibold text-gray-900">{count}</span> {status.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Outside the summary guard on purpose. These have their own requests and their own
          errors, so a failed summary must not blank them, and paging them must not blank
          the summary. */}
      <div className="bg-white rounded-2xl shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 p-6">
          <h3 className="font-semibold text-gray-900">Payments ({paymentsTotal})</h3>
          <div className="flex items-center gap-2">
            <select
              value={paymentStatus}
              onChange={(e) => { setPaymentStatus(e.target.value); setPaymentsPage(0); }}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
              aria-label="Filter payments by status"
            >
              <option value="all">All statuses</option>
              <option value="succeeded">Succeeded</option>
              <option value="processing">Processing</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="refunded">Refunded</option>
              <option value="partially_refunded">Partially refunded</option>
            </select>
            <button
              onClick={exportPayments}
              disabled={exporting !== null || paymentsTotal === 0}
              className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {exporting === 'payments'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Download className="w-4 h-4" />}
              Export CSV
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead className="bg-gray-50">
              <tr>
                {['Date', 'Client', 'Provider', 'Method', 'Status', 'Gross', 'Commission'].map((h) => (
                  <th
                    key={h}
                    className="text-left py-4 px-6 text-xs font-medium text-gray-500 uppercase whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {payments.length === 0 ? (
                <tr>
                  <td className="py-4 px-6 text-sm text-gray-500" colSpan={7}>No payments in this period.</td>
                </tr>
              ) : payments.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="py-4 px-6 text-sm text-gray-600 whitespace-nowrap">
                    {manilaDate(p.paid_at ?? p.created_at)}
                  </td>
                  <td className="py-4 px-6 text-sm text-gray-900">{p.client_name}</td>
                  <td className="py-4 px-6 text-sm text-gray-900">{p.provider_name}</td>
                  <td className="py-4 px-6 text-sm text-gray-600">{methodLabel(p.payment_method_type)}</td>
                  <td className="py-4 px-6 text-sm text-gray-600">{p.status.replace(/_/g, ' ')}</td>
                  <td className="py-4 px-6 text-sm text-gray-900 whitespace-nowrap">{PESO(Number(p.gross_amount))}</td>
                  <td className="py-4 px-6 text-sm text-purple-600 whitespace-nowrap">{PESO(Number(p.commission_amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 p-6">
          <span className="text-sm text-gray-500">
            {paymentsTotal === 0
              ? 'Nothing to show'
              : `Showing ${paymentsPage * ROWS_PER_PAGE + 1}-${Math.min((paymentsPage + 1) * ROWS_PER_PAGE, paymentsTotal)} of ${paymentsTotal}`}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPaymentsPage((p) => Math.max(0, p - 1))}
              disabled={paymentsPage === 0}
              className="px-4 py-2 border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPaymentsPage((p) => p + 1)}
              disabled={(paymentsPage + 1) * ROWS_PER_PAGE >= paymentsTotal}
              className="px-4 py-2 border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Bookings */}
      <div className="bg-white rounded-2xl shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 p-6">
          <h3 className="font-semibold text-gray-900">Bookings ({bookingsTotal})</h3>
          <div className="flex items-center gap-2">
            <select
              value={bookingStatus}
              onChange={(e) => { setBookingStatus(e.target.value); setBookingsPage(0); }}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
              aria-label="Filter bookings by status"
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="accepted">Accepted</option>
              <option value="confirmed">Confirmed</option>
              <option value="awaiting_confirmation">Awaiting confirmation</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="rejected">Rejected</option>
              <option value="disputed">Disputed</option>
            </select>
            <button
              onClick={exportBookings}
              disabled={exporting !== null || bookingsTotal === 0}
              className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {exporting === 'bookings'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Download className="w-4 h-4" />}
              Export CSV
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead className="bg-gray-50">
              <tr>
                {['Created', 'Client', 'Provider', 'Service', 'Status', 'Payment', 'Total'].map((h) => (
                  <th
                    key={h}
                    className="text-left py-4 px-6 text-xs font-medium text-gray-500 uppercase whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bookings.length === 0 ? (
                <tr>
                  <td className="py-4 px-6 text-sm text-gray-500" colSpan={7}>No bookings in this period.</td>
                </tr>
              ) : bookings.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="py-4 px-6 text-sm text-gray-600 whitespace-nowrap">{manilaDate(b.created_at)}</td>
                  <td className="py-4 px-6 text-sm text-gray-900">{b.client_name}</td>
                  <td className="py-4 px-6 text-sm text-gray-900">{b.provider_name}</td>
                  <td className="py-4 px-6 text-sm text-gray-600">{b.service_title ?? '-'}</td>
                  <td className="py-4 px-6 text-sm text-gray-600">{b.status.replace(/_/g, ' ')}</td>
                  <td className="py-4 px-6 text-sm text-gray-600">{b.payment_status ?? 'unpaid'}</td>
                  <td className="py-4 px-6 text-sm text-gray-900 whitespace-nowrap">{PESO(Number(b.total_price))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 p-6">
          <span className="text-sm text-gray-500">
            {bookingsTotal === 0
              ? 'Nothing to show'
              : `Showing ${bookingsPage * ROWS_PER_PAGE + 1}-${Math.min((bookingsPage + 1) * ROWS_PER_PAGE, bookingsTotal)} of ${bookingsTotal}`}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setBookingsPage((p) => Math.max(0, p - 1))}
              disabled={bookingsPage === 0}
              className="px-4 py-2 border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50"
            >
              Previous
            </button>
            <button
              onClick={() => setBookingsPage((p) => p + 1)}
              disabled={(bookingsPage + 1) * ROWS_PER_PAGE >= bookingsTotal}
              className="px-4 py-2 border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminReportsPanel;
