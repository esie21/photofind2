import { useState, useEffect } from 'react';
import { X, AlertCircle, Loader2, CheckCircle, AlertTriangle, Image, Clock } from 'lucide-react';
import bookingService, { BookingEvidence } from '../api/services/bookingService';
import { getUploadUrl } from '../api/config';

interface ConfirmCompletionModalProps {
  booking: {
    id: string;
    service_title?: string;
    provider_name?: string;
    provider_completed_at?: string;
    completion_notes?: string;
    start_date?: string;
  };
  onClose: () => void;
  onSuccess: () => void;
}

export function ConfirmCompletionModal({ booking, onClose, onSuccess }: ConfirmCompletionModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingEvidence, setIsLoadingEvidence] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<BookingEvidence[]>([]);
  const [showDispute, setShowDispute] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    loadEvidence();
  }, [booking.id]);

  const loadEvidence = async () => {
    try {
      const data = await bookingService.getBookingEvidence(booking.id);
      setEvidence(data);
    } catch (err) {
      console.error('Failed to load evidence:', err);
    } finally {
      setIsLoadingEvidence(false);
    }
  };

  const handleConfirm = async () => {
    setError(null);
    setIsLoading(true);

    try {
      await bookingService.confirmBooking(booking.id, true);
      onSuccess();
    } catch (err: any) {
      console.error('Confirm error:', err);
      setError(err?.message || 'Failed to confirm completion');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDispute = async () => {
    setError(null);

    if (disputeReason.trim().length < 10) {
      setError('Please provide a detailed reason (at least 10 characters)');
      return;
    }

    setIsLoading(true);

    try {
      await bookingService.confirmBooking(booking.id, false, disputeReason.trim());
      onSuccess();
    } catch (err: any) {
      console.error('Dispute error:', err);
      setError(err?.message || 'Failed to submit dispute');
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Not set';
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const getTimeRemaining = (): { text: string; urgency: 'normal' | 'warning' | 'critical' } | null => {
    if (!booking.provider_completed_at) return null;
    const completedAt = new Date(booking.provider_completed_at);
    const deadline = new Date(completedAt.getTime() + 48 * 60 * 60 * 1000);
    const now = new Date();
    const remaining = deadline.getTime() - now.getTime();

    if (remaining <= 0) return { text: 'Auto-confirming very soon...', urgency: 'critical' };

    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

    // Determine urgency level
    let urgency: 'normal' | 'warning' | 'critical' = 'normal';
    if (hours < 6) {
      urgency = 'critical';
    } else if (hours < 12) {
      urgency = 'warning';
    }

    // Format text based on time remaining
    let text: string;
    if (hours === 0) {
      text = `Only ${minutes} minutes left to respond!`;
    } else if (hours < 6) {
      text = `Only ${hours}h ${minutes}m left - respond now!`;
    } else if (hours < 24) {
      text = `${hours}h ${minutes}m remaining to respond`;
    } else {
      text = `${hours}h ${minutes}m remaining`;
    }

    return { text, urgency };
  };

  const timeInfo = getTimeRemaining();

  const getEvidenceUrl = (fileUrl: string) => {
    // Use centralized URL utility that works in both dev and production
    return getUploadUrl(fileUrl);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-xl max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-900">Confirm Service Completion</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Booking Info */}
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="font-medium text-gray-900">{booking.service_title || 'Service'}</p>
              <p className="text-sm text-gray-600">Provider: {booking.provider_name || 'Provider'}</p>
              <p className="text-sm text-gray-500">{formatDate(booking.start_date)}</p>
            </div>

            {/* Time Remaining with Urgency Indicators */}
            {timeInfo && (
              <div className={`flex items-center gap-2 text-sm rounded-xl p-3 ${
                timeInfo.urgency === 'critical'
                  ? 'text-red-700 bg-red-50 animate-pulse'
                  : timeInfo.urgency === 'warning'
                    ? 'text-orange-700 bg-orange-50'
                    : 'text-amber-700 bg-amber-50'
              }`}>
                <Clock className={`w-4 h-4 ${timeInfo.urgency === 'critical' ? 'animate-bounce' : ''}`} />
                <span className="font-medium">{timeInfo.text}</span>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 rounded-xl">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Completion Notes */}
            {booking.completion_notes && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">Provider Notes</p>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-sm text-gray-600">{booking.completion_notes}</p>
                </div>
              </div>
            )}

            {/* Evidence Photos */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">
                Evidence Photos ({evidence.length})
              </p>
              {isLoadingEvidence ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : evidence.length === 0 ? (
                <div className="text-center py-8 bg-gray-50 rounded-xl">
                  <Image className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No evidence photos uploaded</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
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
                        className="w-full h-32 object-cover rounded-lg bg-gray-100"
                        onError={(ev) => {
                          const target = ev.currentTarget;
                          target.onerror = null;
                          target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="%239ca3af" stroke-width="2"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"%3E%3C/rect%3E%3Ccircle cx="8.5" cy="8.5" r="1.5"%3E%3C/circle%3E%3Cpolyline points="21,15 16,10 5,21"%3E%3C/polyline%3E%3C/svg%3E';
                        }}
                      />
                      <span className="absolute bottom-2 left-2 text-xs bg-black/60 text-white px-2 py-0.5 rounded capitalize">
                        {e.evidence_type}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Dispute Form */}
            {showDispute && (
              <div className="space-y-3 pt-2 border-t border-gray-200">
                <div className="flex items-start gap-2 p-3 bg-red-50 rounded-xl">
                  <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">
                    Raising a dispute will notify the admin for review. Please provide a detailed reason.
                  </p>
                </div>
                <textarea
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  placeholder="Explain why you're disputing this completion..."
                  rows={3}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="p-4 border-t border-gray-200 space-y-3">
            {!showDispute ? (
              <>
                <button
                  onClick={handleConfirm}
                  disabled={isLoading}
                  className="w-full px-4 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 font-medium"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Confirming...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-5 h-5" />
                      Confirm Service Complete
                    </>
                  )}
                </button>
                <button
                  onClick={() => setShowDispute(true)}
                  disabled={isLoading}
                  className="w-full px-4 py-2.5 text-red-600 hover:bg-red-50 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4" />
                  Raise Dispute
                </button>
              </>
            ) : (
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowDispute(false);
                    setDisputeReason('');
                    setError(null);
                  }}
                  disabled={isLoading}
                  className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  onClick={handleDispute}
                  disabled={isLoading || disputeReason.trim().length < 10}
                  className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    'Submit Dispute'
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Image Lightbox */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4"
          onClick={() => setSelectedImage(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 text-white hover:bg-white/20 rounded-full"
            onClick={() => setSelectedImage(null)}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={selectedImage}
            alt="Evidence"
            className="max-w-full max-h-full object-contain rounded-lg bg-gray-800"
            onError={(ev) => {
              const target = ev.currentTarget;
              target.onerror = null;
              target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="%239ca3af" stroke-width="2"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"%3E%3C/rect%3E%3Ccircle cx="8.5" cy="8.5" r="1.5"%3E%3C/circle%3E%3Cpolyline points="21,15 16,10 5,21"%3E%3C/polyline%3E%3C/svg%3E';
            }}
          />
        </div>
      )}
    </>
  );
}

export default ConfirmCompletionModal;
