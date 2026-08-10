import { TermsContent } from './TermsContent';

export function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-gray-900 mb-1">Terms & Conditions</h1>
        <p className="text-sm text-gray-500 mb-8">Please read these terms carefully before using PhotoFind.</p>

        <div className="bg-white rounded-2xl shadow-sm p-6">
          <TermsContent />
        </div>
      </div>
    </div>
  );
}

export default TermsPage;
