import express, { Request, Response } from 'express';
import { pool } from '../config/database';
import { verifyToken } from '../middleware/auth';
import { auditService } from '../services/auditService';
import { notificationService } from '../services/notificationService';

const router = express.Router();

// Admin middleware - ensure user is admin
const requireAdmin = async (req: Request & { userId?: string }, res: Response, next: Function) => {
  const role = (req as any).role;
  if (role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Apply auth and admin check to all routes
router.use(verifyToken, requireAdmin);

// ==================== DASHBOARD METRICS ====================

router.get('/metrics/overview', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [
      usersResult,
      providersResult,
      bookingsResult,
      revenueResult,
      activeUsersResult,
      pendingVerificationsResult,
      openDisputesResult,
      pendingReviewsResult,
    ] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE deleted_at IS NULL) as total,
          COUNT(*) FILTER (WHERE deleted_at IS NULL AND created_at >= $1) as this_month,
          COUNT(*) FILTER (WHERE deleted_at IS NULL AND created_at >= $2 AND created_at < $3) as last_month
        FROM users
      `, [thisMonth.toISOString(), lastMonth.toISOString(), thisMonth.toISOString()]),

      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE role = 'provider' AND deleted_at IS NULL) as total,
          COUNT(*) FILTER (WHERE role = 'provider' AND deleted_at IS NULL AND is_verified = true) as verified,
          COUNT(*) FILTER (WHERE role = 'provider' AND deleted_at IS NULL AND created_at >= $1) as this_month
        FROM users
      `, [thisMonth.toISOString()]),

      pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE created_at >= $1) as this_month,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
          COUNT(*) FILTER (WHERE status = 'pending') as pending
        FROM bookings WHERE deleted_at IS NULL
      `, [thisMonth.toISOString()]),

      pool.query(`
        SELECT
          COALESCE(SUM(gross_amount), 0) as total_revenue,
          COALESCE(SUM(commission_amount), 0) as total_commission,
          COALESCE(SUM(gross_amount) FILTER (WHERE paid_at >= $1), 0) as this_month_revenue,
          COALESCE(SUM(commission_amount) FILTER (WHERE paid_at >= $1), 0) as this_month_commission,
          COALESCE(SUM(gross_amount) FILTER (WHERE paid_at >= $2 AND paid_at < $3), 0) as last_month_revenue
        FROM payments WHERE status = 'succeeded'
      `, [thisMonth.toISOString(), lastMonth.toISOString(), thisMonth.toISOString()]),

      pool.query(`
        SELECT COUNT(DISTINCT client_id) + COUNT(DISTINCT provider_id) as active_users
        FROM bookings WHERE created_at >= NOW() - INTERVAL '30 days'
      `),

      pool.query(`
        SELECT COUNT(*) as count FROM users
        WHERE role = 'provider' AND deleted_at IS NULL AND verification_status = 'pending'
      `),

      pool.query(`
        SELECT COUNT(*) as count FROM disputes
        WHERE status IN ('open', 'under_review', 'escalated')
      `),

      pool.query(`
        SELECT COUNT(*) as count FROM reviews
        WHERE deleted_at IS NULL AND moderation_status IN ('pending', 'flagged')
      `),
    ]);

    const users = usersResult.rows[0];
    const providers = providersResult.rows[0];
    const bookings = bookingsResult.rows[0];
    const revenue = revenueResult.rows[0];

    const userGrowth = users.last_month > 0
      ? ((parseInt(users.this_month) - parseInt(users.last_month)) / parseInt(users.last_month)) * 100
      : 0;
    const revenueGrowth = parseFloat(revenue.last_month_revenue) > 0
      ? ((parseFloat(revenue.this_month_revenue) - parseFloat(revenue.last_month_revenue)) / parseFloat(revenue.last_month_revenue)) * 100
      : 0;

    return res.json({
      data: {
        users: {
          total: parseInt(users.total),
          thisMonth: parseInt(users.this_month),
          growth: Math.round(userGrowth * 10) / 10,
        },
        providers: {
          total: parseInt(providers.total),
          verified: parseInt(providers.verified),
          thisMonth: parseInt(providers.this_month),
        },
        bookings: {
          total: parseInt(bookings.total),
          thisMonth: parseInt(bookings.this_month),
          completed: parseInt(bookings.completed),
          cancelled: parseInt(bookings.cancelled),
          pending: parseInt(bookings.pending),
        },
        revenue: {
          total: parseFloat(revenue.total_revenue),
          commission: parseFloat(revenue.total_commission),
          thisMonth: parseFloat(revenue.this_month_revenue),
          thisMonthCommission: parseFloat(revenue.this_month_commission),
          growth: Math.round(revenueGrowth * 10) / 10,
        },
        activeUsers: parseInt(activeUsersResult.rows[0].active_users),
        pendingActions: {
          verifications: parseInt(pendingVerificationsResult.rows[0].count),
          disputes: parseInt(openDisputesResult.rows[0].count),
          reviews: parseInt(pendingReviewsResult.rows[0].count),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching admin metrics:', error);
    return res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

router.get('/metrics/revenue-chart', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const period = req.query.period as string || 'month';
    let interval: string;
    let format: string;
    let lookback: string;

    switch (period) {
      case 'week':
        interval = 'day';
        format = 'YYYY-MM-DD';
        lookback = '7 days';
        break;
      case 'year':
        interval = 'month';
        format = 'YYYY-MM';
        lookback = '12 months';
        break;
      default:
        interval = 'day';
        format = 'YYYY-MM-DD';
        lookback = '30 days';
    }

    const result = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC($1, paid_at), $2) as date,
        COALESCE(SUM(gross_amount), 0) as revenue,
        COALESCE(SUM(commission_amount), 0) as commission,
        COUNT(*) as transactions
      FROM payments
      WHERE status = 'succeeded' AND paid_at >= NOW() - INTERVAL '${lookback}'
      GROUP BY DATE_TRUNC($1, paid_at)
      ORDER BY DATE_TRUNC($1, paid_at)
    `, [interval, format]);

    return res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching revenue chart:', error);
    return res.status(500).json({ error: 'Failed to fetch revenue data' });
  }
});

