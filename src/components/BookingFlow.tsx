import { useEffect, useMemo, useState, useCallback } from 'react';
import { Check, Calendar as CalendarIcon, Clock, CreditCard, ChevronRight, MessageSquare, AlertCircle, Loader, Timer, Info } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import bookingService from '../api/services/bookingService';
import serviceService, { Service } from '../api/services/serviceService';
import availabilityService from '../api/services/availabilityService';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PaymentSummary } from './PaymentSummary';

interface TimeSlot {
  id: string;
  start: string;
  end: string;
  status: string;
  is_held?: boolean;
  hold_expires_at?: string;
}

interface BookingFlowProps {
  onComplete: () => void;
  providerId?: string;
  providerName?: string;
  providerImage?: string;
}

export function BookingFlow({ onComplete, providerId, providerName = 'Service Provider', providerImage = 'https://images.unsplash.com/photo-1623783356340-95375aac85ce?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3ZWRkaW5nJTIwcGhvdG9ncmFwaGVyfGVufDF8fHx8MTc2NDQwNzk1NHww&ixlib=rb-4.1.0&q=80&w=1080' }: BookingFlowProps) {
  const { user } = useAuth();
  const toast = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [bookingType, setBookingType] = useState<'hourly' | 'package' | null>(null);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | undefined>(undefined);
  const [selectedSlots, setSelectedSlots] = useState<TimeSlot[]>([]); // Multi-slot selection
  const [bookingMode, setBookingMode] = useState<'request' | 'instant'>('request');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submittedStatus, setSubmittedStatus] = useState<string | null>(null);
  const [providerServices, setProviderServices] = useState<Service[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);
  const [createdBookingId, setCreatedBookingId] = useState<string | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  // Hourly booking specific state
  const [selectedHours, setSelectedHours] = useState<number>(1);

  // Availability state
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [heldSlotIds, setHeldSlotIds] = useState<string[]>([]); // Multi-slot holding
  const [holdExpiresAt, setHoldExpiresAt] = useState<string | null>(null);
  const [holdTimeRemaining, setHoldTimeRemaining] = useState<number | null>(null);
  const [calendarData, setCalendarData] = useState<any>(null);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null); // Calendar error state
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [isHolding, setIsHolding] = useState(false); // Loading state for hold operation

  // Fetch provider services on mount
  useEffect(() => {
    const fetchServices = async () => {
      if (!providerId) {
        setIsLoadingServices(false);
        setProviderServices([]);
        return;
      }
      setIsLoadingServices(true);
      try {
        const services = await serviceService.getServicesByProvider(providerId);
        setProviderServices(services);
      } catch (err) {
        console.error('Failed to fetch provider services:', err);
        setProviderServices([]);
      } finally {
        setIsLoadingServices(false);
      }
    };
    fetchServices();
  }, [providerId]);

  // Fetch calendar data for month
  const fetchCalendarData = useCallback(async () => {
    if (!providerId) return;
    setLoadingCalendar(true);
    setCalendarError(null);
    try {
      const month = currentMonth.getMonth() + 1;
      const year = currentMonth.getFullYear();
      const data = await availabilityService.getCalendar(providerId, month, year);
      setCalendarData(data);
    } catch (err: any) {
      console.error('Failed to fetch calendar:', err);
      setCalendarError(err?.message || 'Failed to load availability. Please try again.');
      setCalendarData(null);
    } finally {
      setLoadingCalendar(false);
    }
  }, [providerId, currentMonth]);

  useEffect(() => {
    // Fetch calendar when we're on the datetime step
    const stepType = getStepType(currentStep);
    if (stepType === 'datetime') {
      fetchCalendarData();
    }
  }, [currentStep, fetchCalendarData]);

  // Fetch available slots for selected date
  const fetchSlotsForDate = useCallback(async (dateStr: string) => {
    if (!providerId) return;
    setLoadingSlots(true);
    setAvailableSlots([]);
    try {
      const data = await availabilityService.getAvailableSlots(providerId, dateStr);
      setAvailableSlots(data.slots || []);
    } catch (err) {
      console.error('Failed to fetch slots:', err);
      setAvailableSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [providerId]);

  // When date changes, fetch slots and release holds
  useEffect(() => {
    if (selectedDay) {
      const dateStr = formatDateString(selectedDay);
      fetchSlotsForDate(dateStr);
    }
  }, [selectedDay, fetchSlotsForDate]);

  // Release holds when date changes (separate effect to avoid stale closure)
  useEffect(() => {
    // When selectedDay changes, release any existing holds
    return () => {
      // This runs when selectedDay is about to change
    };
  }, [selectedDay]);

  // Handle releasing holds when user selects a new date
  const handleDaySelect = useCallback((dateObj: Date) => {
    // Release any previous holds before selecting new date
    if (heldSlotIds.length > 0) {
      availabilityService.releaseSlots(heldSlotIds).catch(console.error);
      setHeldSlotIds([]);
      setHoldExpiresAt(null);
    }
    setSelectedSlots([]);
    setSelectedDay(dateObj);
    setStepError(null);
  }, [heldSlotIds]);

  // Hold timer countdown
  useEffect(() => {
    if (!holdExpiresAt) {
      setHoldTimeRemaining(null);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const expires = new Date(holdExpiresAt).getTime();
      const remaining = Math.max(0, Math.floor((expires - now) / 1000));
      setHoldTimeRemaining(remaining);

      if (remaining <= 0) {
        // Hold expired
        setHeldSlotIds([]);
        setHoldExpiresAt(null);
        setSelectedSlots([]);
        if (selectedDay) {
          fetchSlotsForDate(formatDateString(selectedDay));
        }
        toast.warning('Hold expired', 'Your slot hold has expired. Please select new times.');
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [holdExpiresAt, selectedDay, fetchSlotsForDate, toast]);

  // Cleanup holds on unmount
  useEffect(() => {
    return () => {
      if (heldSlotIds.length > 0) {
        availabilityService.releaseSlots(heldSlotIds).catch(console.error);
      }
    };
  }, [heldSlotIds]);

  // Check if slots are consecutive
  const areSlotsConsecutive = (slots: TimeSlot[]): boolean => {
    if (slots.length <= 1) return true;
    const sorted = [...slots].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = new Date(sorted[i - 1].end).getTime();
      const currStart = new Date(sorted[i].start).getTime();
      if (currStart !== prevEnd) return false;
    }
    return true;
  };

  // Get sorted selected slots
  const getSortedSelectedSlots = (slots: TimeSlot[]): TimeSlot[] => {
    return [...slots].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  };

  // Handle slot toggle (multi-select)
  const handleSlotToggle = (slot: TimeSlot) => {
    const isSelected = selectedSlots.some(s => s.id === slot.id);

    if (isSelected) {
      // Deselect slot
      const newSelection = selectedSlots.filter(s => s.id !== slot.id);
      setSelectedSlots(newSelection);
      // Check if we need to re-validate consecutiveness
      if (newSelection.length > 0 && !areSlotsConsecutive(newSelection)) {
        // Find the longest consecutive chain and keep it
        setSelectedSlots([]);
        toast.warning('Selection cleared', 'Please select consecutive time slots');
      }
    } else {
      // Select slot - check if it would make a consecutive chain
      const newSelection = [...selectedSlots, slot];
      if (areSlotsConsecutive(newSelection)) {
        setSelectedSlots(newSelection);
        setStepError(null);
      } else {
        toast.error('Non-consecutive', 'Please select consecutive time slots only');
      }
    }
  };

  // Hold selected slots
  const handleHoldSlots = async () => {
    if (selectedSlots.length === 0) return;
    if (!areSlotsConsecutive(selectedSlots)) {
      toast.error('Invalid selection', 'Please select consecutive time slots');
      return;
    }

    setIsHolding(true);

    // Release any existing holds first
    if (heldSlotIds.length > 0) {
      try {
        await availabilityService.releaseSlots(heldSlotIds);
      } catch (e) {
        console.error('Failed to release previous holds:', e);
      }
    }

    try {
      const slotIds = selectedSlots.map(s => s.id);
      const holdResponse = await availabilityService.holdSlots(slotIds);
      setHeldSlotIds(slotIds);
      setHoldExpiresAt(holdResponse.hold_expires_at);
      setStepError(null);
      toast.success('Slots reserved', `${slotIds.length} time slot${slotIds.length > 1 ? 's' : ''} held for 10 minutes`);
    } catch (err: any) {
      toast.error('Hold failed', err.message || 'One or more slots are no longer available');
      setSelectedSlots([]);
      if (selectedDay) {
        fetchSlotsForDate(formatDateString(selectedDay));
      }
    } finally {
      setIsHolding(false);
    }
  };

  // Release all held slots
  const handleReleaseHold = async () => {
    if (heldSlotIds.length === 0) return;
    try {
      await availabilityService.releaseSlots(heldSlotIds);
      setHeldSlotIds([]);
      setHoldExpiresAt(null);
      setSelectedSlots([]);
      if (selectedDay) {
        fetchSlotsForDate(formatDateString(selectedDay));
      }
    } catch (e) {
      console.error('Failed to release holds:', e);
    }
  };

  // Clear selection without releasing holds
  const handleClearSelection = () => {
    setSelectedSlots([]);
  };

  // Helper to format date
  const formatDateString = (date: Date): string => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  // Get day availability data
  const getDayData = (day: number) => {
    if (!calendarData) return null;
    const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return calendarData.days?.find((d: any) => d.date?.startsWith(dateStr));
  };

  // Check if day is blocked by override
  const getDayOverride = (day: number) => {
    if (!calendarData) return null;
    const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return calendarData.overrides?.find((o: any) => o.override_date === dateStr);
  };

  // Get status for a day
  const getDayStatus = (day: number): 'available' | 'partial' | 'booked' | 'blocked' | 'past' | 'empty' => {
    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (date < today) return 'past';

    const override = getDayOverride(day);
    if (override && !override.is_available) return 'blocked';

    const dayData = getDayData(day);
    if (!dayData) return 'empty';

    const available = dayData.available_count || 0;
    const booked = dayData.booked_count || 0;
    const total = dayData.total_count || 0;

    if (total === 0) return 'empty';
    if (available === 0) return 'booked';
    if (booked > 0 || (dayData.held_count || 0) > 0) return 'partial';
    return 'available';
  };

  // Check if day is selectable (only days with actual available slots)
  const isDaySelectable = (day: number): boolean => {
    const status = getDayStatus(day);
    // Don't allow selecting 'empty' days - they have no availability data
    return status === 'available' || status === 'partial';
  };

  // Transform services for display - use real services or fallback to defaults
  const services = useMemo(() => {
    if (providerServices.length > 0) {
      return providerServices.map(s => {
        // Support both new and legacy pricing fields
        const hasHourly = !!(s.hourly_rate || s.pricing_type === 'hourly' || s.pricing_type === 'both');
        const hasPackage = !!(s.package_price || s.pricing_type === 'package' || s.pricing_type === 'both');
        const hourlyRate = s.hourly_rate || (s.pricing_type === 'hourly' ? Number(s.price) : null);
        const packagePrice = s.package_price || (s.pricing_type === 'package' ? Number(s.price) : null);

        return {
          id: s.id,
          name: s.title,
          duration: s.duration_minutes ? `${Math.floor(s.duration_minutes / 60)} hours` : 'Flexible',
          duration_minutes: s.duration_minutes || null,
          photos: s.category || 'Photography',
          price: Number(s.price) || 0,
          pricing_type: s.pricing_type || 'package',
          hourly_rate: hourlyRate,
          package_price: packagePrice,
          has_hourly: hasHourly,
          has_package: hasPackage,
          description: s.description,
          features: s.description ? s.description.split('\n').filter(Boolean) : [s.category || 'Professional service'],
        };
      });
    }
    // Fallback default services if provider has none
    return [
      { id: 'basic', name: 'Basic Package', duration: '4 hours', duration_minutes: 240, photos: '200+ photos', price: 1200, pricing_type: 'both' as const, hourly_rate: 300, package_price: 1200, has_hourly: true, has_package: true, description: '', features: ['4 hours coverage', '200+ edited photos', 'Online gallery', 'Print release'] },
      { id: 'standard', name: 'Standard Package', duration: '8 hours', duration_minutes: 480, photos: '400+ photos', price: 2400, pricing_type: 'both' as const, hourly_rate: 400, package_price: 2400, has_hourly: true, has_package: true, description: '', features: ['8 hours coverage', '400+ edited photos', 'Online gallery', 'Print release', 'Engagement session', 'USB drive'] },
      { id: 'premium', name: 'Premium Package', duration: 'Full day', duration_minutes: 720, photos: '600+ photos', price: 3600, pricing_type: 'both' as const, hourly_rate: 500, package_price: 3600, has_hourly: true, has_package: true, description: '', features: ['Full day coverage', '600+ edited photos', 'Online gallery', 'Print release', 'Engagement session', 'USB drive', 'Second photographer', 'Premium album'] },
    ];
  }, [providerServices]);

  const selectedServiceData = services.find(s => s.id === selectedService);

  // Check if selected service has both pricing options
  const selectedServiceHasBothPricing = selectedServiceData?.has_hourly && selectedServiceData?.has_package;

  // Dynamic steps based on whether we need pricing selection step
  const steps = selectedServiceHasBothPricing
    ? [
        { number: 1, name: 'Select Service', icon: Check },
        { number: 2, name: 'Pricing Type', icon: Check },
        { number: 3, name: 'Date & Time', icon: CalendarIcon },
        { number: 4, name: 'Confirm & Pay', icon: CreditCard },
      ]
    : [
        { number: 1, name: 'Select Service', icon: Check },
        { number: 2, name: 'Date & Time', icon: CalendarIcon },
        { number: 3, name: 'Confirm & Pay', icon: CreditCard },
      ];

  // Get max steps
  const maxSteps = selectedServiceHasBothPricing ? 4 : 3;

  // Determine which step handles what
  const getStepType = (step: number): 'service' | 'pricingtype' | 'datetime' | 'confirm' => {
    if (step === 1) return 'service';
    if (selectedServiceHasBothPricing) {
      if (step === 2) return 'pricingtype';
      if (step === 3) return 'datetime';
      if (step === 4) return 'confirm';
    } else {
      if (step === 2) return 'datetime';
      if (step === 3) return 'confirm';
    }
    return 'service';
  };

  const currentStepType = getStepType(currentStep);

  // Check if any service has hourly or package pricing
  const hasAnyHourly = useMemo(() => services.some(s => s.has_hourly), [services]);
  const hasAnyPackage = useMemo(() => services.some(s => s.has_package), [services]);

  // Get hourly rate based on selected service or booking type
  const hourlyRate = useMemo(() => {
    if (selectedServiceData?.hourly_rate) {
      return selectedServiceData.hourly_rate;
    }
    // Fallback to first service with hourly rate
    const serviceWithHourly = services.find(s => s.hourly_rate);
    return serviceWithHourly?.hourly_rate || 500;
  }, [selectedServiceData, services]);

  // Get package price based on selected service
  const packagePrice = useMemo(() => {
    if (selectedServiceData?.package_price) {
      return selectedServiceData.package_price;
    }
    return selectedServiceData?.price || 0;
  }, [selectedServiceData]);

  // Calculate duration and pricing based on selected slots
  const sortedSlots = useMemo(() => getSortedSelectedSlots(selectedSlots), [selectedSlots]);

  const totalDurationMinutes = useMemo(() => {
    if (sortedSlots.length === 0) return 0;
    const firstStart = new Date(sortedSlots[0].start).getTime();
    const lastEnd = new Date(sortedSlots[sortedSlots.length - 1].end).getTime();
    return Math.round((lastEnd - firstStart) / (1000 * 60));
  }, [sortedSlots]);

  const totalDurationHours = totalDurationMinutes / 60;

  // Pricing based on booking type selection
  const isHourlyPricing = bookingType === 'hourly';
  const basePrice = selectedServiceData
    ? (bookingType === 'hourly'
        ? (selectedServiceData.hourly_rate || 0)
        : (selectedServiceData.package_price || selectedServiceData.price || 0))
    : 0;
  const packageDurationMinutes = selectedServiceData?.duration_minutes || 0;
  const packageDurationHours = packageDurationMinutes > 0 ? packageDurationMinutes / 60 : 0;
  // Ensure requiredSlotsForPackage is at least 1 to avoid division issues
  const requiredSlotsForPackage = packageDurationMinutes > 0 ? Math.ceil(packageDurationMinutes / 30) : 1;

  // Calculate price based on booking type
  // Hourly: hourly rate × hours selected
  // Package: fixed price regardless of duration
  const hasSelectedSlots = totalDurationMinutes > 0;
  const servicePrice = hasSelectedSlots
    ? (bookingType === 'hourly' && totalDurationHours > 0 ? hourlyRate * totalDurationHours : basePrice)
    : 0;
  const platformFee = Number.isFinite(servicePrice) ? servicePrice * 0.15 : 0;
  const total = Number.isFinite(servicePrice + platformFee) ? servicePrice + platformFee : 0;

  const selectedDateString = useMemo(() => {
    if (!selectedDay) return '';
    return formatDateString(selectedDay);
  }, [selectedDay]);

  // Format time for display from selected slots
  const selectedTimeLabel = useMemo(() => {
    if (sortedSlots.length === 0) return '';
    const date = new Date(sortedSlots[0].start);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }, [sortedSlots]);

  // Get end time label from last slot
  const selectedEndTimeLabel = useMemo(() => {
    if (sortedSlots.length === 0) return '';
    const date = new Date(sortedSlots[sortedSlots.length - 1].end);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }, [sortedSlots]);

  // Use first slot start time for booking
  const selectedDateTimeIso = useMemo(() => {
    if (sortedSlots.length === 0) return '';
    return sortedSlots[0].start;
  }, [sortedSlots]);

  // Get last slot end time for booking
  const selectedEndDateTimeIso = useMemo(() => {
    if (sortedSlots.length === 0) return '';
    return sortedSlots[sortedSlots.length - 1].end;
  }, [sortedSlots]);

  // Format duration for display
  const formatDuration = (minutes: number): string => {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    return `${hours}h ${mins}m`;
  };

  // Format hold timer
  const formatHoldTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const canProceed = () => {
    if (currentStepType === 'service') return selectedService !== null;
    if (currentStepType === 'pricingtype') return bookingType !== null;
    if (currentStepType === 'datetime') return selectedDateString && selectedSlots.length > 0;
    return true;
  };

  const validateStep = (): boolean => {
    setStepError(null);

    if (currentStepType === 'service') {
      if (!selectedService) {
        setStepError('Please select a service to continue');
        return false;
      }
    }

    if (currentStepType === 'pricingtype') {
      if (!bookingType) {
        setStepError('Please select a pricing type to continue');
        return false;
      }
    }

    if (currentStepType === 'datetime') {
      if (!selectedDateString) {
        setStepError('Please select a date for your booking');
        return false;
      }
      if (selectedSlots.length === 0) {
        setStepError('Please select at least one time slot');
        return false;
      }
    }

    return true;
  };

  const handleNext = async () => {
    if (!validateStep()) {
      return;
    }

    // When moving from service selection, auto-set booking type if service only has one option
    if (currentStepType === 'service' && selectedServiceData) {
      if (!selectedServiceData.has_hourly && selectedServiceData.has_package) {
        setBookingType('package');
      } else if (selectedServiceData.has_hourly && !selectedServiceData.has_package) {
        setBookingType('hourly');
      }
      // If both are available, user will select in next step
    }

    // Auto-hold slots if user is on datetime step and hasn't held them yet
    if (currentStepType === 'datetime' && selectedSlots.length > 0 && heldSlotIds.length === 0) {
      if (!areSlotsConsecutive(selectedSlots)) {
        toast.error('Invalid selection', 'Please select consecutive time slots');
        return;
      }

      setIsHolding(true);
      try {
        const slotIds = selectedSlots.map(s => s.id);
        const holdResponse = await availabilityService.holdSlots(slotIds);
        setHeldSlotIds(slotIds);
        setHoldExpiresAt(holdResponse.hold_expires_at);
        toast.success('Slots reserved', `${slotIds.length} time slot${slotIds.length > 1 ? 's' : ''} held for 10 minutes`);
      } catch (err: any) {
        toast.error('Hold failed', err.message || 'One or more slots are no longer available');
        setSelectedSlots([]);
        if (selectedDay) {
          fetchSlotsForDate(formatDateString(selectedDay));
        }
        setIsHolding(false);
        return;
      }
      setIsHolding(false);
    }

    if (currentStep < maxSteps) {
      setCurrentStep(currentStep + 1);
      setError(null);
      setStepError(null);
    } else {
      await submitBooking();
    }
  };

  const submitBooking = async () => {
    if (!user || !selectedServiceData) {
      setError('Missing required information. Please log in and select a service.');
      return;
    }

    if (!providerId) {
      setError('No provider selected.');
      return;
    }

    if (!selectedDateTimeIso || !selectedEndDateTimeIso) {
      setError('Please select a date and time.');
      return;
    }

    if (heldSlotIds.length === 0) {
      setError('Please reserve your time slots first.');
      return;
    }

    // Check if hold has expired
    if (holdExpiresAt) {
      const expiresAt = new Date(holdExpiresAt).getTime();
      const now = Date.now();
      if (now >= expiresAt) {
        setError('Your slot reservation has expired. Please select and reserve your time slots again.');
        setHeldSlotIds([]);
        setHoldExpiresAt(null);
        setSelectedSlots([]);
        // Refresh available slots
        if (selectedDay) {
          fetchSlotsForDate(formatDateString(selectedDay));
        }
        return;
      }
      // Warn if less than 2 minutes remaining
      const remaining = Math.floor((expiresAt - now) / 1000);
      if (remaining < 120) {
        toast.warning('Hurry!', `Your slot reservation expires in ${Math.floor(remaining / 60)}:${(remaining % 60).toString().padStart(2, '0')}`);
      }
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const bookingData = {
        provider_id: providerId,
        service_id: selectedService,
        start_date: selectedDateTimeIso,
        end_date: selectedEndDateTimeIso,
        slot_ids: heldSlotIds,
        duration_minutes: totalDurationMinutes,
        total_price: Number(total.toFixed(2)),
        booking_mode: bookingMode,
      };

      console.log('Submitting booking:', bookingData);
      const created = await bookingService.createBooking(bookingData);
      setSubmittedStatus((created as any)?.status || null);
      setCreatedBookingId((created as any)?.id || null);

      // Show payment modal
      setShowPayment(true);
    } catch (err: any) {
      console.error('Booking error:', err);
      const errorMsg = err?.message || 'Failed to create booking. Please try again.';
      setError(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePaymentSuccess = () => {
    setShowPayment(false);
    setSuccess(true);
    toast.success('Booking confirmed!', `Your booking with ${providerName} has been confirmed.`);
    setTimeout(() => {
      onComplete();
    }, 2000);
  };

  const handlePaymentFailed = (errorMsg: string) => {
    setError(`Payment failed: ${errorMsg}. Your booking has been saved. You can pay later from your dashboard.`);
    toast.error('Payment failed', errorMsg);
  };

  const handlePaymentCancel = () => {
    setShowPayment(false);
    // Booking is already created, inform user they can pay later
    setError('Payment cancelled. Your booking has been saved but requires payment to confirm. You can complete payment from your dashboard.');
    toast.warning('Payment cancelled', 'You can complete payment from your dashboard.');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      {/* Payment Modal */}
      {showPayment && createdBookingId && selectedServiceData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <PaymentSummary
            bookingId={createdBookingId}
            serviceName={selectedServiceData.name}
            providerName={providerName}
            totalAmount={total}
            onPaymentSuccess={handlePaymentSuccess}
            onPaymentFailed={handlePaymentFailed}
            onCancel={handlePaymentCancel}
          />
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4">
        {/* Error Alert */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-900">Booking Error</p>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Step Validation Error */}
        {stepError && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-900">Please complete this step</p>
              <p className="text-sm text-amber-700 mt-1">{stepError}</p>
            </div>
          </div>
        )}

        {/* Success Alert */}
        {success && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-2xl p-4 flex items-start gap-3">
            <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-green-900">Booking Submitted!</p>
              <p className="text-sm text-green-700 mt-1">{submittedStatus === 'accepted' ? 'Your booking is confirmed instantly.' : 'Your booking request has been sent to the provider.'} Redirecting...</p>
            </div>
          </div>
        )}

        {success && (
          <div className="mb-6 bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
            <h3 className="text-gray-900 mb-4">Booking Status</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${success ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                  <Check className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="text-sm text-gray-900">Submitted</div>
                  <div className="text-xs text-gray-500">Booking created</div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${submittedStatus === 'accepted' ? 'bg-green-500 text-white' : 'bg-yellow-500 text-white'}`}>
                  {submittedStatus === 'accepted' ? <Check className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                </div>
                <div className="flex-1">
                  <div className="text-sm text-gray-900">{submittedStatus === 'accepted' ? 'Accepted' : 'Pending'}</div>
                  <div className="text-xs text-gray-500">{submittedStatus === 'accepted' ? 'Provider accepted instantly' : 'Waiting for provider approval'}</div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-200 text-gray-500">
                  <Check className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="text-sm text-gray-900">Completed</div>
                  <div className="text-xs text-gray-500">After the session is finished</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Progress Steps */}
        <div className="bg-white rounded-2xl p-6 shadow-sm mb-6">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <div key={step.number} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-2 transition-all ${
                    currentStep > step.number 
                      ? 'bg-green-500 text-white' 
                      : currentStep === step.number 
                        ? 'bg-purple-600 text-white' 
                        : 'bg-gray-200 text-gray-400'
                  }`}>
                    {currentStep > step.number ? (
                      <Check className="w-6 h-6" />
                    ) : (
                      <span>{step.number}</span>
                    )}
                  </div>
                  <span className={`text-sm ${
                    currentStep >= step.number ? 'text-gray-900' : 'text-gray-400'
                  }`}>
                    {step.name}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <div className={`h-0.5 flex-1 mx-4 ${
                    currentStep > step.number ? 'bg-green-500' : 'bg-gray-200'
                  }`}></div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              {/* Step 1: Select Service */}
              {currentStepType === 'service' && (
                <div>
                  <h2 className="text-gray-900 mb-2">Select a Service</h2>
                  <p className="text-gray-600 mb-6">Choose the service you'd like to book from {providerName}</p>

                  {!providerId ? (
                    <div className="text-center py-12">
                      <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
                      <p className="text-gray-600">Please select a provider first to view their services.</p>
                    </div>
                  ) : isLoadingServices ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader className="w-8 h-8 animate-spin text-purple-600" />
                      <span className="ml-3 text-gray-600">Loading services...</span>
                    </div>
                  ) : services.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-gray-600">No services available from this provider.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {services.map((service) => (
                        <button
                          key={service.id}
                          onClick={() => { setSelectedService(service.id); setBookingType(null); setStepError(null); }}
                          className={`w-full p-6 border-2 rounded-2xl text-left transition-all ${
                            selectedService === service.id
                              ? 'border-purple-500 bg-purple-50 shadow-lg'
                              : 'border-gray-200 hover:border-purple-300'
                          }`}
                        >
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="text-lg font-semibold text-gray-900">{service.name}</h3>
                                {selectedService === service.id && (
                                  <div className="w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center">
                                    <Check className="w-3 h-3 text-white" />
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                {/* Show available pricing badges */}
                                {service.has_hourly && (
                                  <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">
                                    ⏱️ ₱{service.hourly_rate?.toLocaleString()}/hr
                                  </span>
                                )}
                                {service.has_package && (
                                  <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">
                                    📦 ₱{service.package_price?.toLocaleString()}
                                  </span>
                                )}
                                {service.duration_minutes && service.has_package && (
                                  <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">
                                    {formatDuration(service.duration_minutes)}
                                  </span>
                                )}
                                <span className="text-sm text-gray-500">{service.photos}</span>
                              </div>
                            </div>
                          </div>
                          {service.description && (
                            <p className="text-sm text-gray-600 mb-4">{service.description}</p>
                          )}
                          <div className="grid grid-cols-2 gap-2">
                            {service.features.slice(0, 4).map((feature, idx) => (
                              <div key={idx} className="flex items-center gap-2 text-sm text-gray-600">
                                <Check className="w-4 h-4 text-purple-500" />
                                <span>{feature}</span>
                              </div>
                            ))}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Step 2: Choose Pricing Type (only if service has both options) */}
              {currentStepType === 'pricingtype' && selectedServiceData && (
                <div>
                  <h2 className="text-gray-900 mb-2">Choose Pricing Type</h2>
                  <p className="text-gray-600 mb-6">Select how you'd like to pay for {selectedServiceData.name}</p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Hourly Booking Card */}
                    <button
                      onClick={() => { setBookingType('hourly'); setStepError(null); }}
                      className={`relative p-6 border-2 rounded-2xl text-left transition-all ${
                        bookingType === 'hourly'
                          ? 'border-blue-500 bg-blue-50 shadow-lg shadow-blue-100'
                          : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/50'
                      }`}
                    >
                      {bookingType === 'hourly' && (
                        <div className="absolute top-3 right-3 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                          <Check className="w-4 h-4 text-white" />
                        </div>
                      )}
                      <div className="w-14 h-14 bg-blue-100 rounded-xl flex items-center justify-center mb-4">
                        <Clock className="w-7 h-7 text-blue-600" />
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">Hourly Booking</h3>
                      <p className="text-sm text-gray-600 mb-4">
                        Pay by the hour. Choose your own session duration.
                      </p>
                      <div className="p-3 bg-blue-100 rounded-lg">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-blue-700">Hourly Rate</span>
                          <span className="text-xl font-bold text-blue-600">₱{selectedServiceData.hourly_rate?.toLocaleString()}/hr</span>
                        </div>
                        <p className="text-xs text-blue-600 mt-1">+ 15% platform fee</p>
                      </div>
                      <ul className="mt-4 space-y-2">
                        <li className="flex items-center gap-2 text-sm text-gray-600">
                          <Check className="w-4 h-4 text-blue-500" />
                          Flexible duration
                        </li>
                        <li className="flex items-center gap-2 text-sm text-gray-600">
                          <Check className="w-4 h-4 text-blue-500" />
                          Pay only for time used
                        </li>
                      </ul>
                    </button>

                    {/* Package Booking Card */}
                    <button
                      onClick={() => { setBookingType('package'); setStepError(null); }}
                      className={`relative p-6 border-2 rounded-2xl text-left transition-all ${
                        bookingType === 'package'
                          ? 'border-green-500 bg-green-50 shadow-lg shadow-green-100'
                          : 'border-gray-200 hover:border-green-300 hover:bg-green-50/50'
                      }`}
                    >
                      {bookingType === 'package' && (
                        <div className="absolute top-3 right-3 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                          <Check className="w-4 h-4 text-white" />
                        </div>
                      )}
                      <div className="w-14 h-14 bg-green-100 rounded-xl flex items-center justify-center mb-4">
                        <CreditCard className="w-7 h-7 text-green-600" />
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">Package Price</h3>
                      <p className="text-sm text-gray-600 mb-4">
                        Fixed price for the entire package duration.
                      </p>
                      <div className="p-3 bg-green-100 rounded-lg">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-green-700">Package Price</span>
                          <span className="text-xl font-bold text-green-600">₱{selectedServiceData.package_price?.toLocaleString()}</span>
                        </div>
                        <p className="text-xs text-green-600 mt-1">
                          {selectedServiceData.duration_minutes
                            ? `${formatDuration(selectedServiceData.duration_minutes)} included • + 15% fee`
                            : '+ 15% platform fee'
                          }
                        </p>
                      </div>
                      <ul className="mt-4 space-y-2">
                        <li className="flex items-center gap-2 text-sm text-gray-600">
                          <Check className="w-4 h-4 text-green-500" />
                          All-inclusive pricing
                        </li>
                        <li className="flex items-center gap-2 text-sm text-gray-600">
                          <Check className="w-4 h-4 text-green-500" />
                          No surprises
                        </li>
                      </ul>
                    </button>
                  </div>
                </div>
              )}

              {/* Date & Time Step */}
              {currentStepType === 'datetime' && (
                <div>
                  <h2 className="text-gray-900 mb-2">Select Date & Time</h2>
                  <p className="text-gray-600 mb-6">Choose from {providerName}'s available schedule</p>

                  {/* Pricing Information Panel - Hourly */}
                  {bookingType === 'hourly' && (
                    <div className="mb-6 rounded-2xl overflow-hidden border border-blue-200 bg-white shadow-sm">
                      <div className="px-4 sm:px-6 py-4 bg-gradient-to-r from-blue-600 to-blue-500">
                        <h3 className="text-white font-semibold text-lg">Hourly Booking</h3>
                        <p className="text-white/80 text-sm">Select your date, start time, and how many hours you need</p>
                      </div>
                      <div className="p-4 sm:p-6">
                        <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <span className="text-sm text-blue-700">Hourly Rate</span>
                              <div className="text-2xl font-bold text-blue-600">
                                ₱{hourlyRate.toLocaleString()}/hr
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700">
                                ⏱️ Hourly
                              </span>
                            </div>
                          </div>
                          {totalDurationMinutes > 0 && (
                            <div className="pt-3 border-t border-blue-200">
                              <div className="flex items-center justify-between text-sm mb-1">
                                <span className="text-blue-700">Duration</span>
                                <span className="font-semibold text-blue-800">{formatDuration(totalDurationMinutes)}</span>
                              </div>
                              <div className="flex items-center justify-between text-sm mb-1">
                                <span className="text-blue-700">Calculation</span>
                                <span className="text-blue-800">₱{hourlyRate.toLocaleString()} × {totalDurationHours.toFixed(1)} hrs</span>
                              </div>
                              <div className="flex items-center justify-between font-semibold text-lg mt-2 pt-2 border-t border-blue-200">
                                <span className="text-blue-700">Total</span>
                                <span className="text-blue-600">₱{(hourlyRate * totalDurationHours).toLocaleString()}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Pricing Information Panel - Package */}
                  {bookingType === 'package' && selectedServiceData && (
                    <div className="mb-6 rounded-2xl overflow-hidden border border-green-200 bg-white shadow-sm">
                      <div className="px-4 sm:px-6 py-4 bg-gradient-to-r from-green-600 to-green-500">
                        <h3 className="text-white font-semibold text-lg">{selectedServiceData.name}</h3>
                        <p className="text-white/80 text-sm">
                          {packageDurationMinutes > 0
                            ? `${formatDuration(packageDurationMinutes)} package`
                            : 'Fixed price package'
                          }
                        </p>
                      </div>
                      <div className="p-4 sm:p-6">
                        <div className="p-4 rounded-xl bg-green-50 border border-green-200">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-2xl font-bold text-green-600">
                              ₱{basePrice.toLocaleString()}
                            </span>
                            <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">
                              📦 Package
                            </span>
                          </div>
                          <p className="text-sm text-green-700">
                            {packageDurationMinutes > 0
                              ? `Select ${requiredSlotsForPackage} consecutive slots (${formatDuration(packageDurationMinutes)}).`
                              : 'Select your preferred time slots below.'
                            }
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Hold Timer Banner */}
                  {heldSlotIds.length > 0 && holdTimeRemaining !== null && (
                    <div className={`mb-4 p-3 rounded-xl flex items-center justify-between ${
                      holdTimeRemaining <= 60 ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'
                    }`}>
                      <div className="flex items-center gap-2">
                        <Timer className={`w-5 h-5 ${holdTimeRemaining <= 60 ? 'text-red-600' : 'text-amber-600'}`} />
                        <span className={`text-sm font-medium ${holdTimeRemaining <= 60 ? 'text-red-700' : 'text-amber-700'}`}>
                          {heldSlotIds.length} slot{heldSlotIds.length > 1 ? 's' : ''} held for {formatHoldTime(holdTimeRemaining)}
                        </span>
                      </div>
                      <button
                        onClick={handleReleaseHold}
                        className="text-sm text-gray-500 hover:text-gray-700"
                      >
                        Release
                      </button>
                    </div>
                  )}

                  <div className="space-y-6">
                    {/* Calendar with Availability - Traditional Design */}
                    <div className="rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-sm">
                      {/* Calendar Header */}
                      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
                        <div className="flex items-center justify-between">
                          {/* Month Navigation */}
                          <button
                            onClick={() => {
                              const newDate = new Date(currentMonth);
                              newDate.setMonth(newDate.getMonth() - 1);
                              const now = new Date();
                              if (newDate.getFullYear() > now.getFullYear() ||
                                  (newDate.getFullYear() === now.getFullYear() && newDate.getMonth() >= now.getMonth())) {
                                setCurrentMonth(newDate);
                                // Clear selection when changing months
                                if (selectedDay && selectedDay.getMonth() !== newDate.getMonth()) {
                                  handleDaySelect(undefined as any);
                                  setSelectedDay(undefined);
                                }
                              }
                            }}
                            className="w-10 h-10 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors"
                          >
                            <ChevronRight className="w-5 h-5 text-gray-600 rotate-180" />
                          </button>

                          <h3 className="text-lg sm:text-xl font-semibold text-gray-900">
                            {currentMonth.toLocaleString('default', { month: 'long' })} {currentMonth.getFullYear()}
                          </h3>

                          <button
                            onClick={() => {
                              const newDate = new Date(currentMonth);
                              newDate.setMonth(newDate.getMonth() + 1);
                              setCurrentMonth(newDate);
                              // Clear selection when changing months
                              if (selectedDay && selectedDay.getMonth() !== newDate.getMonth()) {
                                handleDaySelect(undefined as any);
                                setSelectedDay(undefined);
                              }
                            }}
                            className="w-10 h-10 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors"
                          >
                            <ChevronRight className="w-5 h-5 text-gray-600" />
                          </button>
                        </div>
                      </div>

                      {/* Selected Date Display */}
                      {selectedDay && (
                        <div className="px-4 sm:px-6 py-3 bg-purple-50 border-b border-purple-100">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Check className="w-4 h-4 text-purple-600" />
                              <span className="text-purple-700 font-medium text-sm sm:text-base">
                                {selectedDay.toLocaleDateString('en-US', {
                                  weekday: 'long',
                                  month: 'long',
                                  day: 'numeric'
                                })}
                              </span>
                            </div>
                            <button
                              onClick={() => { setSelectedDay(undefined); setSelectedSlots([]); }}
                              className="text-purple-500 hover:text-purple-700 text-xs sm:text-sm"
                            >
                              Change
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Calendar Grid */}
                      <div className="p-2 sm:p-4">
                        {loadingCalendar ? (
                          <div className="flex flex-col items-center justify-center py-12 sm:py-16">
                            <Loader className="w-8 h-8 animate-spin text-purple-600 mb-3" />
                            <p className="text-gray-500 text-sm">Loading availability...</p>
                          </div>
                        ) : calendarError ? (
                          <div className="flex flex-col items-center justify-center py-12 sm:py-16">
                            <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
                            <p className="text-gray-600 font-medium mb-2">Failed to load calendar</p>
                            <p className="text-gray-400 text-sm mb-4">{calendarError}</p>
                            <button
                              onClick={fetchCalendarData}
                              className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition-colors"
                            >
                              Try Again
                            </button>
                          </div>
                        ) : (
                          <div className="border border-gray-200 rounded-lg overflow-hidden">
                            {/* Day Headers */}
                            <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
                              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                                <div
                                  key={idx}
                                  className="text-center text-xs sm:text-sm font-semibold text-gray-500 py-2 sm:py-3 border-r border-gray-200 last:border-r-0"
                                >
                                  <span className="hidden sm:inline">{day}</span>
                                  <span className="sm:hidden">{day.charAt(0)}</span>
                                </div>
                              ))}
                            </div>

                            {/* Calendar Days Grid */}
                            <div className="grid grid-cols-7">
                              {/* Empty cells for days before month starts */}
                              {Array.from({ length: new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay() }).map((_, i) => (
                                <div key={`empty-${i}`} className="h-14 sm:h-16 md:h-20 border-r border-b border-gray-100 last:border-r-0 bg-gray-50/50" />
                              ))}

                              {/* Day cells */}
                              {Array.from({ length: new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate() }).map((_, i) => {
                                const day = i + 1;
                                const status = getDayStatus(day);
                                const selectable = isDaySelectable(day);
                                const dayData = getDayData(day);
                                const dateObj = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
                                const isSelected = selectedDay?.toDateString() === dateObj.toDateString();
                                const isToday = new Date().toDateString() === dateObj.toDateString();

                                const getCellBackground = () => {
                                  if (isSelected) return 'bg-purple-600';
                                  switch (status) {
                                    case 'available': return 'bg-white hover:bg-green-50';
                                    case 'partial': return 'bg-white hover:bg-amber-50';
                                    case 'booked': return 'bg-red-50/50';
                                    case 'blocked': return 'bg-gray-100';
                                    case 'past': return 'bg-gray-50';
                                    default: return 'bg-white hover:bg-gray-50';
                                  }
                                };

                                const getTextColor = () => {
                                  if (isSelected) return 'text-white';
                                  switch (status) {
                                    case 'available': return 'text-gray-900';
                                    case 'partial': return 'text-gray-900';
                                    case 'booked': return 'text-red-300';
                                    case 'blocked': return 'text-gray-300';
                                    case 'past': return 'text-gray-300';
                                    default: return 'text-gray-700';
                                  }
                                };

                                const getStatusIndicator = () => {
                                  if (isSelected || status === 'past') return null;
                                  switch (status) {
                                    case 'available':
                                      return <div className="w-2 h-2 rounded-full bg-green-500" />;
                                    case 'partial':
                                      return <div className="w-2 h-2 rounded-full bg-amber-500" />;
                                    case 'booked':
                                      return <div className="w-2 h-0.5 bg-red-300 rounded" />;
                                    case 'blocked':
                                      return <div className="w-2 h-0.5 bg-gray-400 rounded" />;
                                    default:
                                      return null;
                                  }
                                };

                                return (
                                  <button
                                    key={day}
                                    onClick={() => {
                                      if (selectable) {
                                        handleDaySelect(dateObj);
                                      }
                                    }}
                                    disabled={!selectable}
                                    className={`
                                      relative h-14 sm:h-16 md:h-20 border-r border-b border-gray-100 last:border-r-0
                                      flex flex-col items-center justify-start pt-1.5 sm:pt-2
                                      transition-colors
                                      ${getCellBackground()}
                                      ${selectable ? 'cursor-pointer' : 'cursor-not-allowed'}
                                    `}
                                    title={
                                      status === 'blocked' ? 'Provider unavailable' :
                                      status === 'booked' ? 'Fully booked' :
                                      status === 'past' ? 'Past date' :
                                      dayData?.available_count ? `${dayData.available_count} slot${dayData.available_count !== 1 ? 's' : ''} available` :
                                      'Check availability'
                                    }
                                  >
                                    {/* Day number */}
                                    <span className={`
                                      text-sm sm:text-base font-medium
                                      ${isSelected ? 'w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white/20 flex items-center justify-center' : ''}
                                      ${getTextColor()}
                                      ${isToday && !isSelected ? 'w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center' : ''}
                                    `}>
                                      {day}
                                    </span>

                                    {/* Slot count */}
                                    {dayData && dayData.available_count > 0 && status !== 'past' && (
                                      <span className={`
                                        text-[10px] sm:text-xs mt-0.5
                                        ${isSelected ? 'text-purple-200' : 'text-gray-500'}
                                      `}>
                                        {dayData.available_count} {dayData.available_count === 1 ? 'slot' : 'slots'}
                                      </span>
                                    )}

                                    {/* Status indicator dot */}
                                    <div className="absolute bottom-1 sm:bottom-2 left-1/2 -translate-x-1/2">
                                      {getStatusIndicator()}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Legend */}
                      <div className="px-3 sm:px-4 pb-3 sm:pb-4">
                        <div className="flex flex-wrap items-center justify-center gap-x-4 sm:gap-x-6 gap-y-2 text-xs sm:text-sm text-gray-500">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-green-500" />
                            <span>Available</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-amber-500" />
                            <span>Partial</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-0.5 bg-red-300 rounded" />
                            <span>Full</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-0.5 bg-gray-400 rounded" />
                            <span>Closed</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Time Slots - Multi-Select */}
                    {selectedDay && (
                      <div className="rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-sm">
                        {/* Time Slots Header */}
                        <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-4 sm:px-6 py-4">
                          <div className="flex items-center gap-2 sm:gap-3">
                            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-white/20 flex items-center justify-center">
                              <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                            </div>
                            <div>
                              <h3 className="text-white font-semibold text-base sm:text-lg">Select Time Slots</h3>
                              <p className="text-blue-100 text-xs sm:text-sm">
                                {availableSlots.length > 0
                                  ? isHourlyPricing
                                    ? `Tap consecutive slots for longer bookings (₱${basePrice.toLocaleString()}/hr)`
                                    : packageDurationMinutes > 0
                                      ? `Select ${requiredSlotsForPackage} consecutive slots (${formatDuration(packageDurationMinutes)} package)`
                                      : 'Tap consecutive slots for longer bookings'
                                  : 'No slots available'
                                }
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Selection Summary */}
                        {selectedSlots.length > 0 && (
                          <div className="px-4 sm:px-6 py-3 bg-blue-50 border-b border-blue-100">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                  <Clock className="w-4 h-4 text-blue-600" />
                                  <span className="text-blue-700 font-medium text-sm sm:text-base">
                                    {selectedTimeLabel} - {selectedEndTimeLabel}
                                  </span>
                                </div>
                                <span className="px-2 py-0.5 bg-blue-100 rounded-full text-xs font-medium text-blue-700">
                                  {formatDuration(totalDurationMinutes)}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                {heldSlotIds.length > 0 ? (
                                  <div className="flex items-center gap-1 px-2 py-1 bg-green-100 rounded-full">
                                    <Check className="w-3 h-3 text-green-600" />
                                    <span className="text-xs text-green-700 font-medium">Reserved</span>
                                  </div>
                                ) : (
                                  <button
                                    onClick={handleHoldSlots}
                                    disabled={isHolding || !areSlotsConsecutive(selectedSlots)}
                                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-full transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                  >
                                    {isHolding ? (
                                      <>
                                        <Loader className="w-3 h-3 animate-spin" />
                                        <span>Reserving...</span>
                                      </>
                                    ) : (
                                      'Reserve Slots'
                                    )}
                                  </button>
                                )}
                                <button
                                  onClick={handleClearSelection}
                                  className="text-xs text-gray-500 hover:text-gray-700"
                                >
                                  Clear
                                </button>
                              </div>
                            </div>
                            {/* Price preview */}
                            {selectedServiceData && totalDurationMinutes > 0 && (
                              <div className="mt-2 pt-2 border-t border-blue-200">
                                <div className="flex items-center justify-between text-sm">
                                  {isHourlyPricing ? (
                                    <span className="text-blue-600">
                                      ₱{basePrice.toLocaleString()}/hr × {totalDurationHours.toFixed(1)} hrs
                                    </span>
                                  ) : (
                                    <span className="text-blue-600">
                                      Package: {formatDuration(packageDurationMinutes)} ({requiredSlotsForPackage} slots)
                                    </span>
                                  )}
                                  <span className="font-semibold text-blue-800">
                                    ₱{servicePrice.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                                  </span>
                                </div>
                                {/* Package duration mismatch warning */}
                                {!isHourlyPricing && packageDurationMinutes > 0 && totalDurationMinutes !== packageDurationMinutes && (
                                  <div className="mt-1 text-xs text-amber-600">
                                    Note: Package is {formatDuration(packageDurationMinutes)}, you selected {formatDuration(totalDurationMinutes)}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Slots Grid */}
                        <div className="p-4 sm:p-6">
                          {loadingSlots ? (
                            <div className="flex flex-col items-center justify-center py-10">
                              <Loader className="w-8 h-8 animate-spin text-blue-600 mb-3" />
                              <p className="text-gray-500 text-sm">Loading available times...</p>
                            </div>
                          ) : availableSlots.length === 0 ? (
                            <div className="text-center py-10">
                              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                                <Clock className="w-8 h-8 text-gray-300" />
                              </div>
                              <p className="text-gray-600 font-medium">No available slots</p>
                              <p className="text-sm text-gray-400 mt-1">Try selecting a different date</p>
                            </div>
                          ) : (
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-1.5 sm:gap-2">
                              {availableSlots.map((slot) => {
                                const startTime = new Date(slot.start);
                                const timeLabel = startTime.toLocaleTimeString('en-US', {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                  hour12: true,
                                });
                                const isSelected = selectedSlots.some(s => s.id === slot.id);
                                const isHeldByMe = heldSlotIds.includes(slot.id);
                                const isHeldByOther = slot.is_held && !isHeldByMe;
                                const isDisabled = (heldSlotIds.length > 0 && !isHeldByMe) || isHeldByOther;

                                return (
                                  <button
                                    key={slot.id}
                                    onClick={() => !isDisabled && handleSlotToggle(slot)}
                                    disabled={isDisabled}
                                    title={isHeldByOther ? 'Temporarily unavailable (held by another user)' : ''}
                                    className={`
                                      relative p-2 sm:p-3 rounded-lg text-center transition-all duration-150
                                      ${isHeldByOther
                                        ? 'bg-orange-50 border border-orange-200 cursor-not-allowed'
                                        : isSelected
                                          ? isHeldByMe
                                            ? 'bg-green-500 text-white shadow-md'
                                            : 'bg-blue-500 text-white shadow-md'
                                          : 'bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-300'
                                      }
                                      ${isDisabled && !isHeldByOther ? 'opacity-40 cursor-not-allowed' : ''}
                                      ${!isDisabled ? 'cursor-pointer active:scale-95' : ''}
                                    `}
                                  >
                                    <span className={`font-medium text-xs sm:text-sm ${
                                      isHeldByOther ? 'text-orange-400' :
                                      isSelected ? 'text-white' : 'text-gray-700'
                                    }`}>
                                      {timeLabel}
                                    </span>
                                    {isHeldByMe && (
                                      <Check className="w-3 h-3 absolute top-0.5 right-0.5 text-white" />
                                    )}
                                    {isHeldByOther && (
                                      <Timer className="w-3 h-3 absolute top-0.5 right-0.5 text-orange-400" />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {/* Today's date notice */}
                          {selectedDay && new Date().toDateString() === selectedDay.toDateString() && availableSlots.length > 0 && (
                            <div className="mt-4 flex items-start gap-3 p-3 bg-amber-50 rounded-xl border border-amber-200">
                              <Clock className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                              <div>
                                <p className="text-sm text-amber-800 font-medium">Booking for today</p>
                                <p className="text-xs text-amber-600 mt-0.5">
                                  Only future time slots are shown. Past hours have been automatically hidden.
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Instructions */}
                          {heldSlotIds.length === 0 && availableSlots.length > 0 && (
                            <div className="mt-4 flex items-start gap-3 p-3 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl border border-blue-100">
                              <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                              <div>
                                <p className="text-sm text-blue-800 font-medium">Book multiple hours</p>
                                <p className="text-xs text-blue-600 mt-0.5">
                                  Tap consecutive slots to book longer sessions. Each slot is 30 minutes. Select your desired duration, then tap "Reserve Slots".
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Held by others legend */}
                          {availableSlots.some(s => s.is_held) && (
                            <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                              <div className="flex items-center gap-1">
                                <div className="w-3 h-3 rounded bg-orange-50 border border-orange-200" />
                                <span>Temporarily held by another user</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Booking Mode - Redesigned */}
                    <div className="rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-sm">
                      <div className="px-4 sm:px-6 py-4 border-b border-gray-100">
                        <label className="text-sm sm:text-base font-semibold text-gray-900">Booking Mode</label>
                        <p className="text-xs sm:text-sm text-gray-500 mt-0.5">How would you like to book?</p>
                      </div>
                      <div className="p-4 sm:p-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => setBookingMode('request')}
                            className={`p-4 sm:p-5 rounded-xl text-left transition-all duration-200 ${
                              bookingMode === 'request'
                                ? 'bg-gradient-to-br from-purple-600 to-purple-700 text-white shadow-lg shadow-purple-200 scale-[1.02]'
                                : 'bg-gray-50 border border-gray-200 hover:border-purple-300 hover:bg-purple-50'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                bookingMode === 'request' ? 'bg-white/20' : 'bg-purple-100'
                              }`}>
                                <MessageSquare className={`w-5 h-5 ${bookingMode === 'request' ? 'text-white' : 'text-purple-600'}`} />
                              </div>
                              <div>
                                <div className={`text-sm sm:text-base font-semibold ${bookingMode === 'request' ? 'text-white' : 'text-gray-900'}`}>
                                  Request Approval
                                </div>
                                <div className={`text-xs sm:text-sm mt-1 ${bookingMode === 'request' ? 'text-purple-200' : 'text-gray-500'}`}>
                                  Provider will review and confirm
                                </div>
                              </div>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setBookingMode('instant')}
                            className={`p-4 sm:p-5 rounded-xl text-left transition-all duration-200 ${
                              bookingMode === 'instant'
                                ? 'bg-gradient-to-br from-green-600 to-green-700 text-white shadow-lg shadow-green-200 scale-[1.02]'
                                : 'bg-gray-50 border border-gray-200 hover:border-green-300 hover:bg-green-50'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                bookingMode === 'instant' ? 'bg-white/20' : 'bg-green-100'
                              }`}>
                                <Check className={`w-5 h-5 ${bookingMode === 'instant' ? 'text-white' : 'text-green-600'}`} />
                              </div>
                              <div>
                                <div className={`text-sm sm:text-base font-semibold ${bookingMode === 'instant' ? 'text-white' : 'text-gray-900'}`}>
                                  Instant Booking
                                </div>
                                <div className={`text-xs sm:text-sm mt-1 ${bookingMode === 'instant' ? 'text-green-200' : 'text-gray-500'}`}>
                                  Book immediately, no waiting
                                </div>
                              </div>
                            </div>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* How it works info */}
                    <div className={`rounded-xl p-4 border transition-all ${
                      bookingMode === 'instant'
                        ? 'bg-green-50 border-green-200'
                        : 'bg-purple-50 border-purple-200'
                    }`}>
                      <div className="flex items-start gap-3">
                        <Info className={`w-5 h-5 flex-shrink-0 mt-0.5 ${bookingMode === 'instant' ? 'text-green-600' : 'text-purple-600'}`} />
                        <div>
                          <p className={`text-sm font-medium ${bookingMode === 'instant' ? 'text-green-800' : 'text-purple-800'}`}>
                            How it works
                          </p>
                          <p className={`text-xs sm:text-sm mt-1 ${bookingMode === 'instant' ? 'text-green-700' : 'text-purple-700'}`}>
                            {bookingMode === 'instant'
                              ? 'Your booking will be confirmed immediately and the time slot will be reserved.'
                              : 'Your booking request will be sent to the provider. They will review and confirm.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Review & Confirm Step */}
              {currentStepType === 'confirm' && (
                <div>
                  <h2 className="text-gray-900 mb-2">Review & Confirm</h2>
                  <p className="text-gray-600 mb-6">Review your booking details before proceeding to payment</p>

                  <div className="space-y-6">
                    {/* Booking Details Summary */}
                    <div className="bg-gray-50 rounded-2xl p-6 space-y-4">
                      <div className="flex items-center gap-4">
                        <ImageWithFallback
                          src={providerImage}
                          alt={providerName}
                          className="w-16 h-16 object-cover rounded-xl"
                        />
                        <div>
                          <p className="font-medium text-gray-900">{providerName}</p>
                          <p className="text-sm text-gray-600">Service Provider</p>
                        </div>
                      </div>

                      <div className="border-t border-gray-200 pt-4 space-y-3">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Booking Type</span>
                          <span className={`font-medium px-2 py-0.5 rounded-full text-sm ${
                            bookingType === 'hourly'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-green-100 text-green-700'
                          }`}>
                            {bookingType === 'hourly' ? '⏱️ Hourly' : '📦 Package'}
                          </span>
                        </div>
                        {bookingType === 'package' && selectedServiceData && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">Package</span>
                            <span className="font-medium text-gray-900">{selectedServiceData.name}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-gray-600">Date</span>
                          <span className="font-medium text-gray-900">
                            {selectedDay?.toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            })}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Time</span>
                          <span className="font-medium text-gray-900">{selectedTimeLabel} - {selectedEndTimeLabel}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Duration</span>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{formatDuration(totalDurationMinutes)}</span>
                            <span className="px-2 py-0.5 bg-purple-100 rounded text-xs font-medium text-purple-700">
                              {selectedSlots.length} slot{selectedSlots.length > 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Booking Mode</span>
                          <span className="font-medium text-gray-900">
                            {bookingMode === 'instant' ? 'Instant Booking' : 'Request Approval'}
                          </span>
                        </div>
                      </div>

                      <div className="border-t border-gray-200 pt-4 space-y-2">
                        {/* Rate breakdown */}
                        <div className="text-xs text-gray-500 pb-1 border-b border-gray-100">
                          {bookingType === 'hourly' ? (
                            <>₱{hourlyRate.toLocaleString()} per hour × {totalDurationHours.toFixed(1)} hours</>
                          ) : (
                            <>Fixed Package Price{packageDurationMinutes > 0 ? ` (${formatDuration(packageDurationMinutes)})` : ''}</>
                          )}
                        </div>
                        {/* Package duration mismatch warning */}
                        {!isHourlyPricing && packageDurationMinutes > 0 && totalDurationMinutes !== packageDurationMinutes && (
                          <div className="flex items-start gap-2 p-2 bg-amber-50 rounded-lg border border-amber-200">
                            <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                            <span className="text-xs text-amber-700">
                              Package duration is {formatDuration(packageDurationMinutes)}, but you selected {formatDuration(totalDurationMinutes)}. The price remains fixed.
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Service Fee</span>
                          <span className="text-gray-900">₱{servicePrice.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Platform Fee (15%)</span>
                          <span className="text-gray-900">₱{platformFee.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between font-semibold text-lg pt-2 border-t border-gray-200">
                          <span className="text-gray-900">Total</span>
                          <span className="text-purple-600">₱{total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                      <div className="flex items-start gap-3">
                        <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-green-800">
                          <p className="mb-1"><strong>Secure Payment via PayMongo</strong></p>
                          <p>After confirming, you'll be prompted to enter your payment details securely. Your card information is encrypted and never stored on our servers.</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                      <div className="flex items-start gap-3">
                        <CreditCard className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-blue-800">
                          <p className="mb-1"><strong>Payment Methods Accepted</strong></p>
                          <p>Credit/Debit Cards (Visa, Mastercard), GCash, PayMaya, and more.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Summary Sidebar */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <h3 className="text-gray-900 mb-4">Booking Summary</h3>

              <div className="space-y-4">
                {/* Provider */}
                <div className="flex gap-3">
                  <ImageWithFallback
                    src={providerImage}
                    alt={providerName}
                    className="w-16 h-16 object-cover rounded-xl"
                  />
                  <div>
                    <p className="text-gray-900">{providerName}</p>
                    <p className="text-sm text-gray-600">Service Provider</p>
                  </div>
                </div>

                {/* Booking Type */}
                {bookingType && (
                  <div className="pt-4 border-t border-gray-200">
                    <div className="flex justify-between mb-2">
                      <span className="text-sm text-gray-600">Type</span>
                      <span className={`text-sm px-2 py-0.5 rounded-full ${
                        bookingType === 'hourly'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-green-100 text-green-700'
                      }`}>
                        {bookingType === 'hourly' ? '⏱️ Hourly' : '📦 Package'}
                      </span>
                    </div>
                    {bookingType === 'package' && selectedServiceData && (
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Package</span>
                        <span className="text-sm text-gray-900">{selectedServiceData.name}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Date & Time */}
                {selectedDateString && selectedSlots.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <CalendarIcon className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-900">{selectedDateString}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-900">{selectedTimeLabel} - {selectedEndTimeLabel}</span>
                    </div>
                    {/* Duration badge */}
                    <div className="flex items-center gap-2 text-sm">
                      <Timer className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-900">{formatDuration(totalDurationMinutes)}</span>
                      <span className="px-1.5 py-0.5 bg-purple-100 rounded text-xs text-purple-700">
                        {selectedSlots.length} slot{selectedSlots.length > 1 ? 's' : ''}
                      </span>
                    </div>
                    {heldSlotIds.length > 0 && (
                      <div className="flex items-center gap-2 text-sm text-green-600">
                        <Check className="w-4 h-4" />
                        <span>{heldSlotIds.length} slot{heldSlotIds.length > 1 ? 's' : ''} reserved</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Pricing */}
                {bookingType && (
                  <div className="pt-4 border-t border-gray-200 space-y-2">
                    {/* Rate info */}
                    <div className="flex justify-between items-center text-xs pb-1">
                      {bookingType === 'hourly' ? (
                        <>
                          <span className="text-gray-500">Rate</span>
                          <span className="text-blue-600 font-medium">₱{hourlyRate.toLocaleString()}/hr</span>
                        </>
                      ) : selectedServiceData ? (
                        <>
                          <span className="text-gray-500">Package Price</span>
                          <span className="text-green-600 font-medium">₱{basePrice.toLocaleString()}</span>
                        </>
                      ) : null}
                    </div>
                    {hasSelectedSlots ? (
                      <>
                        {bookingType === 'hourly' && (
                          <div className="flex justify-between text-sm text-gray-500">
                            <span>Calculation</span>
                            <span>₱{hourlyRate.toLocaleString()} × {totalDurationHours.toFixed(1)} hrs</span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Service Fee</span>
                          <span className="text-gray-900">
                            ₱{(bookingType === 'hourly'
                              ? hourlyRate * totalDurationHours
                              : basePrice
                            ).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Platform Fee (15%)</span>
                          <span className="text-gray-900">
                            ₱{((bookingType === 'hourly'
                              ? hourlyRate * totalDurationHours
                              : basePrice
                            ) * 0.15).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="flex justify-between pt-2 border-t border-gray-200">
                          <span className="text-gray-900 font-medium">Total</span>
                          <span className="text-purple-600 font-semibold">
                            ₱{((bookingType === 'hourly'
                              ? hourlyRate * totalDurationHours
                              : basePrice
                            ) * 1.15).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-2">
                        <p className="text-sm text-gray-500">
                          {bookingType === 'hourly'
                            ? `₱${hourlyRate.toLocaleString()}/hr`
                            : selectedServiceData
                              ? `₱${basePrice.toLocaleString()}`
                              : 'Select a package'
                          }
                        </p>
                        <p className="text-xs text-gray-400 mt-1">Select time slots to see total</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-3">
              {currentStep > 1 && (
                <button
                  onClick={() => setCurrentStep(currentStep - 1)}
                  disabled={isSubmitting}
                  className="w-full py-3 border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Back
                </button>
              )}
              <button
                onClick={handleNext}
                disabled={!canProceed() || isSubmitting}
                className="w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader className="w-5 h-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    {currentStepType === 'confirm' ? 'Confirm & Pay' : 'Continue'}
                    {currentStepType !== 'confirm' && <ChevronRight className="w-5 h-5" />}
                  </>
                )}
              </button>
            </div>

            {/* Help */}
            <div className="bg-purple-50 rounded-2xl p-4 border border-purple-200">
              <div className="flex items-start gap-3">
                <MessageSquare className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-purple-900 mb-1">Need help?</p>
                  <p className="text-xs text-purple-700">Contact our support team for assistance with your booking</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
