import { useEffect, useMemo, useState } from 'react';
import { Check, Calendar as CalendarIcon, Clock, CreditCard, ChevronRight, MessageSquare, AlertCircle, Loader } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import bookingService from '../api/services/bookingService';
import serviceService, { Service } from '../api/services/serviceService';
import { useAuth } from '../context/AuthContext';
import availabilityService from '../api/services/availabilityService';
import { Calendar } from './ui/calendar';
import { PaymentSummary } from './PaymentSummary';

interface BookingFlowProps {
  onComplete: () => void;
  providerId?: string;
  providerName?: string;
  providerImage?: string;
}

export function BookingFlow({ onComplete, providerId, providerName = 'Service Provider', providerImage = 'https://images.unsplash.com/photo-1623783356340-95375aac85ce?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3ZWRkaW5nJTIwcGhvdG9ncmFwaGVyfGVufDF8fHx8MTc2NDQwNzk1NHww&ixlib=rb-4.1.0&q=80&w=1080' }: BookingFlowProps) {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | undefined>(undefined);
  const [selectedTimeIso, setSelectedTimeIso] = useState<string>('');
  const [bookingMode, setBookingMode] = useState<'request' | 'instant'>('request');
  const [isLoadingTimes, setIsLoadingTimes] = useState(false);
  const [availableTimeSlots, setAvailableTimeSlots] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submittedStatus, setSubmittedStatus] = useState<string | null>(null);
  const [providerServices, setProviderServices] = useState<Service[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);
  const [createdBookingId, setCreatedBookingId] = useState<string | null>(null);
  const [showPayment, setShowPayment] = useState(false);

  const steps = [
    { number: 1, name: 'Select Service', icon: Check },
    { number: 2, name: 'Date & Time', icon: CalendarIcon },
    { number: 3, name: 'Confirm & Pay', icon: CreditCard },
  ];

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

  // Transform services for display - use real services or fallback to defaults
  const services = useMemo(() => {
    if (providerServices.length > 0) {
      return providerServices.map(s => ({
        id: s.id,
        name: s.title,
        duration: s.duration_minutes ? `${Math.floor(s.duration_minutes / 60)} hours` : 'Flexible',
        photos: s.category || 'Photography',
        price: Number(s.price) || 0,
        description: s.description,
        features: s.description ? s.description.split('\n').filter(Boolean) : [s.category || 'Professional service'],
      }));
    }
    // Fallback default services if provider has none
    return [
      { id: 'basic', name: 'Basic Package', duration: '4 hours', photos: '200+ photos', price: 1200, description: '', features: ['4 hours coverage', '200+ edited photos', 'Online gallery', 'Print release'] },
      { id: 'standard', name: 'Standard Package', duration: '8 hours', photos: '400+ photos', price: 2400, description: '', features: ['8 hours coverage', '400+ edited photos', 'Online gallery', 'Print release', 'Engagement session', 'USB drive'] },
      { id: 'premium', name: 'Premium Package', duration: 'Full day', photos: '600+ photos', price: 3600, description: '', features: ['Full day coverage', '600+ edited photos', 'Online gallery', 'Print release', 'Engagement session', 'USB drive', 'Second photographer', 'Premium album'] },
    ];
  }, [providerServices]);

  const selectedServiceData = services.find(s => s.id === selectedService);
  const servicePrice = selectedServiceData ? Number(selectedServiceData.price) || 0 : 0;
  const platformFee = servicePrice * 0.15;
  const total = servicePrice + platformFee;

  const selectedDateString = useMemo(() => {
    if (!selectedDay) return '';
    const yyyy = selectedDay.getFullYear();
    const mm = String(selectedDay.getMonth() + 1).padStart(2, '0');
    const dd = String(selectedDay.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }, [selectedDay]);

  const selectedTimeLabel = useMemo(() => {
    if (!selectedTimeIso) return '';
    try {
      const d = new Date(selectedTimeIso);
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (_e) {
      return '';
    }
  }, [selectedTimeIso]);

  useEffect(() => {
    (async () => {
      setError(null);
      setAvailableTimeSlots([]);
      setSelectedTimeIso('');

      if (!providerId) return;
      if (!selectedDateString) return;
      if (!selectedService) return;

      setIsLoadingTimes(true);
      try {
        const data = await availabilityService.getProviderTimeslots({
          providerId: providerId,
          date: selectedDateString,
          service_id: selectedService,
        });
        setAvailableTimeSlots(data.time_slots || []);
      } catch (e: any) {
        setAvailableTimeSlots([]);
        setError(e?.message || 'Failed to load availability');
      } finally {
        setIsLoadingTimes(false);
      }
    })();
  }, [providerId, selectedDateString, selectedService]);

  const canProceed = () => {
    if (currentStep === 1) return selectedService !== null;
    if (currentStep === 2) return selectedDateString && selectedTimeIso;
    return true;
  };

  const handleNext = async () => {
    if (currentStep < 3) {
      setCurrentStep(currentStep + 1);
      setError(null);
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

    if (!selectedTimeIso) {
      setError('Please select a time slot.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const startDate = selectedTimeIso;

      const bookingData = {
        provider_id: providerId,
        service_id: selectedService,
        start_date: startDate,
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
    setTimeout(() => {
      onComplete();
    }, 2000);
  };

  const handlePaymentFailed = (errorMsg: string) => {
    setError(`Payment failed: ${errorMsg}. Your booking has been saved. You can pay later from your dashboard.`);
  };

  const handlePaymentCancel = () => {
    setShowPayment(false);
    // Booking is already created, inform user they can pay later
    setError('Payment cancelled. Your booking has been saved but requires payment to confirm. You can complete payment from your dashboard.');
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
              {currentStep === 1 && (
                <div>
                  <h2 className="text-gray-900 mb-2">Select Your Package</h2>
                  <p className="text-gray-600 mb-6">Choose the package that best fits your needs</p>

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
                          onClick={() => setSelectedService(service.id)}
                          className={`w-full p-6 border-2 rounded-2xl text-left transition-all ${
                            selectedService === service.id
                              ? 'border-purple-600 bg-purple-50'
                              : 'border-gray-200 hover:border-purple-300'
                          }`}
                        >
                          <div className="flex items-start justify-between mb-4">
                            <div>
                              <h3 className="text-gray-900 mb-1">{service.name}</h3>
                              <p className="text-sm text-gray-600">{service.duration} • {service.photos}</p>
                            </div>
                            <div className="text-right">
                              <div className="text-purple-600">${Number(service.price).toFixed(2)}</div>
                              <div className="text-xs text-gray-500">+ platform fee</div>
                            </div>
                          </div>
                          {service.description && (
                            <p className="text-sm text-gray-600 mb-4">{service.description}</p>
                          )}
                          <div className="grid grid-cols-2 gap-2">
                            {service.features.map((feature, idx) => (
                              <div key={idx} className="flex items-center gap-2 text-sm text-gray-600">
                                <Check className="w-4 h-4 text-green-500" />
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

              {/* Step 2: Date & Time */}
              {currentStep === 2 && (
                <div >
                  <h2 className="text-gray-900 mb-2">Select Date & Time</h2>
                  <p className="text-gray-600 mb-6">Choose when you'd like your session</p>

                  <div className="space-y-6">
                    {/* Date Selection with inline calendar */}
                    <div className="bg-gray-50 rounded-2xl p-4">
                      <div className="flex items-center gap-2 mb-4">
                        <CalendarIcon className="w-5 h-5 text-purple-600" />
                        <label className="text-sm font-medium text-gray-900">Select Date</label>
                      </div>

                      {/* Selected date display */}
                      {selectedDay && (
                        <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-xl">
                          <div className="text-purple-600 font-semibold">
                            {selectedDay.toLocaleDateString('en-US', {
                              weekday: 'long',
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric'
                            })}
                          </div>
                        </div>
                      )}

                      {/* Inline Calendar */}
                      <div className="flex justify-center bg-white rounded-xl border border-gray-200 p-2">
                        <Calendar
                          mode="single"
                          selected={selectedDay}
                          onSelect={(d: Date | undefined) => setSelectedDay(d)}
                          disabled={(date: Date) => date < new Date(new Date().toDateString())}
                          className="rounded-xl"
                        />
                      </div>
                    </div>

                    {/* Booking Mode */}
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-3">Booking Mode</label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setBookingMode('request')}
                          className={`p-4 border-2 rounded-xl text-left transition-all ${
                            bookingMode === 'request'
                              ? 'border-purple-600 bg-purple-50'
                              : 'border-gray-200 hover:border-purple-300'
                          }`}
                        >
                          <div className={`text-sm font-medium mb-1 ${bookingMode === 'request' ? 'text-purple-600' : 'text-gray-900'}`}>
                            Request Approval
                          </div>
                          <div className="text-xs text-gray-500">Provider will confirm</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setBookingMode('instant')}
                          className={`p-4 border-2 rounded-xl text-left transition-all ${
                            bookingMode === 'instant'
                              ? 'border-purple-600 bg-purple-50'
                              : 'border-gray-200 hover:border-purple-300'
                          }`}
                        >
                          <div className={`text-sm font-medium mb-1 ${bookingMode === 'instant' ? 'text-purple-600' : 'text-gray-900'}`}>
                            Instant Booking
                          </div>
                          <div className="text-xs text-gray-500">Book immediately</div>
                        </button>
                      </div>
                    </div>

                    {/* Time Selection */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Clock className="w-5 h-5 text-purple-600" />
                        <label className="text-sm font-medium text-gray-900">Select Time</label>
                      </div>
                      {isLoadingTimes ? (
                        <div className="flex items-center justify-center py-8 bg-gray-50 rounded-xl">
                          <Loader className="w-6 h-6 animate-spin text-purple-600 mr-2" />
                          <span className="text-sm text-gray-600">Loading available times...</span>
                        </div>
                      ) : !selectedDateString ? (
                        <div className="text-center py-8 bg-gray-50 rounded-xl">
                          <CalendarIcon className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                          <p className="text-sm text-gray-600">Select a date to see available times</p>
                        </div>
                      ) : availableTimeSlots.length === 0 ? (
                        <div className="text-center py-8 bg-yellow-50 rounded-xl border border-yellow-200">
                          <AlertCircle className="w-8 h-8 text-yellow-500 mx-auto mb-2" />
                          <p className="text-sm text-yellow-700">No available time slots for this date</p>
                          <p className="text-xs text-yellow-600 mt-1">Try selecting a different date</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                          {availableTimeSlots.map((iso) => (
                            <button
                              type="button"
                              key={iso}
                              onClick={() => setSelectedTimeIso(iso)}
                              className={`px-3 py-3 border-2 rounded-xl text-sm font-medium transition-all ${
                                selectedTimeIso === iso
                                  ? 'border-purple-600 bg-purple-600 text-white'
                                  : 'border-gray-200 hover:border-purple-300 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              {new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                      <p className="text-sm text-blue-800">
                        <strong>Note:</strong> {bookingMode === 'instant' ? 'Instant bookings are accepted immediately if the slot is still available.' : 'Your booking request will be sent to the service provider for confirmation.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Review & Confirm */}
              {currentStep === 3 && (
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
                          <span className="text-gray-600">Service</span>
                          <span className="font-medium text-gray-900">{selectedServiceData?.name}</span>
                        </div>
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
                          <span className="font-medium text-gray-900">{selectedTimeLabel}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Booking Mode</span>
                          <span className="font-medium text-gray-900">
                            {bookingMode === 'instant' ? 'Instant Booking' : 'Request Approval'}
                          </span>
                        </div>
                      </div>

                      <div className="border-t border-gray-200 pt-4 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Service Fee</span>
                          <span className="text-gray-900">PHP {servicePrice.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Platform Fee (15%)</span>
                          <span className="text-gray-900">PHP {platformFee.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between font-semibold text-lg pt-2 border-t border-gray-200">
                          <span className="text-gray-900">Total</span>
                          <span className="text-purple-600">PHP {total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
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

                {/* Service */}
                {selectedServiceData && (
                  <div className="pt-4 border-t border-gray-200">
                    <div className="flex justify-between mb-2">
                      <span className="text-sm text-gray-600">Service</span>
                      <span className="text-sm text-gray-900">{selectedServiceData.name}</span>
                    </div>
                  </div>
                )}

                {/* Date & Time */}
                {selectedDateString && selectedTimeIso && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <CalendarIcon className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-900">{selectedDateString}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-900">{selectedTimeLabel}</span>
                    </div>
                  </div>
                )}

                {/* Pricing */}
                {selectedServiceData && (
                  <div className="pt-4 border-t border-gray-200 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Service Fee</span>
                      <span className="text-gray-900">${servicePrice.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Platform Fee (15%)</span>
                      <span className="text-gray-900">${platformFee.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-gray-200">
                      <span className="text-gray-900">Total</span>
                      <span className="text-purple-600">${total.toFixed(2)}</span>
                    </div>
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
                    {currentStep === 3 ? 'Confirm & Pay' : 'Continue'}
                    {currentStep < 3 && <ChevronRight className="w-5 h-5" />}
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
