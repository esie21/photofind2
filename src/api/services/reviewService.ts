import { apiClient } from '../client';

export interface Review {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  booking_id: string;
  reviewer_name?: string;
  reviewer_image?: string;
  provider_name?: string;
  provider_image?: string;
  service_title?: string;
  is_visible?: boolean;
  moderation_status?: string;
}

export interface ReviewStats {
  totalReviews: number;
  averageRating: string;
  distribution?: {
    5: number;
    4: number;
    3: number;
    2: number;
    1: number;
  };
}

export interface ProviderReviewsResponse {
  reviews: Review[];
  stats: ReviewStats;
}

export interface PendingReview {
  booking_id: string;
  start_date: string;
  total_price: number;
  provider_id: string;
  provider_name: string;
  provider_image: string;
  service_title: string;
}

export interface CanReviewResponse {
  canReview: boolean;
  reason?: string;
  reviewId?: string;
}

const reviewService = {
  // Get reviews for a provider (public)
  async getProviderReviews(providerId: string, limit = 10, offset = 0): Promise<ProviderReviewsResponse> {
    const response = await apiClient.get<ProviderReviewsResponse>(
      `/reviews/provider/${providerId}?limit=${limit}&offset=${offset}`
    );
    return response;
  },

  // Get reviews written by the current user
  async getMyReviews(): Promise<Review[]> {
    const response = await apiClient.get<Review[]>('/reviews/my-reviews');
    return response;
  },

  // Get reviews received by the provider (for provider dashboard)
  async getReceivedReviews(): Promise<ProviderReviewsResponse> {
    const response = await apiClient.get<ProviderReviewsResponse>('/reviews/received');
    return response;
  },

  // Check if user can review a booking
  async canReview(bookingId: string): Promise<CanReviewResponse> {
    const response = await apiClient.get<CanReviewResponse>(`/reviews/can-review/${bookingId}`);
    return response;
  },

  // Get bookings that can be reviewed
  async getPendingReviews(): Promise<PendingReview[]> {
    const response = await apiClient.get<PendingReview[]>('/reviews/pending-reviews');
    return response;
  },

  // Create a review
  async createReview(data: {
    booking_id: string;
    rating: number;
    comment?: string;
  }): Promise<Review> {
    const response = await apiClient.post<Review>('/reviews', data);
    return response;
  },

  // Update a review (within 48 hours)
  async updateReview(reviewId: string, data: {
    rating: number;
    comment?: string;
  }): Promise<Review> {
    const response = await apiClient.put<Review>(`/reviews/${reviewId}`, data);
    return response;
  },

  // Delete a review
  async deleteReview(reviewId: string): Promise<{ success: boolean }> {
    const response = await apiClient.delete<{ success: boolean }>(`/reviews/${reviewId}`);
    return response;
  },

  // Helper to format date
  formatReviewDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  },

  // Helper to get rating text
  getRatingText(rating: number): string {
    if (rating >= 4.5) return 'Excellent';
    if (rating >= 4) return 'Very Good';
    if (rating >= 3) return 'Good';
    if (rating >= 2) return 'Fair';
    return 'Poor';
  },
};

export default reviewService;
