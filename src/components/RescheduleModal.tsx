import { useState, useEffect, useCallback } from 'react';
import { useModal } from '../hooks/useModal';
import { X, Clock, AlertCircle, Loader2 } from 'lucide-react';
import bookingService from '../api/services/bookingService';
import availabilityService from '../api/services/availabilityService';
import { AvailabilityCalendar } from './AvailabilityCalendar';

interface RescheduleModalProps {
  providerId: string;
  booking: {
    id: string;
    service?: string;
    provider?: string;
    client?: string;
    date?: string;
    time?: string;
    start_date?: string;
    end_date?: string;
    duration_minutes?: number;
  };
  onClose: () => void;
  onSuccess: () => void;
}

interface RawSlot {
  id: string;
  start: string;
  end: string;
  status: string;
}

// A candidate start time is only valid if there's an unbroken run of available
// slots, back-to-back from that start, covering the full booking duration.
function computeValidStartTimes(
  slots: RawSlot[],
  durationMinutes: number,
  ownWindow?: { startMs: number; endMs: number }
): RawSlot[] {
  const available = slots
    .filter((s) => {
      if (s.status === 'available') return true;
      // The slots this booking currently occupies show as 'booked' (by itself), but
      // moveBookingSlots on the backend already allows a booking to reclaim its own
      // slots - so they're fair game to reselect too. Without this, nudging the time
      // slightly within/around the current window looks like there's nowhere to go.
      if (!ownWindow) return false;
      const startMs = new Date(s.start).getTime();
      const endMs = new Date(s.end).getTime();
      return startMs >= ownWindow.startMs && endMs <= ownWindow.endMs;
    })
    .map((s) => ({ ...s, startMs: new Date(s.start).getTime(), endMs: new Date(s.end).getTime() }))
    .sort((a, b) => a.startMs - b.startMs);

  const durationMs = durationMinutes * 60 * 1000;
  const valid: RawSlot[] = [];

  for (let i = 0; i < available.length; i++) {
    let coverageEnd = available[i].endMs;
    let j = i;
    while (coverageEnd - available[i].startMs < durationMs && j + 1 < available.length && available[j + 1].startMs === coverageEnd) {
      j++;
      coverageEnd = available[j].endMs;
    }
    if (coverageEnd - available[i].startMs >= durationMs) {
      valid.push(available[i]);
    }
  }

  return valid;
}

export function RescheduleModal({ providerId, booking, onClose, onSuccess }: RescheduleModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const [selectedDate, setSelectedDate] = useState<string | undefined>(undefined);
  const [selectedSlot, setSelectedSlot] = useState<RawSlot | null>(null);
  const [validSlots, setValidSlots] = useState<RawSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const { overlayProps, cardProps } = useModal(onClose, {
    closeOnEscape: !isLoading,
    closeOnBackdrop: !isLoading,
    labelledBy: 'reschedule-title',
  });

  // Calculate duration from existing booking or default to 60 minutes
  const getDuration = () => {
    if (booking.duration_minutes) return booking.duration_minutes;
    if (booking.start_date && booking.end_date) {
      const start = new Date(booking.start_date);
      const end = new Date(booking.end_date);
      return Math.round((end.getTime() - start.getTime()) / (1000 * 60));
    }
    return 60; // Default 1 hour
  };

  const duration = getDuration();

  const fetchSlotsForDate = useCallback(async (dateStr: string) => {
    setLoadingSlots(true);
    setSlotsError(null);
    setSelectedSlot(null);
    try {
      const data = await availabilityService.getAvailableSlots(providerId, dateStr);
      const oneHourFromNow = Date.now() + 60 * 60 * 1000;
      const ownWindow = booking.start_date && booking.end_date
        ? { startMs: new Date(booking.start_date).getTime(), endMs: new Date(booking.end_date).getTime() }
        : undefined;
      const candidates = computeValidStartTimes(data.slots || [], duration, ownWindow).filter(
        (s) => new Date(s.start).getTime() >= oneHourFromNow
      );
      setValidSlots(candidates);
    } catch (err: any) {
      setSlotsError(err?.message || 'Failed to load available times');
      setValidSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [providerId, duration, booking.start_date, booking.end_date]);

  useEffect(() => {
    if (selectedDate) fetchSlotsForDate(selectedDate);
  }, [selectedDate, fetchSlotsForDate]);

  // Default the calendar to the booking's current month
  const existingDate = booking.start_date || booking.date;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedSlot) {
      setError('Please select an available time');
      return;
    }

    setIsLoading(true);
    try {
      const startDate = new Date(selectedSlot.start);
      const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

      await bookingService.rescheduleBooking(booking.id, {
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        reason: reason.trim() || undefined,
      });

      onSuccess();
    } catch (err: any) {
      console.error('Reschedule error:', err);
      setError(err?.message || 'Failed to reschedule booking');
    } finally {
      setIsLoading(false);
    }
  };

  const formatSlotTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });

  // Format current booking date for display
  const currentDateStr = existingDate
    ? new Date(existingDate).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Not set';

  return (
    <div className="modal-overlay" {...overlayProps}>
      <div className="modal-card modal-card--lg" {...cardProps}>
        {/* Header */}
        <div className="modal-header flex items-center justify-between p-4 border-b border-gray-200">
          <h2 id="reschedule-title" className="text-lg font-semibold text-gray-900">Reschedule Booking</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="modal-body p-4 space-y-4">
          {/* Current Booking Info */}
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-sm text-gray-500 mb-1">Current Booking</p>
            <p className="font-medium text-gray-900">{booking.service || 'Service'}</p>
            <p className="text-sm text-gray-600">{currentDateStr}</p>
            <p className="text-xs text-gray-500 mt-1">Duration: {duration} minutes</p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 rounded-xl">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* New Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              New Date
            </label>
            <AvailabilityCalendar
              providerId={providerId}
              onDateSelect={setSelectedDate}
              selectedDate={selectedDate}
              initialDate={existingDate ? new Date(existingDate) : undefined}
            />
          </div>

          {/* New Time */}
          {selectedDate && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                New Time
              </label>
              {loadingSlots ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
                </div>
              ) : slotsError ? (
                <div className="text-center py-4">
                  <p className="text-sm text-red-600">{slotsError}</p>
                  <button
                    type="button"
                    onClick={() => fetchSlotsForDate(selectedDate)}
                    className="mt-1 text-sm text-purple-600 hover:underline"
                  >
                    Retry
                  </button>
                </div>
              ) : validSlots.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">
                  No time on this date fits the full {duration}-minute session. Please pick another date.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {validSlots.map((slot) => (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() => setSelectedSlot(slot)}
                      className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                        selectedSlot?.id === slot.id
                          ? 'bg-purple-600 text-white shadow-md'
                          : 'bg-gray-50 text-gray-700 hover:bg-purple-50 hover:text-purple-700'
                      }`}
                    >
                      {formatSlotTime(slot.start)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Reason (optional) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason for rescheduling <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Schedule conflict, personal emergency..."
              rows={2}
              maxLength={500}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !selectedSlot}
              className="flex-1 px-4 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Rescheduling...
                </>
              ) : (
                'Reschedule'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default RescheduleModal;
