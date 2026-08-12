import { useEffect, useState } from 'react';
import {
  X, Calendar, Clock, PhilippinePeso, Mail, Tag, FileText,
  RefreshCw, AlertCircle, CheckCircle2, Image as ImageIcon, Loader2, Receipt,
} from 'lucide-react';
import { useModal } from '../hooks/useModal';
import bookingService, { BookingEvidence } from '../api/services/bookingService';
import { getUploadUrl } from '../api/config';
import { STATUS_STYLES } from './BookingsPage';
import { ImageWithFallback } from './figma/ImageWithFallback';

// Evidence only exists once a provider has gone through the complete-with-evidence
// flow, so there's no point calling the endpoint for bookings that never reached it.
const STATUSES_WITH_EVIDENCE = ['awaiting_confirmation', 'completed', 'disputed'];

interface BookingDetailsModalProps {
  booking: {
    id: string;
    otherParty: { id?: string; name: string; image?: string; email?: string };
    service: string;
    service_description?: string;
    service_category?: string;
    service_duration_minutes?: number;
    start_date?: string;
    end_date?: string;
    price: number;
    status: string;
    payment_status?: string;
    payment_due_at?: string | null;
    created_at?: string;
    accepted_at?: string | null;
    rejected_at?: string | null;
    cancelled_at?: string | null;
    completed_at?: string | null;
    cancellation_reason?: string | null;
    dispute_reason?: string | null;
    dispute_resolution?: string | null;
    dispute_resolved_at?: string | null;
    provider_completed_at?: string | null;
    client_confirmed_at?: string | null;
    completion_notes?: string | null;
    rescheduled_at?: string | null;
    reschedule_reason?: string | null;
    reschedule_count?: number;
    original_start_date?: string | null;
    original_end_date?: string | null;
  };
  isProvider: boolean;
  onClose: () => void;
}

function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila',
  });
}

function formatTimeOnly(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
}

function formatDuration(minutes?: number, start?: string, end?: string): string {
  let mins = minutes;
  if (!mins && start && end) {
    const diff = new Date(end).getTime() - new Date(start).getTime();
    if (!isNaN(diff) && diff > 0) mins = Math.round(diff / 60000);
  }
  if (!mins || mins <= 0) return '';
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours === 0) return `${rem} min`;
  if (rem === 0) return `${hours} hr${hours !== 1 ? 's' : ''}`;
  return `${hours} hr${hours !== 1 ? 's' : ''} ${rem} min`;
}

