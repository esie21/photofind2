import { useState } from 'react';
import { X, Mail, Loader, AlertCircle, CheckCircle, ArrowLeft } from 'lucide-react';
import { useToast } from '../context/ToastContext';

interface ForgotPasswordModalProps {
  onClose: () => void;
  onBackToLogin: () => void;
}

// Email validation - matches backend
const validateEmail = (email: string): string | undefined => {
  if (!email) return 'Email is required';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email) || email.length > 254) {
    return 'Please enter a valid email address';
  }
  return undefined;
};

export function ForgotPasswordModal({ onClose, onBackToLogin }: ForgotPasswordModalProps) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [touched, setTouched] = useState(false);
  const [success, setSuccess] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);

  const handleBlur = () => {
    setTouched(true);
    setEmailError(validateEmail(email));
  };

  const handleSubmit = async () => {
    setError(null);
    setTouched(true);

    const emailValidation = validateEmail(email);
    if (emailValidation) {
      setEmailError(emailValidation);
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/auth/forgot-password`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send reset email');
      }

      setSuccess(true);
      // In development, show the reset URL for testing
      if (data.devResetUrl) {
        setDevResetUrl(data.devResetUrl);
      }
      toast.success('Email sent!', 'Check your inbox for the password reset link.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send reset email';
      setError(message);
      toast.error('Error', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full">
        <div className="border-b border-gray-200 p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBackToLogin}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Back to login"
            >
              <ArrowLeft className="w-5 h-5 text-gray-500" />
            </button>
            <h2 className="text-gray-900">Reset Password</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6">
          {success ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Check Your Email</h3>
              <p className="text-gray-600 mb-4">
                We've sent a password reset link to <span className="font-medium">{email}</span>
              </p>
              <p className="text-sm text-gray-500 mb-6">
                Didn't receive the email? Check your spam folder or try again in a few minutes.
              </p>

              {/* Development mode: show reset URL */}
              {devResetUrl && (
                <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-xl text-left">
                  <p className="text-xs font-medium text-yellow-800 mb-2">Development Mode - Reset URL:</p>
                  <a
                    href={devResetUrl}
                    className="text-xs text-purple-600 hover:underline break-all"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {devResetUrl}
                  </a>
                </div>
              )}

              <div className="space-y-3">
                <button
                  onClick={onBackToLogin}
                  className="w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors"
                >
                  Back to Login
                </button>
                <button
                  onClick={() => {
                    setSuccess(false);
                    setEmail('');
                    setDevResetUrl(null);
                  }}
                  className="w-full py-3 text-purple-600 hover:bg-purple-50 rounded-xl transition-colors"
                >
                  Try Different Email
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-gray-600 mb-6">
                Enter your email address and we'll send you a link to reset your password.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-700 mb-2">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (touched) {
                          setEmailError(validateEmail(e.target.value));
                        }
                      }}
                      onBlur={handleBlur}
                      placeholder="your@email.com"
                      className={`w-full pl-11 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none ${
                        touched && emailError ? 'border-red-500 bg-red-50' : 'border-gray-300'
                      }`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !loading) {
                          handleSubmit();
                        }
                      }}
                    />
                  </div>
                  {touched && emailError && (
                    <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {emailError}
                    </p>
                  )}
                </div>

                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                    <p className="text-red-600 text-sm flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      {error}
                    </p>
                  </div>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading && <Loader className="w-4 h-4 animate-spin" />}
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>

                <button
                  onClick={onBackToLogin}
                  className="w-full py-3 text-gray-600 hover:bg-gray-50 rounded-xl transition-colors"
                >
                  Back to Login
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