router.get('/metrics/bookings-chart', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const period = req.query.period as string || 'month';
    let lookback = period === 'week' ? '7 days' : period === 'year' ? '12 months' : '30 days';
    let interval = period === 'year' ? 'month' : 'day';
    let format = period === 'year' ? 'YYYY-MM' : 'YYYY-MM-DD';

    const result = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC($1, created_at), $2) as date,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
        COUNT(*) FILTER (WHERE status = 'pending') as pending
      FROM bookings
      WHERE deleted_at IS NULL AND created_at >= NOW() - INTERVAL '${lookback}'
      GROUP BY DATE_TRUNC($1, created_at)
      ORDER BY DATE_TRUNC($1, created_at)
    `, [interval, format]);

    return res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching bookings chart:', error);
    return res.status(500).json({ error: 'Failed to fetch bookings data' });
  }
});

router.get('/metrics/users-chart', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const period = req.query.period as string || 'month';
    let lookback = period === 'week' ? '7 days' : period === 'year' ? '12 months' : '30 days';
    let interval = period === 'year' ? 'month' : 'day';
    let format = period === 'year' ? 'YYYY-MM' : 'YYYY-MM-DD';

    const result = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC($1, created_at), $2) as date,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE role = 'client') as clients,
        COUNT(*) FILTER (WHERE role = 'provider') as providers
      FROM users
      WHERE deleted_at IS NULL AND created_at >= NOW() - INTERVAL '${lookback}'
      GROUP BY DATE_TRUNC($1, created_at)
      ORDER BY DATE_TRUNC($1, created_at)
    `, [interval, format]);

    return res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching users chart:', error);
    return res.status(500).json({ error: 'Failed to fetch users data' });
  }
});

