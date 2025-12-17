import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { useAuth } from './context/AuthContext';
import { LandingPage } from './components/LandingPage';
import { AuthModal } from './components/AuthModal';
import { ClientDashboard } from './components/ClientDashboard';
import { ProviderDashboard } from './components/ProviderDashboard';
import { BookingFlow } from './components/BookingFlow';
import { AdminDashboard } from './components/AdminDashboard';

export default function App() {
  const [currentView, setCurrentView] = useState<'landing' | 'client' | 'provider' | 'booking' | 'admin'>('landing');
    const { user } = useAuth();
  const [bookingContext, setBookingContext] = useState<{ providerId?: string; providerName?: string; providerImage?: string } | null>(null);

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

  return (
    <div className="min-h-screen bg-gray-50">
      <Header 
        onViewChange={handleViewChange} 
        currentView={currentView}
        onAuthClick={(mode) => {
          setAuthMode(mode);
          setShowAuthModal(true);
        }}
      />
      
      <main>
        {currentView === 'landing' && <LandingPage onViewChange={handleViewChange} />}
        {currentView === 'client' && <ClientDashboard onStartBooking={(provider?: unknown) => {
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
            onComplete={() => setCurrentView('client')}
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
    </div>
  );
}
