import express, { Request, Response } from 'express';
import { pool } from '../config/database';
import { verifyToken } from '../middleware/auth';
import { ensureProviderWallet } from '../services/walletService';
import { MINIMUM_PAYOUT_AMOUNT } from '../config/payoutConfig';

const router = express.Router();

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
        minimum_payout_amount: MINIMUM_PAYOUT_AMOUNT,
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

// Note: there is intentionally no standalone "release pending balance" endpoint here.
// Funds move from pending to available as part of the booking-completion flow itself
// (POST /:id/complete -> PUT /:id/confirm, the 48-hour auto-confirm, or dispute
// resolution, all in bookings.ts) so the release always happens atomically with the
// status transition that authorizes it. A separate endpoint duplicated that logic
// with its own looser idempotency check (a LIKE match on transaction description
// text) that could silently stop guarding against a double release if the wording
// in any of those call sites ever changed.

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