router.get('/metrics/categories', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        COALESCE(u.category, 'Uncategorized') as category,
        COUNT(DISTINCT u.id) as providers,
        COUNT(DISTINCT b.id) as bookings,
        COALESCE(SUM(p.gross_amount), 0) as revenue
      FROM users u
      LEFT JOIN services s ON s.provider_id::text = u.id::text
      LEFT JOIN bookings b ON b.service_id::text = s.id::text AND b.deleted_at IS NULL
      LEFT JOIN payments p ON p.booking_id::text = b.id::text AND p.status = 'succeeded'
      WHERE u.role = 'provider' AND u.deleted_at IS NULL
      GROUP BY u.category
      ORDER BY providers DESC
    `);

    return res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching category metrics:', error);
    return res.status(500).json({ error: 'Failed to fetch category data' });
  }
});

// ==================== USER MANAGEMENT ====================

router.get('/users', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const { search, role, status, verified, limit = '50', offset = '0', sortBy = 'created_at', sortOrder = 'desc' } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(u.name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (role && role !== 'all') {
      conditions.push(`u.role = $${paramIndex}`);
      params.push(role);
      paramIndex++;
    }

    if (status === 'active') {
      conditions.push('u.deleted_at IS NULL');
    } else if (status === 'deleted') {
      conditions.push('u.deleted_at IS NOT NULL');
    }

    if (verified === 'true') {
      conditions.push('u.is_verified = true');
    } else if (verified === 'false') {
      conditions.push('(u.is_verified = false OR u.is_verified IS NULL)');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const validSortColumns = ['created_at', 'name', 'email', 'role'];
    const orderColumn = validSortColumns.includes(sortBy as string) ? sortBy : 'created_at';
    const orderDir = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM users u ${whereClause}`, params);

    // Check if reviews table exists
    const reviewsTableExists = await pool.query(`
      SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'reviews')
    `);
    const hasReviews = reviewsTableExists.rows[0]?.exists;

    const dataQuery = `
      SELECT u.id, u.email, u.name, u.role, u.profile_image, u.category,
             u.is_verified, u.verification_status, u.verified_at,
             u.created_at, u.updated_at, u.deleted_at,
             (SELECT COUNT(*) FROM bookings WHERE client_id::text = u.id::text OR provider_id::text = u.id::text) as booking_count,
             ${hasReviews ? `COALESCE((SELECT AVG(rating) FROM reviews WHERE reviewee_id::text = u.id::text AND deleted_at IS NULL), 0)` : '0'} as avg_rating
      FROM users u ${whereClause}
      ORDER BY u.${orderColumn} ${orderDir}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const dataResult = await pool.query(dataQuery, params);

    return res.json({
      data: dataResult.rows,
      meta: { total: parseInt(countResult.rows[0].total), limit: parseInt(limit as string), offset: parseInt(offset as string) },
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.get('/users/:id', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const userId = req.params.id;

    // Check if reviews table exists
    const reviewsCheck = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'reviews')`);
    const hasReviews = reviewsCheck.rows[0]?.exists;

    const userResult = await pool.query(`
      SELECT u.*,
             (SELECT COUNT(*) FROM bookings WHERE client_id::text = u.id::text) as bookings_as_client,
             (SELECT COUNT(*) FROM bookings WHERE provider_id::text = u.id::text) as bookings_as_provider,
             ${hasReviews ? `(SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE reviewee_id::text = u.id::text AND deleted_at IS NULL)` : '0'} as avg_rating,
             ${hasReviews ? `(SELECT COUNT(*) FROM reviews WHERE reviewee_id::text = u.id::text AND deleted_at IS NULL)` : '0'} as review_count,
             (SELECT COALESCE(SUM(gross_amount), 0) FROM payments WHERE client_id::text = u.id::text AND status = 'succeeded') as total_spent,
             (SELECT COALESCE(SUM(net_provider_amount), 0) FROM payments WHERE provider_id::text = u.id::text AND status = 'succeeded') as total_earned
      FROM users u WHERE u.id::text = $1
    `, [userId]);

    if (!userResult.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    const activityResult = await pool.query(`
      SELECT 'booking' as type, id, status, created_at FROM bookings
      WHERE client_id::text = $1 OR provider_id::text = $1
      ORDER BY created_at DESC LIMIT 10
    `, [userId]);

    return res.json({ data: { ...userResult.rows[0], recentActivity: activityResult.rows } });
  } catch (error) {
    console.error('Error fetching user:', error);
    return res.status(500).json({ error: 'Failed to fetch user' });
  }
});

