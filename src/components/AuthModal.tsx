import { useState, useEffect } from 'react';
import { X, Mail, Chrome, Loader, AlertCircle, Eye, EyeOff, ArrowLeft, Check, Camera, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface AuthModalProps {
  mode: 'login' | 'signup';
  onClose: () => void;
  onSuccess: (role: 'client' | 'provider') => void;
  onForgotPassword?: () => void;
}

interface FieldErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
  name?: string;
}

// Email validation - matches backend regex
const validateEmail = (email: string): string | undefined => {
  if (!email) return 'Email is required';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email) || email.length > 254) {
    return 'Please enter a valid email address';
  }
  return undefined;
};

// Password validation - matches backend requirements
const validatePassword = (password: string, isSignup: boolean = false): string | undefined => {
  if (!password) return 'Password is required';
  if (isSignup) {
    if (password.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
    if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
    if (!/[0-9]/.test(password)) return 'Password must contain a number';
  } else {
    // For login, just check it's not empty
    if (password.length < 1) return 'Password is required';
  }
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

const validateName = (name: string): string | undefined => {
  if (!name) return 'Name is required';
  if (name.trim().length < 2) return 'Name must be at least 2 characters';
  if (name.trim().length > 100) return 'Name must be less than 100 characters';
  return undefined;
};

export function AuthModal({ mode, onClose, onSuccess, onForgotPassword }: AuthModalProps) {
  const { login, signup } = useAuth();
  const toast = useToast();
  const [authStep, setAuthStep] = useState<'method' | 'role'>('method');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [selectedRole, setSelectedRole] = useState<'client' | 'provider' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);

  // Reset form when modal opens or mode changes
  useEffect(() => {
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setName('');
    setSelectedRole(null);
    setAuthStep('method');
    setError(null);
    setFieldErrors({});
    setTouched({});
    setShowPassword(false);
    setShowConfirmPassword(false);
  }, [mode]);

  const passwordStrength = getPasswordStrength(password);

  const validateForm = (): boolean => {
    const errors: FieldErrors = {};

    const emailError = validateEmail(email);
    if (emailError) errors.email = emailError;

    const passwordError = validatePassword(password, mode === 'signup');
    if (passwordError) errors.password = passwordError;

    if (mode === 'signup') {
      const nameError = validateName(name);
      if (nameError) errors.name = nameError;

      const confirmError = validateConfirmPassword(password, confirmPassword);
      if (confirmError) errors.confirmPassword = confirmError;
    }

    setFieldErrors(errors);
    setTouched({ email: true, password: true, name: true, confirmPassword: true });

    return Object.keys(errors).length === 0;
  };

  const handleBlur = (field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));

    // Validate the specific field
    let error: string | undefined;
    if (field === 'email') error = validateEmail(email);
    else if (field === 'password') error = validatePassword(password, mode === 'signup');
    else if (field === 'confirmPassword') error = validateConfirmPassword(password, confirmPassword);
    else if (field === 'name') error = validateName(name);

    setFieldErrors(prev => ({ ...prev, [field]: error }));
  };

  const handleBackToForm = () => {
    setAuthStep('method');
    setError(null);
    setSelectedRole(null);
  };

  const checkEmailAvailability = async (emailToCheck: string): Promise<boolean> => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/auth/check-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToCheck }),
      });
      const data = await response.json();
      return data.available;
    } catch {
      // If check fails, proceed anyway (backend will catch it)
      return true;
    }
  };

  const handleEmailSubmit = async () => {
    setError(null);

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      if (mode === 'login') {
        const response = await login(email, password);
        toast.success('Welcome back!', `Signed in as ${response.name || email}`);
        onSuccess(response.role as 'client' | 'provider');
        onClose();
      } else {
        // Check email availability before proceeding to role selection
        setCheckingEmail(true);
        const available = await checkEmailAvailability(email);
        setCheckingEmail(false);

        if (!available) {
          setFieldErrors(prev => ({ ...prev, email: 'This email is already registered. Try logging in instead.' }));
          setError('Email already registered');
          setLoading(false);
          return;
        }

        setAuthStep('role');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      setError(message);
      toast.error('Login failed', message);
    } finally {
      setLoading(false);
      setCheckingEmail(false);
    }
  };

  const handleRoleSelect = async (role: 'client' | 'provider') => {
    setSelectedRole(role);
    setError(null);
    setLoading(true);

    try {
      const response = await signup({
        email,
        password,
        name,
        role,
      });
      toast.success('Account created!', `Welcome to PhotoFind, ${name}!`);
      onSuccess(role);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Signup failed';
      setError(message);
      toast.error('Signup failed', message);
    } finally {
      setLoading(false);
    }
  };

  const handleMethodSubmit = async (method: 'google') => {
    setError(null);
    setLoading(true);
    try {
      if (method === 'google') {
        setError('Google sign-in is not configured yet');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Method failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {authStep === 'role' && (
              <button
                onClick={handleBackToForm}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title="Go back"
              >
                <ArrowLeft className="w-5 h-5 text-gray-500" />
              </button>
            )}
            <h2 className="text-gray-900">
              {mode === 'login' ? 'Welcome Back' : authStep === 'role' ? 'Choose Your Role' : 'Create Your Account'}
            </h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6">
          {authStep === 'method' ? (
            <>
              <p className="text-gray-600 mb-6">
                {mode === 'login' 
                  ? 'Choose your preferred login method' 
                  : 'Choose how you want to sign up'}
              </p>

              {/* Email */}
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm text-gray-700 mb-2">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (touched.email) {
                          setFieldErrors(prev => ({ ...prev, email: validateEmail(e.target.value) }));
                        }
                      }}
                      onBlur={() => handleBlur('email')}
                      placeholder="your@email.com"
                      className={`w-full pl-11 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none ${
                        touched.email && fieldErrors.email ? 'border-red-500 bg-red-50' : 'border-gray-300'
                      }`}
                    />
                  </div>
                  {touched.email && fieldErrors.email && (
                    <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {fieldErrors.email}
                    </p>
                  )}
                </div>
                {mode === 'login' && (
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (touched.password) {
                            setFieldErrors(prev => ({ ...prev, password: validatePassword(e.target.value, false) }));
                          }
                        }}
                        onBlur={() => handleBlur('password')}
                        placeholder="••••••••"
                        className={`w-full px-4 py-3 pr-12 border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none ${
                          touched.password && fieldErrors.password ? 'border-red-500 bg-red-50' : 'border-gray-300'
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
                    {touched.password && fieldErrors.password && (
                      <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {fieldErrors.password}
                      </p>
                    )}
                  </div>
                )}
                {mode === 'signup' && authStep === 'method' && (
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Full Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (touched.name) {
                          setFieldErrors(prev => ({ ...prev, name: validateName(e.target.value) }));
                        }
                      }}
                      onBlur={() => handleBlur('name')}
                      placeholder="Your name"
                      className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none ${
                        touched.name && fieldErrors.name ? 'border-red-500 bg-red-50' : 'border-gray-300'
                      }`}
                    />
                    {touched.name && fieldErrors.name && (
                      <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {fieldErrors.name}
                      </p>
                    )}
                  </div>
                )}
                {mode === 'signup' && authStep === 'method' && (
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (touched.password) {
                            setFieldErrors(prev => ({ ...prev, password: validatePassword(e.target.value, true) }));
                          }
                          // Also validate confirm password if it's been touched
                          if (touched.confirmPassword && confirmPassword) {
                            setFieldErrors(prev => ({ ...prev, confirmPassword: validateConfirmPassword(e.target.value, confirmPassword) }));
                          }
                        }}
                        onBlur={() => handleBlur('password')}
                        placeholder="••••••••"
                        className={`w-full px-4 py-3 pr-12 border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none ${
                          touched.password && fieldErrors.password ? 'border-red-500 bg-red-50' : 'border-gray-300'
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
                    {touched.password && fieldErrors.password && (
                      <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {fieldErrors.password}
                      </p>
                    )}
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
                )}
                {mode === 'signup' && authStep === 'method' && (
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Confirm Password</label>
                    <div className="relative">
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          if (touched.confirmPassword) {
                            setFieldErrors(prev => ({ ...prev, confirmPassword: validateConfirmPassword(password, e.target.value) }));
                          }
                        }}
                        onBlur={() => handleBlur('confirmPassword')}
                        placeholder="••••••••"
                        className={`w-full px-4 py-3 pr-12 border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none ${
                          touched.confirmPassword && fieldErrors.confirmPassword ? 'border-red-500 bg-red-50' :
                          touched.confirmPassword && !fieldErrors.confirmPassword && confirmPassword ? 'border-green-500 bg-green-50' : 'border-gray-300'
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
                    {touched.confirmPassword && fieldErrors.confirmPassword && (
                      <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {fieldErrors.confirmPassword}
                      </p>
                    )}
                    {touched.confirmPassword && !fieldErrors.confirmPassword && confirmPassword && (
                      <p className="mt-1 text-sm text-green-600 flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" />
                        Passwords match
                      </p>
                    )}
                  </div>
                )}
                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                    <p className="text-red-600 text-sm flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      {error}
                    </p>
                  </div>
                )}
                <button
                  onClick={handleEmailSubmit}
                  disabled={loading || checkingEmail}
                  className="w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {(loading || checkingEmail) && <Loader className="w-4 h-4 animate-spin" />}
                  {checkingEmail ? 'Checking...' : mode === 'login' ? 'Sign In' : 'Continue'}
                </button>
              </div>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-white text-gray-500">or</span>
                </div>
              </div>

              {/* Social Options */}
              <div className="space-y-3">
                <button 
                  onClick={() => handleMethodSubmit('google')}
                  className="w-full py-3 px-4 border-2 border-gray-200 rounded-xl hover:bg-gray-50 transition-colors flex items-center justify-center gap-3"
                >
                  <Chrome className="w-5 h-5 text-gray-700" />
                  <span className="text-gray-700">Continue with Google</span>
                </button>
              </div>

              {mode === 'login' && (
                <div className="mt-6 text-center">
                  <button
                    onClick={() => {
                      if (onForgotPassword) {
                        onForgotPassword();
                      }
                    }}
                    className="text-sm text-purple-600 hover:text-purple-700 hover:underline transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-gray-600 mb-2">
                How do you want to use PhotoFind?
              </p>
              <p className="text-sm text-gray-500 mb-6">
                Creating account for <span className="font-medium text-gray-700">{email}</span>
              </p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-red-600 text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {error}
                  </p>
                </div>
              )}

              <div className="space-y-4">
                <button
                  onClick={() => handleRoleSelect('client')}
                  disabled={loading}
                  className={`w-full p-6 border-2 rounded-2xl transition-all text-left disabled:opacity-50 ${
                    selectedRole === 'client'
                      ? 'border-purple-500 bg-purple-50'
                      : 'border-gray-200 hover:border-purple-500 hover:bg-purple-50'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center flex-shrink-0">
                      <User className="w-6 h-6 text-purple-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-gray-900 mb-1 font-medium">I'm a Client</h3>
                      <p className="text-sm text-gray-600">
                        Looking to hire creative professionals for my projects
                      </p>
                    </div>
                    {loading && selectedRole === 'client' && (
                      <Loader className="w-5 h-5 animate-spin text-purple-600" />
                    )}
                  </div>
                </button>

                <button
                  onClick={() => handleRoleSelect('provider')}
                  disabled={loading}
                  className={`w-full p-6 border-2 rounded-2xl transition-all text-left disabled:opacity-50 ${
                    selectedRole === 'provider'
                      ? 'border-pink-500 bg-pink-50'
                      : 'border-gray-200 hover:border-pink-500 hover:bg-pink-50'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-pink-100 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Camera className="w-6 h-6 text-pink-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-gray-900 mb-1 font-medium">I'm a Service Provider</h3>
                      <p className="text-sm text-gray-600">
                        I want to offer my creative services and grow my business
                      </p>
                    </div>
                    {loading && selectedRole === 'provider' && (
                      <Loader className="w-5 h-5 animate-spin text-pink-600" />
                    )}
                  </div>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
