import { Bell, Menu, User, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface HeaderProps {
  onViewChange: (view: 'landing' | 'client' | 'provider' | 'booking' | 'admin') => void;
  currentView: string;
  onAuthClick: (mode: 'login' | 'signup') => void;
}

export function Header({ onViewChange, currentView, onAuthClick }: HeaderProps) {
  const { user, logout } = useAuth();
  const isLoggedIn = !!user;

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-8">
            <button 
              onClick={() => onViewChange('landing')}
              className="flex items-center gap-2"
            >
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                <span className="text-white">PF</span>
              </div>
              <span className="text-gray-900">PhotoFind</span>
            </button>

            {/* Navigation - Desktop */}
            {isLoggedIn && (
              <nav className="hidden md:flex items-center gap-6">
                <button 
                  onClick={() => onViewChange('client')}
                  className={`text-sm ${currentView === 'client' ? 'text-purple-600' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  Browse Services
                </button>
                <button 
                  onClick={() => onViewChange('provider')}
                  className={`text-sm ${currentView === 'provider' ? 'text-purple-600' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  Provider Dashboard
                </button>
                <button 
                  onClick={() => onViewChange('admin')}
                  className={`text-sm ${currentView === 'admin' ? 'text-purple-600' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  Admin
                </button>
              </nav>
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-4">
            {!isLoggedIn ? (
              <>
                <button 
                  onClick={() => onAuthClick('login')}
                  className="text-sm text-gray-700 hover:text-gray-900"
                >
                  Log In
                </button>
                <button 
                  onClick={() => onAuthClick('signup')}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
                >
                  Sign Up
                </button>
              </>
            ) : (
              <>
                <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg relative">
                  <Bell className="w-5 h-5" />
                  <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
                </button>
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 bg-gradient-to-br from-purple-400 to-pink-400 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm">{user?.name ? user.name.slice(0,1).toUpperCase() : 'U'}</span>
                  </div>
                  <div className="hidden sm:flex flex-col text-left">
                    <span className="text-sm text-gray-900">{user?.name || user?.email}</span>
                    <span className="text-xs text-gray-500">{user?.role}</span>
                  </div>
                  <button
                    onClick={() => logout()}
                    className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                    title="Logout"
                  >
                    <LogOut className="w-5 h-5" />
                  </button>
                </div>
                <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg md:hidden">
                  <Menu className="w-5 h-5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
