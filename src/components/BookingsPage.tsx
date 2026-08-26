import { useEffect, useMemo, useState } from 'react';
import { Calendar, Clock, PhilippinePeso, MessageSquare, RefreshCw, AlertCircle, Star, Info, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { EmptyState } from './EmptyState';
import { ChatInterface } from './ChatInterface';
import { RescheduleModal } from './RescheduleModal';
import { ConfirmCompletionModal } from './ConfirmCompletionModal';
import { DisputeResponsePanel } from './DisputeResponsePanel';
import { ReviewForm } from './ReviewForm';
import { PaymentSummary } from './PaymentSummary';
import { BookingDetailsModal } from './BookingDetailsModal';
import { useModal } from '../hooks/useModal';
import bookingService from '../api/services/bookingService';
import { CASH_CONFIRM_GRACE_MS, PLATFORM_COMMISSION_PERCENT } from '../constants/payment';
import reviewService from '../api/services/reviewService';

const ITEMS_PER_PAGE = 8;

export const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Pending' },
  accepted: { bg: 'bg-green-100', text: 'text-green-700', label: 'Confirmed' },
  confirmed: { bg: 'bg-green-100', text: 'text-green-700', label: 'Confirmed' },
  completed: { bg: 'bg-green-100', text: 'text-green-700', label: 'Completed' },
  rejected: { bg: 'bg-red-100', text: 'text-red-700', label: 'Rejected' },
  cancelled: { bg: 'bg-red-100', text: 'text-red-700', label: 'Cancelled' },
  awaiting_confirmation: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Awaiting Confirmation' },
  disputed: { bg: 'bg-red-100', text: 'text-red-700', label: 'Disputed' },
};

const RESCHEDULABLE_STATUSES = ['pending', 'accepted', 'confirmed'];

// A booking is payable once the provider has accepted it and it has not been paid
// for yet. This mirrors the server-side gate in POST /payments/create-intent, which
// is what actually enforces the rule - payment_status is 'unpaid' before an intent
// exists and 'pending' once one does, so only 'paid' means the money actually landed.
const PAYABLE_STATUSES = ['accepted', 'confirmed'];

// Where a cash booking's payment state is worth showing. Wider than PAYABLE_STATUSES
// because cash is settled after the shoot, not before it - and 'disputed' is on the list
// deliberately: whether the cash was ever handed over is usually the substance of the
// argument, so hiding it there removes the one fact both sides are reasoning about.
const CASH_VISIBLE_STATUSES = ['accepted', 'confirmed', 'awaiting_confirmation', 'completed', 'disputed'];
function isPayable(booking: { status: string; payment_status?: string; payment_due_at?: string | null; payment_method?: string }) {
  if (!PAYABLE_STATUSES.includes(booking.status) || booking.payment_status === 'paid') return false;
  // Cash bookings have nothing to pay here - POST /payments/create-intent refuses them
  // outright - so offering the button would only produce a refusal the client can't act on.
  if (booking.payment_method === 'cash') return false;
  // The deadline closes payment on the server (create-intent and attach-method both check
  // it), so the button has to disappear at the same moment or it just leads to a refusal.
  // The sweep that cancels the booking runs every 10 minutes, so there is a window where
  // the booking still looks accepted but can no longer be paid.
  if (booking.payment_due_at && new Date(booking.payment_due_at).getTime() < Date.now()) return false;
  return true;
}

// Whether the provider can record the cash for this booking right now. Mirrors the
// server's guards in POST /bookings/:id/confirm-cash so the button isn't offered where
// the call would only be refused: cash bookings, not already settled, and not before
// the shoot (with the same grace for a client paying on arrival).
function canConfirmCash(booking: {
  status: string;
  payment_method?: string;
  payment_status?: string;
  cash_confirmed_at?: string | null;
  start_date?: string | null;
}) {
  if (booking.payment_method !== 'cash') return false;
  if (booking.payment_status === 'paid' || booking.cash_confirmed_at) return false;
  if (!['accepted', 'confirmed', 'awaiting_confirmation', 'completed'].includes(booking.status)) return false;
  if (booking.start_date) {
    const startsAt = new Date(booking.start_date).getTime();
    if (!isNaN(startsAt) && Date.now() < startsAt - CASH_CONFIRM_GRACE_MS) return false;
  }
  return true;
}