export function BookingDetailsModal({ booking, isProvider, onClose }: BookingDetailsModalProps) {
  const { overlayProps, cardProps } = useModal(onClose, { label: 'Booking details' });
  const [evidence, setEvidence] = useState<BookingEvidence[]>([]);
  const [loadingEvidence, setLoadingEvidence] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  useModal(() => setSelectedImage(null), { enabled: !!selectedImage, lockScroll: false });

  useEffect(() => {
    if (!STATUSES_WITH_EVIDENCE.includes(booking.status)) return;
    setLoadingEvidence(true);
    bookingService.getBookingEvidence(booking.id)
      .then(setEvidence)
      .catch((err) => console.error('Failed to load evidence:', err))
      .finally(() => setLoadingEvidence(false));
  }, [booking.id, booking.status]);

  const statusStyle = STATUS_STYLES[booking.status] || { bg: 'bg-gray-100', text: 'text-gray-700', label: booking.status };
  const otherPartyLabel = isProvider ? 'Client' : 'Provider';
  const duration = formatDuration(booking.service_duration_minutes, booking.start_date, booking.end_date);
  const wasRescheduled = !!booking.rescheduled_at || !!booking.original_start_date;

  // Timeline entries in chronological order, only the ones that actually happened.
  const timeline: { label: string; at: string }[] = [];
  if (booking.created_at) timeline.push({ label: 'Booking requested', at: booking.created_at });
  if (booking.accepted_at) timeline.push({ label: 'Accepted by provider', at: booking.accepted_at });
  if (booking.rejected_at) timeline.push({ label: 'Rejected by provider', at: booking.rejected_at });
  if (booking.provider_completed_at) timeline.push({ label: 'Marked complete by provider', at: booking.provider_completed_at });
  if (booking.client_confirmed_at) timeline.push({ label: 'Completion confirmed by client', at: booking.client_confirmed_at });
  if (booking.dispute_resolved_at) timeline.push({ label: 'Dispute resolved', at: booking.dispute_resolved_at });
  if (booking.cancelled_at) timeline.push({ label: 'Cancelled', at: booking.cancelled_at });
  if (booking.completed_at) timeline.push({ label: 'Completed', at: booking.completed_at });
  timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const getEvidenceUrl = (fileUrl: string) => getUploadUrl(fileUrl);

  return (
    <>
      <div className="modal-overlay" {...overlayProps}>
        <div className="modal-card modal-card--lg" {...cardProps}>
          <div className="modal-header flex items-center justify-between p-4 border-b border-gray-200">
            <div className="flex items-center gap-2 min-w-0">
              <Receipt className="w-5 h-5 text-purple-600 flex-shrink-0" />
              <h2 className="text-lg font-semibold text-gray-900 truncate">Booking Details</h2>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors flex-shrink-0">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          <div className="modal-body p-4 space-y-4">
            {/* Status + reference */}
            <div className="flex items-center justify-between">
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusStyle.bg} ${statusStyle.text}`}>
                {statusStyle.label}
              </span>
              <span className="text-xs text-gray-400">Ref #{String(booking.id).slice(0, 8)}</span>
            </div>

            {/* Service */}
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="font-medium text-gray-900">{booking.service}</p>
              {booking.service_category && (
                <p className="flex items-center gap-1.5 text-xs text-gray-500 mt-1">
                  <Tag className="w-3.5 h-3.5" />
                  {booking.service_category}
                </p>
              )}
              {booking.service_description && (
                <p className="text-sm text-gray-600 mt-2">{booking.service_description}</p>
              )}
            </div>

            {/* Schedule */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">Schedule</p>
              <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
                <p className="flex items-center gap-2 text-sm text-gray-700">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  {formatDateTime(booking.start_date)}
                </p>
                {booking.end_date && (
                  <p className="flex items-center gap-2 text-sm text-gray-700">
                    <Clock className="w-4 h-4 text-gray-400" />
                    Until {formatTimeOnly(booking.end_date)}
                    {duration && ` (${duration})`}
                  </p>
                )}
                {booking.created_at && (
                  <p className="text-xs text-gray-400 pt-1">Booked on {formatDateTime(booking.created_at)}</p>
                )}
              </div>
            </div>

            {/* Price */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">Price</p>
              <div className="bg-gray-50 rounded-xl p-3 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-gray-900">
                  <PhilippinePeso className="w-4 h-4 text-gray-400" />
                  {booking.price.toLocaleString()}
                </span>
                {booking.payment_status && (
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    booking.payment_status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {booking.payment_status === 'paid' ? 'Paid' : 'Payment due'}
                  </span>
                )}
              </div>
            </div>

            {/* Other party */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">{otherPartyLabel}</p>
              <div className="bg-gray-50 rounded-xl p-3 flex items-center gap-3">
                <ImageWithFallback
                  src={booking.otherParty.image}
                  alt={booking.otherParty.name}
                  className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{booking.otherParty.name}</p>
                  {booking.otherParty.email && (
                    <p className="flex items-center gap-1.5 text-xs text-gray-500 truncate">
                      <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                      {booking.otherParty.email}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Reschedule history */}
            {wasRescheduled && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">Reschedule History</p>
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 space-y-1">
                  <p className="flex items-center gap-2 text-sm text-amber-800">
                    <RefreshCw className="w-4 h-4 flex-shrink-0" />
                    Originally {formatDateTime(booking.original_start_date)}
                  </p>
                  {booking.reschedule_reason && (
                    <p className="text-xs text-amber-700">Reason: {booking.reschedule_reason}</p>
                  )}
                  {!!booking.reschedule_count && booking.reschedule_count > 1 && (
                    <p className="text-xs text-amber-600">Rescheduled {booking.reschedule_count} times</p>
                  )}
                </div>
              </div>
            )}

            {/* Cancellation reason */}
            {booking.status === 'cancelled' && booking.cancellation_reason && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">Cancellation Reason</p>
                <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                  <p className="text-sm text-red-700">{booking.cancellation_reason}</p>
                </div>
              </div>
            )}

            {/* Dispute */}
            {(booking.dispute_reason || booking.dispute_resolution) && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">Dispute</p>
                <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-2">
                  {booking.dispute_reason && (
                    <p className="flex items-start gap-2 text-sm text-red-700">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      {booking.dispute_reason}
                    </p>
                  )}
                  {booking.dispute_resolution && (
                    <p className="flex items-start gap-2 text-sm text-green-700 pt-2 border-t border-red-100">
                      <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      Resolution: {booking.dispute_resolution}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Completion notes + evidence */}
            {(booking.completion_notes || STATUSES_WITH_EVIDENCE.includes(booking.status)) && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">Completion</p>
                <div className="bg-gray-50 rounded-xl p-3 space-y-3">
                  {booking.completion_notes && (
                    <p className="text-sm text-gray-600">{booking.completion_notes}</p>
                  )}
                  {loadingEvidence ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                    </div>
                  ) : evidence.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2">
                      {evidence.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => setSelectedImage(getEvidenceUrl(e.file_url))}
                          className="relative group"
                        >
                          <img
                            src={getEvidenceUrl(e.file_url)}
                            alt={e.evidence_type}
                            className="w-full h-20 object-cover rounded-lg bg-gray-100"
                          />
                        </button>
                      ))}
                    </div>
                  ) : STATUSES_WITH_EVIDENCE.includes(booking.status) ? (
                    <p className="flex items-center gap-2 text-xs text-gray-400">
                      <ImageIcon className="w-4 h-4" />
                      No evidence photos uploaded
                    </p>
                  ) : null}
                </div>
              </div>
            )}

            {/* Full status timeline */}
            {timeline.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">Timeline</p>
                <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                  {timeline.map((entry, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <FileText className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-gray-700">{entry.label}</p>
                        <p className="text-xs text-gray-400">{formatDateTime(entry.at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedImage && (
        <div className="modal-lightbox" onClick={() => setSelectedImage(null)}>
          <button
            className="modal-lightbox-close p-2 text-white hover:bg-white/20 rounded-full"
            onClick={() => setSelectedImage(null)}
          >
            <X className="w-6 h-6" />
          </button>
          <img src={selectedImage} alt="Evidence" className="max-w-full max-h-full object-contain rounded-lg bg-gray-800" />
        </div>
      )}
    </>
  );
}

export default BookingDetailsModal;