router.delete('/users/:id', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const adminId = req.userId;
    const userId = req.params.id;
    const { reason } = req.body;

    const currentUser = await pool.query('SELECT * FROM users WHERE id::text = $1', [userId]);
    if (!currentUser.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    await pool.query('UPDATE users SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id::text = $1', [userId]);

    await auditService.logUserAction(adminId!, 'user.delete', userId, { oldValues: { deleted_at: null }, newValues: { deleted_at: new Date().toISOString() }, reason }, req);

    return res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

router.post('/users/:id/restore', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const adminId = req.userId;
    const userId = req.params.id;

    await pool.query('UPDATE users SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id::text = $1', [userId]);

    await auditService.logUserAction(adminId!, 'user.restore', userId, { oldValues: { deleted_at: 'timestamp' }, newValues: { deleted_at: null } }, req);

    return res.json({ message: 'User restored successfully' });
  } catch (error) {
    console.error('Error restoring user:', error);
    return res.status(500).json({ error: 'Failed to restore user' });
  }
});

// ==================== PROVIDER VERIFICATION ====================

router.get('/providers/pending-verification', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.name, u.profile_image, u.category, u.bio,
             u.years_experience, u.location, u.verification_status, u.verification_documents, u.created_at,
             (SELECT COUNT(*) FROM services WHERE provider_id::text = u.id::text) as service_count
      FROM users u
      WHERE u.role = 'provider' AND u.deleted_at IS NULL AND u.verification_status = 'pending'
      ORDER BY u.created_at ASC
    `);

    return res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching pending verifications:', error);
    return res.status(500).json({ error: 'Failed to fetch pending verifications' });
  }
});

router.post('/providers/:id/verify', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const adminId = req.userId;
    const providerId = req.params.id;

    await pool.query(`
      UPDATE users SET is_verified = true, verification_status = 'approved', verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id::text = $1
    `, [providerId]);

    await auditService.logUserAction(adminId!, 'provider.verify', providerId, { newValues: { is_verified: true, verification_status: 'approved' } }, req);

    await notificationService.create({
      userId: providerId,
      type: 'system',
      title: 'Verification Approved',
      message: 'Congratulations! Your provider account has been verified.',
      data: { action: 'verification_approved' },
    });

    return res.json({ message: 'Provider verified successfully' });
  } catch (error) {
    console.error('Error verifying provider:', error);
    return res.status(500).json({ error: 'Failed to verify provider' });
  }
});

router.post('/providers/:id/reject', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const adminId = req.userId;
    const providerId = req.params.id;
    const { reason } = req.body;

    await pool.query(`UPDATE users SET verification_status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id::text = $1`, [providerId]);

    await auditService.logUserAction(adminId!, 'provider.reject', providerId, { newValues: { verification_status: 'rejected' }, reason }, req);

    await notificationService.create({
      userId: providerId,
      type: 'system',
      title: 'Verification Rejected',
      message: `Your verification request was not approved. Reason: ${reason || 'Does not meet requirements'}`,
      data: { action: 'verification_rejected', reason },
    });

    return res.json({ message: 'Provider verification rejected' });
  } catch (error) {
    console.error('Error rejecting provider:', error);
    return res.status(500).json({ error: 'Failed to reject provider' });
  }
});

// ==================== REVIEW MODERATION ====================

router.get('/reviews', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const { status = 'all', limit = '50', offset = '0' } = req.query;

    const conditions: string[] = ['r.deleted_at IS NULL'];
    const params: any[] = [];
    let paramIndex = 1;

    if (status !== 'all') {
      conditions.push(`r.moderation_status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM reviews r ${whereClause}`, params);

    const dataQuery = `
      SELECT r.*, reviewer.name as reviewer_name, reviewer.email as reviewer_email,
             reviewee.name as reviewee_name, reviewee.email as reviewee_email,
             b.id as booking_id, s.title as service_title
      FROM reviews r
      JOIN users reviewer ON reviewer.id::text = r.reviewer_id::text
      JOIN users reviewee ON reviewee.id::text = r.reviewee_id::text
      LEFT JOIN bookings b ON b.id::text = r.booking_id::text
      LEFT JOIN services s ON s.id::text = b.service_id::text
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const dataResult = await pool.query(dataQuery, params);

    return res.json({
      data: dataResult.rows,
      meta: { total: parseInt(countResult.rows[0].total), limit: parseInt(limit as string), offset: parseInt(offset as string) },
    });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    return res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

router.patch('/reviews/:id/moderate', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const adminId = req.userId;
    const reviewId = req.params.id;
    const { action, reason } = req.body;

    const oldReview = await pool.query('SELECT * FROM reviews WHERE id::text = $1', [reviewId]);
    if (!oldReview.rows[0]) {
      return res.status(404).json({ error: 'Review not found' });
    }

    let status: string;
    let visible = true;

    switch (action) {
      case 'approve': status = 'approved'; visible = true; break;
      case 'reject': status = 'rejected'; visible = false; break;
      case 'flag': status = 'flagged'; visible = false; break;
      default: return res.status(400).json({ error: 'Invalid action' });
    }

    await pool.query(`
      UPDATE reviews SET moderation_status = $1, moderation_reason = $2, moderated_by = $3,
                         moderated_at = CURRENT_TIMESTAMP, is_visible = $4, updated_at = CURRENT_TIMESTAMP
      WHERE id::text = $5
    `, [status, reason, adminId, visible, reviewId]);

    await auditService.logReviewAction(adminId!, `review.${action}` as any, reviewId, {
      oldValues: { moderation_status: oldReview.rows[0].moderation_status },
      newValues: { moderation_status: status }, reason,
    }, req);

    return res.json({ message: `Review ${action}ed successfully` });
  } catch (error) {
    console.error('Error moderating review:', error);
    return res.status(500).json({ error: 'Failed to moderate review' });
  }
});

