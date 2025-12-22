import express, { Request, Response } from 'express';
import { pool } from '../config/database';
import { verifyToken } from '../middleware/auth';

const router = express.Router();

// Helper to ensure provider has a wallet
async function ensureProviderWallet(providerId: string): Promise<string> {
  const existing = await pool.query(
    'SELECT id FROM wallets WHERE provider_id::text = $1',
    [providerId]
  );

  if (existing.rows[0]) {
    return existing.rows[0].id;
  }

  const created = await pool.query(
    'INSERT INTO wallets (provider_id) VALUES ($1) RETURNING id',
    [providerId]
  );

  return created.rows[0].id;
}

// Get provider's wallet
router.get('/my', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const providerId = req.userId;
  const role = (req as any).role;

  if (!providerId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (role !== 'provider' && role !== 'admin') {
    return res.status(403).json({ error: 'Only providers can access wallet' });
  }

  try {
    const walletId = await ensureProviderWallet(providerId);

    const walletRes = await pool.query(
      'SELECT * FROM wallets WHERE id::text = $1',
      [walletId]
    );

    const wallet = walletRes.rows[0];

    // Get pending payouts count
    const pendingPayoutsRes = await pool.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
       FROM payouts
       WHERE provider_id::text = $1 AND status IN ('pending', 'approved', 'processing')`,
      [providerId]
    );

    // Get total earnings
    const earningsRes = await pool.query(
      `SELECT COALESCE(SUM(net_provider_amount), 0) as total
       FROM payments
       WHERE provider_id::text = $1 AND status = 'succeeded'`,
      [providerId]
    );

    // Get total paid out
    const paidOutRes = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM payouts
       WHERE provider_id::text = $1 AND status = 'completed'`,
      [providerId]
    );

    return res.json({
      data: {
        ...wallet,
        available_balance: parseFloat(wallet.available_balance),
        pending_balance: parseFloat(wallet.pending_balance),
        total_earnings: parseFloat(earningsRes.rows[0].total),
        total_paid_out: parseFloat(paidOutRes.rows[0].total),
        pending_payouts_count: parseInt(pendingPayoutsRes.rows[0].count),
        pending_payouts_total: parseFloat(pendingPayoutsRes.rows[0].total),
      }
    });
  } catch (error: any) {
    console.error('Error fetching wallet:', error);
    return res.status(500).json({ error: 'Failed to fetch wallet' });
  }
});

// Get wallet by provider ID (admin)
router.get('/provider/:providerId', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const userId = req.userId;
  const role = (req as any).role;
  const providerId = req.params.providerId;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Only admin or the provider themselves can access
  if (role !== 'admin' && userId !== providerId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const walletId = await ensureProviderWallet(providerId);

    const walletRes = await pool.query(
      'SELECT * FROM wallets WHERE id::text = $1',
      [walletId]
    );

    return res.json({ data: walletRes.rows[0] });
  } catch (error: any) {
    console.error('Error fetching wallet:', error);
    return res.status(500).json({ error: 'Failed to fetch wallet' });
  }
});

