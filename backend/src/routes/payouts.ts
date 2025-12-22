import express, { Request, Response } from 'express';
import { pool } from '../config/database';
import { verifyToken } from '../middleware/auth';
import { notificationService } from '../services/notificationService';

const router = express.Router();

// Minimum payout amount
const MINIMUM_PAYOUT_AMOUNT = parseFloat(process.env.MINIMUM_PAYOUT_AMOUNT || '500'); // 500 PHP

// Request a payout
router.post('/request', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const providerId = req.userId;
  const role = (req as any).role;
  const { amount, payout_method, payout_details } = req.body;

  if (!providerId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (role !== 'provider' && role !== 'admin') {
    return res.status(403).json({ error: 'Only providers can request payouts' });
  }

  const payoutAmount = parseFloat(amount);
  if (isNaN(payoutAmount) || payoutAmount <= 0) {
    return res.status(400).json({ error: 'Invalid payout amount' });
  }

  if (payoutAmount < MINIMUM_PAYOUT_AMOUNT) {
    return res.status(400).json({
      error: `Minimum payout amount is ${MINIMUM_PAYOUT_AMOUNT} PHP`,
      minimum: MINIMUM_PAYOUT_AMOUNT
    });
  }

  if (!payout_method) {
    return res.status(400).json({ error: 'payout_method is required' });
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    // Get wallet with lock
    const walletRes = await dbClient.query(
      'SELECT * FROM wallets WHERE provider_id::text = $1 FOR UPDATE',
      [providerId]
    );

    if (!walletRes.rows[0]) {
      await dbClient.query('ROLLBACK');
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const wallet = walletRes.rows[0];
    const availableBalance = parseFloat(wallet.available_balance);

    if (payoutAmount > availableBalance) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({
        error: 'Insufficient available balance',
        available: availableBalance,
        requested: payoutAmount
      });
    }

    // Check for existing pending payouts
    const pendingPayouts = await dbClient.query(
      `SELECT COUNT(*) as count FROM payouts
       WHERE provider_id::text = $1 AND status IN ('pending', 'approved', 'processing')`,
      [providerId]
    );

    if (parseInt(pendingPayouts.rows[0].count) >= 3) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'You have too many pending payout requests. Please wait for them to be processed.' });
    }

    // Create payout request
    const payoutRes = await dbClient.query(
      `INSERT INTO payouts (provider_id, wallet_id, amount, payout_method, payout_details, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING *`,
      [providerId, wallet.id, payoutAmount, payout_method, JSON.stringify(payout_details || {})]
    );

    const payout = payoutRes.rows[0];

    // Deduct from available balance (hold for payout)
    const newAvailableBalance = availableBalance - payoutAmount;
    await dbClient.query(
      'UPDATE wallets SET available_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id::text = $2',
      [newAvailableBalance, wallet.id]
    );

    // Record transaction
    await dbClient.query(
      `INSERT INTO transactions (wallet_id, payout_id, type, amount, balance_after, reference_id, description)
       VALUES ($1, $2, 'payout_requested', $3, $4, $5, $6)`,
      [
        wallet.id,
        payout.id,
        -payoutAmount,
        newAvailableBalance,
        `payout_${payout.id}`,
        `Payout request of ${payoutAmount} PHP via ${payout_method}`
      ]
    );

    await dbClient.query('COMMIT');

    return res.status(201).json({
      data: {
        ...payout,
        amount: parseFloat(payout.amount),
        new_available_balance: newAvailableBalance,
      }
    });
  } catch (error: any) {
    await dbClient.query('ROLLBACK');
    console.error('Error requesting payout:', error);
    return res.status(500).json({ error: 'Failed to request payout' });
  } finally {
    dbClient.release();
  }
});

// Get provider's payout history
router.get('/my', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const providerId = req.userId;
  const role = (req as any).role;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  const status = req.query.status as string;

  if (!providerId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (role !== 'provider' && role !== 'admin') {
    return res.status(403).json({ error: 'Only providers can view their payouts' });
  }

  try {
    let query = `SELECT * FROM payouts WHERE provider_id::text = $1`;
    const params: any[] = [providerId];
    let paramIndex = 2;

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ` ORDER BY requested_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const payoutsRes = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) as total FROM payouts WHERE provider_id::text = $1`;
    const countParams: any[] = [providerId];
    if (status) {
      countQuery += ` AND status = $2`;
      countParams.push(status);
    }

    const countRes = await pool.query(countQuery, countParams);

    return res.json({
      data: payoutsRes.rows.map(p => ({
        ...p,
        amount: parseFloat(p.amount),
      })),
      meta: {
        total: parseInt(countRes.rows[0].total),
        limit,
        offset,
      }
    });
  } catch (error: any) {
    console.error('Error fetching payouts:', error);
    return res.status(500).json({ error: 'Failed to fetch payouts' });
  }
});