router.delete('/reviews/:id', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const adminId = req.userId;
    const reviewId = req.params.id;
    const { reason } = req.body;

    await pool.query('UPDATE reviews SET deleted_at = CURRENT_TIMESTAMP WHERE id::text = $1', [reviewId]);

    await auditService.logReviewAction(adminId!, 'review.delete', reviewId, { newValues: { deleted_at: new Date().toISOString() }, reason }, req);

    return res.json({ message: 'Review deleted successfully' });
  } catch (error) {
    console.error('Error deleting review:', error);
    return res.status(500).json({ error: 'Failed to delete review' });
  }
});

// ==================== DISPUTE MANAGEMENT ====================

router.get('/disputes', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const { status = 'all', priority, limit = '50', offset = '0' } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (status !== 'all') {
      conditions.push(`d.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (priority) {
      conditions.push(`d.priority = $${paramIndex}`);
      params.push(priority);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM disputes d ${whereClause}`, params);

    const dataQuery = `
      SELECT d.*, raised.name as raised_by_name, raised.email as raised_by_email,
             against.name as against_name, against.email as against_email,
             assigned.name as assigned_to_name,
             b.id as booking_id, s.title as service_title
      FROM disputes d
      JOIN users raised ON raised.id::text = d.raised_by::text
      JOIN users against ON against.id::text = d.against_user::text
      LEFT JOIN users assigned ON assigned.id::text = d.assigned_to::text
      LEFT JOIN bookings b ON b.id::text = d.booking_id::text
      LEFT JOIN services s ON s.id::text = b.service_id::text
      ${whereClause}
      ORDER BY CASE d.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END, d.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const dataResult = await pool.query(dataQuery, params);

    return res.json({
      data: dataResult.rows,
      meta: { total: parseInt(countResult.rows[0].total), limit: parseInt(limit as string), offset: parseInt(offset as string) },
    });
  } catch (error) {
    console.error('Error fetching disputes:', error);
    return res.status(500).json({ error: 'Failed to fetch disputes' });
  }
});

router.get('/disputes/:id', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const disputeId = req.params.id;

    const disputeResult = await pool.query(`
      SELECT d.*, raised.name as raised_by_name, raised.email as raised_by_email,
             against.name as against_name, against.email as against_email,
             assigned.name as assigned_to_name, resolved.name as resolved_by_name,
             b.id as booking_id, b.start_date, b.end_date, b.status as booking_status,
             s.title as service_title, s.price as service_price
      FROM disputes d
      JOIN users raised ON raised.id::text = d.raised_by::text
      JOIN users against ON against.id::text = d.against_user::text
      LEFT JOIN users assigned ON assigned.id::text = d.assigned_to::text
      LEFT JOIN users resolved ON resolved.id::text = d.resolved_by::text
      LEFT JOIN bookings b ON b.id::text = d.booking_id::text
      LEFT JOIN services s ON s.id::text = b.service_id::text
      WHERE d.id::text = $1
    `, [disputeId]);

    if (!disputeResult.rows[0]) {
      return res.status(404).json({ error: 'Dispute not found' });
    }

    const commentsResult = await pool.query(`
      SELECT dc.*, u.name as user_name, u.role as user_role
      FROM dispute_comments dc JOIN users u ON u.id::text = dc.user_id::text
      WHERE dc.dispute_id::text = $1 ORDER BY dc.created_at ASC
    `, [disputeId]);

    return res.json({ data: { ...disputeResult.rows[0], comments: commentsResult.rows } });
  } catch (error) {
    console.error('Error fetching dispute:', error);
    return res.status(500).json({ error: 'Failed to fetch dispute' });
  }
});

router.patch('/disputes/:id', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const adminId = req.userId;
    const disputeId = req.params.id;
    const { status, priority, assigned_to } = req.body;

    const oldDispute = await pool.query('SELECT * FROM disputes WHERE id::text = $1', [disputeId]);
    if (!oldDispute.rows[0]) {
      return res.status(404).json({ error: 'Dispute not found' });
    }

    const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const values: any[] = [];
    let paramIndex = 1;

    if (status) { updates.push(`status = $${paramIndex}`); values.push(status); paramIndex++; }
    if (priority) { updates.push(`priority = $${paramIndex}`); values.push(priority); paramIndex++; }
    if (assigned_to !== undefined) { updates.push(`assigned_to = $${paramIndex}`); values.push(assigned_to || null); paramIndex++; }

    values.push(disputeId);
    await pool.query(`UPDATE disputes SET ${updates.join(', ')} WHERE id::text = $${paramIndex}`, values);

    await auditService.logDisputeAction(adminId!, 'dispute.update', disputeId, {
      oldValues: { status: oldDispute.rows[0].status, priority: oldDispute.rows[0].priority },
      newValues: { status, priority },
    }, req);

    return res.json({ message: 'Dispute updated successfully' });
  } catch (error) {
    console.error('Error updating dispute:', error);
    return res.status(500).json({ error: 'Failed to update dispute' });
  }
});

router.post('/disputes/:id/resolve', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const adminId = req.userId;
    const disputeId = req.params.id;
    const { resolution, resolution_type, refund_amount } = req.body;

    await pool.query(`
      UPDATE disputes SET status = 'resolved', resolution = $1, resolution_type = $2, refund_amount = $3,
                          resolved_by = $4, resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id::text = $5
    `, [resolution, resolution_type, refund_amount || null, adminId, disputeId]);

    await auditService.logDisputeAction(adminId!, 'dispute.resolve', disputeId, { newValues: { resolution_type, refund_amount }, resolution }, req);

    const dispute = await pool.query('SELECT raised_by, against_user FROM disputes WHERE id::text = $1', [disputeId]);
    if (dispute.rows[0]) {
      await notificationService.create({
        userId: dispute.rows[0].raised_by,
        type: 'system',
        title: 'Dispute Resolved',
        message: `Your dispute has been resolved. Resolution: ${resolution_type}`,
        data: { dispute_id: disputeId, resolution_type },
      });
      await notificationService.create({
        userId: dispute.rows[0].against_user,
        type: 'system',
        title: 'Dispute Resolved',
        message: `A dispute against you has been resolved. Resolution: ${resolution_type}`,
        data: { dispute_id: disputeId, resolution_type },
      });
    }

    return res.json({ message: 'Dispute resolved successfully' });
  } catch (error) {
    console.error('Error resolving dispute:', error);
    return res.status(500).json({ error: 'Failed to resolve dispute' });
  }
});

router.post('/disputes/:id/comments', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const adminId = req.userId;
    const disputeId = req.params.id;
    const { comment, is_internal = true } = req.body;

    const result = await pool.query(`
      INSERT INTO dispute_comments (dispute_id, user_id, comment, is_internal)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [disputeId, adminId, comment, is_internal]);

    await auditService.logDisputeAction(adminId!, 'dispute.comment', disputeId, { newValues: { comment_id: result.rows[0].id, is_internal } }, req);

    return res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error adding comment:', error);
    return res.status(500).json({ error: 'Failed to add comment' });
  }
});