// How long the client has left to pay, in words. Returns null once there is no deadline
// left to talk about.
function describePaymentDeadline(dueAt?: string | null): { text: string; urgent: boolean } | null {
  if (!dueAt) return null;
  const msLeft = new Date(dueAt).getTime() - Date.now();
  if (isNaN(msLeft)) return null;
  if (msLeft <= 0) return { text: 'Payment window closed', urgent: true };

  const hours = Math.floor(msLeft / (60 * 60 * 1000));
  const minutes = Math.floor((msLeft % (60 * 60 * 1000)) / (60 * 1000));
  const left = hours >= 24
    ? `${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? '' : 's'}`
    : hours >= 1
      ? `${hours}h ${minutes}m`
      : `${minutes} minute${minutes === 1 ? '' : 's'}`;

  return { text: `Pay within ${left} or the slot is released`, urgent: hours < 6 };
}

type StatusFilter = 'all' | 'upcoming' | 'completed' | 'cancelled';

const FILTER_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

// Matches the same bucketing ProviderDashboard uses elsewhere in the app, so
// "Cancelled" means the same thing everywhere a booking list is filtered.
function getBookingCategory(status: string): StatusFilter {
  if (status === 'completed') return 'completed';
  if (['cancelled', 'rejected', 'disputed'].includes(status)) return 'cancelled';
  return 'upcoming';
}

