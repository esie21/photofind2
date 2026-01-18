import { useState, useEffect, useCallback, useRef } from 'react';
import { Clock, Loader2, AlertCircle, CheckCircle, Timer, X } from 'lucide-react';
import availabilityService from '../api/services/availabilityService';

interface TimeSlot {
  id: string;
  start: string;
  end: string;
  status: string;
}

interface TimeSlotPickerProps {
  providerId: string;
  date: string;
  onSlotSelect: (slot: TimeSlot | null) => void;
  onSlotHold?: (slotId: string, expiresAt: string) => void;
  selectedSlotId?: string;
  autoHold?: boolean;
  className?: string;
}

export function TimeSlotPicker({
  providerId,
  date,
  onSlotSelect,
  onSlotHold,
  selectedSlotId,
  autoHold = true,
  className = '',
}: TimeSlotPickerProps) {
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [holdingSlot, setHoldingSlot] = useState<string | null>(null);
  const [holdExpiresAt, setHoldExpiresAt] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchSlots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await availabilityService.getAvailableSlots(providerId, date);
      setSlots(data.slots || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load time slots');
    } finally {
      setLoading(false);
    }
  }, [providerId, date]);

  useEffect(() => {
    fetchSlots();
    // Cleanup: release any held slots when unmounting
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (holdingSlot) {
        availabilityService.releaseSlot(holdingSlot).catch(console.error);
      }
    };
  }, [fetchSlots]);

  // Timer for hold expiration countdown
  useEffect(() => {
    if (!holdExpiresAt) {
      setTimeRemaining(null);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const expires = new Date(holdExpiresAt).getTime();
      const remaining = Math.max(0, Math.floor((expires - now) / 1000));
      setTimeRemaining(remaining);

      if (remaining <= 0) {
        // Hold expired - refresh slots
        setHoldingSlot(null);
        setHoldExpiresAt(null);
        onSlotSelect(null);
        fetchSlots();
      }
    };

    updateTimer();
    timerRef.current = setInterval(updateTimer, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [holdExpiresAt, fetchSlots, onSlotSelect]);

  const handleSlotClick = async (slot: TimeSlot) => {
    if (holdingSlot === slot.id) {
      // Already holding this slot - just select it
      return;
    }

    if (autoHold) {
      // Release any existing hold first
      if (holdingSlot) {
        try {
          await availabilityService.releaseSlot(holdingSlot);
        } catch (e) {
          console.error('Failed to release previous hold:', e);
        }
      }

      setHoldingSlot(slot.id);
      try {
        const holdResponse = await availabilityService.holdSlot(slot.id);
        setHoldExpiresAt(holdResponse.hold_expires_at);
        onSlotSelect(slot);
        onSlotHold?.(slot.id, holdResponse.hold_expires_at);
      } catch (err: any) {
        setError(err.message || 'Failed to hold slot');
        setHoldingSlot(null);
        // Refresh slots - this one might have been taken
        fetchSlots();
      }
    } else {
      onSlotSelect(slot);
    }
  };

  const handleReleaseHold = async () => {
    if (!holdingSlot) return;

    try {
      await availabilityService.releaseSlot(holdingSlot);
      setHoldingSlot(null);
      setHoldExpiresAt(null);
      onSlotSelect(null);
      fetchSlots();
    } catch (err: any) {
      setError(err.message || 'Failed to release slot');
    }
  };

  const formatSlotTime = (datetime: string) => {
    const date = new Date(datetime);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatTimeRemaining = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const dateObj = new Date(date);
  const formattedDate = dateObj.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-gray-200 ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-purple-600" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Select Time</h3>
            <p className="text-sm text-gray-500">{formattedDate}</p>
          </div>
        </div>
      </div>

      {/* Hold Timer */}
      {holdingSlot && timeRemaining !== null && (
        <div className={`px-4 py-3 flex items-center justify-between ${
          timeRemaining <= 60 ? 'bg-red-50 border-b-2 border-red-200' : timeRemaining <= 120 ? 'bg-amber-50 border-b-2 border-amber-200' : 'bg-yellow-50'
        }`}>
          <div className="flex items-center gap-2">
            <Timer className={`w-4 h-4 ${timeRemaining <= 60 ? 'text-red-600 animate-pulse' : timeRemaining <= 120 ? 'text-amber-600' : 'text-yellow-600'}`} />
            <div>
              <span className={`text-sm font-medium ${timeRemaining <= 60 ? 'text-red-700' : timeRemaining <= 120 ? 'text-amber-700' : 'text-yellow-700'}`}>
                {timeRemaining <= 60 ? 'Hurry! ' : ''}Slot held for {formatTimeRemaining(timeRemaining)}
              </span>
              {timeRemaining <= 120 && (
                <p className={`text-xs ${timeRemaining <= 60 ? 'text-red-600' : 'text-amber-600'}`}>
                  {timeRemaining <= 60 ? 'Complete booking now to avoid losing this slot!' : 'Finish your booking soon'}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={handleReleaseHold}
            className="text-sm text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
          >
            Release
          </button>
        </div>
      )}

      {/* Slots */}
      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-2" />
            <p className="text-red-600">{error}</p>
            <button
              onClick={fetchSlots}
              className="mt-2 text-sm text-purple-600 hover:underline"
            >
              Retry
            </button>
          </div>
        ) : slots.length === 0 ? (
          <div className="text-center py-12">
            <Clock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No available slots for this date</p>
            <p className="text-sm text-gray-400 mt-1">Please select another date</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {slots.map((slot) => {
              const isSelected = selectedSlotId === slot.id || holdingSlot === slot.id;
              const isHeld = holdingSlot === slot.id;

              // Calculate duration in minutes
              const startMs = new Date(slot.start).getTime();
              const endMs = new Date(slot.end).getTime();
              const durationMins = Math.round((endMs - startMs) / (1000 * 60));
              const durationLabel = durationMins >= 60
                ? `${Math.floor(durationMins / 60)}h${durationMins % 60 > 0 ? ` ${durationMins % 60}m` : ''}`
                : `${durationMins}m`;

              return (
                <button
                  key={slot.id}
                  onClick={() => handleSlotClick(slot)}
                  disabled={holdingSlot !== null && holdingSlot !== slot.id}
                  title={`${formatSlotTime(slot.start)} - ${formatSlotTime(slot.end)} (${durationLabel})`}
                  className={`
                    relative px-3 py-3 rounded-xl text-sm font-medium transition-all
                    ${isSelected
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'bg-gray-50 text-gray-700 hover:bg-purple-50 hover:text-purple-700'
                    }
                    ${holdingSlot !== null && holdingSlot !== slot.id ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  <div className="flex flex-col items-center">
                    <span>{formatSlotTime(slot.start)}</span>
                    <span className={`text-[10px] ${isSelected ? 'text-purple-200' : 'text-gray-400'}`}>
                      {durationLabel}
                    </span>
                  </div>
                  {isHeld && (
                    <CheckCircle className="w-4 h-4 absolute top-1 right-1 text-white" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Info */}
      {autoHold && !holdingSlot && slots.length > 0 && (
        <div className="px-4 pb-4">
          <p className="text-xs text-gray-400 text-center">
            Selecting a slot will hold it for 10 minutes while you complete your booking
          </p>
        </div>
      )}
    </div>
  );
}

export default TimeSlotPicker;
