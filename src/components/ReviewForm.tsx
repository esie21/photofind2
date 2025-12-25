import { useState } from 'react';
import { Star, X, Loader } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import reviewService from '../api/services/reviewService';

interface ReviewFormProps {
  bookingId: string;
  providerName: string;
  serviceName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ReviewForm({ bookingId, providerName, serviceName, onClose, onSuccess }: ReviewFormProps) {
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) {
      toast.error('Please select a rating', 'Choose between 1 and 5 stars');
      return;
    }

    setIsSubmitting(true);
    try {
      await reviewService.createReview({
        booking_id: bookingId,
        rating,
        comment: comment.trim() || undefined,
      });
      toast.success('Review submitted!', 'Thank you for your feedback');
      onSuccess();
      onClose();
    } catch (error: any) {
      toast.error('Failed to submit review', error?.message || 'Please try again');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getRatingLabel = (stars: number): string => {
    switch (stars) {
      case 1: return 'Poor';
      case 2: return 'Fair';
      case 3: return 'Good';
      case 4: return 'Very Good';
      case 5: return 'Excellent';
      default: return 'Select rating';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Leave a Review</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6">
          {/* Provider Info */}
          <div className="text-center mb-6">
            <h3 className="text-gray-900 font-medium">{providerName}</h3>
            <p className="text-sm text-gray-600">{serviceName}</p>
          </div>

          {/* Star Rating */}
          <div className="mb-6">
            <p className="text-sm text-gray-700 mb-3 text-center">How was your experience?</p>
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(star)}
                  className="p-1 transition-transform hover:scale-110"
                >
                  <Star
                    className={`w-10 h-10 transition-colors ${
                      star <= (hoverRating || rating)
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-gray-300'
                    }`}
                  />
                </button>
              ))}
            </div>
            <p className="text-center text-sm text-gray-600 mt-2">
              {getRatingLabel(hoverRating || rating)}
            </p>
          </div>

          {/* Comment */}
          <div className="mb-6">
            <label className="block text-sm text-gray-700 mb-2">
              Share your experience (optional)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What did you like about working with this provider? Any feedback for future clients?"
              rows={4}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none resize-none"
              maxLength={1000}
            />
            <p className="text-xs text-gray-500 text-right mt-1">
              {comment.length}/1000 characters
            </p>
          </div>

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || rating === 0}
            className="w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSubmitting && <Loader className="w-4 h-4 animate-spin" />}
            {isSubmitting ? 'Submitting...' : 'Submit Review'}
          </button>

          <p className="text-xs text-gray-500 text-center mt-4">
            Your review will be visible to other users and helps providers improve their services.
          </p>
        </div>
      </div>
    </div>
  );
}

export default ReviewForm;
