import { Router, Request, Response } from 'express';
import pool from '../config/database';
import { verifyToken } from '../middleware/auth';
import { parseRating, parseBoundedText, parsePagination } from '../utils/validation';

const router = Router();

// reviews.comment is TEXT, so the database imposes no limit of its own. Roughly the length
// of a long, considered review; past that it is somebody pasting something.
const MAX_REVIEW_COMMENT = 2000;

/**
 * Recomputes a provider's cached rating and review_count from their visible reviews.
 *
 * users.rating and users.review_count are a denormalised copy of what the reviews table
 * says, and they are what the search listing and profile header render - so if they drift,
 * a provider's public star rating stops matching their own reviews page.
 *
 * Takes the caller's client so the recompute commits with the write that caused it. The
 * three call sites used to run it as a separate statement on the pool afterwards, which
 * meant an error in between - or two reviews landing at once - could leave the cached
 * figures describing a set of reviews that no longer existed.
 */
async function recomputeProviderRating(db: { query: Function }, revieweeId: string) {
  await db.query(
    `UPDATE users
     SET rating = (
       SELECT COALESCE(AVG(rating), 0)
       FROM reviews
       WHERE reviewee_id::text = $1
         AND is_visible = TRUE
         AND moderation_status = 'approved'
         AND deleted_at IS NULL
     ),
     review_count = (
       SELECT COUNT(*)
       FROM reviews
       WHERE reviewee_id::text = $1
         AND is_visible = TRUE
         AND moderation_status = 'approved'
         AND deleted_at IS NULL
     )
     WHERE id::text = $1`,
    [String(revieweeId)]
  );
}

// ==============================================
// REVIEW ROUTES
// ==============================================

