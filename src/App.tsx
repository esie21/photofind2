import { useState, useEffect, lazy, Suspense } from 'react';
import { Header } from './components/Header';
import { useAuth } from './context/AuthContext';
import { useToast } from './context/ToastContext';
import { LandingPage } from './components/LandingPage';
import { AccountMenuTarget } from './components/UserAccountMenu';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Notification } from './api/services/notificationService';

// Every view and modal below is code-split.
//
// These used to be static imports, which meant one chunk held the lot - the admin
// dashboard, Recharts, the wallet, the whole booking flow - and every first-time
// visitor downloaded all of it before the landing page could paint, despite a given
// session rendering one or two of these screens.
//
// Header and LandingPage stay static deliberately: they are what an anonymous visitor
// sees first, so splitting them would only add a network round-trip before first paint.
//
// The .then() remap is because lazy() wants a module whose *default* export is the
// component, and these are all named exports.
const lazyNamed = <T extends Record<string, any>, K extends keyof T>(
  loader: () => Promise<T>,
  name: K,
) => lazy(() => loader().then((m) => ({ default: m[name] })));

const ResetPasswordPage = lazyNamed(() => import('./components/ResetPasswordPage'), 'ResetPasswordPage');
const PaymentCallbackPage = lazyNamed(() => import('./components/PaymentCallbackPage'), 'PaymentCallbackPage');
const ClientDashboard = lazyNamed(() => import('./components/ClientDashboard'), 'ClientDashboard');
const ProviderDashboard = lazyNamed(() => import('./components/ProviderDashboard'), 'ProviderDashboard');
const ProviderProfilePage = lazyNamed(() => import('./components/ProviderProfilePage'), 'ProviderProfilePage');
const BookingFlow = lazyNamed(() => import('./components/BookingFlow'), 'BookingFlow');
const AdminDashboard = lazyNamed(() => import('./components/AdminDashboard'), 'AdminDashboard');
const MessagesPage = lazyNamed(() => import('./components/MessagesPage'), 'MessagesPage');
const SettingsPage = lazyNamed(() => import('./components/SettingsPage'), 'SettingsPage');
const HelpSupportPage = lazyNamed(() => import('./components/HelpSupportPage'), 'HelpSupportPage');
const TermsPage = lazyNamed(() => import('./components/TermsPage'), 'TermsPage');
const BookingsPage = lazyNamed(() => import('./components/BookingsPage'), 'BookingsPage');
const AuthModal = lazyNamed(() => import('./components/AuthModal'), 'AuthModal');
const ForgotPasswordModal = lazyNamed(() => import('./components/ForgotPasswordModal'), 'ForgotPasswordModal');
const ChatInterface = lazyNamed(() => import('./components/ChatInterface'), 'ChatInterface');
const TermsUpdateModal = lazyNamed(() => import('./components/TermsUpdateModal'), 'TermsUpdateModal');

// Matches the loading state AdminDashboard already renders, so a view arriving over the
// network looks like a view fetching its data rather than like a different kind of wait.
const ModalFallback = () => (
  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
  </div>
);

const ViewFallback = () => (
  <div className="flex justify-center py-20">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
  </div>
);

type ProviderTab = 'overview' | 'profile' | 'availability' | 'bookings' | 'wallet' | 'reviews';

interface ChatContext {
  recipientId: string;
  recipientName: string;
  recipientImage?: string;
  bookingId?: number;
}

