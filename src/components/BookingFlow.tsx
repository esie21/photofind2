import { useState } from 'react';
import { Check, Calendar, Clock, CreditCard, ChevronRight, MessageSquare, AlertCircle, Loader } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import bookingService from '../api/services/bookingService';
import { useAuth } from '../context/AuthContext';

interface BookingFlowProps {
  onComplete: () => void;
  providerId?: number;
  providerName?: string;
  providerImage?: string;
}

export function BookingFlow({ onComplete, providerId = 1, providerName = 'Sarah Johnson', providerImage = 'https://images.unsplash.com/photo-1623783356340-95375aac85ce?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3ZWRkaW5nJTIwcGhvdG9ncmFwaGVyfGVufDF8fHx8MTc2NDQwNzk1NHww&ixlib=rb-4.1.0&q=80&w=1080' }: BookingFlowProps) {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const steps = [
    { number: 1, name: 'Select Service', icon: Check },
    { number: 2, name: 'Date & Time', icon: Calendar },
    { number: 3, name: 'Payment', icon: CreditCard },
  ];

  // Map services to have IDs that match database service IDs
  const services = [
    { id: 'basic', name: 'Basic Package', duration: '4 hours', photos: '200+ photos', price: 1200, features: ['4 hours coverage', '200+ edited photos', 'Online gallery', 'Print release'] },
    { id: 'standard', name: 'Standard Package', duration: '8 hours', photos: '400+ photos', price: 2400, features: ['8 hours coverage', '400+ edited photos', 'Online gallery', 'Print release', 'Engagement session', 'USB drive'] },
    { id: 'premium', name: 'Premium Package', duration: 'Full day', photos: '600+ photos', price: 3600, features: ['Full day coverage', '600+ edited photos', 'Online gallery', 'Print release', 'Engagement session', 'USB drive', 'Second photographer', 'Premium album'] },
  ];

  const availableTimes = [
    '9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM',
    '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM',
    '5:00 PM', '6:00 PM'
  ];

  const selectedServiceData = services.find(s => s.id === selectedService);
  const platformFee = selectedServiceData ? selectedServiceData.price * 0.15 : 0;
  const total = selectedServiceData ? selectedServiceData.price + platformFee : 0;

  const canProceed = () => {
    if (currentStep === 1) return selectedService !== null;
    if (currentStep === 2) return selectedDate && selectedTime;
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

    setIsSubmitting(true);
    setError(null);

    try {
      // Convert date and time to ISO string for start_date
      const [year, month, day] = selectedDate.split('-');
      const [hourStr] = selectedTime.split(':');
      const hour = parseInt(hourStr) + (selectedTime.includes('PM') && hourStr !== '12' ? 12 : 0);
      const startDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), hour, 0, 0).toISOString();
      
      // End date is start date + duration
      const endDate = new Date(new Date(startDate).getTime() + 4 * 60 * 60 * 1000).toISOString();

      const bookingData = {
        provider_id: Number(providerId),
        service_id: 1, // Using 1 as default; in production would map service name to DB id
        start_date: startDate,
        end_date: endDate,
        total_price: Number(total.toFixed(2)),
      };

      console.log('Submitting booking:', bookingData);
      await bookingService.createBooking(bookingData);
      
      setSuccess(true);
      setTimeout(() => {
        onComplete();
      }, 2000);
    } catch (err: any) {
      console.error('Booking error:', err);
      const errorMsg = err?.message || 'Failed to create booking. Please try again.';
      setError(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
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
              <p className="text-sm text-green-700 mt-1">Your booking request has been sent to the provider. Redirecting...</p>
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
                            <div className="text-purple-600">${service.price}</div>
                            <div className="text-xs text-gray-500">+ platform fee</div>
                          </div>
                        </div>
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
                </div>
              )}

              {/* Step 2: Date & Time */}
              {currentStep === 2 && (
                <div>
                  <h2 className="text-gray-900 mb-2">Select Date & Time</h2>
                  <p className="text-gray-600 mb-6">Choose when you'd like your session</p>

                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm text-gray-700 mb-2">Select Date</label>
                      <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        min={new Date().toISOString().split('T')[0]}
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-sm text-gray-700 mb-2">Select Time</label>
                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                        {availableTimes.map((time) => (
                          <button
                            key={time}
                            onClick={() => setSelectedTime(time)}
                            className={`px-4 py-3 border-2 rounded-xl text-sm transition-all ${
                              selectedTime === time
                                ? 'border-purple-600 bg-purple-50 text-purple-600'
                                : 'border-gray-200 hover:border-purple-300 text-gray-700'
                            }`}
                          >
                            {time}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                      <p className="text-sm text-blue-800">
                        <strong>Note:</strong> Your booking request will be sent to the service provider for confirmation. 
                        You'll receive a notification once it's confirmed.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Payment */}
              {currentStep === 3 && (
                <div>
                  <h2 className="text-gray-900 mb-2">Payment Information</h2>
                  <p className="text-gray-600 mb-6">Complete your booking with secure payment</p>

                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm text-gray-700 mb-2">Card Number</label>
                      <input
                        type="text"
                        placeholder="1234 5678 9012 3456"
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-gray-700 mb-2">Expiry Date</label>
                        <input
                          type="text"
                          placeholder="MM/YY"
                          className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-700 mb-2">CVV</label>
                        <input
                          type="text"
                          placeholder="123"
                          className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm text-gray-700 mb-2">Cardholder Name</label>
                      <input
                        type="text"
                        placeholder="John Doe"
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                      />
                    </div>

                    <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                      <div className="flex items-start gap-3">
                        <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-green-800">
                          <p className="mb-1"><strong>Secure Payment</strong></p>
                          <p>Your payment information is encrypted and secure. You won't be charged until the provider confirms your booking.</p>
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
                {selectedDate && selectedTime && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-900">{selectedDate}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-900">{selectedTime}</span>
                    </div>
                  </div>
                )}

                {/* Pricing */}
                {selectedServiceData && (
                  <div className="pt-4 border-t border-gray-200 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Service Fee</span>
                      <span className="text-gray-900">${selectedServiceData.price}</span>
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
                    {currentStep === 3 ? 'Complete Booking' : 'Continue'}
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
