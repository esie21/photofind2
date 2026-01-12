import { useState, useRef } from 'react';
import { X, Upload, Image, Trash2, AlertCircle, Loader2, CheckCircle } from 'lucide-react';
import bookingService from '../api/services/bookingService';

interface CompleteBookingModalProps {
  booking: {
    id: string;
    service_title?: string;
    client_name?: string;
    start_date?: string;
    end_date?: string;
  };
  onClose: () => void;
  onSuccess: () => void;
}

interface EvidenceFile {
  file: File;
  preview: string;
  type: 'before' | 'after' | 'during' | 'other';
}

export function CompleteBookingModal({ booking, onClose, onSuccess }: CompleteBookingModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState<EvidenceFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles: EvidenceFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) {
        setError('Only image files are allowed');
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError('File size must be less than 10MB');
        continue;
      }
      newFiles.push({
        file,
        preview: URL.createObjectURL(file),
        type: 'after', // default type
      });
    }

    setEvidenceFiles(prev => [...prev, ...newFiles]);
    setError(null);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFile = (index: number) => {
    setEvidenceFiles(prev => {
      const newFiles = [...prev];
      URL.revokeObjectURL(newFiles[index].preview);
      newFiles.splice(index, 1);
      return newFiles;
    });
  };

  const updateFileType = (index: number, type: EvidenceFile['type']) => {
    setEvidenceFiles(prev => {
      const newFiles = [...prev];
      newFiles[index].type = type;
      return newFiles;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (evidenceFiles.length === 0) {
      setError('Please upload at least 1 evidence photo');
      return;
    }

    setIsLoading(true);

    try {
      const files = evidenceFiles.map(ef => ef.file);
      const types = evidenceFiles.map(ef => ef.type);

      await bookingService.completeBooking(
        booking.id,
        files,
        notes.trim() || undefined,
        types
      );

      // Cleanup previews
      evidenceFiles.forEach(ef => URL.revokeObjectURL(ef.preview));

      onSuccess();
    } catch (err: any) {
      console.error('Complete booking error:', err);
      setError(err?.message || 'Failed to complete booking');
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Not set';
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <h2 className="text-lg font-semibold text-gray-900">Complete Service</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Booking Info */}
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="font-medium text-gray-900">{booking.service_title || 'Service'}</p>
            <p className="text-sm text-gray-600">Client: {booking.client_name || 'Client'}</p>
            <p className="text-sm text-gray-500">{formatDate(booking.start_date)}</p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 rounded-xl">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Info Box */}
          <div className="bg-blue-50 rounded-xl p-3">
            <p className="text-sm text-blue-800">
              Upload proof photos to verify service completion. The client will be notified to confirm.
              If they don't respond within 48 hours, the booking will be auto-confirmed.
            </p>
          </div>

          {/* Upload Section */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Evidence Photos <span className="text-red-500">*</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-300 rounded-xl p-6 hover:border-purple-500 hover:bg-purple-50 transition-colors flex flex-col items-center gap-2"
            >
              <Upload className="w-8 h-8 text-gray-400" />
              <span className="text-sm text-gray-600">Click to upload photos</span>
              <span className="text-xs text-gray-400">JPEG, PNG, GIF, WEBP - Max 10MB each</span>
            </button>
          </div>

          {/* Preview Grid */}
          {evidenceFiles.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">
                Uploaded Photos ({evidenceFiles.length})
              </p>
              <div className="grid grid-cols-2 gap-3">
                {evidenceFiles.map((ef, index) => (
                  <div key={index} className="relative group">
                    <img
                      src={ef.preview}
                      alt={`Evidence ${index + 1}`}
                      className="w-full h-32 object-cover rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <select
                      value={ef.type}
                      onChange={(e) => updateFileType(index, e.target.value as EvidenceFile['type'])}
                      className="absolute bottom-2 left-2 right-2 text-xs bg-white/90 backdrop-blur rounded px-2 py-1 border border-gray-200"
                    >
                      <option value="before">Before</option>
                      <option value="during">During</option>
                      <option value="after">After</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Completion Notes <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes about the service..."
              rows={3}
              maxLength={1000}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
            />
          </div>
        </form>

        {/* Actions */}
        <div className="flex gap-3 p-4 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || evidenceFiles.length === 0}
            className="flex-1 px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ backgroundColor: '#16a34a', color: '#ffffff' }}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                Mark Complete
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CompleteBookingModal;
