import { useState } from 'react';
import { Loader2, MessageSquare, Send, ImagePlus, CheckCircle } from 'lucide-react';
import bookingService from '../api/services/bookingService';
import { useToast } from '../context/ToastContext';
import { DisputeEvidencePicker, PickedEvidenceFile, revokePickedFiles } from './DisputeEvidencePicker';

interface DisputeResponsePanelProps {
  bookingId: string;
  /** Which side of the booking the current user is on. */
  role: 'client' | 'provider';
  /** The provider's response so far, if any. Shown to both sides. */
  existingResponse?: string | null;
  existingResponseAt?: string | null;
  /** Called after a successful submit so the caller can refetch the booking. */
  onSubmitted?: () => void;
}

const MIN_RESPONSE_LENGTH = 10;
const MAX_RESPONSE_LENGTH = 2000;

/**
 * Lets a participant add to an open dispute: the provider states their side and can
 * attach photos, the client can attach photos backing the reason they already gave.
 *
 * Both sides could previously only read a "under admin review" banner, so an admin
 * decided the case on the provider's completion photos plus one paragraph of client
 * text, with no way for either party to answer the other.
 */
export function DisputeResponsePanel({
  bookingId,
  role,
  existingResponse,
  existingResponseAt,
  onSubmitted,
}: DisputeResponsePanelProps) {
  const toast = useToast();
  const isProvider = role === 'provider';

  const [open, setOpen] = useState(false);
  const [response, setResponse] = useState(existingResponse || '');
  const [files, setFiles] = useState<PickedEvidenceFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatDate = (value?: string | null) => {
    if (!value) return '';
    return new Date(value).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const reset = () => {
    revokePickedFiles(files);
    setFiles([]);
    setError(null);
    setOpen(false);
  };

  const handleSubmit = async () => {
    setError(null);

    const trimmed = response.trim();
    if (isProvider && trimmed.length < MIN_RESPONSE_LENGTH) {
      setError(`Please give a detailed response (at least ${MIN_RESPONSE_LENGTH} characters)`);
      return;
    }
    if (!isProvider && files.length === 0) {
      setError('Choose at least one photo to attach');
      return;
    }

    setSubmitting(true);
    try {
      // Text first: it is the part that must land. If the photo upload then fails, the
      // provider's statement is still on record and the toast says only photos failed,
      // rather than leaving them unsure whether to retype the whole thing.
      if (isProvider) {
        await bookingService.submitDisputeResponse(bookingId, trimmed);
      }

      if (files.length > 0) {
        try {
          await bookingService.uploadDisputeEvidence(bookingId, files.map((f) => f.file));
        } catch (uploadErr: any) {
          if (isProvider) {
            toast.warning(
              'Response saved, photos failed',
              uploadErr?.message || 'Your response was recorded. Try attaching the photos again.'
            );
            revokePickedFiles(files);
            setFiles([]);
            setOpen(false);
            onSubmitted?.();
            return;
          }
          throw uploadErr;
        }
      }

      const photoNote = files.length > 0 ? ` ${files.length} photo${files.length === 1 ? '' : 's'} attached.` : '';
      toast.success(
        isProvider ? 'Response submitted' : 'Photos attached',
        isProvider
          ? `The admin reviewing this dispute has been notified.${photoNote}`
          : 'The admin reviewing this dispute has been notified.'
      );

      reset();
      onSubmitted?.();
    } catch (err: any) {
      setError(err?.message || 'Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-red-200 space-y-3">
      {/* The provider's response, once given, is visible to both sides - the client
          should not have to wait for the resolution to learn what was said about them. */}
      {existingResponse && (
        <div className="p-3 bg-white border border-red-200 rounded-lg">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 mb-1">
            <MessageSquare className="w-3.5 h-3.5" />
            {isProvider ? 'Your response' : "Provider's response"}
            {existingResponseAt && (
              <span className="font-normal text-gray-400">· {formatDate(existingResponseAt)}</span>
            )}
          </p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{existingResponse}</p>
        </div>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
        >
          {isProvider ? (
            <>
              <MessageSquare className="w-4 h-4" />
              {existingResponse ? 'Edit your response' : 'Respond to this dispute'}
            </>
          ) : (
            <>
              <ImagePlus className="w-4 h-4" />
              Add supporting photos
            </>
          )}
        </button>
      ) : (
        <div className="space-y-3">
          {isProvider && (
            <div className="space-y-1">
              <label htmlFor={`dispute-response-${bookingId}`} className="text-sm font-medium text-gray-700">
                Your side of the story
              </label>
              <textarea
                id={`dispute-response-${bookingId}`}
                value={response}
                onChange={(e) => setResponse(e.target.value.slice(0, MAX_RESPONSE_LENGTH))}
                rows={4}
                disabled={submitting}
                placeholder="Explain what happened, and address the client's specific reason above..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none disabled:opacity-50"
              />
              <p className="text-xs text-gray-400 text-right">
                {response.trim().length}/{MAX_RESPONSE_LENGTH}
              </p>
            </div>
          )}

          <DisputeEvidencePicker
            files={files}
            onChange={setFiles}
            disabled={submitting}
            onError={setError}
            label={isProvider ? 'Supporting photos (optional)' : 'Supporting photos'}
            helpText={
              isProvider
                ? 'Photos that back up your account, e.g. the delivered work or your messages with the client.'
                : "Photos showing the problem you described. The admin sees these alongside the provider's."
            }
          />

          {error && (
            <p className="text-sm text-red-700 bg-red-100 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={reset}
              disabled={submitting}
              className="px-3 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 px-3 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting...
                </>
              ) : isProvider ? (
                <>
                  <Send className="w-4 h-4" />
                  Submit response
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Attach photos
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
