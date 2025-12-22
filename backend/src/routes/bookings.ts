import express, { Request, Response } from 'express';
import { pool } from '../config/database';
import { verifyToken } from '../middleware/auth';
import { notificationService } from '../services/notificationService';


const router = express.Router();

function parseId(v: any): string | null {
  if (!v) return null;
  const str = String(v).trim();
  if (!str || str === 'undefined' || str === 'null') return null;
  return str;
}

// Get the correct ID for a foreign key column (handles both direct users reference and separate tables)
async function getIdForForeignKey(userId: string, columnName: string, targetTable: string): Promise<string> {
  try {
    // Check what table the column references
    const fkCheck = await pool.query(`
      SELECT ccu.table_name AS foreign_table_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'bookings'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = $1
      LIMIT 1
    `, [columnName]);

    const refTable = fkCheck.rows[0]?.foreign_table_name;

    if (refTable && refTable !== 'users' && refTable === targetTable) {
      // Need to get or create record in the referenced table
      const existingResult = await pool.query(
        `SELECT id FROM ${targetTable} WHERE user_id::text = $1`,
        [userId]
      );

      if (existingResult.rows.length > 0) {
        return existingResult.rows[0].id;
      }

      // Create record if it doesn't exist
      const newRecord = await pool.query(
        `INSERT INTO ${targetTable} (user_id) VALUES ($1) RETURNING id`,
        [userId]
      );
      return newRecord.rows[0].id;
    }
  } catch (error) {
    console.log(`Could not check ${columnName} reference, using userId directly:`, error);
  }

  // If references users directly or error, return userId
  return userId;
}

// Get provider record ID from user ID
async function getProviderIdFromUserId(userId: string): Promise<string> {
  return getIdForForeignKey(userId, 'provider_id', 'providers');
}

// Get client record ID from user ID
async function getClientIdFromUserId(userId: string): Promise<string> {
  return getIdForForeignKey(userId, 'client_id', 'clients');
}

async function getServiceDurationMinutes(serviceId: string) {
  try {
    const res = await pool.query('SELECT duration_minutes FROM services WHERE id::text = $1', [serviceId]);
    const v = res.rows[0]?.duration_minutes;
    const n = typeof v === 'string' ? parseInt(v, 10) : v;
    return Number.isFinite(n) && n > 0 ? n : 60;
  } catch (e) {
    return 60;
  }
}

async function autoCompletePastBookings(providerId?: string) {
  if (!providerId) return;

  try {
    await pool.query(
      `
        UPDATE bookings
        SET status = 'completed',
            completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE status IN ('accepted', 'confirmed')
          AND end_date < CURRENT_TIMESTAMP
          AND provider_id::text = $1
      `,
      [providerId]
    );
  } catch (e) {
    console.log('autoCompletePastBookings error (non-fatal):', e);
  }
}

async function ensureBookingChatExists(bookingId: string, clientId: string, providerId: string) {
  const existing = await pool.query('SELECT id FROM chats WHERE booking_id::text = $1', [bookingId]);
  if (existing.rows[0]) return existing.rows[0].id as number;

  const created = await pool.query(
    'INSERT INTO chats (booking_id, user_a, user_b) VALUES ($1, $2, $3) RETURNING id',
    [bookingId, clientId, providerId]
  );
  return created.rows[0].id as number;
}