// Get specific payout
router.get('/:id', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const userId = req.userId;
  const role = (req as any).role;
  const payoutId = req.params.id;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const payoutRes = await pool.query(
      `SELECT p.*, u.name as provider_name, u.email as provider_email
       FROM payouts p
       JOIN users u ON u.id::text = p.provider_id::text
       WHERE p.id::text = $1`,
      [payoutId]
    );

    if (!payoutRes.rows[0]) {
      return res.status(404).json({ error: 'Payout not found' });
    }

    const payout = payoutRes.rows[0];

    // Check access
    if (role !== 'admin' && String(payout.provider_id) !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.json({
      data: {
        ...payout,
        amount: parseFloat(payout.amount),
      }
    });
  } catch (error: any) {
    console.error('Error fetching payout:', error);
    return res.status(500).json({ error: 'Failed to fetch payout' });
  }
});

// Admin: Get all payouts
router.get('/', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const userId = req.userId;
  const role = (req as any).role;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  const status = req.query.status as string;

  if (!userId || role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    let query = `
      SELECT p.*, u.name as provider_name, u.email as provider_email
      FROM payouts p
      JOIN users u ON u.id::text = p.provider_id::text
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (status) {
      query += ` WHERE p.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ` ORDER BY p.requested_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const payoutsRes = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) as total FROM payouts`;
    const countParams: any[] = [];
    if (status) {
      countQuery += ` WHERE status = $1`;
      countParams.push(status);
    }

    const countRes = await pool.query(countQuery, countParams);

    return res.json({
      data: payoutsRes.rows.map(p => ({
        ...p,
        amount: parseFloat(p.amount),
      })),
      meta: {
        total: parseInt(countRes.rows[0].total),
        limit,
        offset,
      }
    });
  } catch (error: any) {
    console.error('Error fetching all payouts:', error);
    return res.status(500).json({ error: 'Failed to fetch payouts' });
  }
});

// Admin: Update payout status
router.patch('/:id/status', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const adminId = req.userId;
  const role = (req as any).role;
  const payoutId = req.params.id;
  const { status, admin_notes, rejection_reason } = req.body;

  if (!adminId || role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  if (!status) {
    return res.status(400).json({ error: 'status is required' });
  }

  const validStatuses = ['approved', 'rejected', 'processing', 'completed', 'failed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    // Get payout with lock
    const payoutRes = await dbClient.query(
      'SELECT * FROM payouts WHERE id::text = $1 FOR UPDATE',
      [payoutId]
    );

    if (!payoutRes.rows[0]) {
      await dbClient.query('ROLLBACK');
      return res.status(404).json({ error: 'Payout not found' });
    }

    const payout = payoutRes.rows[0];
    const currentStatus = payout.status;

    // Validate status transitions
    const validTransitions: Record<string, string[]> = {
      'pending': ['approved', 'rejected'],
      'approved': ['processing', 'rejected'],
      'processing': ['completed', 'failed'],
      'rejected': [],
      'completed': [],
      'failed': ['pending'], // Allow retry
    };

    if (!validTransitions[currentStatus]?.includes(status)) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({
        error: `Cannot transition from ${currentStatus} to ${status}`,
        valid_transitions: validTransitions[currentStatus]
      });
    }

    // Get wallet for potential refund
    const walletRes = await dbClient.query(
      'SELECT * FROM wallets WHERE id::text = $1 FOR UPDATE',
      [payout.wallet_id]
    );
    const wallet = walletRes.rows[0];

    // Handle status-specific actions
    let updates = `status = $1, admin_notes = COALESCE($2, admin_notes), updated_at = CURRENT_TIMESTAMP`;
    let updateParams: any[] = [status, admin_notes];
    let paramIndex = 3;

    if (status === 'rejected') {
      updates += `, rejection_reason = $${paramIndex}, processed_at = CURRENT_TIMESTAMP`;
      updateParams.push(rejection_reason || 'Rejected by admin');
      paramIndex++;

      // Refund to available balance
      const refundAmount = parseFloat(payout.amount);
      const newAvailableBalance = parseFloat(wallet.available_balance) + refundAmount;

      await dbClient.query(
        'UPDATE wallets SET available_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id::text = $2',
        [newAvailableBalance, wallet.id]
      );

      // Record refund transaction
      await dbClient.query(
        `INSERT INTO transactions (wallet_id, payout_id, type, amount, balance_after, reference_id, description)
         VALUES ($1, $2, 'payout_cancelled', $3, $4, $5, $6)`,
        [
          wallet.id,
          payout.id,
          refundAmount,
          newAvailableBalance,
          `payout_rejected_${payout.id}`,
          `Payout request rejected: ${rejection_reason || 'Rejected by admin'}`
        ]
      );
    } else if (status === 'approved') {
      updates += `, processed_at = CURRENT_TIMESTAMP`;
    } else if (status === 'completed') {
      updates += `, completed_at = CURRENT_TIMESTAMP`;

      // Record completion transaction
      await dbClient.query(
        `INSERT INTO transactions (wallet_id, payout_id, type, amount, balance_after, reference_id, description)
         VALUES ($1, $2, 'payout_completed', $3, $4, $5, $6)`,
        [
          wallet.id,
          payout.id,
          -parseFloat(payout.amount),
          parseFloat(wallet.available_balance),
          `payout_completed_${payout.id}`,
          `Payout of ${payout.amount} PHP completed via ${payout.payout_method}`
        ]
      );
    } else if (status === 'failed') {
      // Refund to available balance
      const refundAmount = parseFloat(payout.amount);
      const newAvailableBalance = parseFloat(wallet.available_balance) + refundAmount;

      await dbClient.query(
        'UPDATE wallets SET available_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id::text = $2',
        [newAvailableBalance, wallet.id]
      );

      // Record refund transaction
      await dbClient.query(
        `INSERT INTO transactions (wallet_id, payout_id, type, amount, balance_after, reference_id, description)
         VALUES ($1, $2, 'payout_cancelled', $3, $4, $5, $6)`,
        [
          wallet.id,
          payout.id,
          refundAmount,
          newAvailableBalance,
          `payout_failed_${payout.id}`,
          `Payout failed and refunded: ${admin_notes || 'Processing failed'}`
        ]
      );
    }

    updateParams.push(payoutId);
    await dbClient.query(
      `UPDATE payouts SET ${updates} WHERE id::text = $${paramIndex}`,
      updateParams
    );

    await dbClient.query('COMMIT');

    // Fetch updated payout
    const updatedPayout = await pool.query(
      `SELECT p.*, u.name as provider_name
       FROM payouts p
       JOIN users u ON u.id::text = p.provider_id::text
       WHERE p.id::text = $1`,
      [payoutId]
    );

    // Send notification to provider about payout status change
    try {
      const payoutAmount = parseFloat(payout.amount);

      if (status === 'approved') {
        await notificationService.notifyPayoutApproved(
          String(payout.provider_id),
          payoutAmount,
          payoutId
        );
      } else if (status === 'rejected') {
        await notificationService.notifyPayoutRejected(
          String(payout.provider_id),
          payoutAmount,
          payoutId,
          rejection_reason || 'Request could not be approved'
        );
      } else if (status === 'completed') {
        await notificationService.notifyPayoutCompleted(
          String(payout.provider_id),
          payoutAmount,
          payoutId
        );
      }
    } catch (notifError) {
      console.error('Failed to send payout notification:', notifError);
    }

    return res.json({
      data: {
        ...updatedPayout.rows[0],
        amount: parseFloat(updatedPayout.rows[0].amount),
      }
    });
  } catch (error: any) {
    await dbClient.query('ROLLBACK');
    console.error('Error updating payout status:', error);
    return res.status(500).json({ error: 'Failed to update payout status' });
  } finally {
    dbClient.release();
  }
});

