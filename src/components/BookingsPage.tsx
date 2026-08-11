import { useEffect, useMemo, useState } from 'react';
import { Calendar, Clock, PhilippinePeso, MessageSquare, RefreshCw, AlertCircle, Star } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { EmptyState } from './EmptyState';
import { ChatInterface } from './ChatInterface';
import { RescheduleModal } from './RescheduleModal';
import { ConfirmCompletionModal } from './ConfirmCompletionModal';
import { ReviewForm } from './ReviewForm';
import { PaymentSummary } from './PaymentSummary';
import bookingService from '../api/services/bookingService';
import reviewService from '../api/services/reviewService';

const ITEMS_PER_PAGE = 8;

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
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
function isPayable(booking: { status: string; payment_status?: string }) {
  return PAYABLE_STATUSES.includes(booking.status) && booking.payment_status !== 'paid';
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

  const fetchBookings = async () => {
    setLoading(true);
    setError(null);
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
          ? { id: b.client_user_id || b.client_id, name: b.client_name || b.client_email || 'Client', image: b.client_image }
          : { id: b.provider_user_id || b.provider_id, name: b.provider_name || 'Provider', image: b.provider_image };

        return {
          id: b.id,
          otherParty,
          service: b.service_title || b.service_name || 'Service',
          date,
          time,
          start_date: b.start_date,
          end_date: b.end_date,
          price: Number(b.total_price || b.totalPrice || b.price || 0),
          status: b.status,
          payment_status: b.payment_status,
          dispute_reason: b.dispute_reason,
          provider_completed_at: b.provider_completed_at,
          completion_notes: b.completion_notes,
          reschedule_pending_approval: b.reschedule_pending_approval,
          rescheduled_by: b.rescheduled_by,
        };
      });

      mapped.sort((a, b) => {
        const aTime = a.start_date ? new Date(a.start_date).getTime() : Infinity;
        const bTime = b.start_date ? new Date(b.start_date).getTime() : Infinity;
        return aTime - bTime;
      });

      setBookings(mapped);
      setPage(1);
    } catch (err: any) {
      console.error('Failed to fetch bookings', err);
      setError(err?.message || 'Failed to load bookings');
      setBookings([]);
    } finally {
      setLoading(false);
    }
  };

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
              onClick={fetchBookings}
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
                              {booking.payment_status === 'paid' ? 'Paid' : 'Payment due'}
                            </span>
                          )}
                          <div className="flex items-center gap-4">
                            {!isProvider && isPayable(booking) && (
                              <button
                                onClick={() => setPayingBooking(booking)}
                                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
                              >
                                Pay now
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

      {/* Payment moved here from BookingFlow: the client is only asked to pay once
          the provider has accepted, so this is the only place PaymentSummary is
          reachable from. The overlay matches the one BookingFlow used to render. */}
      {payingBooking && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <PaymentSummary
            bookingId={String(payingBooking.id)}
            serviceName={payingBooking.service}
            providerName={payingBooking.otherParty.name}
            totalAmount={payingBooking.price}
            onPaymentSuccess={() => {
              setPayingBooking(null);
              toast.success('Payment complete', 'Your booking is paid and confirmed.');
              fetchBookings();
            }}
            onPaymentFailed={(err) => {
              // Leave the modal open so the client can retry with another card.
              toast.error('Payment failed', err);
            }}
            onCancel={() => setPayingBooking(null)}
          />
        </div>
      )}
    </div>
  );
}

export default BookingsPage;