router.get('/', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const currentUserId = req.userId;
  const role = (req as any).role;
  if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });
  if (role !== 'admin') return res.status(403).json({ error: 'Access denied' });

  try {
    await autoCompletePastBookings();
    const q = `
      SELECT b.*, s.title as service_title, u1.name as client_name, u2.name as provider_name
      FROM bookings b
      JOIN services s ON s.id = b.service_id
      JOIN users u1 ON u1.id = b.client_id
      JOIN users u2 ON u2.id = b.provider_id
      ORDER BY b.created_at DESC
    `;
    const { rows } = await pool.query(q);
    return res.json({ data: rows });
  } catch (error) {
    console.error('Error fetching all bookings:', error);
    return res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// Create a new booking (protected)
router.post('/', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const clientId = req.userId; // from verifyToken
  const { provider_id, service_id, start_date, end_date, total_price, booking_mode } = req.body;

  if (!clientId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!provider_id || !service_id || !start_date || !total_price) {
    return res.status(400).json({ error: 'Missing required booking fields' });
  }

  try {
    const clientUserIdStr = parseId(clientId);
    const providerUserIdStr = parseId(provider_id);
    const serviceIdStr = parseId(service_id);

    if (!clientUserIdStr) return res.status(400).json({ error: 'Invalid client ID' });
    if (!providerUserIdStr || !serviceIdStr) return res.status(400).json({ error: 'Invalid provider_id or service_id' });

    // Convert user IDs to record IDs if needed (handles providers/clients tables)
    const clientIdStr = await getClientIdFromUserId(clientUserIdStr);
    const providerIdStr = await getProviderIdFromUserId(providerUserIdStr);

    console.log('Booking IDs:', { clientUserIdStr, clientIdStr, providerUserIdStr, providerIdStr, serviceIdStr });

    const start = new Date(String(start_date));
    if (isNaN(start.getTime())) return res.status(400).json({ error: 'Invalid start_date' });

    let end: Date;
    if (end_date) {
      end = new Date(String(end_date));
      if (isNaN(end.getTime())) return res.status(400).json({ error: 'Invalid end_date' });
    } else {
      const durationMinutes = await getServiceDurationMinutes(serviceIdStr);
      end = new Date(start.getTime() + durationMinutes * 60 * 1000);
    }

    if (end.getTime() <= start.getTime()) return res.status(400).json({ error: 'end_date must be after start_date' });

    const mode = booking_mode === 'instant' ? 'instant' : 'request';
    const initialStatus = mode === 'instant' ? 'accepted' : 'pending';
    const acceptedAt = mode === 'instant' ? new Date().toISOString() : null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Skip availability check since we're using default slots
      // Just check for conflicts with existing bookings
      const conflictRes = await client.query(
        `
          SELECT id
          FROM bookings
          WHERE provider_id::text = $1
            AND status NOT IN ('cancelled', 'rejected')
            AND start_date < $2
            AND end_date > $3
          LIMIT 1
        `,
        [providerIdStr, end.toISOString(), start.toISOString()]
      );

      if (conflictRes.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Time slot already booked' });
      }

      const insertQuery = `
        INSERT INTO bookings (client_id, provider_id, service_id, start_date, end_date, status, booking_mode, accepted_at, total_price)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;

      const values = [
        clientIdStr,
        providerIdStr,
        serviceIdStr,
        start.toISOString(),
        end.toISOString(),
        initialStatus,
        mode,
        acceptedAt,
        total_price,
      ];

      const result = await client.query(insertQuery, values);
      const booking = result.rows[0];

      await client.query('COMMIT');

      // Send notification about new booking
      try {
        // Get client, provider and service info for notification
        const clientInfo = await pool.query('SELECT name FROM users WHERE id::text = $1', [clientUserIdStr]);
        const providerInfo = await pool.query('SELECT name FROM users WHERE id::text = $1', [providerUserIdStr]);
        const serviceInfo = await pool.query('SELECT title FROM services WHERE id::text = $1', [serviceIdStr]);
        const clientName = clientInfo.rows[0]?.name || 'A client';
        const providerName = providerInfo.rows[0]?.name || 'Provider';
        const serviceTitle = serviceInfo.rows[0]?.title || 'a service';

        if (mode === 'instant') {
          // Instant booking - notify client that booking is confirmed
          await notificationService.notifyBookingAccepted(
            clientUserIdStr,
            providerName,
            String(booking.id)
          );
        } else {
          // Request booking - notify provider of new request
          await notificationService.notifyBookingRequest(
            providerUserIdStr,
            clientName,
            String(booking.id),
            serviceTitle
          );
        }
      } catch (notifError) {
        console.error('Failed to send booking notification:', notifError);
        // Don't fail the booking creation if notification fails
      }

      return res.status(201).json({ data: booking, status: initialStatus });
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (_e) {
      }
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error creating booking:', error);
    const errorMessage = error?.message || 'Failed to create booking';
    const errorDetail = error?.detail || '';

    if (error?.code === '23503') {
      return res.status(400).json({
        error: 'Invalid reference: provider, service, or client does not exist',
        detail: errorDetail
      });
    }

    if (error?.code === '23514') {
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

router.get('/provider/my', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const providerId = req.userId;
  const role = (req as any).role;
  if (!providerId) return res.status(401).json({ error: 'Unauthorized' });
  if (role !== 'provider' && role !== 'admin') return res.status(403).json({ error: 'Access denied' });

  try {
    await autoCompletePastBookings(providerId);

    // Check what tables exist
    const tablesCheck = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('providers', 'clients')
    `);
    const existingTables = tablesCheck.rows.map((r: any) => r.table_name);
    const hasProvidersTable = existingTables.includes('providers');
    const hasClientsTable = existingTables.includes('clients');

    // Check if bookings.provider_id references providers table
    let providerRefTable = 'users';
    let clientRefTable = 'users';

    try {
      const fkCheck = await pool.query(`
        SELECT kcu.column_name, ccu.table_name AS foreign_table_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'bookings'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name IN ('provider_id', 'client_id')
      `);

      for (const row of fkCheck.rows) {
        if (row.column_name === 'provider_id') providerRefTable = row.foreign_table_name;
        if (row.column_name === 'client_id') clientRefTable = row.foreign_table_name;
      }
    } catch (e) {
      // Ignore errors, use defaults
    }

    let q: string;
    if (providerRefTable === 'providers' && hasProvidersTable) {
      if (clientRefTable === 'clients' && hasClientsTable) {
        // Both reference separate tables
        q = `
          SELECT b.*, s.title as service_title,
                 cu.id as client_user_id, cu.name as client_name, cu.email as client_email, cu.profile_image as client_image
          FROM bookings b
          LEFT JOIN services s ON s.id::text = b.service_id::text
          LEFT JOIN providers p ON p.id = b.provider_id
          LEFT JOIN clients c ON c.id = b.client_id
          LEFT JOIN users cu ON cu.id = c.user_id
          WHERE p.user_id::text = $1
          ORDER BY b.created_at DESC
        `;
      } else {
        // provider_id references providers, but client_id references users directly
        q = `
          SELECT b.*, s.title as service_title,
                 u.id as client_user_id, u.name as client_name, u.email as client_email, u.profile_image as client_image
          FROM bookings b
          LEFT JOIN services s ON s.id::text = b.service_id::text
          LEFT JOIN providers p ON p.id = b.provider_id
          LEFT JOIN users u ON u.id::text = b.client_id::text
          WHERE p.user_id::text = $1
          ORDER BY b.created_at DESC
        `;
      }
    } else {
      // provider_id references users table directly
      q = `
        SELECT b.*, s.title as service_title,
               u.id as client_user_id, u.name as client_name, u.email as client_email, u.profile_image as client_image
        FROM bookings b
        LEFT JOIN services s ON s.id::text = b.service_id::text
        LEFT JOIN users u ON u.id::text = b.client_id::text
        WHERE b.provider_id::text = $1
        ORDER BY b.created_at DESC
      `;
    }

    const { rows } = await pool.query(q, [providerId]);
    return res.json({ data: rows });
  } catch (error) {
    console.error('Error fetching bookings for provider:', error);
    return res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// Optionally: add GET endpoints for user's bookings (protected)
router.get('/my', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const clientId = req.userId;
  if (!clientId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Check what tables exist
    const tablesCheck = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('providers', 'clients')
    `);
    const existingTables = tablesCheck.rows.map((r: any) => r.table_name);
    const hasProvidersTable = existingTables.includes('providers');
    const hasClientsTable = existingTables.includes('clients');

    // Check FK constraints to determine actual references
    let clientRefTable = 'users';
    let providerRefTable = 'users';

    try {
      const fkCheck = await pool.query(`
        SELECT kcu.column_name, ccu.table_name AS foreign_table_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'bookings'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name IN ('provider_id', 'client_id')
      `);

      for (const row of fkCheck.rows) {
        if (row.column_name === 'provider_id') providerRefTable = row.foreign_table_name;
        if (row.column_name === 'client_id') clientRefTable = row.foreign_table_name;
      }
    } catch (e) {
      // Ignore errors, use defaults
    }

    let q: string;
    if (clientRefTable === 'clients' && hasClientsTable) {
      if (providerRefTable === 'providers' && hasProvidersTable) {
        // Both reference separate tables
        q = `
          SELECT b.*, s.title as service_title,
                 pu.id as provider_user_id, pu.name as provider_name, pu.email as provider_email, pu.profile_image as provider_image
          FROM bookings b
          LEFT JOIN services s ON s.id::text = b.service_id::text
          LEFT JOIN clients c ON c.id = b.client_id
          LEFT JOIN providers p ON p.id = b.provider_id
          LEFT JOIN users pu ON pu.id = p.user_id
          WHERE c.user_id::text = $1
          ORDER BY b.created_at DESC
        `;
      } else {
        // client_id references clients, but provider_id references users directly
        q = `
          SELECT b.*, s.title as service_title,
                 u.id as provider_user_id, u.name as provider_name, u.email as provider_email, u.profile_image as provider_image
          FROM bookings b
          LEFT JOIN services s ON s.id::text = b.service_id::text
          LEFT JOIN clients c ON c.id = b.client_id
          LEFT JOIN users u ON u.id::text = b.provider_id::text
          WHERE c.user_id::text = $1
          ORDER BY b.created_at DESC
        `;
      }
    } else {
      // client_id references users table directly
      if (providerRefTable === 'providers' && hasProvidersTable) {
        q = `
          SELECT b.*, s.title as service_title,
                 pu.id as provider_user_id, pu.name as provider_name, pu.email as provider_email, pu.profile_image as provider_image
          FROM bookings b
          LEFT JOIN services s ON s.id::text = b.service_id::text
          LEFT JOIN providers p ON p.id = b.provider_id
          LEFT JOIN users pu ON pu.id = p.user_id
          WHERE b.client_id::text = $1
          ORDER BY b.created_at DESC
        `;
      } else {
        q = `
          SELECT b.*, s.title as service_title,
                 u.id as provider_user_id, u.name as provider_name, u.email as provider_email, u.profile_image as provider_image
          FROM bookings b
          LEFT JOIN services s ON s.id::text = b.service_id::text
          LEFT JOIN users u ON u.id::text = b.provider_id::text
          WHERE b.client_id::text = $1
          ORDER BY b.created_at DESC
        `;
      }
    }

    const { rows } = await pool.query(q, [clientId]);
    return res.json({ data: rows });
  } catch (error) {
    console.error('Error fetching bookings for user:', error);
    return res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

router.delete('/:id', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const currentUserId = req.userId;
  const role = (req as any).role;
  const bookingId = String(req.params.id || '');
  if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });
  if (!bookingId) return res.status(400).json({ error: 'Invalid booking id' });

  try {
    const existingRes = await pool.query(
      'SELECT id, client_id, provider_id, status FROM bookings WHERE id::text = $1',
      [bookingId]
    );
    const existing = existingRes.rows[0];
    if (!existing) return res.status(404).json({ error: 'Booking not found' });

    const isParticipant =
      String(existing.client_id) === String(currentUserId) ||
      String(existing.provider_id) === String(currentUserId);

    if (role !== 'admin' && !isParticipant) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const currentStatus = String(existing.status);
    if (role !== 'admin') {
      if (['completed', 'cancelled', 'rejected'].includes(currentStatus)) {
        return res.status(400).json({ error: 'Cannot cancel this booking' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [existing.provider_id]);

      if (role === 'admin') {
        await client.query('DELETE FROM bookings WHERE id::text = $1', [bookingId]);
        await client.query('COMMIT');
        return res.json({ success: true });
      }

      const updatedRes = await client.query(
        `
          UPDATE bookings
          SET status = 'cancelled',
              cancelled_at = COALESCE(cancelled_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
          WHERE id::text = $1
          RETURNING *
        `,
        [bookingId]
      );
      await client.query('COMMIT');

      // Send cancellation notification to the other party
      try {
        const isClient = String(existing.client_id) === String(currentUserId);
        const otherPartyId = isClient ? String(existing.provider_id) : String(existing.client_id);
        const cancellerInfo = await pool.query('SELECT name FROM users WHERE id::text = $1', [currentUserId]);
        const serviceInfo = await pool.query('SELECT title FROM services WHERE id::text = $1', [String(updatedRes.rows[0].service_id)]);
        const cancellerName = cancellerInfo.rows[0]?.name || (isClient ? 'Client' : 'Provider');
        const serviceTitle = serviceInfo.rows[0]?.title || 'service';

        await notificationService.notifyBookingCancelled(
          otherPartyId,
          cancellerName,
          bookingId
        );
      } catch (notifError) {
        console.error('Failed to send cancellation notification:', notifError);
      }

      return res.json({ data: updatedRes.rows[0] });
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (_e) {
      }
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error deleting booking:', error);
    return res.status(500).json({ error: 'Failed to delete booking' });
  }
});

router.get('/:id', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const currentUserId = req.userId;
  const bookingId = String(req.params.id || '');
  if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });
  if (!bookingId) return res.status(400).json({ error: 'Invalid booking id' });

  try {
    const bookingRes = await pool.query(
      `
        SELECT b.*, s.title as service_title, u1.name as client_name, u2.name as provider_name
        FROM bookings b
        JOIN services s ON s.id = b.service_id
        JOIN users u1 ON u1.id = b.client_id
        JOIN users u2 ON u2.id = b.provider_id
        WHERE b.id::text = $1
      `,
      [bookingId]
    );
    const booking = bookingRes.rows[0];
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    if (String(booking.client_id) !== String(currentUserId) && String(booking.provider_id) !== String(currentUserId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.json({ data: booking });
  } catch (error) {
    console.error('Error fetching booking:', error);
    return res.status(500).json({ error: 'Failed to fetch booking' });
  }
});

router.put('/:id', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const currentUserId = req.userId;
  const bookingId = String(req.params.id || '');
  const nextStatus = req.body?.status ? String(req.body.status) : null;

  if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });
  if (!bookingId) return res.status(400).json({ error: 'Invalid booking id' });

  try {
    // Check what tables exist
    const tablesCheck = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('providers', 'clients')
    `);
    const existingTables = tablesCheck.rows.map((r: any) => r.table_name);
    const hasProvidersTable = existingTables.includes('providers');
    const hasClientsTable = existingTables.includes('clients');

    const existingRes = await pool.query(
      'SELECT id, client_id, provider_id, status, start_date, end_date FROM bookings WHERE id::text = $1',
      [bookingId]
    );
    const existing = existingRes.rows[0];
    if (!existing) return res.status(404).json({ error: 'Booking not found' });

    // Get actual user IDs for comparison (handle providers/clients tables)
    let providerUserId = String(existing.provider_id);
    let clientUserId = String(existing.client_id);

    if (hasProvidersTable) {
      try {
        const pRes = await pool.query('SELECT user_id FROM providers WHERE id::text = $1', [existing.provider_id]);
        if (pRes.rows[0]) providerUserId = String(pRes.rows[0].user_id);
      } catch (e) { /* ignore */ }
    }

    if (hasClientsTable) {
      try {
        const cRes = await pool.query('SELECT user_id FROM clients WHERE id::text = $1', [existing.client_id]);
        if (cRes.rows[0]) clientUserId = String(cRes.rows[0].user_id);
      } catch (e) { /* ignore */ }
    }

    const isClient = clientUserId === String(currentUserId);
    const isProvider = providerUserId === String(currentUserId);

    if (!isClient && !isProvider) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!nextStatus) {
      return res.status(400).json({ error: 'Missing status' });
    }

    if (!['pending', 'accepted', 'rejected', 'confirmed', 'completed', 'cancelled'].includes(nextStatus)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const currentStatus = String(existing.status);

    const isAccept = nextStatus === 'accepted' || nextStatus === 'confirmed';
    const isReject = nextStatus === 'rejected';
    const isCancel = nextStatus === 'cancelled';
    const isComplete = nextStatus === 'completed';

    if (isAccept) {
      if (!isProvider) return res.status(403).json({ error: 'Only provider can accept booking' });
      if (currentStatus !== 'pending') return res.status(400).json({ error: 'Only pending bookings can be accepted' });
    }

    if (isReject) {
      if (!isProvider) return res.status(403).json({ error: 'Only provider can reject booking' });
      if (currentStatus !== 'pending') return res.status(400).json({ error: 'Only pending bookings can be rejected' });
    }

    if (isCancel) {
      if (!isClient && !isProvider) return res.status(403).json({ error: 'Access denied' });
      if (['completed', 'cancelled', 'rejected'].includes(currentStatus)) {
        return res.status(400).json({ error: 'Cannot cancel this booking' });
      }
    }

    if (isComplete) {
      if (!isProvider) return res.status(403).json({ error: 'Only provider can complete booking' });
      if (!['accepted', 'confirmed'].includes(currentStatus)) return res.status(400).json({ error: 'Only accepted bookings can be completed' });
    }

    if (nextStatus === 'pending') {
      return res.status(400).json({ error: 'Cannot set booking back to pending' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [existing.provider_id]);

      if (isAccept) {
        const conflictRes = await client.query(
          `
            SELECT id
            FROM bookings
            WHERE provider_id = $1
              AND id <> $2
              AND status NOT IN ('cancelled', 'rejected')
              AND start_date < $3
              AND end_date > $4
            LIMIT 1
          `,
          [existing.provider_id, existing.id, new Date(existing.end_date).toISOString(), new Date(existing.start_date).toISOString()]
        );
        if (conflictRes.rows[0]) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Cannot accept due to booking conflict' });
        }
      }

      const updates: string[] = ['status = $1', 'updated_at = CURRENT_TIMESTAMP'];
      const values: any[] = [nextStatus];
      let idx = 2;

      if (isAccept) {
        updates.push(`accepted_at = COALESCE(accepted_at, CURRENT_TIMESTAMP)`);
      }
      if (isReject) {
        updates.push(`rejected_at = COALESCE(rejected_at, CURRENT_TIMESTAMP)`);
      }
      if (isCancel) {
        updates.push(`cancelled_at = COALESCE(cancelled_at, CURRENT_TIMESTAMP)`);
      }
      if (isComplete) {
        updates.push(`completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)`);
      }

      values.push(bookingId);

      const updateRes = await client.query(
        `UPDATE bookings SET ${updates.join(', ')} WHERE id::text = $${idx} RETURNING *`,
        values
      );
      const updated = updateRes.rows[0];
      await client.query('COMMIT');

      // Send notifications based on status change
      if (String(existing.status) !== String(nextStatus)) {
        try {
          // Get names for notifications
          const clientInfo = await pool.query('SELECT name FROM users WHERE id::text = $1', [clientUserId]);
          const providerInfo = await pool.query('SELECT name FROM users WHERE id::text = $1', [providerUserId]);
          const serviceInfo = await pool.query('SELECT title FROM services WHERE id::text = $1', [String(updated.service_id)]);
          const clientName = clientInfo.rows[0]?.name || 'Client';
          const providerName = providerInfo.rows[0]?.name || 'Provider';
          const serviceTitle = serviceInfo.rows[0]?.title || 'service';

          if (isAccept) {
            // Notify client that their booking was accepted
            await notificationService.notifyBookingAccepted(
              clientUserId,
              providerName,
              bookingId
            );
          } else if (isReject) {
            // Notify client that their booking was rejected
            await notificationService.notifyBookingRejected(
              clientUserId,
              providerName,
              bookingId
            );
          } else if (isCancel) {
            // Notify the other party about cancellation
            const notifyUserId = isClient ? providerUserId : clientUserId;
            const cancellerName = isClient ? clientName : providerName;
            await notificationService.notifyBookingCancelled(
              notifyUserId,
              cancellerName,
              bookingId
            );
          } else if (isComplete) {
            // Notify client that booking is completed
            await notificationService.notifyBookingCompleted(
              clientUserId,
              bookingId,
              serviceTitle
            );
          }
        } catch (notifError) {
          console.error('Failed to send status update notification:', notifError);
          // Don't fail the update if notification fails
        }

        const chatId = await ensureBookingChatExists(String(bookingId), String(existing.client_id), String(existing.provider_id));

        const inserted = await pool.query(
          `
            INSERT INTO chat_messages (chat_id, sender_id, content, is_system)
            VALUES ($1, NULL, $2, TRUE)
            RETURNING id, chat_id, sender_id, content, attachment_url, attachment_type, attachment_name, is_system, created_at, read_at
          `,
          [chatId, `Booking status updated to ${nextStatus}.`]
        );

        await pool.query('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [chatId]);

        const io = (req.app as any).get('io');
        if (io) {
          io.to(`booking:${bookingId}`).emit('chat:message', {
            bookingId,
            message: inserted.rows[0],
          });
        }
      }

      return res.json({ data: updated });
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (_e) {
      }
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error updating booking:', error);
    return res.status(500).json({ error: 'Failed to update booking' });
  }
});

export default router;
