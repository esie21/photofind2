import type { ProviderStats } from '../services/providerStats';

// rankScore = 0.5 * rating + 0.25 * responsiveness + 0.25 * completion, each in 0..1.
export const WEIGHTS = { rating: 0.5, response: 0.25, completion: 0.25 } as const;

// A provider with no usable data for a component gets this, so being new is neither
// rewarded nor punished for response time / completion.
const NEUTRAL = 0.5;

// Bayesian average: pull the rating towards PRIOR_MEAN until there are enough reviews to
// trust it. Without this a single 5-star review (5.0) outranks 200 reviews averaging 4.8.
const PRIOR_MEAN = 4.0;
const PRIOR_WEIGHT = 5; // "worth" this many reviews

// Responsiveness decays smoothly: ~0.92 at 1h, ~0.61 at 6h, ~0.37 at 12h, ~0.14 at 24h.
const RESPONSE_DECAY_HOURS = 12;

export function ratingScore(rating: number, reviewCount: number): number {
  const reviews = Math.max(0, Number(reviewCount) || 0);
  const avg = reviews > 0 ? Math.min(5, Math.max(0, Number(rating) || 0)) : PRIOR_MEAN;
  const smoothed = (reviews * avg + PRIOR_WEIGHT * PRIOR_MEAN) / (reviews + PRIOR_WEIGHT);
  return smoothed / 5;
}

export function responseScore(medianResponseSeconds: number | null): number {
  if (medianResponseSeconds === null || !Number.isFinite(medianResponseSeconds)) return NEUTRAL;
  const hours = Math.max(0, medianResponseSeconds) / 3600;
  return Math.exp(-hours / RESPONSE_DECAY_HOURS);
}

export function completionScore(completionRate: number | null): number {
  return completionRate === null ? NEUTRAL : Math.min(1, Math.max(0, completionRate));
}

export function rankScore(
  rating: number,
  reviewCount: number,
  stats: ProviderStats | undefined
): number {
  return (
    WEIGHTS.rating * ratingScore(rating, reviewCount) +
    WEIGHTS.response * responseScore(stats?.medianResponseSeconds ?? null) +
    WEIGHTS.completion * completionScore(stats?.completionRate ?? null)
  );
}
