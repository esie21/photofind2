import { useState } from 'react';
import { X, Mail, Chrome, Loader, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface AuthModalProps {
  mode: 'login' | 'signup';
  onClose: () => void;
  onSuccess: (role: 'client' | 'provider') => void;
}

interface FieldErrors {
  email?: string;
  password?: string;
  name?: string;
}

const validateEmail = (email: string): string | undefined => {
  if (!email) return 'Email is required';
  // Basic check: must contain @ with something before and after
  if (!email.includes('@') || email.indexOf('@') === 0 || email.indexOf('@') === email.length - 1) {
    return 'Please enter a valid email address';
  }
  return undefined;
};

const validatePassword = (password: string): string | undefined => {
  if (!password) return 'Password is required';
  if (password.length < 6) return 'Password must be at least 6 characters';
  return undefined;
};

const validateName = (name: string): string | undefined => {
  if (!name) return 'Name is required';
  if (name.length < 2) return 'Name must be at least 2 characters';
  return undefined;
};

export function AuthModal({ mode, onClose, onSuccess }: AuthModalProps) {
  const { login, signup } = useAuth();
  const toast = useToast();
  const [authStep, setAuthStep] = useState<'method' | 'role'>('method');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [selectedRole, setSelectedRole] = useState<'client' | 'provider' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const validateForm = (): boolean => {
    const errors: FieldErrors = {};

    const emailError = validateEmail(email);
    if (emailError) errors.email = emailError;

    const passwordError = validatePassword(password);
    if (passwordError) errors.password = passwordError;

    if (mode === 'signup') {
      const nameError = validateName(name);
      if (nameError) errors.name = nameError;
    }

    setFieldErrors(errors);
    setTouched({ email: true, password: true, name: true });

    return Object.keys(errors).length === 0;
  };

  const handleBlur = (field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));

    // Validate the specific field
    let error: string | undefined;
    if (field === 'email') error = validateEmail(email);
    else if (field === 'password') error = validatePassword(password);
    else if (field === 'name') error = validateName(name);

    setFieldErrors(prev => ({ ...prev, [field]: error }));
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
        setAuthStep('role');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      setError(message);
      toast.error('Login failed', message);
    } finally {
      setLoading(false);
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
          <h2 className="text-gray-900">
            {mode === 'login' ? 'Welcome Back' : 'Create Your Account'}
          </h2>
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
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (touched.password) {
                          setFieldErrors(prev => ({ ...prev, password: validatePassword(e.target.value) }));
                        }
                      }}
                      onBlur={() => handleBlur('password')}
                      placeholder="••••••••"
                      className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none ${
                        touched.password && fieldErrors.password ? 'border-red-500 bg-red-50' : 'border-gray-300'
                      }`}
                    />
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
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (touched.password) {
                          setFieldErrors(prev => ({ ...prev, password: validatePassword(e.target.value) }));
                        }
                      }}
                      onBlur={() => handleBlur('password')}
                      placeholder="••••••••"
                      className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none ${
                        touched.password && fieldErrors.password ? 'border-red-500 bg-red-50' : 'border-gray-300'
                      }`}
                    />
                    {touched.password && fieldErrors.password && (
                      <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {fieldErrors.password}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-gray-500">Must be at least 6 characters</p>
                  </div>
                )}
                {error && <p className="text-red-500 text-sm">{error}</p>}
                <button 
                  onClick={handleEmailSubmit}
                  disabled={loading}
                  className="w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors disabled:bg-gray-400 flex items-center justify-center gap-2"
                >
                  {loading && <Loader className="w-4 h-4 animate-spin" />}
                  {mode === 'login' ? 'Sign In' : 'Continue with Email'}
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
                  <button className="text-sm text-purple-600 hover:text-purple-700">
                    Forgot password?
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-gray-600 mb-6">
                How do you want to use PhotoFind?
              </p>

              <div className="space-y-4">
                <button
                  onClick={() => handleRoleSelect('client')}
                  disabled={loading}
                  className="w-full p-6 border-2 border-gray-200 rounded-2xl hover:border-purple-500 hover:bg-purple-50 transition-all text-left disabled:opacity-50"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Mail className="w-6 h-6 text-purple-600" />
                    </div>
                    <div>
                      <h3 className="text-gray-900 mb-1">I'm a Client</h3>
                      <p className="text-sm text-gray-600">
                        Looking to hire creative professionals for my projects
                      </p>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => handleRoleSelect('provider')}
                  disabled={loading}
                  className="w-full p-6 border-2 border-gray-200 rounded-2xl hover:border-purple-500 hover:bg-purple-50 transition-all text-left disabled:opacity-50"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-pink-100 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Chrome className="w-6 h-6 text-pink-600" />
                    </div>
                    <div>
                      <h3 className="text-gray-900 mb-1">I'm a Service Provider</h3>
                      <p className="text-sm text-gray-600">
                        I want to offer my creative services and grow my business
                      </p>
                    </div>
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
