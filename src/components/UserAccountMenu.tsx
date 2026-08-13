import { useEffect, useRef, useState } from 'react';
import { User, Calendar, Wallet, Star, Settings, HelpCircle, ChevronRight, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';

export type AccountMenuTarget = 'profile' | 'bookings' | 'wallet' | 'reviews' | 'settings' | 'help';

interface UserAccountMenuProps {
  onNavigate: (target: AccountMenuTarget) => void;
}

const MENU_ITEMS: { target: AccountMenuTarget; label: string; icon: typeof User }[] = [
  { target: 'profile', label: 'My Profile', icon: User },
  { target: 'bookings', label: 'My Bookings', icon: Calendar },
  { target: 'wallet', label: 'Wallet & Earnings', icon: Wallet },
  { target: 'reviews', label: 'Reviews', icon: Star },
  { target: 'settings', label: 'Settings & Privacy', icon: Settings },
  { target: 'help', label: 'Help & Support', icon: HelpCircle },
];

const ROLE_LABEL: Record<string, string> = {
  provider: 'Service Provider',
  client: 'Client',
  admin: 'Administrator',
};

export function UserAccountMenu({ onNavigate }: UserAccountMenuProps) {
  const { user, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const frame = requestAnimationFrame(() => setIsVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    setIsVisible(false);
  }, [isOpen]);

  if (!user) return null;

  const handleItemClick = (target: AccountMenuTarget) => {
    setIsOpen(false);
    onNavigate(target);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="profile-chip flex items-center gap-2 rounded-2xl"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <Avatar className="w-8 h-8">
          {user.profile_image && <AvatarImage src={user.profile_image} alt={user.name || 'Profile'} />}
          <AvatarFallback className="bg-gradient-to-br from-purple-400 to-pink-400 text-white text-sm">
            {user.name ? user.name.slice(0, 1).toUpperCase() : 'U'}
          </AvatarFallback>
        </Avatar>
        <span className="profile-chip-name text-sm whitespace-nowrap">{user.name || user.email}</span>
      </button>

      {isOpen && (
        <div
          role="menu"
          className={`account-menu-panel ${isVisible ? 'account-menu-panel-open' : ''} absolute right-0 mt-2 bg-white border border-gray-100 overflow-hidden z-50`}
        >
          {/* Profile summary */}
          <div className="px-4 py-4">
            <div className="flex items-center gap-3">
              <Avatar className="account-menu-avatar">
                {user.profile_image && <AvatarImage src={user.profile_image} alt={user.name || 'Profile'} />}
                <AvatarFallback className="bg-gradient-to-br from-purple-400 to-pink-400 text-white">
                  {user.name ? user.name.slice(0, 1).toUpperCase() : 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-bold text-gray-900 truncate">{user.name || 'Your Account'}</p>
                <p className="text-sm text-gray-500 truncate">
                  {ROLE_LABEL[user.role] || user.email}
                </p>
              </div>
            </div>
          </div>
          <div className="border-t border-gray-100" />

          {/* Account menu */}
          <div className="py-2">
            {MENU_ITEMS.filter(({ target }) =>
              !(target === 'bookings' && (user.role === 'provider' || user.role === 'admin')) &&
              // Profile / Wallet & Earnings / Reviews only have a home on the provider
              // dashboard today (see App.tsx's handleAccountMenuNavigate) - for anyone
              // else they were a dead end that just popped a "coming soon" toast.
              !(target === 'wallet' && user.role !== 'provider') &&
              !(target === 'profile' && user.role !== 'provider') &&
              !(target === 'reviews' && user.role !== 'provider')
            ).map(({ target, label, icon: Icon }) => (
              <button
                key={target}
                role="menuitem"
                onClick={() => handleItemClick(target)}
                className="account-menu-row w-full flex items-center gap-3 text-left hover:bg-purple-50 transition-colors"
              >
                <span className="account-menu-icon-circle">
                  <Icon className="w-4 h-4" />
                </span>
                <span className="flex-1 text-sm text-gray-900">{label}</span>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </button>
            ))}
          </div>

          <div className="border-t border-gray-100" />

          {/* Log out */}
          <div className="py-2">
            <button
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                logout();
              }}
              className="account-menu-row w-full flex items-center gap-3 text-left hover:bg-red-50 transition-colors"
            >
              <span className="account-menu-icon-circle account-menu-icon-circle-danger">
                <LogOut className="w-4 h-4" />
              </span>
              <span className="flex-1 text-sm text-red-600">Log Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserAccountMenu;