// ==================== AUDIT LOGS ====================

router.get('/audit-logs', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const { userId, action, entityType, entityId, startDate, endDate, limit = '50', offset = '0' } = req.query;

    const result = await auditService.getLogs({
      userId: userId as string,
      action: action as string,
      entityType: entityType as string,
      entityId: entityId as string,
      startDate: startDate as string,
      endDate: endDate as string,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });

    return res.json({
      data: result.data,
      meta: { total: result.total, limit: parseInt(limit as string), offset: parseInt(offset as string) },
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// ==================== BOOKINGS MANAGEMENT ====================

router.get('/bookings', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const { status = 'all', limit = '50', offset = '0' } = req.query;

    const conditions: string[] = ['b.deleted_at IS NULL'];
    const params: any[] = [];
    let paramIndex = 1;

    if (status !== 'all') {
      conditions.push(`b.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM bookings b ${whereClause}`, params);

    const dataQuery = `
      SELECT b.*, client.name as client_name, client.email as client_email,
             provider.name as provider_name, provider.email as provider_email,
             s.title as service_title, s.price as service_price,
             p.status as payment_status, p.gross_amount as payment_amount
      FROM bookings b
      JOIN users client ON client.id::text = b.client_id::text
      JOIN users provider ON provider.id::text = b.provider_id::text
      LEFT JOIN services s ON s.id::text = b.service_id::text
      LEFT JOIN payments p ON p.booking_id::text = b.id::text
      ${whereClause}
      ORDER BY b.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const dataResult = await pool.query(dataQuery, params);

    return res.json({
      data: dataResult.rows,
      meta: { total: parseInt(countResult.rows[0].total), limit: parseInt(limit as string), offset: parseInt(offset as string) },
    });
  } catch (error) {
    console.error('Error fetching bookings:', error);
    return res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// ==================== PAYMENTS ====================

router.get('/payments', async (req: Request & { userId?: string }, res: Response) => {
  try {
    const { status, limit = '50', offset = '0' } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (status && status !== 'all') {
      conditions.push(`p.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM payments p ${whereClause}`, params);

    const dataQuery = `
      SELECT p.*, client.name as client_name, provider.name as provider_name,
             b.id as booking_id, s.title as service_title
      FROM payments p
      JOIN users client ON client.id::text = p.client_id::text
      JOIN users provider ON provider.id::text = p.provider_id::text
      LEFT JOIN bookings b ON b.id::text = p.booking_id::text
      LEFT JOIN services s ON s.id::text = b.service_id::text
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const dataResult = await pool.query(dataQuery, params);

    return res.json({
      data: dataResult.rows,
      meta: { total: parseInt(countResult.rows[0].total), limit: parseInt(limit as string), offset: parseInt(offset as string) },
    });
  } catch (error) {
    console.error('Error fetching payments:', error);
    return res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

export default router;
