import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { useAuth } from './context/AuthContext';
import { LandingPage } from './components/LandingPage';
import { AuthModal } from './components/AuthModal';
import { ClientDashboard } from './components/ClientDashboard';
import { ProviderDashboard } from './components/ProviderDashboard';
import { BookingFlow } from './components/BookingFlow';
import { AdminDashboard } from './components/AdminDashboard';
import { ChatInterface } from './components/ChatInterface';
import { Notification } from './api/services/notificationService';

interface ChatContext {
  recipientId: string;
  recipientName: string;
  recipientImage?: string;
  bookingId?: number;
}

export default function App() {
  const [currentView, setCurrentView] = useState<'landing' | 'client' | 'provider' | 'booking' | 'admin'>('landing');
    const { user } = useAuth();
  const [bookingContext, setBookingContext] = useState<{ providerId?: string; providerName?: string; providerImage?: string } | null>(null);
  const [dashboardKey, setDashboardKey] = useState(0);
  const [chatContext, setChatContext] = useState<ChatContext | null>(null);

    useEffect(() => {
      if (user) {
        setCurrentView(user.role === 'provider' ? 'provider' : 'client');
      } else {
        setCurrentView('landing');
      }
    }, [user]);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');

  const handleViewChange = (view: 'landing' | 'client' | 'provider' | 'booking' | 'admin') => {
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

  // Handle notification click navigation
  const handleNotificationNavigate = (notification: Notification) => {
    const data = notification.data || {};

    // For message notifications, open the chat
    if (notification.type === 'new_message') {
      const senderName = data.sender_name || 'User';
      const senderId = data.sender_id;
      const chatId = data.chat_id;

      if (senderId) {
        setChatContext({
          recipientId: String(senderId),
          recipientName: senderName,
          bookingId: data.booking_id ? Number(data.booking_id) : undefined,
        });
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
        {currentView === 'landing' && <LandingPage onViewChange={handleViewChange} />}
        {currentView === 'client' && <ClientDashboard key={dashboardKey} onStartBooking={(provider?: unknown) => {
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
          }} />}
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
      </main>

      {showAuthModal && (
        <AuthModal
          mode={authMode}
          onClose={() => setShowAuthModal(false)}
          onSuccess={(role) => {
            setShowAuthModal(false);
            setCurrentView(role === 'provider' ? 'provider' : 'client');
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
