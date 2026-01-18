import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { useAuth } from './context/AuthContext';
import { LandingPage } from './components/LandingPage';
import { AuthModal } from './components/AuthModal';
import { ForgotPasswordModal } from './components/ForgotPasswordModal';
import { ResetPasswordPage } from './components/ResetPasswordPage';
import { ClientDashboard } from './components/ClientDashboard';
import { ProviderDashboard } from './components/ProviderDashboard';
import { ProviderProfilePage } from './components/ProviderProfilePage';
import { BookingFlow } from './components/BookingFlow';
import { AdminDashboard } from './components/AdminDashboard';
import { ChatInterface } from './components/ChatInterface';
import { Notification } from './api/services/notificationService';
import chatService from './api/services/chatService';

interface ChatContext {
  recipientId: string;
  recipientName: string;
  recipientImage?: string;
  bookingId?: number;
}

export default function App() {
  const [currentView, setCurrentView] = useState<'landing' | 'client' | 'provider' | 'booking' | 'admin' | 'provider-profile' | 'reset-password'>('landing');
  const { user } = useAuth();
  const [bookingContext, setBookingContext] = useState<{ providerId?: string; providerName?: string; providerImage?: string; serviceId?: string } | null>(null);
  const [dashboardKey, setDashboardKey] = useState(0);
  const [chatContext, setChatContext] = useState<ChatContext | null>(null);
  const [viewingProviderId, setViewingProviderId] = useState<string | null>(null);

  // Check for reset-password route on mount
  useEffect(() => {
    const path = window.location.pathname;
    if (path === '/reset-password') {
      setCurrentView('reset-password');
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

  const handleViewChange = (view: 'landing' | 'client' | 'provider' | 'booking' | 'admin' | 'provider-profile') => {
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
    setCurrentView(view);
  };

  const handleViewProviderProfile = (providerId: string) => {
    setViewingProviderId(providerId);
    setCurrentView('provider-profile');
  };

  // Handle notification click navigation
  const handleNotificationNavigate = async (notification: Notification) => {
    console.log('=== NOTIFICATION CLICK HANDLER STARTED ===');
    console.log('Raw notification:', notification);

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

      console.log('Notification click:', { type: notification.type, data, rawData: notification.data });

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

      console.log('New message notification - initial:', { senderId, chatId, bookingId, rawBookingId: data.booking_id, data });

      // Always try to get fresh booking_id from chat if we have chatId
      if (chatId) {
        console.log('Fetching booking_id from chat_id:', chatId);
        try {
          const chatInfo = await chatService.getChatInfo(chatId);
          console.log('Chat info received:', chatInfo);
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

      console.log('Final bookingId for chat:', bookingId);

      if (senderId) {
        const context = {
          recipientId: String(senderId),
          recipientName: senderName,
          bookingId,
        };
        console.log('Setting chatContext:', context);
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
      />
      
      <main>
        {currentView === 'reset-password' && <ResetPasswordPage />}
        {currentView === 'landing' && <LandingPage onViewChange={handleViewChange} />}
        {currentView === 'client' && <ClientDashboard
          key={dashboardKey}
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
            setCurrentView('booking');
          }}
          onViewProvider={handleViewProviderProfile}
        />}
        {currentView === 'provider' && <ProviderDashboard />}
        {currentView === 'booking' && (
          <BookingFlow
            onComplete={() => {
              setDashboardKey(k => k + 1);
              setCurrentView('client');
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
              setCurrentView('booking');
            }}
            onBack={() => setCurrentView('client')}
          />
        )}
      </main>

      {showAuthModal && (
        <AuthModal
          mode={authMode}
          onClose={() => setShowAuthModal(false)}
          onSuccess={(role) => {
            setShowAuthModal(false);
            setCurrentView(role === 'provider' ? 'provider' : 'client');
          }}
          onForgotPassword={() => {
            setShowAuthModal(false);
            setShowForgotPasswordModal(true);
          }}
        />
      )}

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

      {/* Global Chat Modal - opened from notifications */}
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
    </div>
  );
}
