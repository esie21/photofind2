import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Loader2, X, Calendar, Clock } from 'lucide-react';
import availabilityService, { CalendarData, CalendarDay } from '../api/services/availabilityService';

interface AvailabilityCalendarProps {
  providerId: string;
  onDateSelect: (date: string) => void;
  selectedDate?: string;
  className?: string;
}

export function AvailabilityCalendar({
  providerId,
  onDateSelect,
  selectedDate,
  className = '',
}: AvailabilityCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarData, setCalendarData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const month = currentDate.getMonth() + 1;
  const year = currentDate.getFullYear();

  const fetchCalendarData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await availabilityService.getCalendar(providerId, month, year);
      setCalendarData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load calendar');
    } finally {
      setLoading(false);
    }
  }, [providerId, month, year]);

  useEffect(() => {
    fetchCalendarData();
  }, [fetchCalendarData]);

  const goToPreviousMonth = () => {
    const newDate = new Date(currentDate);
    newDate.setMonth(newDate.getMonth() - 1);
    // Don't go before current month
    const now = new Date();
    if (newDate.getFullYear() > now.getFullYear() ||
        (newDate.getFullYear() === now.getFullYear() && newDate.getMonth() >= now.getMonth())) {
      setCurrentDate(newDate);
    }
  };

  const goToNextMonth = () => {
    const newDate = new Date(currentDate);
    newDate.setMonth(newDate.getMonth() + 1);
    // Don't go more than 2 months ahead
    const maxDate = new Date();
    maxDate.setMonth(maxDate.getMonth() + 2);
    if (newDate <= maxDate) {
      setCurrentDate(newDate);
    }
  };

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month - 1, 1).getDay();
  };

  const getDayData = (day: number): CalendarDay | undefined => {
    if (!calendarData) return undefined;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return calendarData.days.find(d => d.date.startsWith(dateStr));
  };

  const getOverride = (day: number) => {
    if (!calendarData) return undefined;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return calendarData.overrides.find(o => o.override_date === dateStr);
  };

  const isDateSelectable = (day: number): boolean => {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Can't select past dates
    if (date < today) return false;

    // Check if blocked by override
    const override = getOverride(day);
    if (override && !override.is_available) return false;

    // Check if has available slots
    const dayData = getDayData(day);
    if (dayData && dayData.available_count > 0) return true;

    // If no data, assume selectable (slots will be generated)
    return true;
  };

  const getDayStatus = (day: number): 'available' | 'partial' | 'booked' | 'blocked' | 'past' | 'empty' => {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (date < today) return 'past';

    const override = getOverride(day);
    if (override && !override.is_available) return 'blocked';

    const dayData = getDayData(day);
    if (!dayData) return 'empty';

    const total = dayData.total_count;
    const available = dayData.available_count;
    const booked = dayData.booked_count;

    if (total === 0) return 'empty';
    if (available === 0) return 'booked';
    if (booked > 0 || dayData.held_count > 0) return 'partial';
    return 'available';
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'available': return 'bg-green-100 text-green-800 hover:bg-green-200';
      case 'partial': return 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200';
      case 'booked': return 'bg-red-100 text-red-500';
      case 'blocked': return 'bg-gray-200 text-gray-400';
      case 'past': return 'bg-gray-50 text-gray-300';
      default: return 'bg-white text-gray-700 hover:bg-gray-50';
    }
  };

  const handleDateClick = (day: number) => {
    if (!isDateSelectable(day)) return;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    onDateSelect(dateStr);
  };

  const isSelected = (day: number): boolean => {
    if (!selectedDate) return false;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return selectedDate === dateStr;
  };

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const monthName = currentDate.toLocaleString('default', { month: 'long' });

  const canGoPrevious = () => {
    const now = new Date();
    return year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1);
  };

  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-gray-200 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <button
          onClick={goToPreviousMonth}
          disabled={!canGoPrevious()}
          className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-purple-600" />
          <h3 className="text-lg font-semibold text-gray-900">
            {monthName} {year}
          </h3>
        </div>
        <button
          onClick={goToNextMonth}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <ChevronRight className="w-5 h-5 text-gray-600" />
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <X className="w-12 h-12 text-red-400 mx-auto mb-2" />
            <p className="text-red-600">{error}</p>
            <button
              onClick={fetchCalendarData}
              className="mt-2 text-sm text-purple-600 hover:underline"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {/* Day Headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="text-center text-xs font-medium text-gray-500 py-2">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Days */}
            <div className="grid grid-cols-7 gap-1">
              {/* Empty cells for days before the 1st */}
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`empty-${i}`} className="aspect-square" />
              ))}

              {/* Day cells */}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const status = getDayStatus(day);
                const selectable = isDateSelectable(day);
                const selected = isSelected(day);
                const dayData = getDayData(day);

                const getTooltip = () => {
                  switch (status) {
                    case 'past': return 'This date has passed';
                    case 'blocked':
                      const override = getOverride(day);
                      return override?.reason ? `Unavailable: ${override.reason}` : 'Provider marked as unavailable';
                    case 'booked': return 'All time slots are booked';
                    case 'partial':
                      return dayData ? `${dayData.available_count} of ${dayData.total_count} slots available` : 'Some slots available';
                    case 'available':
                      return dayData ? `${dayData.available_count} slots available` : 'Available for booking';
                    default: return 'Check availability';
                  }
                };

                return (
                  <button
                    key={day}
                    onClick={() => handleDateClick(day)}
                    disabled={!selectable}
                    title={getTooltip()}
                    className={`
                      aspect-square rounded-lg flex flex-col items-center justify-center
                      text-sm font-medium transition-all relative group
                      ${selected ? 'ring-2 ring-purple-600 bg-purple-100 text-purple-700' : getStatusColor(status)}
                      ${selectable ? 'cursor-pointer' : 'cursor-not-allowed'}
                    `}
                  >
                    <span>{day}</span>
                    {dayData && dayData.available_count > 0 && status !== 'past' && (
                      <span className="text-[10px] opacity-70">
                        {dayData.available_count} slot{dayData.available_count !== 1 ? 's' : ''}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Legend */}
      <div className="px-4 pb-4 flex flex-wrap gap-3 text-xs">
        <div className="flex items-center gap-1.5" title="All time slots are open for booking">
          <div className="w-3 h-3 rounded bg-green-100 border border-green-300" />
          <span className="text-gray-600">Available</span>
        </div>
        <div className="flex items-center gap-1.5" title="Some slots are taken, but openings remain">
          <div className="w-3 h-3 rounded bg-yellow-100 border border-yellow-300" />
          <span className="text-gray-600">Partial</span>
        </div>
        <div className="flex items-center gap-1.5" title="All time slots are already booked">
          <div className="w-3 h-3 rounded bg-red-100 border border-red-300" />
          <span className="text-gray-600">Fully Booked</span>
        </div>
        <div className="flex items-center gap-1.5" title="Provider has marked this day as unavailable">
          <div className="w-3 h-3 rounded bg-gray-200 border border-gray-300" />
          <span className="text-gray-600">Unavailable</span>
        </div>
      </div>
    </div>
  );
}

export default AvailabilityCalendar;
