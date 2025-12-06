import express, { Request, Response } from 'express';
import { pool } from '../config/database';
import { verifyToken } from '../middleware/auth';


const router = express.Router();

// Create a new booking (protected)
router.post('/', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const clientId = req.userId; // from verifyToken
  const { provider_id, service_id, start_date, end_date, total_price } = req.body;

  if (!clientId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!provider_id || !service_id || !start_date || !end_date || !total_price) {
    return res.status(400).json({ error: 'Missing required booking fields' });
  }

  try {
    // Convert clientId to integer for database
    const clientIdInt = parseInt(clientId, 10);
    if (isNaN(clientIdInt)) {
      return res.status(400).json({ error: 'Invalid client ID' });
    }

    // Ensure provider_id and service_id are integers
    const providerIdInt = typeof provider_id === 'string' ? parseInt(provider_id, 10) : provider_id;
    const serviceIdInt = typeof service_id === 'string' ? parseInt(service_id, 10) : service_id;

    if (isNaN(providerIdInt) || isNaN(serviceIdInt)) {
      return res.status(400).json({ error: 'Invalid provider_id or service_id' });
    }

    const insertQuery = `
      INSERT INTO bookings (client_id, provider_id, service_id, start_date, end_date, status, total_price)
      VALUES ($1, $2, $3, $4, $5, 'pending', $6)
      RETURNING *
    `;

    const values = [clientIdInt, providerIdInt, serviceIdInt, start_date, end_date, total_price];

    const result = await pool.query(insertQuery, values);
    const booking = result.rows[0];

    return res.status(201).json({ data: booking });
  } catch (error: any) {
    console.error('Error creating booking:', error);
    // Provide more detailed error information
    const errorMessage = error?.message || 'Failed to create booking';
    const errorDetail = error?.detail || '';
    
    // Check for common database errors
    if (error?.code === '23503') {
      // Foreign key constraint violation
      return res.status(400).json({ 
        error: 'Invalid reference: provider, service, or client does not exist',
        detail: errorDetail
      });
    }
    
    if (error?.code === '23514') {
      // Check constraint violation
      return res.status(400).json({ 
        error: 'Invalid data: constraint violation',
        detail: errorDetail
      });
    }

    return res.status(500).json({ 
      error: 'Failed to create booking',
      detail: process.env.NODE_ENV !== 'production' ? errorMessage : undefined
    });
  }
});

// Optionally: add GET endpoints for user's bookings (protected)
router.get('/my', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const clientId = req.userId;
  if (!clientId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const q = `SELECT b.*, s.title as service_title, u.name as provider_name FROM bookings b
      JOIN services s ON s.id = b.service_id
      JOIN users u ON u.id = b.provider_id
      WHERE b.client_id = $1 ORDER BY b.created_at DESC`;
    const { rows } = await pool.query(q, [clientId]);
    return res.json({ data: rows });
  } catch (error) {
    console.error('Error fetching bookings for user:', error);
    return res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

export default router;
