import { TermsContent, type Audience } from './TermsContent';
import { useAuth } from '../context/AuthContext';

export function TermsPage() {
  const { user } = useAuth();

  // Open on the reader's own half of the agreement. A provider arriving from Settings
  // is looking for what they signed up to, not for the client payment rules - and the
  // filter chips are right there if they want the rest.
  const defaultAudience: Audience =
    user?.role === 'client' || user?.role === 'provider' ? user.role : 'all';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-gray-900 mb-1">Terms &amp; Conditions</h1>
        <p className="text-sm text-gray-500 mb-8">Please read these terms carefully before using PhotoFind.</p>

        <div className="bg-white rounded-2xl shadow-sm p-6">
          <TermsContent defaultAudience={defaultAudience} showContents />
        </div>
      </div>
    </div>
  );
}

export default TermsPage;
