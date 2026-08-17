import { useEffect, useRef, useState } from 'react';
import { Lock, X, Eye, EyeOff, Loader2, AlertCircle, CheckCircle, Check } from 'lucide-react';
import authService from '../api/services/authService';
import { useModal } from '../hooks/useModal';
import { useToast } from '../context/ToastContext';

interface ChangePasswordModalProps {
  /** False for a Google account that has never set a real password (see authService.User). */
  hasPassword: boolean;
  onClose: () => void;
  /** Called once the password has actually changed, so the caller can refresh the user. */
  onChanged: () => void;
}

// Mirrors backend/src/middleware/security.ts's isStrongPassword, same as ResetPasswordPage.
const validatePassword = (password: string): string | undefined => {
  if (!password) return 'Password is required';
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain a number';
  return undefined;
};

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

export function ChangePasswordModal({ hasPassword, onClose, onChanged }: ChangePasswordModalProps) {
  const toast = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [currentPasswordError, setCurrentPasswordError] = useState<string | undefined>();
  const [newPasswordError, setNewPasswordError] = useState<string | undefined>();
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | undefined>();

  const passwordStrength = getPasswordStrength(newPassword);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { overlayProps, cardProps } = useModal(onClose, {
    closeOnEscape: !loading && !success,
    closeOnBackdrop: !loading && !success,
    labelledBy: 'change-password-title',
  });

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const handleBlur = (field: 'currentPassword' | 'newPassword' | 'confirmPassword') => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    if (field === 'currentPassword') {
      setCurrentPasswordError(hasPassword && !currentPassword ? 'Current password is required' : undefined);
    } else if (field === 'newPassword') {
      setNewPasswordError(validatePassword(newPassword));
    } else {
      setConfirmPasswordError(validateConfirmPassword(newPassword, confirmPassword));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTouched({ currentPassword: true, newPassword: true, confirmPassword: true });

    const currentErr = hasPassword && !currentPassword ? 'Current password is required' : undefined;
    const newErr = validatePassword(newPassword);
    const confirmErr = validateConfirmPassword(newPassword, confirmPassword);

    setCurrentPasswordError(currentErr);
    setNewPasswordError(newErr);
    setConfirmPasswordError(confirmErr);

    if (currentErr || newErr || confirmErr) return;

    setLoading(true);
    try {
      await authService.changePassword({
        currentPassword: hasPassword ? currentPassword : undefined,
        newPassword,
      });
      setSuccess(true);
      toast.success('Password updated', 'Use your new password next time you sign in.');
      onChanged();
      closeTimer.current = setTimeout(onClose, 1800);
    } catch (err: any) {
      setError(err?.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  const fieldClass = (hasError: boolean) =>
    `w-full px-4 py-3 pr-12 border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none ${
      hasError ? 'border-red-500 bg-red-50' : 'border-gray-300'
    }`;

  return (
    <div className="modal-overlay" {...overlayProps}>
      <div className="modal-card modal-card--md modal-card--plain" {...cardProps}>
        {!success && (
          <div className="modal-header flex items-center justify-between p-6 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Lock className="w-5 h-5 text-purple-600" />
              </div>
              <h3 id="change-password-title" className="text-lg font-semibold text-gray-900">
                Change password
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              aria-label="Close"
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        )}

        {success ? (
          <div className="p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Password updated</h3>
            <p className="text-gray-600">You're all set - use your new password next time you sign in.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="p-6 space-y-4">
            {!hasPassword && (
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-sm text-purple-800">
                You signed in with Google, so there's no current password to enter. Set one below and
                you'll also be able to sign in with your email and this password.
              </div>
            )}

            {hasPassword && (
              <div>
                <label className="block text-sm text-gray-700 mb-2">Current password</label>
                <div className="relative">
                  <input
                    ref={firstFieldRef}
                    type={showCurrent ? 'text' : 'password'}
                    value={currentPassword}
                    autoComplete="current-password"
                    onChange={(e) => {
                      setCurrentPassword(e.target.value);
                      if (touched.currentPassword) setCurrentPasswordError(e.target.value ? undefined : 'Current password is required');
                    }}
                    onBlur={() => handleBlur('currentPassword')}
                    placeholder="••••••••"
                    className={fieldClass(Boolean(touched.currentPassword && currentPasswordError))}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                    tabIndex={-1}
                  >
                    {showCurrent ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                {touched.currentPassword && currentPasswordError && (
                  <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {currentPasswordError}
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm text-gray-700 mb-2">New password</label>
              <div className="relative">
                <input
                  ref={hasPassword ? undefined : firstFieldRef}
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  autoComplete="new-password"
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (touched.newPassword) setNewPasswordError(validatePassword(e.target.value));
                    if (touched.confirmPassword && confirmPassword) {
                      setConfirmPasswordError(validateConfirmPassword(e.target.value, confirmPassword));
                    }
                  }}
                  onBlur={() => handleBlur('newPassword')}
                  placeholder="••••••••"
                  className={fieldClass(Boolean(touched.newPassword && newPasswordError))}
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showNew ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>

              {newPassword && (
                <div className="mt-2 flex items-center gap-2">
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
              )}

              {touched.newPassword && newPasswordError && (
                <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {newPasswordError}
                </p>
              )}

              <div className="mt-2 space-y-1">
                <p className={`text-xs flex items-center gap-1 ${newPassword.length >= 8 ? 'text-green-600' : 'text-gray-500'}`}>
                  {newPassword.length >= 8 ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-gray-300 inline-block" />}
                  At least 8 characters
                </p>
                <p className={`text-xs flex items-center gap-1 ${/[A-Z]/.test(newPassword) ? 'text-green-600' : 'text-gray-500'}`}>
                  {/[A-Z]/.test(newPassword) ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-gray-300 inline-block" />}
                  One uppercase letter
                </p>
                <p className={`text-xs flex items-center gap-1 ${/[a-z]/.test(newPassword) ? 'text-green-600' : 'text-gray-500'}`}>
                  {/[a-z]/.test(newPassword) ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-gray-300 inline-block" />}
                  One lowercase letter
                </p>
                <p className={`text-xs flex items-center gap-1 ${/[0-9]/.test(newPassword) ? 'text-green-600' : 'text-gray-500'}`}>
                  {/[0-9]/.test(newPassword) ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-gray-300 inline-block" />}
                  One number
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-700 mb-2">Confirm new password</label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  autoComplete="new-password"
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (touched.confirmPassword) setConfirmPasswordError(validateConfirmPassword(newPassword, e.target.value));
                  }}
                  onBlur={() => handleBlur('confirmPassword')}
                  placeholder="••••••••"
                  className={fieldClass(Boolean(touched.confirmPassword && confirmPasswordError))}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
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
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Updating...' : hasPassword ? 'Update password' : 'Set password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default ChangePasswordModal;