export function BookingsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const isProvider = user?.role === 'provider';

  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [showChat, setShowChat] = useState(false);
  const [chatParty, setChatParty] = useState<any>(null);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleBooking, setRescheduleBooking] = useState<any>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmBookingData, setConfirmBookingData] = useState<any>(null);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewBooking, setReviewBooking] = useState<any>(null);
  const [reviewedBookingIds, setReviewedBookingIds] = useState<Set<string>>(new Set());
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [payingBooking, setPayingBooking] = useState<any>(null);
  const [checkingPaymentFor, setCheckingPaymentFor] = useState<string | null>(null);
  const [detailsBooking, setDetailsBooking] = useState<any>(null);
  // Whether PaymentSummary currently allows dismissing it - false while a payment's
  // outcome is still unknown, so a client can't Escape/backdrop-click their way out of
  // a charge that already went through but hasn't been reflected in their booking list
  // yet. Mirrors the same check PaymentSummary uses for its own Cancel button.
  const [paymentCloseable, setPaymentCloseable] = useState(true);
  const [confirmingCashFor, setConfirmingCashFor] = useState<string | null>(null);
  const [cashConfirmBooking, setCashConfirmBooking] = useState<any>(null);

  // `silent` skips the full-page spinner, for refreshes that happen behind an open modal
  // or behind a button's own pending state. `resetPage` is off for those too - a refresh
  // triggered by closing the payment modal shouldn't throw the reader back to page 1.
  // Returns the mapped rows so a caller can act on fresh data instead of state that
  // hasn't re-rendered yet.
  const fetchBookings = async ({ silent = false, resetPage = true } = {}): Promise<any[]> => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = isProvider
        ? await bookingService.getMyProviderBookings()
        : await bookingService.getMyBookings();

      const mapped = (data || []).map((b: any) => {
        const start = b.start_date ? new Date(b.start_date) : null;
        const date = start
          ? start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })
          : '';
        const time = start
          ? start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })
          : '';

        // "Other party" is whoever isn't the current viewer — the provider for a
        // client, the client for a provider — so the card and chat button work
        // the same way regardless of which side is looking at it.
        const otherParty = isProvider
          ? { id: b.client_user_id || b.client_id, name: b.client_name || b.client_email || 'Client', image: b.client_image, email: b.client_email }
          : { id: b.provider_user_id || b.provider_id, name: b.provider_name || 'Provider', image: b.provider_image, email: b.provider_email };

        return {
          id: b.id,
          otherParty,
          service: b.service_title || b.service_name || 'Service',
          service_description: b.service_description,
          service_category: b.service_category,
          service_duration_minutes: b.service_duration_minutes,
          date,
          time,
          start_date: b.start_date,
          end_date: b.end_date,
          price: Number(b.total_price || b.totalPrice || b.price || 0),
          status: b.status,
          payment_status: b.payment_status,
          payment_due_at: b.payment_due_at,
          payment_method: b.payment_method || 'online',
          cash_confirmed_at: b.cash_confirmed_at,
          created_at: b.created_at,
          accepted_at: b.accepted_at,
          rejected_at: b.rejected_at,
          cancelled_at: b.cancelled_at,
          completed_at: b.completed_at,
          cancellation_reason: b.cancellation_reason,
          dispute_reason: b.dispute_reason,
          dispute_response: b.dispute_response,
          dispute_response_at: b.dispute_response_at,
          dispute_resolution: b.dispute_resolution,
          dispute_resolved_at: b.dispute_resolved_at,
          provider_completed_at: b.provider_completed_at,
          client_confirmed_at: b.client_confirmed_at,
          completion_notes: b.completion_notes,
          reschedule_pending_approval: b.reschedule_pending_approval,
          rescheduled_by: b.rescheduled_by,
          rescheduled_at: b.rescheduled_at,
          reschedule_reason: b.reschedule_reason,
          reschedule_count: b.reschedule_count,
          original_start_date: b.original_start_date,
          original_end_date: b.original_end_date,
        };
      });

      mapped.sort((a, b) => {
        const aTime = a.start_date ? new Date(a.start_date).getTime() : Infinity;
        const bTime = b.start_date ? new Date(b.start_date).getTime() : Infinity;
        return aTime - bTime;
      });

      setBookings(mapped);
      if (resetPage) setPage(1);
      return mapped;
    } catch (err: any) {
      console.error('Failed to fetch bookings', err);
      // A silent refresh is a background nicety - it must not blank the list the reader
      // is looking at or replace it with a full-page error. Keep what's on screen and
      // hand the caller the snapshot it already had.
      if (silent) return bookings;
      setError(err?.message || 'Failed to load bookings');
      setBookings([]);
      return [];
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Opening the payment modal re-reads the booking first. The list is a snapshot, and a
  // booking paid moments ago (in this tab or another) still looked payable in it - which
  // is how a client ended up staring at "Payment Failed / already completed" for a
  // booking they had in fact just paid for.
  const openPayment = async (booking: any) => {
    setCheckingPaymentFor(String(booking.id));
    try {
      const fresh = await fetchBookings({ silent: true, resetPage: false });
      const current = fresh.find((b: any) => String(b.id) === String(booking.id)) || booking;

      if (!isPayable(current)) {
        if (current.payment_status === 'paid') {
          toast.success('Already paid', 'This booking has been paid for - nothing more to do.');
        } else {
          toast.info('Payment not available', `This booking can't be paid while it is ${current.status}.`);
        }
        return;
      }
      setPayingBooking(current);
      setPaymentCloseable(true);
    } finally {
      setCheckingPaymentFor(null);
    }
  };

  // Recording cash charges the provider the platform's commission and can't be undone,
  // so it goes through a confirmation step. Deliberately not window.confirm: nothing else
  // in the app uses it, it can't be styled, and it blocks the whole tab - a native grey
  // box is the wrong thing to meet on the one action here that moves money.
  const confirmCash = async () => {
    const booking = cashConfirmBooking;
    if (!booking) return;

    setConfirmingCashFor(String(booking.id));
    try {
      const result = await bookingService.confirmCashPayment(String(booking.id));
      setCashConfirmBooking(null);
      toast.success(
        'Cash recorded',
        result.outstanding_commission > 0
          ? `Marked as paid. You owe ₱${result.outstanding_commission.toLocaleString('en-PH', { minimumFractionDigits: 2 })} in commission, which comes off your next online payments.`
          : `Marked as paid. ₱${result.commission_charged.toLocaleString('en-PH', { minimumFractionDigits: 2 })} commission was taken from your wallet.`
      );
      await fetchBookings({ silent: true, resetPage: false });
    } catch (err: any) {
      toast.error('Could not record the payment', err?.message || 'Please try again.');
      // Close it either way. The modal holds a snapshot taken when it opened, so leaving
      // it up after a failure offers "Yes, I received it" against stale data - and the
      // most likely failure is that the booking was already settled elsewhere, where
      // pressing it again can only 409. The refreshed list below is the honest view: if
      // it's still unpaid the button is still there to try again.
      setCashConfirmBooking(null);
      await fetchBookings({ silent: true, resetPage: false });
    } finally {
      setConfirmingCashFor(null);
    }
  };

  const cancelPayment = () => {
    setPayingBooking(null);
    fetchBookings({ resetPage: false });
  };

  const { overlayProps: cashOverlayProps, cardProps: cashCardProps } = useModal(
    () => setCashConfirmBooking(null),
    {
      enabled: !!cashConfirmBooking,
      // Not while the request is in flight. The commission is charged server-side the
      // moment this succeeds, so dismissing mid-call would leave the provider unsure
      // whether it landed - the same reason the payment modal locks itself.
      closeOnEscape: !confirmingCashFor,
      closeOnBackdrop: !confirmingCashFor,
      label: 'Confirm cash payment received',
    }
  );

  const { overlayProps: paymentOverlayProps } = useModal(cancelPayment, {
    enabled: !!payingBooking,
    closeOnEscape: paymentCloseable,
    closeOnBackdrop: paymentCloseable,
    label: 'Payment',
  });

  useEffect(() => {
    fetchBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProvider]);

  // Leaving a review is a client-only action, so only clients need to know
  // which of their completed bookings are already reviewed.
  const fetchReviewedBookings = async () => {
    try {
      const myReviews = await reviewService.getMyReviews();
      setReviewedBookingIds(new Set(myReviews.map((r: any) => String(r.booking_id))));
    } catch (err) {
      console.error('Failed to fetch reviewed bookings:', err);
    }
  };

  useEffect(() => {
    if (!isProvider) fetchReviewedBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProvider]);

  const handleApproveReschedule = async (bookingId: string) => {
    setReschedulingId(bookingId);
    try {
      await bookingService.approveReschedule(bookingId);
      toast.success('New time confirmed', 'The proposed time is now the confirmed booking time.');
      fetchBookings();
    } catch (err: any) {
      toast.error('Failed to confirm', err?.message || 'Could not confirm the new time.');
    } finally {
      setReschedulingId(null);
    }
  };

  const handleRejectReschedule = async (bookingId: string) => {
    setReschedulingId(bookingId);
    try {
      await bookingService.rejectReschedule(bookingId);
      toast.info('Reverted to original time', 'The proposed time was declined.');
      fetchBookings();
    } catch (err: any) {
      toast.error('Failed to decline', err?.message || 'Could not decline the new time.');
    } finally {
      setReschedulingId(null);
    }
  };

  const handleLeaveReview = (booking: any) => {
    setReviewBooking(booking);
    setShowReviewForm(true);
  };

  const handleReviewSuccess = () => {
    setReviewedBookingIds((prev) => new Set([...prev, String(reviewBooking?.id)]));
    fetchReviewedBookings();
  };

  const filteredBookings = useMemo(() => {
    if (statusFilter === 'all') return bookings;
    return bookings.filter((b) => getBookingCategory(b.status) === statusFilter);
  }, [bookings, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredBookings.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paginatedBookings = useMemo(() => {
    const start = (safePage - 1) * ITEMS_PER_PAGE;
    return filteredBookings.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredBookings, safePage]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-gray-900 mb-6">Upcoming Bookings</h1>

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 animate-pulse">
                <div className="flex gap-4">
                  <div className="w-16 h-16 rounded-xl bg-gray-200 flex-shrink-0" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-4 bg-gray-200 rounded w-1/3" />
                    <div className="h-3 bg-gray-100 rounded w-1/3" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
            <p className="text-sm text-red-600 mb-3">{error}</p>
            <button
              onClick={() => fetchBookings()}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
            >
              Try again
            </button>
          </div>
        ) : bookings.length === 0 ? (
          <EmptyState
            type="bookings"
            title="No upcoming bookings yet"
            description={isProvider ? "Bookings from clients will show up here." : "Book a service to see it here."}
          />
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-6">
              {FILTER_TABS.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setStatusFilter(tab.value)}
                  className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                    statusFilter === tab.value
                      ? 'bg-purple-600 text-white'
                      : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {filteredBookings.length === 0 ? (
              <EmptyState
                type="bookings"
                title="No bookings match this filter"
                description="Try a different filter to see more bookings."
              />
            ) : (
              <>
                <div className="space-y-4">
                  {paginatedBookings.map((booking) => {
                const statusStyle = STATUS_STYLES[booking.status] || { bg: 'bg-gray-100', text: 'text-gray-700', label: booking.status };
                const canReschedule = RESCHEDULABLE_STATUSES.includes(booking.status);

                return (
                  <div key={booking.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <div className="flex gap-4">
                      <ImageWithFallback
                        src={booking.otherParty.image}
                        alt={booking.otherParty.name}
                        className="w-16 h-16 rounded-xl object-cover flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-900 font-bold truncate">{booking.otherParty.name}</p>
                        <p className="text-sm text-gray-500 truncate">{booking.service}</p>

                        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 mt-2">
                          <span className="flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            {booking.date}
                          </span>
                          <span className="flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            {booking.time}
                          </span>
                          <span className="flex items-center gap-2">
                            <PhilippinePeso className="w-4 h-4" />
                            {booking.price.toLocaleString()}
                          </span>
                        </div>

                        {/* The payment deadline, while it still matters. Clients used to
                            get no warning at all that an unpaid booking would lose its
                            slot - the first they heard was the cancellation. */}
                        {!isProvider && PAYABLE_STATUSES.includes(booking.status)
                          && booking.payment_status !== 'paid'
                          && describePaymentDeadline(booking.payment_due_at) && (
                          <p className={`flex items-center gap-2 text-xs mt-2 ${
                            describePaymentDeadline(booking.payment_due_at)!.urgent ? 'text-red-600' : 'text-amber-700'
                          }`}>
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            {describePaymentDeadline(booking.payment_due_at)!.text}
                          </p>
                        )}

                        {/* Cash bookings have no deadline and no Pay button, so without
                            this the card says nothing at all about how the money moves -
                            which is the one thing both sides need to remember on the day. */}
                        {booking.payment_method === 'cash' && CASH_VISIBLE_STATUSES.includes(booking.status) && (
                          booking.payment_status === 'paid' ? (
                            <div className="cash-notice cash-notice--settled mt-3">
                              <Check className="w-5 h-5 cash-notice__icon" />
                              <div>
                                <p className="cash-notice__title">Paid in cash</p>
                                <p className="cash-notice__body">
                                  {isProvider
                                    ? 'You recorded this cash payment as received.'
                                    : `${booking.otherParty.name} recorded your cash payment. If that's wrong, message them or contact support.`}
                                </p>
                              </div>
                            </div>
                          ) : canConfirmCash(booking) && isProvider ? (
                            <div className="cash-confirm mt-3">
                              <p className="cash-confirm__text">
                                Did {booking.otherParty.name} hand over the &#8369;{booking.price.toLocaleString('en-PH', { minimumFractionDigits: 2 })} in cash?
                              </p>
                              <button
                                type="button"
                                onClick={() => setCashConfirmBooking(booking)}
                                disabled={confirmingCashFor === String(booking.id)}
                                className="cash-confirm__button"
                              >
                                {confirmingCashFor === String(booking.id) ? 'Recording...' : 'Yes, cash received'}
                              </button>
                            </div>
                          ) : (
                            <div className="cash-notice mt-3">
                              <PhilippinePeso className="w-5 h-5 cash-notice__icon" />
                              <div>
                                <p className="cash-notice__title">Paying &#8369;{booking.price.toLocaleString('en-PH', { minimumFractionDigits: 2 })} in cash on the day</p>
                                <p className="cash-notice__body">
                                  {booking.status === 'disputed'
                                    ? `No cash payment was recorded for this booking. That can't be changed while the dispute is open – support will settle it as part of the outcome.`
                                    : isProvider
                                      ? `Collect the cash at the shoot, then mark it received here. You can do that from the booking's start time.`
                                      : `Nothing to pay online. Bring the cash to the shoot and ${booking.otherParty.name} will mark it received. Cash payments aren't held in escrow, so we can't refund them for you.`}
                                </p>
                              </div>
                            </div>
                          )
                        )}

                        {/* Says why, so an expiry doesn't read as the other party walking
                            away - 'cancelled' now covers both. */}
                        {booking.status === 'cancelled' && booking.cancellation_reason && (
                          <p className="text-xs text-gray-500 mt-2">{booking.cancellation_reason}</p>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusStyle.bg} ${statusStyle.text}`}>
                            {statusStyle.label}
                          </span>
                          {PAYABLE_STATUSES.includes(booking.status) && (
                            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                              booking.payment_status === 'paid'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}>
                              {booking.payment_status === 'paid'
                                ? (booking.payment_method === 'cash' ? 'Paid in cash' : 'Paid')
                                : booking.payment_method === 'cash' ? 'Cash on the day' : 'Payment due'}
                            </span>
                          )}
                          <div className="flex items-center gap-4">
                            <button
                              onClick={() => setDetailsBooking(booking)}
                              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                            >
                              <Info className="w-4 h-4" />
                              View Details
                            </button>
                            {!isProvider && isPayable(booking) && (
                              <button
                                onClick={() => openPayment(booking)}
                                disabled={checkingPaymentFor === String(booking.id)}
                                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {checkingPaymentFor === String(booking.id) ? 'Checking...' : 'Pay now'}
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setChatParty(booking.otherParty);
                                setShowChat(true);
                              }}
                              className="flex items-center gap-2 text-sm text-purple-600 hover:text-purple-700 transition-colors"
                            >
                              <MessageSquare className="w-4 h-4" />
                              Message
                            </button>
                            {booking.reschedule_pending_approval ? (
                              String(booking.rescheduled_by) === String(user?.id) ? (
                                <span className="flex items-center gap-2 text-sm text-orange-600">
                                  <RefreshCw className="w-4 h-4" />
                                  Awaiting confirmation
                                </span>
                              ) : (
                                <>
                                  <button
                                    onClick={() => handleApproveReschedule(String(booking.id))}
                                    disabled={reschedulingId === String(booking.id)}
                                    className="flex items-center gap-2 text-sm text-green-600 hover:text-green-700 transition-colors disabled:opacity-50"
                                  >
                                    Confirm New Time
                                  </button>
                                  <button
                                    onClick={() => handleRejectReschedule(String(booking.id))}
                                    disabled={reschedulingId === String(booking.id)}
                                    className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50"
                                  >
                                    Keep Original Time
                                  </button>
                                </>
                              )
                            ) : canReschedule && (
                              <button
                                onClick={() => {
                                  setRescheduleBooking({
                                    id: String(booking.id),
                                    service: booking.service,
                                    provider: isProvider ? undefined : booking.otherParty.name,
                                    client: isProvider ? booking.otherParty.name : undefined,
                                    date: booking.date,
                                    time: booking.time,
                                    start_date: booking.start_date,
                                    end_date: booking.end_date,
                                    otherPartyId: booking.otherParty.id,
                                  });
                                  setShowRescheduleModal(true);
                                }}
                                className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                              >
                                <RefreshCw className="w-4 h-4" />
                                Reschedule
                              </button>
                            )}
                            {!isProvider && booking.status === 'awaiting_confirmation' && (
                              <button
                                onClick={() => {
                                  setConfirmBookingData({
                                    id: String(booking.id),
                                    service_title: booking.service,
                                    provider_name: booking.otherParty.name,
                                    provider_completed_at: booking.provider_completed_at,
                                    completion_notes: booking.completion_notes,
                                    start_date: booking.start_date || booking.date,
                                  });
                                  setShowConfirmModal(true);
                                }}
                                className="flex items-center gap-2 text-sm text-orange-600 hover:text-orange-700 transition-colors"
                              >
                                <Clock className="w-4 h-4" />
                                Confirm Completion
                              </button>
                            )}
                            {!isProvider && booking.status === 'completed' && !reviewedBookingIds.has(String(booking.id)) && (
                              <button
                                onClick={() => handleLeaveReview(booking)}
                                className="flex items-center gap-2 text-sm text-yellow-600 hover:text-yellow-700 transition-colors"
                              >
                                <Star className="w-4 h-4" />
                                Leave Review
                              </button>
                            )}
                            {!isProvider && booking.status === 'completed' && reviewedBookingIds.has(String(booking.id)) && (
                              <span className="flex items-center gap-2 text-sm text-green-600">
                                <Star className="w-4 h-4 fill-current" />
                                Reviewed
                              </span>
                            )}
                          </div>
                        </div>

                        {!isProvider && booking.status === 'disputed' && (
                          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                            <div className="flex items-start gap-2">
                              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                              <div>
                                <h4 className="text-sm font-semibold text-red-800">Dispute Under Review</h4>
                                <p className="text-sm text-red-700 mt-1">
                                  {booking.dispute_reason
                                    ? `Your Reason: "${booking.dispute_reason}"`
                                    : 'You have disputed this booking. An admin will review it shortly.'}
                                </p>
                                <p className="text-xs text-red-600 mt-2">
                                  Admins will analyze the evidence and notify you of the resolution.
                                </p>
                              </div>
                            </div>
                            {/* The client's case used to end at the reason they typed.
                                They can now back it with photos while it is still open,
                                and see the provider's answer instead of waiting for the
                                verdict to find out what was said. */}
                            <DisputeResponsePanel
                              bookingId={booking.id}
                              role="client"
                              existingResponse={booking.dispute_response}
                              existingResponseAt={booking.dispute_response_at}
                              onSubmitted={() => fetchBookings({ silent: true, resetPage: false })}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                    safePage === 1 ? 'text-gray-400' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Previous
                </button>
                {Array.from({ length: totalPages }).map((_, i) => {
                  const pageNum = i + 1;
                  const isActive = pageNum === safePage;
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`w-9 h-9 rounded-lg text-sm transition-colors ${
                        isActive ? 'bg-purple-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                    safePage === totalPages ? 'text-gray-400' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Next
                </button>
              </div>
            )}
              </>
            )}
          </>
        )}
      </div>

      {detailsBooking && (
        <BookingDetailsModal
          booking={detailsBooking}
          isProvider={isProvider}
          onClose={() => setDetailsBooking(null)}
        />
      )}

      {showChat && chatParty && (
        <ChatInterface
          provider={chatParty}
          onClose={() => {
            setShowChat(false);
            setChatParty(null);
          }}
        />
      )}

      {showRescheduleModal && rescheduleBooking && (
        <RescheduleModal
          providerId={String(isProvider ? user?.id : rescheduleBooking.otherPartyId)}
          booking={rescheduleBooking}
          onClose={() => {
            setShowRescheduleModal(false);
            setRescheduleBooking(null);
          }}
          onSuccess={() => {
            setShowRescheduleModal(false);
            setRescheduleBooking(null);
            fetchBookings();
          }}
        />
      )}

      {showConfirmModal && confirmBookingData && (
        <ConfirmCompletionModal
          booking={confirmBookingData}
          onClose={() => {
            setShowConfirmModal(false);
            setConfirmBookingData(null);
          }}
          onSuccess={() => {
            setShowConfirmModal(false);
            setConfirmBookingData(null);
            fetchBookings();
          }}
        />
      )}

      {showReviewForm && reviewBooking && (
        <ReviewForm
          bookingId={String(reviewBooking.id)}
          providerName={reviewBooking.otherParty.name}
          serviceName={reviewBooking.service}
          onClose={() => {
            setShowReviewForm(false);
            setReviewBooking(null);
          }}
          onSuccess={handleReviewSuccess}
        />
      )}

      {cashConfirmBooking && (
        <div className="modal-overlay" {...cashOverlayProps}>
          <div className="modal-card modal-card--md modal-card--plain p-6" {...cashCardProps}>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Confirm cash received</h2>
            <p className="text-sm text-gray-600 mb-4">
              You&apos;re about to record that {cashConfirmBooking.otherParty.name} paid you{' '}
              <span className="font-semibold text-gray-900">
                &#8369;{Number(cashConfirmBooking.price || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </span>{' '}
              in cash for &ldquo;{cashConfirmBooking.service}&rdquo;.
            </p>
            <div className="cash-notice mb-4">
              <AlertCircle className="w-5 h-5 cash-notice__icon" />
              <div>
                <p className="cash-notice__body">
                  This marks the booking paid and takes the {PLATFORM_COMMISSION_PERCENT}% platform
                  commission from your wallet balance &mdash; you already hold the cash, so there&apos;s
                  nothing for us to deduct it from. {cashConfirmBooking.otherParty.name} is told straight
                  away, and this can&apos;t be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setCashConfirmBooking(null)}
                disabled={!!confirmingCashFor}
                className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmCash}
                disabled={!!confirmingCashFor}
                className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {confirmingCashFor ? 'Recording...' : 'Yes, I received it'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment moved here from BookingFlow: the client is only asked to pay once
          the provider has accepted, so this is the only place PaymentSummary is
          reachable from. The overlay matches the one BookingFlow used to render. */}
      {payingBooking && (
        <div className="modal-overlay" {...paymentOverlayProps}>
          <PaymentSummary
            bookingId={String(payingBooking.id)}
            serviceName={payingBooking.service}
            providerName={payingBooking.otherParty.name}
            totalAmount={payingBooking.price}
            onPaymentSuccess={() => {
              setPayingBooking(null);
              toast.success('Payment complete', 'Your booking is paid and confirmed.');
              fetchBookings({ resetPage: false });
            }}
            onPaymentFailed={(err) => {
              // Leave the modal open so the client can retry with another card, but
              // re-read the booking behind it: a "failure" that was really a settled
              // payment must not leave a stale Pay button waiting underneath.
              toast.error('Payment failed', err);
              fetchBookings({ silent: true, resetPage: false });
            }}
            onAlreadyPaid={() => {
              setPayingBooking(null);
              toast.success('Already paid', 'That booking was already paid for - your list is up to date now.');
              fetchBookings({ resetPage: false });
            }}
            // Every exit refreshes. Closing without one is what let the list keep
            // offering Pay for a booking that had already been paid.
            onCancel={cancelPayment}
            // Gates Escape/backdrop-close above - see paymentCloseable.
            onCloseabilityChange={setPaymentCloseable}
          />
        </div>
      )}
    </div>
  );
}

export default BookingsPage;
