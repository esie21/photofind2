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
        {currentView === 'client' && <ClientDashboard onStartBooking={() => setCurrentView('booking')} />}
        {currentView === 'provider' && <ProviderDashboard />}
        {currentView === 'booking' && <BookingFlow onComplete={() => setCurrentView('client')} />}
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