// Get reviews for a provider (public - for displaying on profile)
router.get('/provider/:providerId', async (req: Request, res: Response) => {
  try {
    const { providerId } = req.params;
    // Bound before they reach the query. These were passed through raw, so `?limit=abc`
    // reached Postgres as a LIMIT and came back a 500, and `?limit=999999` was an open
    // invitation to dump every review a provider has ever had in one response - on a
    // public, unauthenticated endpoint.
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 50 });

    const result = await pool.query(
      `SELECT
        r.id,
        r.rating,
        r.comment,
        r.created_at,
        r.booking_id,
        u.name as reviewer_name,
        u.profile_image as reviewer_image,
        s.title as service_title
      FROM reviews r
      JOIN users u ON r.reviewer_id = u.id
      JOIN bookings b ON r.booking_id = b.id
      LEFT JOIN services s ON b.service_id = s.id
      WHERE r.reviewee_id = $1
        AND r.is_visible = TRUE
        AND r.moderation_status = 'approved'
        AND r.deleted_at IS NULL
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3`,
      [providerId, limit, offset]
    );

    // Get stats
    const statsResult = await pool.query(
      `SELECT
        COUNT(*) as total_reviews,
        COALESCE(AVG(rating), 0) as average_rating,
        COUNT(CASE WHEN rating = 5 THEN 1 END) as five_star,
        COUNT(CASE WHEN rating = 4 THEN 1 END) as four_star,
        COUNT(CASE WHEN rating = 3 THEN 1 END) as three_star,
        COUNT(CASE WHEN rating = 2 THEN 1 END) as two_star,
        COUNT(CASE WHEN rating = 1 THEN 1 END) as one_star
      FROM reviews
      WHERE reviewee_id = $1
        AND is_visible = TRUE
        AND moderation_status = 'approved'
        AND deleted_at IS NULL`,
      [providerId]
    );

    const stats = statsResult.rows[0];

    res.json({
      reviews: result.rows,
      stats: {
        totalReviews: parseInt(stats.total_reviews) || 0,
        averageRating: parseFloat(stats.average_rating).toFixed(1) || '0.0',
        distribution: {
          5: parseInt(stats.five_star) || 0,
          4: parseInt(stats.four_star) || 0,
          3: parseInt(stats.three_star) || 0,
          2: parseInt(stats.two_star) || 0,
          1: parseInt(stats.one_star) || 0,
        }
      }
    });
  } catch (error) {
    console.error('Get provider reviews error:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// Get reviews written by a user (for their dashboard)
router.get('/my-reviews', verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.userId;

    const result = await pool.query(
      `SELECT
        r.id,
        r.rating,
        r.comment,
        r.created_at,
        r.booking_id,
        u.name as provider_name,
        u.profile_image as provider_image,
        s.title as service_title
      FROM reviews r
      JOIN users u ON r.reviewee_id = u.id
      JOIN bookings b ON r.booking_id = b.id
      LEFT JOIN services s ON b.service_id = s.id
      WHERE r.reviewer_id = $1 AND r.deleted_at IS NULL
      ORDER BY r.created_at DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get my reviews error:', error);
    res.status(500).json({ error: 'Failed to fetch your reviews' });
  }
});

// Get reviews received by a provider (for provider dashboard)
router.get('/received', verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.userId;

    const result = await pool.query(
      `SELECT
        r.id,
        r.rating,
        r.comment,
        r.created_at,
        r.is_visible,
        r.moderation_status,
        r.booking_id,
        u.name as reviewer_name,
        u.profile_image as reviewer_image,
        s.title as service_title
      FROM reviews r
      JOIN users u ON r.reviewer_id = u.id
      JOIN bookings b ON r.booking_id = b.id
      LEFT JOIN services s ON b.service_id = s.id
      WHERE r.reviewee_id = $1 AND r.deleted_at IS NULL
      ORDER BY r.created_at DESC`,
      [userId]
    );

    // Get stats
    const statsResult = await pool.query(
      `SELECT
        COUNT(*) as total_reviews,
        COALESCE(AVG(rating), 0) as average_rating
      FROM reviews
      WHERE reviewee_id = $1
        AND is_visible = TRUE
        AND moderation_status = 'approved'
        AND deleted_at IS NULL`,
      [userId]
    );

    const stats = statsResult.rows[0];

    res.json({
      reviews: result.rows,
      stats: {
        totalReviews: parseInt(stats.total_reviews) || 0,
        averageRating: parseFloat(stats.average_rating).toFixed(1) || '0.0',
      }
    });
  } catch (error) {
    console.error('Get received reviews error:', error);
    res.status(500).json({ error: 'Failed to fetch received reviews' });
  }
});

// Check if user can review a booking
router.get('/can-review/:bookingId', verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const { bookingId } = req.params;

    // Check if booking exists and is completed
    const bookingResult = await pool.query(
      `SELECT b.id, b.client_id, b.provider_id, b.status
       FROM bookings b
       WHERE b.id::text = $1`,
      [String(bookingId)]
    );

    if (bookingResult.rows.length === 0) {
      return res.json({ canReview: false, reason: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];

    // Get actual client user ID (handle clients table if it exists)
    let clientUserId = String(booking.client_id);
    try {
      const clientCheck = await pool.query(
        `SELECT user_id FROM clients WHERE id::text = $1`,
        [String(booking.client_id)]
      );
      if (clientCheck.rows[0]?.user_id) {
        clientUserId = String(clientCheck.rows[0].user_id);
      }
    } catch (e) {
      // clients table doesn't exist or client_id is already a user ID
    }

    // Only the client can review, and only completed bookings
    if (clientUserId !== String(userId)) {
      return res.json({ canReview: false, reason: 'Only the client can leave a review' });
    }

    if (booking.status !== 'completed') {
      return res.json({ canReview: false, reason: 'Booking must be completed before reviewing' });
    }

    // Check if already reviewed
    const existingReview = await pool.query(
      `SELECT id FROM reviews WHERE booking_id::text = $1 AND reviewer_id::text = $2 AND deleted_at IS NULL`,
      [String(bookingId), String(userId)]
    );

    if (existingReview.rows.length > 0) {
      return res.json({ canReview: false, reason: 'You have already reviewed this booking', reviewId: existingReview.rows[0].id });
    }

    res.json({ canReview: true });
  } catch (error) {
    console.error('Can review check error:', error);
    res.status(500).json({ error: 'Failed to check review eligibility' });
  }
});

// Create a review
router.post('/', verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const { booking_id, rating, comment } = req.body;

    // Validate input
    if (!booking_id) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }

    const ratingValue = parseRating(rating);
    if (ratingValue === null) {
      return res.status(400).json({ error: 'Rating must be a whole number between 1 and 5' });
    }

    const commentCheck = parseBoundedText(comment, MAX_REVIEW_COMMENT, 'Comment');
    if ('error' in commentCheck) {
      return res.status(400).json({ error: commentCheck.error });
    }
    const commentValue = commentCheck.value;

    // Get booking and verify eligibility
    const bookingResult = await pool.query(
      `SELECT b.id, b.client_id, b.provider_id, b.status
       FROM bookings b
       WHERE b.id::text = $1`,
      [String(booking_id)]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];

    // Get actual user IDs (handle providers/clients tables if they exist)
    let clientUserId = String(booking.client_id);
    let providerUserId = String(booking.provider_id);

    // Check if providers table exists and get actual user_id
    try {
      const providerCheck = await pool.query(
        `SELECT user_id FROM providers WHERE id::text = $1`,
        [String(booking.provider_id)]
      );
      if (providerCheck.rows[0]?.user_id) {
        providerUserId = String(providerCheck.rows[0].user_id);
      }
    } catch (e) {
      // providers table doesn't exist or provider_id is already a user ID
    }

    // Check if clients table exists and get actual user_id
    try {
      const clientCheck = await pool.query(
        `SELECT user_id FROM clients WHERE id::text = $1`,
        [String(booking.client_id)]
      );
      if (clientCheck.rows[0]?.user_id) {
        clientUserId = String(clientCheck.rows[0].user_id);
      }
    } catch (e) {
      // clients table doesn't exist or client_id is already a user ID
    }

    // Only the client can review
    if (clientUserId !== String(userId)) {
      return res.status(403).json({ error: 'Only the client can leave a review' });
    }

    // Booking must be completed
    if (booking.status !== 'completed') {
      return res.status(400).json({ error: 'Booking must be completed before reviewing' });
    }

    // Check for existing review
    const existingReview = await pool.query(
      `SELECT id FROM reviews WHERE booking_id::text = $1 AND reviewer_id::text = $2 AND deleted_at IS NULL`,
      [String(booking_id), String(userId)]
    );

    if (existingReview.rows.length > 0) {
      return res.status(400).json({ error: 'You have already reviewed this booking' });
    }

    // Create the review with the actual provider USER ID (not providers table ID).
    //
    // The insert and the rating recompute go in one transaction. Apart they were two
    // independent writes: a failure between them left the review stored but the provider's
    // displayed rating still describing the set of reviews from before it, and two reviews
    // arriving together could both recompute from a snapshot that did not include the
    // other. Nothing surfaces that drift - it just sits there being wrong on the profile.
    const dbClient = await pool.connect();
    let created;
    try {
      await dbClient.query('BEGIN');

      const result = await dbClient.query(
        `INSERT INTO reviews (booking_id, reviewer_id, reviewee_id, rating, comment, is_visible, moderation_status)
         VALUES ($1, $2, $3, $4, $5, TRUE, 'approved')
         RETURNING id, booking_id, rating, comment, created_at`,
        [booking_id, userId, providerUserId, ratingValue, commentValue]
      );
      created = result.rows[0];

      await recomputeProviderRating(dbClient, providerUserId);

      await dbClient.query('COMMIT');
    } catch (txError) {
      try {
        await dbClient.query('ROLLBACK');
      } catch (_e) {
        /* nothing to roll back */
      }
      throw txError;
    } finally {
      dbClient.release();
    }

    console.log('Review created:', created, 'for provider user:', providerUserId);
    res.status(201).json(created);
  } catch (error: any) {
    console.error('Create review error:', error);
    // 23505 covers the same collision the constraint name does, on a database where the
    // constraint was created under a different name.
    if (error.constraint === 'unique_booking_reviewer' || error.code === '23505') {
      return res.status(409).json({ error: 'You have already reviewed this booking' });
    }
    res.status(500).json({ error: 'Failed to create review' });
  }
});

// Update a review (only within 48 hours of creation)
router.put('/:reviewId', verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const { reviewId } = req.params;
    const { rating, comment } = req.body;

    // Verify ownership and check time limit
    const reviewResult = await pool.query(
      `SELECT id, reviewer_id, reviewee_id, created_at
       FROM reviews
       WHERE id = $1 AND deleted_at IS NULL`,
      [reviewId]
    );

    if (reviewResult.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    const review = reviewResult.rows[0];

    if (String(review.reviewer_id) !== String(userId)) {
      return res.status(403).json({ error: 'You can only edit your own reviews' });
    }

    // Check 48-hour edit window
    const hoursSinceCreation = (Date.now() - new Date(review.created_at).getTime()) / (1000 * 60 * 60);
    if (hoursSinceCreation > 48) {
      return res.status(400).json({ error: 'Reviews can only be edited within 48 hours of creation' });
    }

    const ratingValue = parseRating(rating);
    if (ratingValue === null) {
      return res.status(400).json({ error: 'Rating must be a whole number between 1 and 5' });
    }

    const commentCheck = parseBoundedText(comment, MAX_REVIEW_COMMENT, 'Comment');
    if ('error' in commentCheck) {
      return res.status(400).json({ error: commentCheck.error });
    }

    // One transaction, same reasoning as the create path: an edited star rating and the
    // cached average it feeds must not be able to disagree.
    const dbClient = await pool.connect();
    let updated;
    try {
      await dbClient.query('BEGIN');

      const result = await dbClient.query(
        `UPDATE reviews
         SET rating = $1, comment = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $3
         RETURNING id, rating, comment, updated_at`,
        [ratingValue, commentCheck.value, reviewId]
      );
      updated = result.rows[0];

      await recomputeProviderRating(dbClient, String(review.reviewee_id));

      await dbClient.query('COMMIT');
    } catch (txError) {
      try {
        await dbClient.query('ROLLBACK');
      } catch (_e) {
        /* nothing to roll back */
      }
      throw txError;
    } finally {
      dbClient.release();
    }

    res.json(updated);
  } catch (error) {
    console.error('Update review error:', error);
    res.status(500).json({ error: 'Failed to update review' });
  }
});

// Delete a review (soft delete)
router.delete('/:reviewId', verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const { reviewId } = req.params;

    // Verify ownership
    const reviewResult = await pool.query(
      `SELECT id, reviewer_id, reviewee_id FROM reviews WHERE id = $1 AND deleted_at IS NULL`,
      [reviewId]
    );

    if (reviewResult.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    const review = reviewResult.rows[0];

    if (String(review.reviewer_id) !== String(userId)) {
      return res.status(403).json({ error: 'You can only delete your own reviews' });
    }

    // Deleting a review and recomputing the average it fed are one change, so they commit
    // together - otherwise a failure between them leaves a provider's public rating still
    // counting a review that no longer exists.
    const dbClient = await pool.connect();
    try {
      await dbClient.query('BEGIN');

      await dbClient.query(
        `UPDATE reviews SET deleted_at = CURRENT_TIMESTAMP WHERE id::text = $1`,
        [reviewId]
      );

      await recomputeProviderRating(dbClient, String(review.reviewee_id));

      await dbClient.query('COMMIT');
    } catch (txError) {
      try {
        await dbClient.query('ROLLBACK');
      } catch (_e) {
        /* nothing to roll back */
      }
      throw txError;
    } finally {
      dbClient.release();
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete review error:', error);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// Get bookings that can be reviewed (completed but not yet reviewed)
router.get('/pending-reviews', verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.userId;

    const result = await pool.query(
      `SELECT
        b.id as booking_id,
        b.start_date,
        b.total_price,
        u.id as provider_id,
        u.name as provider_name,
        u.profile_image as provider_image,
        s.title as service_title
      FROM bookings b
      JOIN users u ON b.provider_id = u.id
      LEFT JOIN services s ON b.service_id = s.id
      LEFT JOIN reviews r ON r.booking_id = b.id AND r.reviewer_id = $1 AND r.deleted_at IS NULL
      WHERE b.client_id = $1
        AND b.status = 'completed'
        AND r.id IS NULL
      ORDER BY b.start_date DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get pending reviews error:', error);
    res.status(500).json({ error: 'Failed to fetch pending reviews' });
  }
});

export default router;
