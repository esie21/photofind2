import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, X, Loader2, Image, Eye, User, Clock, FileText } from 'lucide-react';
import bookingService, { DisputedBooking, BookingEvidence } from '../api/services/bookingService';
import { getUploadUrl } from '../api/config';

interface BookingDisputesPanelProps {
  onRefresh?: () => void;
}

export function BookingDisputesPanel({ onRefresh }: BookingDisputesPanelProps) {
  const [loading, setLoading] = useState(true);
  const [disputes, setDisputes] = useState<DisputedBooking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedDispute, setSelectedDispute] = useState<DisputedBooking | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolution, setResolution] = useState('');
  const [resolvedInFavorOf, setResolvedInFavorOf] = useState<'client' | 'provider'>('provider');
  const [refundPercentage, setRefundPercentage] = useState(100);
  const [resolving, setResolving] = useState(false);
  const [resolutionResult, setResolutionResult] = useState<{ message: string; details?: any } | null>(null);

  useEffect(() => {
    loadDisputes();
  }, []);

  const loadDisputes = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await bookingService.getDisputedBookings();
      console.log('Loaded disputes:', data.length, data); // Debug log
      setDisputes(data);
    } catch (err: any) {
      console.error('Error loading disputes:', err);
      setError(err?.message || 'Failed to load disputes');
    } finally {
      setLoading(false);
    }
  };

  const handleResolve = async () => {
    if (!selectedDispute || !resolution.trim()) return;

    setResolving(true);
    try {
      // Use refund percentage for client resolution, 0 for provider resolution
      const effectiveRefundPct = resolvedInFavorOf === 'client' ? refundPercentage : 0;
      const result = await bookingService.resolveDispute(
        selectedDispute.id,
        resolution.trim(),
        resolvedInFavorOf,
        effectiveRefundPct
      );
      // Show success result
      setResolutionResult({
        message: result.message,
        details: result.details
      });
      await loadDisputes();
      setShowResolveModal(false);
      setSelectedDispute(null);
      setResolution('');
      setRefundPercentage(100);
      onRefresh?.();
    } catch (err: any) {
      alert(err?.message || 'Failed to resolve dispute');
    } finally {
      setResolving(false);
    }
  };

  const getEvidenceUrl = (fileUrl: string) => {
    // Use centralized URL utility that works in both dev and production
    return getUploadUrl(fileUrl);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'disputed':
        return 'bg-red-100 text-red-700';
      case 'awaiting_confirmation':
        return 'bg-yellow-100 text-yellow-700';
      case 'completed':
        return 'bg-green-100 text-green-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="text-red-700">{error}</p>
        <button
          onClick={loadDisputes}
          className="mt-3 text-red-600 underline text-sm"
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
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Booking Disputes</h2>
          <p className="text-sm text-gray-500">
            Review and resolve booking completion disputes
          </p>
        </div>
        <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm font-medium">
          {disputes.length} dispute{disputes.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Disputes List */}
      {disputes.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
          <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No Active Disputes</h3>
          <p className="text-gray-500">All booking completions are confirmed.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-yellow-50 p-4 rounded-xl">
            <p className="text-yellow-800">Debug: Found {disputes.length} disputes</p>
          </div>
          {disputes.map((dispute) => (
            <div
              key={dispute.id}
              className="bg-white rounded-2xl shadow-sm overflow-hidden border-l-4 border-red-500"
            >
              {/* Dispute Header */}
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-gray-900">
                        {dispute.service_title || 'Service'}
                      </h3>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(dispute.status)}`}>
                        {dispute.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-600">
                          <span className="font-medium">Client:</span> {dispute.client_name || 'Unknown Client'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-600">
                          <span className="font-medium">Provider:</span> {dispute.provider_name || 'Unknown Provider'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedDispute(dispute)}
                    className="px-4 py-2 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <Eye className="w-4 h-4" />
                    View Details
                  </button>
                </div>

                {/* Dispute Reason */}
                {dispute.dispute_reason && (
                  <div className="mt-4 p-3 bg-red-50 rounded-xl">
                    <p className="text-sm font-medium text-red-800 mb-1">Dispute Reason:</p>
                    <p className="text-sm text-red-700">{dispute.dispute_reason}</p>
                  </div>
                )}

                {/* Completion Notes */}
                {dispute.completion_notes && (
                  <div className="mt-3 p-3 bg-gray-50 rounded-xl">
                    <p className="text-sm font-medium text-gray-700 mb-1">Provider Notes:</p>
                    <p className="text-sm text-gray-600">{dispute.completion_notes}</p>
                  </div>
                )}

                {/* Evidence Preview */}
                {dispute.evidence && dispute.evidence.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      Evidence ({dispute.evidence.length} photos)
                    </p>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {dispute.evidence.slice(0, 4).map((e) => (
                        <button
                          key={e.id}
                          onClick={() => setSelectedImage(getEvidenceUrl(e.file_url))}
                          className="relative flex-shrink-0"
                        >
                          <img
                            src={getEvidenceUrl(e.file_url)}
                            alt={e.evidence_type}
                            className="w-20 h-20 object-cover rounded-lg bg-gray-100"
                            onError={(ev) => {
                              const target = ev.currentTarget;
                              target.onerror = null;
                              target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="%239ca3af" stroke-width="2"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"%3E%3C/rect%3E%3Ccircle cx="8.5" cy="8.5" r="1.5"%3E%3C/circle%3E%3Cpolyline points="21,15 16,10 5,21"%3E%3C/polyline%3E%3C/svg%3E';
                            }}
                          />
                          <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded capitalize">
                            {e.evidence_type}
                          </span>
                        </button>
                      ))}
                      {dispute.evidence.length > 4 && (
                        <button
                          onClick={() => setSelectedDispute(dispute)}
                          className="w-20 h-20 bg-gray-100 rounded-lg flex items-center justify-center text-sm text-gray-500"
                        >
                          +{dispute.evidence.length - 4} more
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Timestamps */}
                <div className="mt-4 flex items-center gap-4 text-xs text-gray-500">
                  {dispute.provider_completed_at && (
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>Completed: {formatDate(dispute.provider_completed_at)}</span>
                    </div>
                  )}
                  {(dispute.createdAt || (dispute as any).created_at) && (
                    <div className="flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      <span>Created: {formatDate(dispute.createdAt || (dispute as any).created_at)}</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="mt-4 flex gap-3">
                  <button
                    onClick={() => {
                      setSelectedDispute(dispute);
                      setResolvedInFavorOf('provider');
                      setShowResolveModal(true);
                    }}
                    className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors text-sm font-medium"
                  >
                    Resolve for Provider
                  </button>
                  <button
                    onClick={() => {
                      setSelectedDispute(dispute);
                      setResolvedInFavorOf('client');
                      setShowResolveModal(true);
                    }}
                    className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors text-sm font-medium border-2 border-red-500"
                  >
                    Resolve for Client
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selectedDispute && !showResolveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Dispute Details</h3>
              <button
                onClick={() => setSelectedDispute(null)}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Booking Info */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h4 className="font-medium text-gray-900 mb-2">
                  {selectedDispute.service_title || 'Service'}
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Client</p>
                    <p className="font-medium">{selectedDispute.client_name}</p>
                    <p className="text-gray-400 text-xs">{selectedDispute.client_email}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Provider</p>
                    <p className="font-medium">{selectedDispute.provider_name || 'Unknown Provider'}</p>
                    <p className="text-gray-400 text-xs">{selectedDispute.provider_email}</p>
                  </div>
                </div>
              </div>

              {/* Dispute Reason */}
              {selectedDispute.dispute_reason && (
                <div className="bg-red-50 rounded-xl p-4">
                  <p className="text-sm font-medium text-red-800 mb-1">Client's Dispute Reason</p>
                  <p className="text-sm text-red-700">{selectedDispute.dispute_reason}</p>
                </div>
              )}

              {/* Provider Notes */}
              {selectedDispute.completion_notes && (
                <div className="bg-blue-50 rounded-xl p-4">
                  <p className="text-sm font-medium text-blue-800 mb-1">Provider's Completion Notes</p>
                  <p className="text-sm text-blue-700">{selectedDispute.completion_notes}</p>
                </div>
              )}

              {/* All Evidence */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-3">
                  Evidence Photos ({selectedDispute.evidence?.length || 0})
                </p>
                {selectedDispute.evidence && selectedDispute.evidence.length > 0 ? (
                  <div className="grid grid-cols-3 gap-3">
                    {selectedDispute.evidence.map((e) => (
                      <button
                        key={e.id}
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
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-lg transition-colors" />
                        <span className="absolute bottom-2 left-2 text-xs bg-black/60 text-white px-2 py-0.5 rounded capitalize">
                          {e.evidence_type}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 bg-gray-50 rounded-xl">
                    <Image className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">No evidence photos</p>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-200 flex gap-3">
              <button
                onClick={() => setSelectedDispute(null)}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setResolvedInFavorOf('provider');
                  setShowResolveModal(true);
                }}
                className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-700"
              >
                Resolve for Provider
              </button>
              <button
                onClick={() => {
                  setResolvedInFavorOf('client');
                  setShowResolveModal(true);
                }}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700"
              >
                Resolve for Client
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resolve Modal */}
      {showResolveModal && selectedDispute && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Resolve Dispute
              </h3>
              <button
                onClick={() => {
                  setShowResolveModal(false);
                  setResolution('');
                  setRefundPercentage(100);
                }}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Clear outcome explanation */}
            <div className={`mb-4 p-3 rounded-xl ${resolvedInFavorOf === 'provider' ? 'bg-green-50' : 'bg-blue-50'}`}>
              <p className={`text-sm font-medium ${resolvedInFavorOf === 'provider' ? 'text-green-800' : 'text-blue-800'}`}>
                Resolving in favor of: <span className="capitalize">{resolvedInFavorOf}</span>
              </p>
              <ul className={`text-xs mt-2 space-y-1 ${resolvedInFavorOf === 'provider' ? 'text-green-700' : 'text-blue-700'}`}>
                {resolvedInFavorOf === 'provider' ? (
                  <>
                    <li>• Booking will be marked as completed</li>
                    <li>• Full payment will be released to provider</li>
                    <li>• Client will not receive any refund</li>
                  </>
                ) : (
                  <>
                    <li>• Booking will be cancelled</li>
                    <li>• Client will receive {refundPercentage}% refund</li>
                    <li>• Provider will receive {100 - refundPercentage}% of payment</li>
                  </>
                )}
              </ul>
            </div>

            {/* Partial Refund Slider (only for client resolution) */}
            {resolvedInFavorOf === 'client' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Refund Amount: {refundPercentage}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={refundPercentage}
                  onChange={(e) => setRefundPercentage(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>0% (No refund)</span>
                  <span>50% (Split)</span>
                  <span>100% (Full refund)</span>
                </div>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Resolution Details <span className="text-red-500">*</span>
              </label>
              <textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Explain your decision..."
                rows={4}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
              />
              <p className="text-xs text-gray-500 mt-1">Minimum 10 characters required</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowResolveModal(false);
                  setResolution('');
                  setRefundPercentage(100);
                }}
                disabled={resolving}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleResolve}
                disabled={resolving || resolution.trim().length < 10}
                className={`flex-1 px-4 py-2.5 text-white rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 ${
                  resolvedInFavorOf === 'provider'
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {resolving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Resolving...
                  </>
                ) : (
                  'Confirm Resolution'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resolution Success Modal */}
      {resolutionResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Dispute Resolved</h3>
            <p className="text-gray-600 mb-4">{resolutionResult.message}</p>
            {resolutionResult.details && (
              <div className="bg-gray-50 rounded-xl p-3 text-sm text-left mb-4">
                {resolutionResult.details.released_to_provider > 0 && (
                  <p className="text-green-700">
                    Released to provider: <span className="font-medium">₱{resolutionResult.details.released_to_provider.toFixed(2)}</span>
                  </p>
                )}
                {resolutionResult.details.refunded_to_client > 0 && (
                  <p className="text-blue-700">
                    Refunded to client: <span className="font-medium">₱{resolutionResult.details.refunded_to_client.toFixed(2)}</span>
                  </p>
                )}
              </div>
            )}
            <button
              onClick={() => setResolutionResult(null)}
              className="w-full px-4 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700"
            >
              Done
            </button>
          </div>
        </div>
      )}

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
    </div>
  );
}

export default BookingDisputesPanel;
