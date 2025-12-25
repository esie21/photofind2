import { X, Home, Search, Calendar, User, Settings, LogOut, Shield, LayoutDashboard } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
  onViewChange: (view: 'landing' | 'client' | 'provider' | 'booking' | 'admin') => void;
  currentView: string;
}

export function MobileNav({ isOpen, onClose, onViewChange, currentView }: MobileNavProps) {
  const { user, logout } = useAuth();

  const handleNavigate = (view: 'landing' | 'client' | 'provider' | 'booking' | 'admin') => {
    onViewChange(view);
    onClose();
  };

  const handleLogout = () => {
    logout();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50 md:hidden"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 w-72 bg-white shadow-xl z-50 md:hidden transform transition-transform duration-300 ease-in-out">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
              <span className="text-white font-semibold">PF</span>
            </div>
            <span className="font-semibold text-gray-900">PhotoFind</span>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* User Info */}
        {user && (
          <div className="p-4 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-pink-400 rounded-full flex items-center justify-center">
                <span className="text-white text-lg font-medium">
                  {user.name ? user.name.slice(0, 1).toUpperCase() : 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{user.name || user.email}</p>
                <p className="text-xs text-gray-500 capitalize">{user.role}</p>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Links */}
        <nav className="p-4 space-y-1">
          <button
            onClick={() => handleNavigate('landing')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors ${
              currentView === 'landing'
                ? 'bg-purple-50 text-purple-600'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Home className="w-5 h-5" />
            <span className="font-medium">Home</span>
          </button>

          {user && (
            <>
              <button
                onClick={() => handleNavigate('client')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors ${
                  currentView === 'client'
                    ? 'bg-purple-50 text-purple-600'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Search className="w-5 h-5" />
                <span className="font-medium">Browse Services</span>
              </button>

              {user.role === 'provider' && (
                <button
                  onClick={() => handleNavigate('provider')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors ${
                    currentView === 'provider'
                      ? 'bg-purple-50 text-purple-600'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <LayoutDashboard className="w-5 h-5" />
                  <span className="font-medium">Provider Dashboard</span>
                </button>
              )}

              {user.role === 'admin' && (
                <button
                  onClick={() => handleNavigate('admin')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors ${
                    currentView === 'admin'
                      ? 'bg-purple-50 text-purple-600'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Shield className="w-5 h-5" />
                  <span className="font-medium">Admin Panel</span>
                </button>
              )}
            </>
          )}
        </nav>

        {/* Footer Actions */}
        {user && (
          <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200 bg-white">
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-red-600 hover:bg-red-50 rounded-xl transition-colors"
            >
              <LogOut className="w-5 h-5" />
              <span className="font-medium">Sign Out</span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
