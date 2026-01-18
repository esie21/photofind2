import { useState, useEffect } from 'react';
import { Eye, EyeOff, Loader, AlertCircle, CheckCircle, Check, XCircle } from 'lucide-react';
import { useToast } from '../context/ToastContext';

// Simple navigation helper (no react-router)
const navigateToHome = () => {
  window.history.pushState({}, '', '/');
  window.location.reload();
};

// Get URL search params
const getSearchParams = () => new URLSearchParams(window.location.search);

// Password validation - matches backend requirements
const validatePassword = (password: string): string | undefined => {
  if (!password) return 'Password is required';
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain a number';
  return undefined;
};

// Password strength calculator
const getPasswordStrength = (password: string): { score: number; label: string; color: string } => {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 2) return { score, label: 'Weak', color: 'bg-red-500' };
  if (score <= 4) return { score, label: 'Medium', color: 'bg-yellow-500' };
  return { score, label: 'Strong', color: 'bg-green-500' };
};

const validateConfirmPassword = (password: string, confirmPassword: string): string | undefined => {
  if (!confirmPassword) return 'Please confirm your password';
  if (password !== confirmPassword) return 'Passwords do not match';
  return undefined;
};

export function ResetPasswordPage() {
  const toast = useToast();
  const searchParams = getSearchParams();
  const token = searchParams.get('token');

  const [verifying, setVerifying] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | undefined>();
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const passwordStrength = getPasswordStrength(password);

  // Verify token on mount
  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setTokenError('No reset token provided');
        setVerifying(false);
        return;
      }

      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/auth/verify-reset-token?token=${encodeURIComponent(token)}`
        );
        const data = await response.json();

        if (data.valid) {
          setTokenValid(true);
          setUserEmail(data.email);
        } else {
          setTokenError(data.error || 'Invalid or expired reset link');
        }
      } catch (err) {
        setTokenError('Failed to verify reset link. Please try again.');
      } finally {
        setVerifying(false);
      }
    };

    verifyToken();
  }, [token]);

  const handleBlur = (field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));

    if (field === 'password') {
      setPasswordError(validatePassword(password));
    } else if (field === 'confirmPassword') {
      setConfirmPasswordError(validateConfirmPassword(password, confirmPassword));
    }
  };

  const handleSubmit = async () => {
    setError(null);
    setTouched({ password: true, confirmPassword: true });

    const passError = validatePassword(password);
    const confirmError = validateConfirmPassword(password, confirmPassword);

    setPasswordError(passError);
    setConfirmPasswordError(confirmError);

    if (passError || confirmError) {
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/auth/reset-password`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }

      setSuccess(true);
      toast.success('Password reset!', 'You can now log in with your new password.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reset password';
      setError(message);
      toast.error('Error', message);
    } finally {
      setLoading(false);
    }
  };

  // Loading state
  if (verifying) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8 text-center">
          <Loader className="w-12 h-12 text-purple-600 animate-spin mx-auto mb-4" />
          <h2 className="text-xl text-gray-900 mb-2">Verifying Reset Link</h2>
          <p className="text-gray-600">Please wait while we verify your reset link...</p>
        </div>
      </div>
    );
  }

  // Invalid/expired token
  if (!tokenValid) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <XCircle className="w-8 h-8 text-red-600" />
          </div>
          <h2 className="text-xl text-gray-900 mb-2">Invalid Reset Link</h2>
          <p className="text-gray-600 mb-6">{tokenError}</p>
          <button
            onClick={() => navigateToHome()}
            className="w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl text-gray-900 mb-2">Password Reset Successful!</h2>
          <p className="text-gray-600 mb-6">
            Your password has been reset. You can now log in with your new password.
          </p>
          <button
            onClick={() => navigateToHome()}
            className="w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  // Reset password form
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Set New Password</h2>
          {userEmail && (
            <p className="text-gray-600">
              For account: <span className="font-medium">{userEmail}</span>
            </p>
          )}
        </div>

        <div className="space-y-4">
          {/* New Password */}
          <div>
            <label className="block text-sm text-gray-700 mb-2">New Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (touched.password) {
                    setPasswordError(validatePassword(e.target.value));
                  }
                  if (touched.confirmPassword && confirmPassword) {
                    setConfirmPasswordError(validateConfirmPassword(e.target.value, confirmPassword));
                  }
                }}
                onBlur={() => handleBlur('password')}
                placeholder="••••••••"
                className={`w-full px-4 py-3 pr-12 border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none ${
                  touched.password && passwordError ? 'border-red-500 bg-red-50' : 'border-gray-300'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            {/* Password strength indicator */}
            {password && (
              <div className="mt-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${passwordStrength.color} transition-all duration-300`}
                      style={{ width: `${(passwordStrength.score / 6) * 100}%` }}
                    />
                  </div>
                  <span className={`text-xs font-medium ${
                    passwordStrength.label === 'Weak' ? 'text-red-600' :
                    passwordStrength.label === 'Medium' ? 'text-yellow-600' : 'text-green-600'
                  }`}>
                    {passwordStrength.label}
                  </span>
                </div>
              </div>
            )}

            {touched.password && passwordError && (
              <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                {passwordError}
              </p>
            )}

            {/* Password requirements */}
            <div className="mt-2 space-y-1">
              <p className={`text-xs flex items-center gap-1 ${password.length >= 8 ? 'text-green-600' : 'text-gray-500'}`}>
                {password.length >= 8 ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-gray-300 inline-block" />}
                At least 8 characters
              </p>
              <p className={`text-xs flex items-center gap-1 ${/[A-Z]/.test(password) ? 'text-green-600' : 'text-gray-500'}`}>
                {/[A-Z]/.test(password) ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-gray-300 inline-block" />}
                One uppercase letter
              </p>
              <p className={`text-xs flex items-center gap-1 ${/[a-z]/.test(password) ? 'text-green-600' : 'text-gray-500'}`}>
                {/[a-z]/.test(password) ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-gray-300 inline-block" />}
                One lowercase letter
              </p>
              <p className={`text-xs flex items-center gap-1 ${/[0-9]/.test(password) ? 'text-green-600' : 'text-gray-500'}`}>
                {/[0-9]/.test(password) ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-gray-300 inline-block" />}
                One number
              </p>
            </div>
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-sm text-gray-700 mb-2">Confirm New Password</label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (touched.confirmPassword) {
                    setConfirmPasswordError(validateConfirmPassword(password, e.target.value));
                  }
                }}
                onBlur={() => handleBlur('confirmPassword')}
                placeholder="••••••••"
                className={`w-full px-4 py-3 pr-12 border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none ${
                  touched.confirmPassword && confirmPasswordError ? 'border-red-500 bg-red-50' :
                  touched.confirmPassword && !confirmPasswordError && confirmPassword ? 'border-green-500 bg-green-50' : 'border-gray-300'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
              >
                {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {touched.confirmPassword && confirmPasswordError && (
              <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                {confirmPasswordError}
              </p>
            )}
            {touched.confirmPassword && !confirmPasswordError && confirmPassword && (
              <p className="mt-1 text-sm text-green-600 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                Passwords match
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
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>

          <button
            onClick={() => navigateToHome()}
            className="w-full py-3 text-gray-600 hover:bg-gray-50 rounded-xl transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