// Cancel payout request (by provider, only if pending)
router.delete('/:id', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const providerId = req.userId;
  const role = (req as any).role;
  const payoutId = req.params.id;

  if (!providerId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    const payoutRes = await dbClient.query(
      'SELECT * FROM payouts WHERE id::text = $1 FOR UPDATE',
      [payoutId]
    );

    if (!payoutRes.rows[0]) {
      await dbClient.query('ROLLBACK');
      return res.status(404).json({ error: 'Payout not found' });
    }

    const payout = payoutRes.rows[0];

    // Check ownership
    if (role !== 'admin' && String(payout.provider_id) !== providerId) {
      await dbClient.query('ROLLBACK');
      return res.status(403).json({ error: 'Access denied' });
    }

    // Can only cancel pending payouts
    if (payout.status !== 'pending') {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'Can only cancel pending payout requests' });
    }

    // Get wallet
    const walletRes = await dbClient.query(
      'SELECT * FROM wallets WHERE id::text = $1 FOR UPDATE',
      [payout.wallet_id]
    );
    const wallet = walletRes.rows[0];

    // Refund to available balance
    const refundAmount = parseFloat(payout.amount);
    const newAvailableBalance = parseFloat(wallet.available_balance) + refundAmount;

    await dbClient.query(
      'UPDATE wallets SET available_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id::text = $2',
      [newAvailableBalance, wallet.id]
    );

    // Update payout status
    await dbClient.query(
      `UPDATE payouts SET status = 'rejected', rejection_reason = 'Cancelled by user', updated_at = CURRENT_TIMESTAMP WHERE id::text = $1`,
      [payoutId]
    );

    // Record refund transaction
    await dbClient.query(
      `INSERT INTO transactions (wallet_id, payout_id, type, amount, balance_after, reference_id, description)
       VALUES ($1, $2, 'payout_cancelled', $3, $4, $5, $6)`,
      [
        wallet.id,
        payout.id,
        refundAmount,
        newAvailableBalance,
        `payout_cancelled_${payout.id}`,
        `Payout request cancelled by user`
      ]
    );

    await dbClient.query('COMMIT');

    return res.json({
      data: {
        message: 'Payout request cancelled',
        refunded_amount: refundAmount,
        new_available_balance: newAvailableBalance,
      }
    });
  } catch (error: any) {
    await dbClient.query('ROLLBACK');
    console.error('Error cancelling payout:', error);
    return res.status(500).json({ error: 'Failed to cancel payout' });
  } finally {
    dbClient.release();
  }
});

export default router;