// Get wallet transactions
router.get('/transactions', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const providerId = req.userId;
  const role = (req as any).role;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;

  if (!providerId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (role !== 'provider' && role !== 'admin') {
    return res.status(403).json({ error: 'Only providers can access transactions' });
  }

  try {
    const walletRes = await pool.query(
      'SELECT id FROM wallets WHERE provider_id::text = $1',
      [providerId]
    );

    if (!walletRes.rows[0]) {
      return res.json({ data: [], meta: { total: 0 } });
    }

    const walletId = walletRes.rows[0].id;

    const transactionsRes = await pool.query(
      `SELECT t.*, p.paymongo_payment_intent_id, b.id as booking_id
       FROM transactions t
       LEFT JOIN payments p ON p.id::text = t.payment_id::text
       LEFT JOIN bookings b ON b.id::text = p.booking_id::text
       WHERE t.wallet_id::text = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [walletId, limit, offset]
    );

    const countRes = await pool.query(
      'SELECT COUNT(*) as total FROM transactions WHERE wallet_id::text = $1',
      [walletId]
    );

    return res.json({
      data: transactionsRes.rows.map(t => ({
        ...t,
        amount: parseFloat(t.amount),
        balance_after: parseFloat(t.balance_after),
      })),
      meta: {
        total: parseInt(countRes.rows[0].total),
        limit,
        offset,
      }
    });
  } catch (error: any) {
    console.error('Error fetching transactions:', error);
    return res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Release pending balance to available (called when service is completed)
router.post('/release-pending', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const userId = req.userId;
  const role = (req as any).role;
  const { booking_id } = req.body;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!booking_id) {
    return res.status(400).json({ error: 'booking_id is required' });
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    // Get booking and payment
    const bookingRes = await dbClient.query(
      `SELECT b.*, p.id as payment_id, p.net_provider_amount, p.status as payment_status
       FROM bookings b
       JOIN payments p ON p.booking_id::text = b.id::text
       WHERE b.id::text = $1`,
      [booking_id]
    );

    if (!bookingRes.rows[0]) {
      await dbClient.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking or payment not found' });
    }

    const booking = bookingRes.rows[0];

    // Verify access - only provider or admin can release
    if (role !== 'admin' && String(booking.provider_id) !== userId) {
      await dbClient.query('ROLLBACK');
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check booking status
    if (booking.status !== 'completed') {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'Can only release funds for completed bookings' });
    }

    // Check payment status
    if (booking.payment_status !== 'succeeded') {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'Payment not completed' });
    }

    const walletRes = await dbClient.query(
      'SELECT * FROM wallets WHERE provider_id::text = $1 FOR UPDATE',
      [booking.provider_id]
    );

    if (!walletRes.rows[0]) {
      await dbClient.query('ROLLBACK');
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const wallet = walletRes.rows[0];
    const amount = parseFloat(booking.net_provider_amount);

    // Check if already released (idempotency)
    const existingRelease = await dbClient.query(
      `SELECT id FROM transactions
       WHERE payment_id::text = $1 AND type = 'payment_received' AND description LIKE '%released%'`,
      [booking.payment_id]
    );

    if (existingRelease.rows[0]) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'Funds already released' });
    }

    // Move from pending to available
    const newPending = parseFloat(wallet.pending_balance) - amount;
    const newAvailable = parseFloat(wallet.available_balance) + amount;

    if (newPending < 0) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient pending balance' });
    }

    await dbClient.query(
      `UPDATE wallets
       SET pending_balance = $1, available_balance = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id::text = $3`,
      [newPending, newAvailable, wallet.id]
    );

    // Record transaction
    await dbClient.query(
      `INSERT INTO transactions (wallet_id, payment_id, type, amount, balance_after, reference_id, description)
       VALUES ($1, $2, 'payment_received', $3, $4, $5, $6)`,
      [
        wallet.id,
        booking.payment_id,
        amount,
        newAvailable,
        `booking_${booking_id}_released`,
        `Funds released for completed booking #${booking_id}`
      ]
    );

    await dbClient.query('COMMIT');

    return res.json({
      data: {
        released_amount: amount,
        new_available_balance: newAvailable,
        new_pending_balance: newPending,
      }
    });
  } catch (error: any) {
    await dbClient.query('ROLLBACK');
    console.error('Error releasing pending balance:', error);
    return res.status(500).json({ error: 'Failed to release pending balance' });
  } finally {
    dbClient.release();
  }
});

// Admin: Manual wallet adjustment
router.post('/adjust', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const adminId = req.userId;
  const role = (req as any).role;
  const { provider_id, amount, type, description } = req.body;

  if (!adminId || role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  if (!provider_id || !amount || !type) {
    return res.status(400).json({ error: 'provider_id, amount, and type are required' });
  }

  const adjustmentAmount = parseFloat(amount);
  if (isNaN(adjustmentAmount) || adjustmentAmount === 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    const walletId = await ensureProviderWallet(provider_id);

    const walletRes = await dbClient.query(
      'SELECT * FROM wallets WHERE id::text = $1 FOR UPDATE',
      [walletId]
    );

    const wallet = walletRes.rows[0];
    let newBalance: number;

    if (type === 'available') {
      newBalance = parseFloat(wallet.available_balance) + adjustmentAmount;
      if (newBalance < 0) {
        await dbClient.query('ROLLBACK');
        return res.status(400).json({ error: 'Adjustment would result in negative balance' });
      }
      await dbClient.query(
        'UPDATE wallets SET available_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id::text = $2',
        [newBalance, walletId]
      );
    } else if (type === 'pending') {
      newBalance = parseFloat(wallet.pending_balance) + adjustmentAmount;
      if (newBalance < 0) {
        await dbClient.query('ROLLBACK');
        return res.status(400).json({ error: 'Adjustment would result in negative balance' });
      }
      await dbClient.query(
        'UPDATE wallets SET pending_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id::text = $2',
        [newBalance, walletId]
      );
    } else {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'type must be "available" or "pending"' });
    }

    await dbClient.query(
      `INSERT INTO transactions (wallet_id, type, amount, balance_after, reference_id, description)
       VALUES ($1, 'adjustment', $2, $3, $4, $5)`,
      [
        walletId,
        adjustmentAmount,
        newBalance,
        `admin_adjustment_${Date.now()}`,
        description || `Admin adjustment by user #${adminId}`
      ]
    );

    await dbClient.query('COMMIT');

    return res.json({
      data: {
        wallet_id: walletId,
        adjustment: adjustmentAmount,
        balance_type: type,
        new_balance: newBalance,
      }
    });
  } catch (error: any) {
    await dbClient.query('ROLLBACK');
    console.error('Error adjusting wallet:', error);
    return res.status(500).json({ error: 'Failed to adjust wallet' });
  } finally {
    dbClient.release();
  }
});

export default router;
