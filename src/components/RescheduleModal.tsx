import { useState } from 'react';
import { X, Calendar, Clock, AlertCircle, Loader2 } from 'lucide-react';
import bookingService from '../api/services/bookingService';

interface RescheduleModalProps {
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

export function RescheduleModal({ booking, onClose, onSuccess }: RescheduleModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  // Parse existing booking date/time
  const existingDate = booking.start_date || booking.date;
  const existingStart = existingDate ? new Date(existingDate) : new Date();

  // Default to tomorrow if no date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  const defaultDate = existingStart > new Date() ? existingStart : tomorrow;

  const [selectedDate, setSelectedDate] = useState(
    defaultDate.toISOString().split('T')[0]
  );
  const [selectedTime, setSelectedTime] = useState(
    defaultDate.toTimeString().slice(0, 5)
  );

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      // Construct start and end dates
      const startDate = new Date(`${selectedDate}T${selectedTime}:00`);
      const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

      // Validate date is in the future
      if (startDate <= new Date()) {
        setError('Please select a future date and time');
        setIsLoading(false);
        return;
      }

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

  // Generate time slots
  const timeSlots = [];
  for (let hour = 6; hour <= 22; hour++) {
    for (let min = 0; min < 60; min += 30) {
      const h = hour.toString().padStart(2, '0');
      const m = min.toString().padStart(2, '0');
      timeSlots.push(`${h}:${m}`);
    }
  }

  // Get min date (today)
  const today = new Date().toISOString().split('T')[0];

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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Reschedule Booking</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Current Booking Info */}
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-sm text-gray-500 mb-1">Current Booking</p>
            <p className="font-medium text-gray-900">{booking.service || 'Service'}</p>
            <p className="text-sm text-gray-600">{currentDateStr}</p>
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
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                min={today}
                required
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* New Time */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              New Time
            </label>
            <div className="relative">
              <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <select
                value={selectedTime}
                onChange={(e) => setSelectedTime(e.target.value)}
                required
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent appearance-none bg-white"
              >
                {timeSlots.map((time) => (
                  <option key={time} value={time}>
                    {new Date(`2000-01-01T${time}`).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Duration: {duration} minutes
            </p>
          </div>

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
              disabled={isLoading}
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
