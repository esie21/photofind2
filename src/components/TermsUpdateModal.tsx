import { useState } from 'react';
import { AlertCircle, Loader, FileText } from 'lucide-react';
import { TermsContent, TermsSummaryList, type Audience } from './TermsContent';
import { useAuth } from '../context/AuthContext';
import { useModal } from '../hooks/useModal';
import { useToast } from '../context/ToastContext';
import authService from '../api/services/authService';

/**
 * Asks a signed-in user to accept the terms again after they have changed.
 *
 * Shown rather than assumed, because "continued use constitutes acceptance" is a weak
 * thing to rely on for a change that alters what someone owes - the commission on cash
 * bookings, the payment deadline, the dispute timeout. `users.terms_version` is what
 * makes this possible at all: before it, acceptance was a timestamp with no record of
 * what had been accepted, so there was nothing to compare against and no one to ask.
 *
 * Deliberately not a hard block. The people most likely to see this have live bookings,
 * and locking them out of a shoot they have already paid for to force a click would do
 * more harm than the delay it saves. Dismissing does not record anything, so the prompt
 * returns on the next load until it is actually accepted.
 */
export function TermsUpdateModal() {
  const { user, applyUser } = useAuth();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showFullTerms, setShowFullTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = !!user && user.terms_acceptance_required === true && !dismissed;

  useModal(() => setDismissed(true), { enabled: open && !showFullTerms });
  useModal(() => setShowFullTerms(false), { enabled: showFullTerms });

  if (!open) return null;

  const audience: Audience =
    user.role === 'client' || user.role === 'provider' ? user.role : 'all';

  const handleAccept = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // The response carries the whole updated row, so applyUser saves the round trip
      // refreshUser() would cost - and clears terms_acceptance_required, which is what
      // closes this modal.
      const updated = await authService.acceptTerms();
      applyUser(updated);
      toast.success('Thanks', 'Your agreement to the updated terms has been recorded.');
    } catch (e: any) {
      const message = e?.message || 'Could not record your acceptance. Please try again.';
      setError(message);
      toast.error('Something went wrong', message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="modal-overlay">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Updated terms and conditions"
          className="modal-card modal-card--lg"
        >
          <div className="modal-header bg-white border-b border-gray-200 p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0">
              <FileText className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h3 className="text-gray-900 font-medium">We&apos;ve updated our Terms</h3>
              <p className="text-xs text-gray-500">
                Please review the changes and confirm you agree.
              </p>
            </div>
          </div>

          <div className="modal-body p-6">
            <div className="terms-summary">
              <p className="terms-summary-title">What this means for you</p>
              <p className="terms-summary-lede">
                The points below are the ones that most affect you. They are a summary, not
                a substitute - you can read the full terms before agreeing.
              </p>
              <TermsSummaryList audience={audience} />
            </div>

            <button
              type="button"
              onClick={() => setShowFullTerms(true)}
              className="text-sm text-purple-600 hover:underline"
            >
              Read the full Terms &amp; Conditions
            </button>

            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-red-600 text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </p>
              </div>
            )}
          </div>

          <div className="modal-footer border-t border-gray-200 p-4 flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => setDismissed(true)}
              disabled={submitting}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              Remind me later
            </button>
            <button
              onClick={handleAccept}
              disabled={submitting}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium disabled:opacity-50 flex items-center gap-2"
            >
              {submitting && <Loader className="w-4 h-4 animate-spin" />}
              {submitting ? 'Saving...' : 'I agree to the updated Terms'}
            </button>
          </div>
        </div>
      </div>

      {showFullTerms && (
        <div
          className="modal-overlay modal-overlay--nested"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowFullTerms(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Terms and conditions"
            className="modal-card modal-card--lg"
          >
            <div className="modal-header bg-white border-b border-gray-200 p-4 flex items-center justify-between">
              <h3 className="text-gray-900 font-medium">Terms &amp; Conditions</h3>
              <button
                onClick={() => setShowFullTerms(false)}
                className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Close
              </button>
            </div>
            <div className="modal-body p-6">
              <TermsContent defaultAudience={audience} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default TermsUpdateModal;
