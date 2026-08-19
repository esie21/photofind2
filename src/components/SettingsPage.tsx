import { useState } from 'react';
import { Lock, Bell, Shield, FileText } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ChangePasswordModal } from './ChangePasswordModal';

interface SettingsPageProps {
  onGoToTerms?: () => void;
}

export function SettingsPage({ onGoToTerms }: SettingsPageProps = {}) {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [bookingReminders, setBookingReminders] = useState(true);
  const [showChangePassword, setShowChangePassword] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-gray-900 mb-1">Settings & Privacy</h1>
        <p className="text-sm text-gray-500 mb-8">Manage your account, notifications, and privacy preferences.</p>

        <div className="space-y-6">
          {/* Account */}
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <h2 className="text-gray-900 mb-4">Account</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-gray-600">Full name</span>
                <span className="text-sm text-gray-900">{user?.name || '—'}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-gray-100">
                <span className="text-sm text-gray-600">Email</span>
                <span className="text-sm text-gray-900">{user?.email || '—'}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-gray-100">
                <span className="text-sm text-gray-600">Account type</span>
                <span className="text-sm text-gray-900">
                  {user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Security */}
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <h2 className="text-gray-900 mb-4">Security</h2>
            <button
              onClick={() => setShowChangePassword(true)}
              className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors text-left"
            >
              <span className="w-9 h-9 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0">
                <Lock className="w-4 h-4" />
              </span>
              <div className="flex-1">
                <div className="text-sm text-gray-900">Change password</div>
                <div className="text-xs text-gray-500">
                  {user?.has_password === false
                    ? "You signed in with Google - set a password to also sign in with email"
                    : 'Update the password you use to sign in'}
                </div>
              </div>
            </button>
          </div>

          {/* Notifications */}
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <h2 className="text-gray-900 mb-4">Notifications</h2>
            <div className="space-y-2">
              <label className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 transition-colors cursor-pointer">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0">
                    <Bell className="w-4 h-4" />
                  </span>
                  <div>
                    <div className="text-sm text-gray-900">Email notifications</div>
                    <div className="text-xs text-gray-500">Booking updates and messages</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={emailNotifications}
                  onChange={(e) => setEmailNotifications(e.target.checked)}
                  className="w-4 h-4" style={{ accentColor: "#9333ea" }}
                />
              </label>
              <label className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 transition-colors cursor-pointer">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0">
                    <Bell className="w-4 h-4" />
                  </span>
                  <div>
                    <div className="text-sm text-gray-900">Booking reminders</div>
                    <div className="text-xs text-gray-500">Reminders before upcoming sessions</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={bookingReminders}
                  onChange={(e) => setBookingReminders(e.target.checked)}
                  className="w-4 h-4" style={{ accentColor: "#9333ea" }}
                />
              </label>
            </div>
          </div>

          {/* Privacy */}
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <h2 className="text-gray-900 mb-4">Privacy</h2>
            <button
              onClick={() => toast.info('Coming soon', 'Privacy controls will be available here soon.')}
              className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors text-left"
            >
              <span className="w-9 h-9 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0">
                <Shield className="w-4 h-4" />
              </span>
              <div className="flex-1">
                <div className="text-sm text-gray-900">Data & privacy</div>
                <div className="text-xs text-gray-500">Control what's visible to others</div>
              </div>
            </button>
          </div>

          {/* Legal */}
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <h2 className="text-gray-900 mb-4">Legal</h2>
            <button
              onClick={() => onGoToTerms?.()}
              disabled={!onGoToTerms}
              className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors text-left disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span className="w-9 h-9 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4" />
              </span>
              <div className="flex-1">
                <div className="text-sm text-gray-900">Terms & Conditions</div>
                <div className="text-xs text-gray-500">Read the terms you agreed to when you signed up</div>
              </div>
            </button>
          </div>
        </div>
      </div>

      {showChangePassword && (
        <ChangePasswordModal
          hasPassword={user?.has_password !== false}
          onClose={() => setShowChangePassword(false)}
          onChanged={() => { refreshUser(); }}
        />
      )}
    </div>
  );
}

export default SettingsPage;