export default function App() {
  const [currentView, setCurrentView] = useState<'landing' | 'client' | 'provider' | 'booking' | 'admin' | 'provider-profile' | 'messages' | 'reset-password' | 'settings' | 'help' | 'bookings' | 'terms' | 'payment-callback'>('landing');
  const { user } = useAuth();
  const toast = useToast();
  const [bookingContext, setBookingContext] = useState<{ providerId?: string; providerName?: string; providerImage?: string; serviceId?: string } | null>(null);
  const [dashboardKey, setDashboardKey] = useState(0);
  const [chatContext, setChatContext] = useState<ChatContext | null>(null);
  const [viewingProviderId, setViewingProviderId] = useState<string | null>(null);
  const [landingSearchQuery, setLandingSearchQuery] = useState<string | undefined>(undefined);
  const [landingCategory, setLandingCategory] = useState<string | undefined>(undefined);
  const [providerTabRequest, setProviderTabRequest] = useState<{ tab: ProviderTab; requestId: number } | null>(null);

  // Switch views and put the URL back to "/" at the same time.
  //
  // Only /bookings and /reset-password have their own paths; every other view
  // lives at "/". Navigating with a bare setCurrentView left the path behind:
  // after visiting /bookings, clicking "Provider Dashboard" showed the dashboard
  // while the URL still read /bookings, so the next refresh re-ran the mount
  // route check, matched /bookings and dropped the user on the Upcoming Bookings
  // page instead of where they actually were - permanently, since nothing ever
  // cleared the path again.
  //
  // replaceState rather than pushState: this rewrites the entry the user is
  // already on instead of stacking a duplicate, so Back still returns to
  // whatever came before /bookings.
  const navigateTo = (view: typeof currentView) => {
    if (window.location.pathname !== '/') {
      window.history.replaceState({}, '', '/');
    }
    setCurrentView(view);
  };

  const handleAccountMenuNavigate = (target: AccountMenuTarget) => {
    const isProvider = user?.role === 'provider';

    if (target === 'settings') {
      navigateTo('settings');
      return;
    }
    if (target === 'help') {
      navigateTo('help');
      return;
    }
    if (target === 'bookings') {
      window.history.pushState({}, '', '/bookings');
      setCurrentView('bookings');
      return;
    }
    // Profile / Wallet & Earnings / Reviews only have a home on the provider dashboard today.
    if (isProvider) {
      const tab: ProviderTab = target === 'profile' ? 'profile' : target === 'wallet' ? 'wallet' : 'reviews';
      setProviderTabRequest({ tab, requestId: Date.now() });
      navigateTo('provider');
    } else {
      toast.info('Coming soon', "This isn't available for client accounts yet.");
    }
  };

  // Check for reset-password / bookings route on mount
  useEffect(() => {
    const path = window.location.pathname;
    if (path === '/reset-password') {
      setCurrentView('reset-password');
      return;
    }
    // Checked before the admin short-circuit below: someone coming back from a 3D
    // Secure redirect needs their payment confirmed whatever their role, and losing
    // that would leave the payment unsettled with no way to retry.
    if (path === '/payment/callback') {
      setCurrentView('payment-callback');
      return;
    }
    // Admins always land on the admin dashboard, regardless of whatever path the
    // browser happened to be on (e.g. left over from a previous visit to /bookings) -
    // otherwise the /bookings check below would route them to the client bookings
    // page instead, since it doesn't look at role at all.
    if (user?.role === 'admin') {
      setCurrentView('admin');
      return;
    }
    if (path === '/bookings' && user) {
      setCurrentView('bookings');
      return;
    }

    if (user) {
      setCurrentView(user.role === 'provider' ? 'provider' : 'client');
    } else {
      setCurrentView('landing');
    }
  }, [user]);

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      if (path === '/reset-password') {
        setCurrentView('reset-password');
      } else if (path === '/payment/callback') {
        setCurrentView('payment-callback');
      } else if (user?.role === 'admin') {
        setCurrentView('admin');
      } else if (path === '/bookings' && user) {
        setCurrentView('bookings');
      } else if (path === '/') {
        if (user) {
          setCurrentView(user.role === 'provider' ? 'provider' : 'client');
        } else {
          setCurrentView('landing');
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [user]);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');

  const handleViewChange = (view: 'landing' | 'client' | 'provider' | 'booking' | 'admin' | 'provider-profile' | 'messages') => {
    // If trying to route to admin, ensure user is admin
    if (view === 'admin') {
      if (!user || user.role !== 'admin') {
        // Prevent access
        alert('Access denied: admin only');
        return;
      }
    }
    // For provider dashboard, ensure user is provider or admin
    if (view === 'provider') {
      if (!user || (user.role !== 'provider' && user.role !== 'admin')) {
        alert('Access denied: provider only');
        return;
      }
    }
    navigateTo(view);
  };

  const handleViewProviderProfile = (providerId: string) => {
    setViewingProviderId(providerId);
    navigateTo('provider-profile');
  };

  // Handle notification click navigation
  const handleNotificationNavigate = async (notification: Notification) => {
    try {
      // Parse data if it's a string (backwards compatibility for old double-stringified data)
      let data = notification.data || {};

      // Keep parsing while data is a string (handles multiple levels of stringify)
      let parseAttempts = 0;
      while (typeof data === 'string' && parseAttempts < 3) {
        try {
          data = JSON.parse(data);
          parseAttempts++;
        } catch (e) {
          console.error('Failed to parse notification data:', e, data);
          data = {};
          break;
        }
      }

    // For message notifications, open the chat
    if (notification.type === 'new_message') {
      const senderName = data.sender_name || 'User';
      const senderId = data.sender_id;
      const chatId = data.chat_id;

      // Helper to safely convert to number
      const toValidNumber = (val: any): number | undefined => {
        if (val === null || val === undefined || val === '') return undefined;
        const num = Number(val);
        return isNaN(num) ? undefined : num;
      };

      // Extract booking_id - check multiple possible locations
      let bookingId: number | undefined = toValidNumber(data.booking_id);

      // Always try to get fresh booking_id from chat if we have chatId
      if (chatId) {
        try {
          const { default: chatService } = await import('./api/services/chatService');
          const chatInfo = await chatService.getChatInfo(chatId);
          if (chatInfo.booking_id) {
            const fetchedId = toValidNumber(chatInfo.booking_id);
            if (fetchedId) {
              bookingId = fetchedId;
            }
          }
        } catch (e) {
          console.error('Failed to get chat info:', e);
        }
      }

      if (senderId) {
        const context = {
          recipientId: String(senderId),
          recipientName: senderName,
          bookingId,
        };
        setChatContext(context);
      } else {
        console.error('No senderId in notification data');
      }
      return;
    }

    // For booking-related notifications, open chat with the relevant person
    if (notification.type.startsWith('booking_')) {
      const bookingId = data.booking_id ? Number(data.booking_id) : undefined;

      // Determine the other party based on notification type and user role
      if (user?.role === 'provider') {
        // Provider receiving notification - client is the other party
        const clientName = data.client_name || 'Client';
        const clientId = data.client_id;
        if (clientId) {
          setChatContext({
            recipientId: String(clientId),
            recipientName: clientName,
            bookingId,
          });
        }
      } else {
        // Client receiving notification - provider is the other party
        const providerName = data.provider_name || 'Provider';
        const providerId = data.provider_id;
        if (providerId) {
          setChatContext({
            recipientId: String(providerId),
            recipientName: providerName,
            bookingId,
          });
        }
      }
      return;
    }

    // For payment notifications, open chat about the booking
    if (notification.type.startsWith('payment_') || notification.type.startsWith('payout_')) {
      const bookingId = data.booking_id ? Number(data.booking_id) : undefined;
      const clientName = data.client_name;
      const clientId = data.client_id;

      if (clientId) {
        setChatContext({
          recipientId: String(clientId),
          recipientName: clientName || 'Client',
          bookingId,
        });
      }
      return;
    }

    // For review notifications
    if (notification.type === 'new_review') {
      const clientName = data.client_name || 'Client';
      const clientId = data.client_id;
      const bookingId = data.booking_id ? Number(data.booking_id) : undefined;

      if (clientId) {
        setChatContext({
          recipientId: String(clientId),
          recipientName: clientName,
          bookingId,
        });
      }
    }
    } catch (error) {
      console.error('Error in notification handler:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        onViewChange={handleViewChange}
        currentView={currentView}
        onAuthClick={(mode) => {
          setAuthMode(mode);
          setShowAuthModal(true);
        }}
        onNotificationNavigate={handleNotificationNavigate}
        onAccountMenuNavigate={handleAccountMenuNavigate}
      />

      <main>
        {/* Keyed on currentView so that navigating away clears a caught error: React
            never resets a boundary on its own, and without the key a single failed
            screen would leave every later screen showing that same stale error.
            onGoHome gives a way out when the broken screen is the one they are on. */}
        <ErrorBoundary key={currentView} variant="inline" onGoHome={() => navigateTo('landing')}>
          <Suspense fallback={<ViewFallback />}>
            {currentView === 'reset-password' && <ResetPasswordPage />}
            {currentView === 'payment-callback' && (
              <PaymentCallbackPage onDone={() => handleAccountMenuNavigate('bookings')} />
            )}
            {currentView === 'settings' && <SettingsPage onGoToTerms={() => navigateTo('terms')} />}
            {currentView === 'bookings' && <BookingsPage />}
            {currentView === 'help' && <HelpSupportPage onGoToBookings={() => handleAccountMenuNavigate('bookings')} />}
            {currentView === 'terms' && <TermsPage />}
            {currentView === 'landing' && (
              <LandingPage
                onViewChange={handleViewChange}
                onViewProvider={handleViewProviderProfile}
                onSearch={(query) => {
                  setLandingSearchQuery(query);
                  setLandingCategory(undefined);
                  setDashboardKey((k) => k + 1);
                  handleViewChange('client');
                }}
                onCategorySelect={(category) => {
                  setLandingCategory(category);
                  setLandingSearchQuery(undefined);
                  setDashboardKey((k) => k + 1);
                }}
              />
            )}
            {currentView === 'client' && <ClientDashboard
              key={dashboardKey}
              initialSearchQuery={landingSearchQuery}
              initialCategory={landingCategory}
              onContactSupport={() => navigateTo('help')}
              onStartBooking={(provider?: unknown) => {
                if (!user) {
                  setAuthMode('login');
                  setShowAuthModal(true);
                  return;
                }
                if (provider) {
                  setBookingContext({
                    providerId: String((provider as any).id),
                    providerName: (provider as any).name,
                    providerImage: (provider as any).profile_image || (provider as any).image,
                  });
                } else {
                  setBookingContext(null);
                }
                navigateTo('booking');
              }}
              onViewProvider={handleViewProviderProfile}
            />}
            {currentView === 'provider' && (
              <ProviderDashboard
                initialTab={providerTabRequest?.tab}
                tabRequestId={providerTabRequest?.requestId}
              />
            )}
            {currentView === 'messages' && <MessagesPage />}
            {currentView === 'booking' && (
              <BookingFlow
                onComplete={() => {
                  setDashboardKey(k => k + 1);
                  navigateTo('client');
                }}
                providerId={bookingContext?.providerId}
                providerName={bookingContext?.providerName}
                providerImage={bookingContext?.providerImage}
              />
            )}
            {currentView === 'admin' && <AdminDashboard />}
            {currentView === 'provider-profile' && viewingProviderId && (
              <ProviderProfilePage
                providerId={viewingProviderId}
                onStartBooking={(provider, service) => {
                  if (!user) {
                    setAuthMode('login');
                    setShowAuthModal(true);
                    return;
                  }
                  setBookingContext({
                    providerId: String(provider.id),
                    providerName: provider.name,
                    providerImage: provider.profile_image || provider.image,
                    serviceId: service?.id ? String(service.id) : undefined,
                  });
                  navigateTo('booking');
                }}
                onBack={() => navigateTo('client')}
              />
            )}
          </Suspense>
        </ErrorBoundary>
      </main>

      {/* Asks for agreement again when the terms have changed since this user last
          accepted. Renders nothing unless the server says re-acceptance is due, and
          sits outside the view switch so it is reachable from wherever they happen to
          be. Kept below AuthModal in the tree so a signup in progress isn't covered by
          it - a brand-new account is stamped with the current version anyway and never
          triggers this. */}
      <Suspense fallback={null}>
        <TermsUpdateModal />
      </Suspense>

      <Suspense fallback={<ModalFallback />}>
        {showAuthModal && (
          <AuthModal
            mode={authMode}
            onClose={() => setShowAuthModal(false)}
            onSuccess={(role) => {
              setShowAuthModal(false);
              navigateTo(role === 'provider' ? 'provider' : 'client');
            }}
            onForgotPassword={() => {
              setShowAuthModal(false);
              setShowForgotPasswordModal(true);
            }}
          />
        )}
      </Suspense>

      <Suspense fallback={<ModalFallback />}>
        {showForgotPasswordModal && (
          <ForgotPasswordModal
            onClose={() => setShowForgotPasswordModal(false)}
            onBackToLogin={() => {
              setShowForgotPasswordModal(false);
              setAuthMode('login');
              setShowAuthModal(true);
            }}
          />
        )}
      </Suspense>

      {/* Global Chat Modal - opened from notifications */}
      <Suspense fallback={null}>
        {chatContext && (
          <ChatInterface
            provider={{
              id: chatContext.recipientId,
              name: chatContext.recipientName,
              image: chatContext.recipientImage,
            }}
            bookingId={chatContext.bookingId}
            onClose={() => setChatContext(null)}
          />
        )}
      </Suspense>
    </div>
  );
}
