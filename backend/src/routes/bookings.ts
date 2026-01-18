import express, { Request, Response } from 'express';
import { pool } from '../config/database';
import { verifyToken } from '../middleware/auth';
import { notificationService } from '../services/notificationService';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();

// ==================== MULTER SETUP FOR BOOKING EVIDENCE ====================
const UPLOADS_ROOT = path.resolve(__dirname, '../../../uploads');

const evidenceStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const bookingId = req.params.id;
    const uploadPath = path.join(UPLOADS_ROOT, 'bookings', bookingId);
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, filename);
  }
});

const evidenceUpload = multer({
  storage: evidenceStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, GIF, WEBP) are allowed'));
    }
  }
});

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

async function getServiceDurationMinutes(serviceId: string): Promise<number> {
  try {
    const res = await pool.query('SELECT duration_minutes FROM services WHERE id::text = $1', [serviceId]);
    const v = res.rows[0]?.duration_minutes;
    if (v === null || v === undefined) return 60;
    const n = typeof v === 'string' ? parseInt(v, 10) : Number(v);
    // Ensure we have a valid positive number, default to 60 minutes
    return Number.isFinite(n) && n > 0 ? n : 60;
  } catch (e) {
    console.error('Error getting service duration:', e);
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

async function ensureBookingChatExists(bookingId: string, clientId: string, providerId: string): Promise<number | null> {
  const existing = await pool.query('SELECT id FROM chats WHERE booking_id::text = $1', [bookingId]);
  if (existing.rows[0]) return existing.rows[0].id as number;

  // Verify both users exist before creating chat
  const usersExist = await pool.query(
    'SELECT id FROM users WHERE id::text IN ($1, $2) AND deleted_at IS NULL',
    [clientId, providerId]
  );

  if (usersExist.rows.length < 2) {
    console.warn(`Cannot create chat: one or both users don't exist (client: ${clientId}, provider: ${providerId})`);
    return null;
  }

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

    // Validate service exists and get its price
    const serviceCheck = await pool.query(
      'SELECT id, price, pricing_type, duration_minutes FROM services WHERE id::text = $1',
      [serviceIdStr]
    );
    if (serviceCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    const service = serviceCheck.rows[0];
    const servicePrice = parseFloat(service.price) || 0;
    const platformFeeRate = 0.15;

    // Validate total_price is not less than service price (with platform fee)
    const minPrice = servicePrice * (1 + platformFeeRate);
    const submittedPrice = parseFloat(total_price) || 0;

    // For hourly pricing, we can't validate exact price here (depends on duration)
    // But we can ensure it's not suspiciously low
    if (service.pricing_type !== 'hourly' && submittedPrice < minPrice * 0.99) {
      return res.status(400).json({
        error: 'Invalid price',
        detail: `Price must be at least ₱${minPrice.toFixed(2)}`
      });
    }

    // Convert user IDs to record IDs if needed (handles providers/clients tables)
    const clientIdStr = await getClientIdFromUserId(clientUserIdStr);
    const providerIdStr = await getProviderIdFromUserId(providerUserIdStr);

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

      // Check if the provider has blocked this date
      const bookingDate = start.toISOString().split('T')[0]; // YYYY-MM-DD
      const blockedCheck = await client.query(
        `SELECT id, reason FROM availability_overrides
         WHERE provider_id::text = $1
           AND override_date = $2::date
           AND is_available = FALSE`,
        [providerUserIdStr, bookingDate]
      );

      if (blockedCheck.rows[0]) {
        await client.query('ROLLBACK');
        const reason = blockedCheck.rows[0].reason || 'Provider is not available on this date';
        return res.status(409).json({ error: reason });
      }

      // Check for conflicts with existing bookings
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
        return res.status(409).json({ error: 'This time slot conflicts with another booking' });
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
            providerUserIdStr,
            providerName,
            String(booking.id)
          );
        } else {
          // Request booking - notify provider of new request
          await notificationService.notifyBookingRequest(
            providerUserIdStr,
            clientUserIdStr,
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

// ==================== GET DISPUTED BOOKINGS (Admin only) ====================
// NOTE: This route MUST be before /:id routes to avoid "disputed" being treated as an ID

router.get('/disputed', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const role = (req as any).role;
  if (role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  try {
    const { rows } = await pool.query(
      `SELECT b.*,
              s.title as service_title,
              u1.name as client_name, u1.email as client_email,
              u2.name as provider_name, u2.email as provider_email
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN users u1 ON u1.id = b.client_id
       LEFT JOIN users u2 ON u2.id = b.provider_id
       WHERE b.dispute_raised = TRUE OR b.status = 'disputed'
       ORDER BY b.updated_at DESC`
    );

    if (rows.length === 0) {
      return res.json({ data: [] });
    }

    // Fetch all evidence for disputed bookings in a single query (fixes N+1)
    const bookingIds = rows.map((b: any) => String(b.id));
    const evidenceRes = await pool.query(
      `SELECT be.*, u.name as uploaded_by_name
       FROM booking_evidence be
       LEFT JOIN users u ON u.id = be.uploaded_by
       WHERE be.booking_id::text = ANY($1)
       ORDER BY be.uploaded_at ASC`,
      [bookingIds]
    );

    // Group evidence by booking_id
    const evidenceByBooking: Record<string, any[]> = {};
    for (const evidence of evidenceRes.rows) {
      const bookingId = String(evidence.booking_id);
      if (!evidenceByBooking[bookingId]) {
        evidenceByBooking[bookingId] = [];
      }
      evidenceByBooking[bookingId].push(evidence);
    }

    // Attach evidence to bookings
    const bookingsWithEvidence = rows.map((booking: any) => ({
      ...booking,
      evidence: evidenceByBooking[String(booking.id)] || []
    }));

    return res.json({ data: bookingsWithEvidence });
  } catch (error) {
    console.error('Error fetching disputed bookings:', error);
    return res.status(500).json({ error: 'Failed to fetch disputed bookings' });
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
          currentUserId,
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
              providerUserId,
              providerName,
              bookingId
            );
          } else if (isReject) {
            // Notify client that their booking was rejected
            await notificationService.notifyBookingRejected(
              clientUserId,
              providerUserId,
              providerName,
              bookingId
            );
          } else if (isCancel) {
            // Notify the other party about cancellation
            const notifyUserId = isClient ? providerUserId : clientUserId;
            const cancellerUserId = isClient ? clientUserId : providerUserId;
            const cancellerName = isClient ? clientName : providerName;
            await notificationService.notifyBookingCancelled(
              notifyUserId,
              cancellerUserId,
              cancellerName,
              bookingId
            );
          } else if (isComplete) {
            // Notify client that booking is completed
            await notificationService.notifyBookingCompleted(
              clientUserId,
              providerUserId,
              bookingId,
              serviceTitle
            );
          }
        } catch (notifError) {
          console.error('Failed to send status update notification:', notifError);
          // Don't fail the update if notification fails
        }

        const chatId = await ensureBookingChatExists(String(bookingId), String(existing.client_id), String(existing.provider_id));

        // Only send chat message if chat was created successfully
        if (chatId) {
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

// ==================== RESCHEDULE BOOKING ====================

router.put('/:id/reschedule', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  try {
    const currentUserId = req.userId;
    const bookingId = req.params.id;
    const { start_date, end_date, reason } = req.body;

    if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });
    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'New start_date and end_date are required' });
    }

    // Parse and validate dates
    const newStartDate = new Date(start_date);
    const newEndDate = new Date(end_date);

    if (isNaN(newStartDate.getTime()) || isNaN(newEndDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    if (newStartDate >= newEndDate) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }

    if (newStartDate < new Date()) {
      return res.status(400).json({ error: 'Cannot reschedule to a past date' });
    }

    // Get existing booking
    const bookingResult = await pool.query(
      `SELECT b.*, s.title as service_title, s.duration_minutes
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.id::text = $1 AND b.deleted_at IS NULL`,
      [bookingId]
    );

    if (!bookingResult.rows[0]) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];
    const clientUserId = String(booking.client_id);
    const providerUserId = String(booking.provider_id);

    // Check if user has permission (client or provider can reschedule)
    const isClient = String(currentUserId) === clientUserId;
    const isProvider = String(currentUserId) === providerUserId;

    if (!isClient && !isProvider) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Only allow rescheduling for certain statuses
    const allowedStatuses = ['pending', 'accepted', 'confirmed'];
    if (!allowedStatuses.includes(booking.status)) {
      return res.status(400).json({
        error: `Cannot reschedule a ${booking.status} booking`
      });
    }

    // Don't allow rescheduling if dispute is raised
    if (booking.dispute_raised) {
      return res.status(400).json({
        error: 'Cannot reschedule a booking with an active dispute'
      });
    }

    // Limit reschedule count to prevent abuse
    const MAX_RESCHEDULES = 10;
    if ((booking.reschedule_count || 0) >= MAX_RESCHEDULES) {
      return res.status(400).json({
        error: `Maximum reschedule limit (${MAX_RESCHEDULES}) reached`
      });
    }

    // Check for conflicts with other bookings (use ::text for type safety)
    const conflictResult = await pool.query(
      `SELECT id FROM bookings
       WHERE provider_id::text = $1
         AND id::text <> $2
         AND status NOT IN ('cancelled', 'rejected')
         AND deleted_at IS NULL
         AND start_date < $3
         AND end_date > $4
       LIMIT 1`,
      [String(booking.provider_id), bookingId, newEndDate.toISOString(), newStartDate.toISOString()]
    );

    if (conflictResult.rows[0]) {
      return res.status(409).json({
        error: 'The selected time slot conflicts with another booking'
      });
    }

    // Store original dates for history
    const originalStartDate = booking.start_date;
    const originalEndDate = booking.end_date;

    // Update the booking
    const updateResult = await pool.query(
      `UPDATE bookings
       SET start_date = $1,
           end_date = $2,
           rescheduled_at = CURRENT_TIMESTAMP,
           rescheduled_by = $3,
           reschedule_reason = $4,
           original_start_date = COALESCE(original_start_date, $5),
           original_end_date = COALESCE(original_end_date, $6),
           reschedule_count = COALESCE(reschedule_count, 0) + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id::text = $7
       RETURNING *`,
      [
        newStartDate.toISOString(),
        newEndDate.toISOString(),
        currentUserId,
        reason || null,
        originalStartDate,
        originalEndDate,
        bookingId
      ]
    );

    const updatedBooking = updateResult.rows[0];

    // Get user names for notifications
    const clientInfo = await pool.query('SELECT name FROM users WHERE id::text = $1', [clientUserId]);
    const providerInfo = await pool.query('SELECT name FROM users WHERE id::text = $1', [providerUserId]);
    const clientName = clientInfo.rows[0]?.name || 'Client';
    const providerName = providerInfo.rows[0]?.name || 'Provider';
    const serviceName = booking.service_title || 'service';

    // Format dates for notification message
    const formatDate = (date: Date) => {
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    };

    const newDateStr = formatDate(newStartDate);
    const rescheduledBy = isClient ? clientName : providerName;

    // Send notification to the other party
    const recipientId = isClient ? providerUserId : clientUserId;
    const recipientRole = isClient ? 'provider' : 'client';

    await notificationService.create({
      userId: recipientId,
      type: 'booking_request', // Reusing type, could add 'booking_rescheduled' type
      title: 'Booking Rescheduled',
      message: `${rescheduledBy} rescheduled the booking for "${serviceName}" to ${newDateStr}`,
      data: {
        booking_id: bookingId,
        client_id: clientUserId,
        client_name: clientName,
        provider_id: providerUserId,
        provider_name: providerName,
        new_start_date: newStartDate.toISOString(),
        old_start_date: originalStartDate,
        reschedule_reason: reason
      }
    });

    // Send system message in chat
    try {
      const chatId = await ensureBookingChatExists(bookingId, clientUserId, providerUserId);
      if (chatId) {
        const systemMessage = reason
          ? `Booking rescheduled to ${newDateStr}. Reason: ${reason}`
          : `Booking rescheduled to ${newDateStr}`;

        await pool.query(
          `INSERT INTO chat_messages (chat_id, sender_id, content, is_system)
           VALUES ($1, NULL, $2, TRUE)`,
          [chatId, systemMessage]
        );

        await pool.query('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [chatId]);

        const io = (req.app as any).get('io');
        if (io) {
          io.to(`booking:${bookingId}`).emit('chat:message', {
            bookingId,
            message: { content: systemMessage, is_system: true, created_at: new Date().toISOString() }
          });
        }
      }
    } catch (chatError) {
      console.error('Failed to send reschedule chat message:', chatError);
    }

    return res.json({
      data: updatedBooking,
      message: 'Booking rescheduled successfully'
    });
  } catch (error) {
    console.error('Error rescheduling booking:', error);
    return res.status(500).json({ error: 'Failed to reschedule booking' });
  }
});

// ==================== AUTO-CONFIRM PAST COMPLETIONS (48-hour timeout) ====================

export async function autoConfirmPastCompletions() {
  try {
    // Find bookings that need auto-confirmation (don't update yet - use transaction per booking)
    const pendingResult = await pool.query(
      `SELECT id, client_id, provider_id, service_id
       FROM bookings
       WHERE status = 'awaiting_confirmation'
         AND provider_completed_at IS NOT NULL
         AND provider_completed_at < NOW() - INTERVAL '48 hours'
         AND client_confirmed_at IS NULL`
    );

    if (pendingResult.rows.length === 0) return;

    // Process each booking in its own transaction for safety
    for (const booking of pendingResult.rows) {
      const txClient = await pool.connect();
      try {
        await txClient.query('BEGIN');

        // Double-check booking status within transaction (prevent race condition)
        const checkRes = await txClient.query(
          `SELECT id FROM bookings
           WHERE id::text = $1
             AND status = 'awaiting_confirmation'
             AND client_confirmed_at IS NULL
           FOR UPDATE`,
          [String(booking.id)]
        );

        if (checkRes.rows.length === 0) {
          // Already confirmed by client or status changed - skip
          await txClient.query('ROLLBACK');
          continue;
        }

        // Update booking status
        await txClient.query(
          `UPDATE bookings
           SET status = 'completed',
               client_confirmed_at = CURRENT_TIMESTAMP,
               completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
               updated_at = CURRENT_TIMESTAMP
           WHERE id::text = $1`,
          [String(booking.id)]
        );

        // Resolve provider user ID (handle providers table FK)
        let providerUserId = String(booking.provider_id);
        try {
          const providerCheck = await txClient.query(
            `SELECT user_id FROM providers WHERE id::text = $1`,
            [String(booking.provider_id)]
          );
          if (providerCheck.rows[0]?.user_id) {
            providerUserId = String(providerCheck.rows[0].user_id);
          }
        } catch (e) {
          // providers table doesn't exist or provider_id is already a user ID
        }

        // Resolve client user ID (handle clients table FK)
        let clientUserId = String(booking.client_id);
        try {
          const clientCheck = await txClient.query(
            `SELECT user_id FROM clients WHERE id::text = $1`,
            [String(booking.client_id)]
          );
          if (clientCheck.rows[0]?.user_id) {
            clientUserId = String(clientCheck.rows[0].user_id);
          }
        } catch (e) {
          // clients table doesn't exist or client_id is already a user ID
        }

        // Get names for notifications
        const serviceInfo = await txClient.query('SELECT title FROM services WHERE id::text = $1', [String(booking.service_id)]);
        const serviceName = serviceInfo.rows[0]?.title || 'service';
        const clientInfo = await txClient.query('SELECT name FROM users WHERE id::text = $1', [clientUserId]);
        const clientName = clientInfo.rows[0]?.name || 'Client';

        // ==================== RELEASE PAYMENT TO PROVIDER ====================
        let paymentReleased = false;
        let releasedAmount = 0;

        // Get payment record for this booking
        const paymentRes = await txClient.query(
          `SELECT id, net_provider_amount, status FROM payments WHERE booking_id::text = $1`,
          [String(booking.id)]
        );
        const payment = paymentRes.rows[0];

        if (payment && payment.status === 'succeeded') {
          const amount = parseFloat(payment.net_provider_amount);

          // Get provider's wallet using resolved user ID with FOR UPDATE lock to prevent race conditions
          const walletRes = await txClient.query(
            `SELECT id, pending_balance, available_balance FROM wallets WHERE provider_id::text = $1 FOR UPDATE`,
            [providerUserId]
          );
          let wallet = walletRes.rows[0];

          // Create wallet if it doesn't exist
          if (!wallet) {
            const newWalletRes = await txClient.query(
              `INSERT INTO wallets (provider_id, available_balance, pending_balance)
               VALUES ($1, 0, 0)
               RETURNING id, pending_balance, available_balance`,
              [providerUserId]
            );
            wallet = newWalletRes.rows[0];
          }

          // Move funds from pending to available balance
          const currentPending = parseFloat(wallet.pending_balance) || 0;
          const currentAvailable = parseFloat(wallet.available_balance) || 0;
          const newPending = Math.max(0, currentPending - amount);
          const newAvailable = currentAvailable + amount;

          await txClient.query(
            `UPDATE wallets
             SET pending_balance = $1,
                 available_balance = $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id::text = $3`,
            [newPending, newAvailable, String(wallet.id)]
          );

          // Create transaction record
          await txClient.query(
            `INSERT INTO transactions (wallet_id, payment_id, type, amount, balance_after, reference_id, description)
             VALUES ($1, $2, 'payment_received', $3, $4, $5, $6)`,
            [
              String(wallet.id),
              String(payment.id),
              amount,
              newAvailable,
              `booking_${booking.id}_auto_confirmed`,
              `Payment auto-released for booking #${booking.id} (48-hour timeout)`
            ]
          );

          paymentReleased = true;
          releasedAmount = amount;
          console.log(`Auto-released payment of ${amount} to provider ${providerUserId} for booking ${booking.id}`);
        }

        // Warn if auto-confirmed but payment wasn't released
        if (!paymentReleased) {
          console.warn(`WARNING: Booking ${booking.id} auto-confirmed but payment not released. Provider ${providerUserId} may not have received payment.`);
        }

        await txClient.query('COMMIT');

        // Send notifications AFTER commit (outside transaction)
        try {
          await notificationService.notifyBookingCompleted(
            clientUserId,
            providerUserId,
            String(booking.id),
            serviceName
          );
          await notificationService.notifyBookingCompleted(
            providerUserId,
            clientUserId,
            String(booking.id),
            serviceName
          );

          if (paymentReleased) {
            await notificationService.notifyPaymentReceived(
              providerUserId,
              clientUserId,
              releasedAmount,
              clientName,
              String(booking.id)
            );
          }
        } catch (notifError) {
          console.error('Failed to send auto-confirm notifications (non-fatal):', notifError);
        }

      } catch (bookingError) {
        await txClient.query('ROLLBACK');
        console.error(`Failed to auto-confirm booking ${booking.id}:`, bookingError);
      } finally {
        txClient.release();
      }
    }

    console.log(`Auto-confirmed ${pendingResult.rows.length} bookings after 48-hour timeout`);
  } catch (e) {
    console.log('autoConfirmPastCompletions error (non-fatal):', e);
  }
}

// ==================== PRE-EXPIRY WARNING (24-hour before auto-confirm) ====================
// Send warning notifications to clients 24 hours before their booking auto-confirms

export async function sendConfirmationWarnings() {
  try {
    // Find bookings that are between 24-48 hours since provider completed
    // and haven't been warned yet
    const warningNeeded = await pool.query(
      `SELECT id, client_id, provider_id, service_id
       FROM bookings
       WHERE status = 'awaiting_confirmation'
         AND provider_completed_at IS NOT NULL
         AND provider_completed_at > NOW() - INTERVAL '48 hours'
         AND provider_completed_at < NOW() - INTERVAL '24 hours'
         AND client_confirmed_at IS NULL
         AND confirmation_warning_sent_at IS NULL`
    );

    if (warningNeeded.rows.length === 0) return;

    console.log(`Found ${warningNeeded.rows.length} bookings needing confirmation warnings`);

    for (const booking of warningNeeded.rows) {
      try {
        // Resolve client user ID
        let clientUserId = String(booking.client_id);
        try {
          const clientCheck = await pool.query(
            `SELECT user_id FROM clients WHERE id::text = $1`,
            [String(booking.client_id)]
          );
          if (clientCheck.rows[0]?.user_id) {
            clientUserId = String(clientCheck.rows[0].user_id);
          }
        } catch (e) { /* clients table doesn't exist */ }

        // Resolve provider user ID for getting name
        let providerUserId = String(booking.provider_id);
        try {
          const providerCheck = await pool.query(
            `SELECT user_id FROM providers WHERE id::text = $1`,
            [String(booking.provider_id)]
          );
          if (providerCheck.rows[0]?.user_id) {
            providerUserId = String(providerCheck.rows[0].user_id);
          }
        } catch (e) { /* providers table doesn't exist */ }

        // Get provider name and service title
        const providerInfo = await pool.query(
          'SELECT name FROM users WHERE id::text = $1',
          [providerUserId]
        );
        const serviceInfo = await pool.query(
          'SELECT title FROM services WHERE id::text = $1',
          [String(booking.service_id)]
        );
        const providerName = providerInfo.rows[0]?.name || 'Provider';
        const serviceTitle = serviceInfo.rows[0]?.title || 'service';

        // Send warning notification
        await notificationService.create({
          userId: clientUserId,
          type: 'confirmation_warning',
          title: 'Action Required: Confirm Your Booking',
          message: `Your booking for "${serviceTitle}" with ${providerName} will auto-confirm in 24 hours. Please review and confirm or dispute if needed.`,
          data: {
            booking_id: String(booking.id),
            provider_name: providerName,
            service_title: serviceTitle,
            auto_confirm_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          }
        });

        // Mark as warned
        await pool.query(
          `UPDATE bookings
           SET confirmation_warning_sent_at = CURRENT_TIMESTAMP
           WHERE id::text = $1`,
          [String(booking.id)]
        );

        console.log(`Sent confirmation warning for booking ${booking.id} to client ${clientUserId}`);
      } catch (bookingError) {
        console.error(`Failed to send warning for booking ${booking.id}:`, bookingError);
      }
    }

    console.log(`Sent ${warningNeeded.rows.length} confirmation warnings`);
  } catch (e) {
    console.log('sendConfirmationWarnings error (non-fatal):', e);
  }
}

// ==================== AUTO-RESOLVE STALE DISPUTES ====================
// Disputes that remain unresolved for 7 days are auto-resolved in favor of the provider
const DISPUTE_TIMEOUT_DAYS = 7;

export async function autoResolveStaleDisputes() {
  try {
    // Find disputes that have been open for more than 7 days
    const staleDisputes = await pool.query(
      `SELECT id, client_id, provider_id, service_id, dispute_reason
       FROM bookings
       WHERE (status = 'disputed' OR dispute_raised = TRUE)
         AND updated_at < NOW() - INTERVAL '${DISPUTE_TIMEOUT_DAYS} days'`
    );

    if (staleDisputes.rows.length === 0) return;

    console.log(`Found ${staleDisputes.rows.length} stale disputes to auto-resolve`);

    for (const booking of staleDisputes.rows) {
      const txClient = await pool.connect();
      try {
        await txClient.query('BEGIN');

        // Lock the booking row
        const checkRes = await txClient.query(
          `SELECT id FROM bookings
           WHERE id::text = $1
             AND (status = 'disputed' OR dispute_raised = TRUE)
           FOR UPDATE`,
          [String(booking.id)]
        );

        if (checkRes.rows.length === 0) {
          await txClient.query('ROLLBACK');
          continue;
        }

        // Resolve provider user ID
        let providerUserId = String(booking.provider_id);
        try {
          const providerCheck = await txClient.query(
            `SELECT user_id FROM providers WHERE id::text = $1`,
            [String(booking.provider_id)]
          );
          if (providerCheck.rows[0]?.user_id) {
            providerUserId = String(providerCheck.rows[0].user_id);
          }
        } catch (e) { /* providers table doesn't exist */ }

        // Resolve client user ID
        let clientUserId = String(booking.client_id);
        try {
          const clientCheck = await txClient.query(
            `SELECT user_id FROM clients WHERE id::text = $1`,
            [String(booking.client_id)]
          );
          if (clientCheck.rows[0]?.user_id) {
            clientUserId = String(clientCheck.rows[0].user_id);
          }
        } catch (e) { /* clients table doesn't exist */ }

        // Update booking - auto-resolve in favor of provider
        await txClient.query(
          `UPDATE bookings
           SET status = 'completed',
               dispute_raised = FALSE,
               dispute_reason = NULL,
               completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
               updated_at = CURRENT_TIMESTAMP
           WHERE id::text = $1`,
          [String(booking.id)]
        );

        // Release payment to provider
        let paymentReleased = false;
        let releasedAmount = 0;

        const paymentRes = await txClient.query(
          `SELECT id, net_provider_amount, status FROM payments WHERE booking_id::text = $1`,
          [String(booking.id)]
        );
        const payment = paymentRes.rows[0];

        if (payment && payment.status === 'succeeded') {
          const amount = parseFloat(payment.net_provider_amount);

          const walletRes = await txClient.query(
            `SELECT id, pending_balance, available_balance FROM wallets WHERE provider_id::text = $1 FOR UPDATE`,
            [providerUserId]
          );
          let wallet = walletRes.rows[0];

          if (!wallet) {
            const newWalletRes = await txClient.query(
              `INSERT INTO wallets (provider_id, available_balance, pending_balance)
               VALUES ($1, 0, 0)
               RETURNING id, pending_balance, available_balance`,
              [providerUserId]
            );
            wallet = newWalletRes.rows[0];
          }

          const currentPending = parseFloat(wallet.pending_balance) || 0;
          const currentAvailable = parseFloat(wallet.available_balance) || 0;
          const newPending = Math.max(0, currentPending - amount);
          const newAvailable = currentAvailable + amount;

          await txClient.query(
            `UPDATE wallets SET pending_balance = $1, available_balance = $2, updated_at = CURRENT_TIMESTAMP WHERE id::text = $3`,
            [newPending, newAvailable, String(wallet.id)]
          );

          await txClient.query(
            `INSERT INTO transactions (wallet_id, payment_id, type, amount, balance_after, reference_id, description)
             VALUES ($1, $2, 'payment_received', $3, $4, $5, $6)`,
            [String(wallet.id), String(payment.id), amount, newAvailable, `dispute_auto_resolved_${booking.id}`, `Payment auto-released after dispute timeout (${DISPUTE_TIMEOUT_DAYS} days)`]
          );

          paymentReleased = true;
          releasedAmount = amount;
        }

        await txClient.query('COMMIT');

        // Send notifications
        try {
          const resolution = `Dispute auto-resolved in favor of provider after ${DISPUTE_TIMEOUT_DAYS} days without admin action.`;
          await notificationService.notifyDisputeResolved(clientUserId, String(booking.id), resolution, 'provider');
          await notificationService.notifyDisputeResolved(providerUserId, String(booking.id), resolution, 'provider');

          if (paymentReleased) {
            await notificationService.notifyPaymentReceived(
              providerUserId,
              clientUserId,
              releasedAmount,
              'Client',
              String(booking.id)
            );
          }
        } catch (notifError) {
          console.error('Failed to send auto-resolve dispute notifications:', notifError);
        }

        console.log(`Auto-resolved dispute for booking ${booking.id} in favor of provider. Payment released: ${paymentReleased}`);

      } catch (bookingError) {
        await txClient.query('ROLLBACK');
        console.error(`Failed to auto-resolve dispute for booking ${booking.id}:`, bookingError);
      } finally {
        txClient.release();
      }
    }

    console.log(`Auto-resolved ${staleDisputes.rows.length} stale disputes`);
  } catch (e) {
    console.log('autoResolveStaleDisputes error (non-fatal):', e);
  }
}

// ==================== PROVIDER COMPLETE WITH EVIDENCE ====================

router.post('/:id/complete', verifyToken, evidenceUpload.array('evidence', 10), async (req: Request & { userId?: string }, res: Response) => {
  const currentUserId = req.userId;
  const bookingId = String(req.params.id || '');
  const { notes, evidence_types } = req.body;
  const files = req.files as Express.Multer.File[];

  if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });
  if (!bookingId) return res.status(400).json({ error: 'Invalid booking id' });

  // Require at least 1 evidence photo
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'At least 1 evidence photo is required' });
  }

  try {
    // Get booking
    const bookingRes = await pool.query(
      `SELECT b.*, s.title as service_title
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.id::text = $1`,
      [bookingId]
    );
    const booking = bookingRes.rows[0];
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    // Check if user is the provider - handle both direct user_id and providers table FK
    let providerUserId = String(booking.provider_id);
    try {
      // Check if providers table exists and get actual user_id
      const providerCheck = await pool.query(
        `SELECT user_id FROM providers WHERE id::text = $1`,
        [String(booking.provider_id)]
      );
      if (providerCheck.rows[0]?.user_id) {
        providerUserId = String(providerCheck.rows[0].user_id);
      }
    } catch (e) {
      // providers table doesn't exist or provider_id is already a user ID - that's fine
    }

    const isProvider = providerUserId === String(currentUserId);
    if (!isProvider) {
      return res.status(403).json({ error: 'Only the provider can complete this booking' });
    }

    // Check booking status
    if (!['accepted', 'confirmed'].includes(booking.status)) {
      return res.status(400).json({ error: `Cannot complete a ${booking.status} booking` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Parse evidence types (can be JSON array or comma-separated)
      let types: string[] = [];
      if (evidence_types) {
        try {
          types = JSON.parse(evidence_types);
        } catch {
          types = String(evidence_types).split(',').map(t => t.trim());
        }
      }

      // Insert evidence records
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const evidenceType = types[i] || 'after';
        const fileUrl = `bookings/${bookingId}/${file.filename}`;

        await client.query(
          `INSERT INTO booking_evidence (booking_id, uploaded_by, evidence_type, file_url)
           VALUES ($1, $2, $3, $4)`,
          [bookingId, currentUserId, evidenceType, fileUrl]
        );
      }

      // Update booking status to awaiting_confirmation
      await client.query(
        `UPDATE bookings
         SET status = 'awaiting_confirmation',
             provider_completed_at = CURRENT_TIMESTAMP,
             completion_notes = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $2`,
        [notes || null, bookingId]
      );

      await client.query('COMMIT');

      // Get client info for notification - handle both direct user_id and clients table FK
      let clientUserId = String(booking.client_id);
      let clientName = 'Client';
      try {
        // First check if clients table exists and get actual user_id
        const clientCheck = await pool.query(
          `SELECT user_id FROM clients WHERE id::text = $1`,
          [String(booking.client_id)]
        );
        if (clientCheck.rows[0]?.user_id) {
          clientUserId = String(clientCheck.rows[0].user_id);
        }
      } catch (e) {
        // clients table doesn't exist or client_id is already a user ID - that's fine
      }

      // Now get user details
      const clientInfo = await pool.query('SELECT id, name FROM users WHERE id::text = $1', [clientUserId]);
      const providerInfo = await pool.query('SELECT name FROM users WHERE id::text = $1', [currentUserId]);
      if (clientInfo.rows[0]) {
        clientUserId = String(clientInfo.rows[0].id);
        clientName = clientInfo.rows[0].name || 'Client';
      }
      const providerName = providerInfo.rows[0]?.name || 'Provider';
      const serviceName = booking.service_title || 'service';

      // Notify client to confirm
      if (clientUserId && clientInfo.rows[0]) {
        await notificationService.notifyClientToConfirm(
          String(clientUserId),
          currentUserId,
          providerName,
          bookingId,
          serviceName
        );
      }

      // Send system message in chat
      try {
        const chatId = await ensureBookingChatExists(bookingId, String(booking.client_id), String(booking.provider_id));
        if (chatId) {
          await pool.query(
            `INSERT INTO chat_messages (chat_id, sender_id, content, is_system)
             VALUES ($1, NULL, $2, TRUE)`,
            [chatId, `${providerName} has marked this service as complete. Please review the evidence and confirm completion.`]
          );
          await pool.query('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [chatId]);

          const io = (req.app as any).get('io');
          if (io) {
            io.to(`booking:${bookingId}`).emit('booking:awaiting_confirmation', { bookingId });
          }
        }
      } catch (chatError) {
        console.error('Failed to send completion chat message:', chatError);
      }

      // Fetch updated booking
      const updatedRes = await pool.query('SELECT * FROM bookings WHERE id::text = $1', [bookingId]);

      return res.json({
        data: updatedRes.rows[0],
        message: 'Service marked as complete. Awaiting client confirmation.'
      });
    } catch (e) {
      await client.query('ROLLBACK');
      // Clean up uploaded files on error
      for (const file of files) {
        try {
          fs.unlinkSync(file.path);
        } catch {}
      }
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error completing booking:', error);
    if (error.message?.includes('Only image files')) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Failed to complete booking' });
  }
});

// ==================== CLIENT CONFIRM OR DISPUTE COMPLETION ====================

router.put('/:id/confirm', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const currentUserId = req.userId;
  const bookingId = String(req.params.id || '');
  const { confirmed, dispute_reason } = req.body;

  if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });
  if (!bookingId) return res.status(400).json({ error: 'Invalid booking id' });
  if (typeof confirmed !== 'boolean') {
    return res.status(400).json({ error: 'confirmed field is required (true/false)' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get booking with FOR UPDATE lock to prevent concurrent modifications
    const bookingRes = await client.query(
      `SELECT b.*, s.title as service_title
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.id::text = $1
       FOR UPDATE OF b`,
      [bookingId]
    );
    const booking = bookingRes.rows[0];
    if (!booking) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Resolve client user ID (handle clients table FK)
    let clientUserId = String(booking.client_id);
    try {
      const clientCheck = await client.query(
        `SELECT user_id FROM clients WHERE id::text = $1`,
        [String(booking.client_id)]
      );
      if (clientCheck.rows[0]?.user_id) {
        clientUserId = String(clientCheck.rows[0].user_id);
      }
    } catch (e) {
      // clients table doesn't exist or client_id is already a user ID
    }

    // Resolve provider user ID (handle providers table FK)
    let providerUserId = String(booking.provider_id);
    try {
      const providerCheck = await client.query(
        `SELECT user_id FROM providers WHERE id::text = $1`,
        [String(booking.provider_id)]
      );
      if (providerCheck.rows[0]?.user_id) {
        providerUserId = String(providerCheck.rows[0].user_id);
      }
    } catch (e) {
      // providers table doesn't exist or provider_id is already a user ID
    }

    // Check if user is the client
    const isClient = clientUserId === String(currentUserId);
    if (!isClient) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the client can confirm this booking' });
    }

    // Idempotency checks - check if already processed
    if (booking.client_confirmed_at) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Booking has already been confirmed by client', already_confirmed: true });
    }
    if (booking.dispute_raised || booking.status === 'disputed') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A dispute has already been raised for this booking', already_disputed: true });
    }

    // Check booking status
    if (booking.status !== 'awaiting_confirmation') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Booking is not awaiting confirmation',
        current_status: booking.status
      });
    }

    if (confirmed) {
      // Client confirms completion
      await client.query(
        `UPDATE bookings
         SET status = 'completed',
             client_confirmed_at = CURRENT_TIMESTAMP,
             completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $1`,
        [bookingId]
      );

      // ==================== RELEASE PAYMENT TO PROVIDER ====================
      let paymentReleased = false;
      let releasedAmount = 0;

      // Get payment record for this booking
      const paymentRes = await client.query(
        `SELECT id, net_provider_amount, status FROM payments WHERE booking_id::text = $1`,
        [bookingId]
      );
      const payment = paymentRes.rows[0];

      if (payment && payment.status === 'succeeded') {
        const amount = parseFloat(payment.net_provider_amount);

        // Get provider's wallet using resolved provider user ID with FOR UPDATE lock
        const walletRes = await client.query(
          `SELECT id, pending_balance, available_balance FROM wallets WHERE provider_id::text = $1 FOR UPDATE`,
          [providerUserId]
        );
        let wallet = walletRes.rows[0];

        // Create wallet if it doesn't exist
        if (!wallet) {
          const newWalletRes = await client.query(
            `INSERT INTO wallets (provider_id, available_balance, pending_balance)
             VALUES ($1, 0, 0)
             RETURNING id, pending_balance, available_balance`,
            [providerUserId]
          );
          wallet = newWalletRes.rows[0];
        }

        // Move funds from pending to available balance
        const currentPending = parseFloat(wallet.pending_balance) || 0;
        const currentAvailable = parseFloat(wallet.available_balance) || 0;
        const newPending = Math.max(0, currentPending - amount);
        const newAvailable = currentAvailable + amount;

        await client.query(
          `UPDATE wallets
           SET pending_balance = $1,
               available_balance = $2,
               updated_at = CURRENT_TIMESTAMP
           WHERE id::text = $3`,
          [newPending, newAvailable, String(wallet.id)]
        );

        // Create transaction record
        await client.query(
          `INSERT INTO transactions (wallet_id, payment_id, type, amount, balance_after, reference_id, description)
           VALUES ($1, $2, 'payment_received', $3, $4, $5, $6)`,
          [
            String(wallet.id),
            String(payment.id),
            amount,
            newAvailable,
            `booking_${bookingId}_completed`,
            `Payment released for completed booking #${bookingId}`
          ]
        );

        paymentReleased = true;
        releasedAmount = amount;
        console.log(`Payment of ${amount} released to provider ${providerUserId} for booking ${bookingId}`);
      } else if (!payment) {
        // No payment record - log warning but allow completion (could be free service or test)
        console.warn(`No payment record found for booking ${bookingId} - completing without payment release`);
      }

      await client.query('COMMIT');

      // Get user names for notifications (already have providerUserId resolved above)
      const providerInfo = await pool.query('SELECT name FROM users WHERE id::text = $1', [providerUserId]);
      const clientInfo = await pool.query('SELECT name FROM users WHERE id::text = $1', [currentUserId]);
      const providerName = providerInfo.rows[0]?.name || 'Provider';
      const clientName = clientInfo.rows[0]?.name || 'Client';
      const serviceName = booking.service_title || 'service';

      // Notify provider
      await notificationService.notifyProviderConfirmed(
        providerUserId,
        currentUserId,
        clientName,
        bookingId,
        serviceName
      );

      // Notify provider about payment release
      if (paymentReleased) {
        await notificationService.notifyPaymentReceived(
          providerUserId,
          currentUserId,
          releasedAmount,
          clientName,
          bookingId
        );
      }

      // Also send completed notification to both parties
      await notificationService.notifyBookingCompleted(
        currentUserId,
        providerUserId,
        bookingId,
        serviceName
      );

      // Send system message in chat
      try {
        const chatId = await ensureBookingChatExists(bookingId, clientUserId, providerUserId);
        if (chatId) {
          const chatMessage = paymentReleased
            ? `Service completion confirmed. Booking is now complete. Payment of ₱${releasedAmount.toFixed(2)} has been released to provider.`
            : 'Service completion confirmed. Booking is now complete.';

          await pool.query(
            `INSERT INTO chat_messages (chat_id, sender_id, content, is_system)
             VALUES ($1, NULL, $2, TRUE)`,
            [chatId, chatMessage]
          );
          await pool.query('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [chatId]);

          const io = (req.app as any).get('io');
          if (io) {
            io.to(`booking:${bookingId}`).emit('booking:completed', { bookingId, paymentReleased, releasedAmount });
          }
        }
      } catch (chatError) {
        console.error('Failed to send confirmation chat message:', chatError);
      }

      const updatedRes = await pool.query('SELECT * FROM bookings WHERE id::text = $1', [bookingId]);
      return res.json({
        data: updatedRes.rows[0],
        message: paymentReleased
          ? `Service completion confirmed. Payment of ₱${releasedAmount.toFixed(2)} released to provider.`
          : 'Service completion confirmed successfully'
      });

    } else {
      // Client disputes completion
      if (!dispute_reason || String(dispute_reason).trim().length < 10) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Please provide a detailed dispute reason (at least 10 characters)' });
      }

      await client.query(
        `UPDATE bookings
         SET status = 'disputed',
             dispute_raised = TRUE,
             dispute_reason = $1,
             dispute_raised_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $2`,
        [dispute_reason.trim(), bookingId]
      );

      await client.query('COMMIT');

      // Get user info for notifications (we already have providerUserId and clientUserId resolved)
      const disputeClientInfo = await pool.query('SELECT name FROM users WHERE id::text = $1', [currentUserId]);
      const disputeProviderInfo = await pool.query('SELECT name FROM users WHERE id::text = $1', [providerUserId]);
      const disputeClientName = disputeClientInfo.rows[0]?.name || 'Client';
      const disputeProviderName = disputeProviderInfo.rows[0]?.name || 'Provider';

      // Notify all admins
      const adminsRes = await pool.query("SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL");
      for (const admin of adminsRes.rows) {
        await notificationService.notifyAdminDispute(
          String(admin.id),
          currentUserId,
          disputeClientName,
          providerUserId,
          disputeProviderName,
          bookingId,
          dispute_reason.trim()
        );
      }

      // Also notify provider
      await notificationService.create({
        userId: providerUserId,
        type: 'booking_disputed',
        title: 'Booking Disputed',
        message: `${disputeClientName} has raised a dispute: ${dispute_reason.substring(0, 100)}${dispute_reason.length > 100 ? '...' : ''}`,
        data: { booking_id: bookingId, reason: dispute_reason }
      });

      // Send system message in chat
      try {
        const chatId = await ensureBookingChatExists(bookingId, clientUserId, providerUserId);
        if (chatId) {
          await pool.query(
            `INSERT INTO chat_messages (chat_id, sender_id, content, is_system)
             VALUES ($1, NULL, $2, TRUE)`,
            [chatId, `A dispute has been raised. An admin will review this booking.`]
          );
          await pool.query('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [chatId]);

          const io = (req.app as any).get('io');
          if (io) {
            io.to(`booking:${bookingId}`).emit('booking:disputed', { bookingId });
          }
        }
      } catch (chatError) {
        console.error('Failed to send dispute chat message:', chatError);
      }

      const updatedRes = await pool.query('SELECT * FROM bookings WHERE id::text = $1', [bookingId]);
      return res.json({
        data: updatedRes.rows[0],
        message: 'Dispute has been raised and admin has been notified'
      });
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error confirming booking:', error);
    return res.status(500).json({ error: 'Failed to process confirmation' });
  } finally {
    client.release();
  }
});

// ==================== GET BOOKING EVIDENCE ====================

router.get('/:id/evidence', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const currentUserId = req.userId;
  const bookingId = String(req.params.id || '');
  const role = (req as any).role;

  if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });
  if (!bookingId) return res.status(400).json({ error: 'Invalid booking id' });

  try {
    // Get booking to verify access
    const bookingRes = await pool.query(
      'SELECT client_id, provider_id FROM bookings WHERE id::text = $1',
      [bookingId]
    );
    const booking = bookingRes.rows[0];
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    // Check access (client, provider, or admin)
    const isParticipant =
      String(booking.client_id) === String(currentUserId) ||
      String(booking.provider_id) === String(currentUserId);

    if (role !== 'admin' && !isParticipant) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get evidence
    const evidenceRes = await pool.query(
      `SELECT be.*, u.name as uploaded_by_name
       FROM booking_evidence be
       LEFT JOIN users u ON u.id = be.uploaded_by
       WHERE be.booking_id::text = $1
       ORDER BY be.uploaded_at ASC`,
      [bookingId]
    );

    return res.json({ data: evidenceRes.rows });
  } catch (error) {
    console.error('Error fetching evidence:', error);
    return res.status(500).json({ error: 'Failed to fetch evidence' });
  }
});

// ==================== ADMIN RESOLVE DISPUTE ====================

router.put('/:id/resolve-dispute', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  const currentUserId = req.userId;
  const bookingId = String(req.params.id || '');
  const role = (req as any).role;
  const { resolution, resolved_in_favor_of, refund_percentage } = req.body;

  if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });
  if (role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  if (!bookingId) return res.status(400).json({ error: 'Invalid booking id' });
  if (!resolution || resolution.trim().length < 10) {
    return res.status(400).json({ error: 'Resolution must be at least 10 characters' });
  }
  if (!['client', 'provider'].includes(resolved_in_favor_of)) {
    return res.status(400).json({ error: 'resolved_in_favor_of must be "client" or "provider"' });
  }

  // Validate refund percentage if provided (0-100)
  const refundPct = refund_percentage !== undefined ? Number(refund_percentage) : (resolved_in_favor_of === 'client' ? 100 : 0);
  if (isNaN(refundPct) || refundPct < 0 || refundPct > 100) {
    return res.status(400).json({ error: 'refund_percentage must be between 0 and 100' });
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    // Get booking with FOR UPDATE lock to prevent concurrent modifications
    const bookingRes = await dbClient.query(
      `SELECT b.*, s.title as service_title
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.id::text = $1
       FOR UPDATE OF b`,
      [bookingId]
    );
    const booking = bookingRes.rows[0];
    if (!booking) {
      await dbClient.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Check if already resolved (idempotency)
    if (booking.status !== 'disputed' && !booking.dispute_raised) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'This booking is not disputed or has already been resolved' });
    }

    // Resolve actual user IDs from providers/clients tables if they exist
    let clientUserId = String(booking.client_id);
    let providerUserId = String(booking.provider_id);

    // Check if providers table exists and resolve provider user ID
    try {
      const providerRes = await dbClient.query(
        `SELECT user_id FROM providers WHERE id::text = $1`,
        [String(booking.provider_id)]
      );
      if (providerRes.rows[0]?.user_id) {
        providerUserId = String(providerRes.rows[0].user_id);
      }
    } catch (e) {
      // providers table doesn't exist, use provider_id directly
    }

    // Check if clients table exists and resolve client user ID
    try {
      const clientRes = await dbClient.query(
        `SELECT user_id FROM clients WHERE id::text = $1`,
        [String(booking.client_id)]
      );
      if (clientRes.rows[0]?.user_id) {
        clientUserId = String(clientRes.rows[0].user_id);
      }
    } catch (e) {
      // clients table doesn't exist, use client_id directly
    }

    // Get payment info
    const paymentRes = await dbClient.query(
      `SELECT id, net_provider_amount, amount, status FROM payments WHERE booking_id::text = $1`,
      [bookingId]
    );
    const payment = paymentRes.rows[0];
    const paymentAmount = payment ? parseFloat(payment.net_provider_amount || payment.amount || 0) : 0;

    // Calculate refund and release amounts
    const refundAmount = (paymentAmount * refundPct) / 100;
    const releaseAmount = paymentAmount - refundAmount;

    // Determine final status based on resolution
    const finalStatus = resolved_in_favor_of === 'provider' ? 'completed' : 'cancelled';

    // Update booking status and store resolution details
    await dbClient.query(
      `UPDATE bookings
       SET status = $1,
           dispute_raised = FALSE,
           dispute_resolution = $2,
           dispute_resolved_at = CURRENT_TIMESTAMP,
           dispute_resolved_by = $3,
           completed_at = CASE WHEN $1 = 'completed' THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE completed_at END,
           cancelled_at = CASE WHEN $1 = 'cancelled' THEN CURRENT_TIMESTAMP ELSE cancelled_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id::text = $4`,
      [finalStatus, resolution.trim(), currentUserId, bookingId]
    );

    let paymentReleased = false;
    let releasedAmount = 0;
    let refundedAmount = 0;

    if (payment && payment.status === 'succeeded') {
      // Get provider's wallet with FOR UPDATE lock
      const walletRes = await dbClient.query(
        `SELECT id, pending_balance, available_balance FROM wallets WHERE provider_id::text = $1 FOR UPDATE`,
        [providerUserId]
      );
      let wallet = walletRes.rows[0];

      if (!wallet) {
        const newWalletRes = await dbClient.query(
          `INSERT INTO wallets (provider_id, available_balance, pending_balance)
           VALUES ($1, 0, 0)
           RETURNING id, pending_balance, available_balance`,
          [providerUserId]
        );
        wallet = newWalletRes.rows[0];
      }

      const currentPending = parseFloat(wallet.pending_balance) || 0;
      const currentAvailable = parseFloat(wallet.available_balance) || 0;

      // Validate: ensure pending balance is sufficient
      if (currentPending < paymentAmount) {
        console.warn(`Warning: Pending balance (${currentPending}) is less than payment amount (${paymentAmount}) for booking ${bookingId}`);
        // Adjust to what's available in pending
        const actualPaymentAmount = Math.min(currentPending, paymentAmount);
        const actualRefund = (actualPaymentAmount * refundPct) / 100;
        const actualRelease = actualPaymentAmount - actualRefund;

        if (actualRelease > 0) {
          // Release partial amount to provider
          const newPending = currentPending - actualPaymentAmount;
          const newAvailable = currentAvailable + actualRelease;

          await dbClient.query(
            `UPDATE wallets SET pending_balance = $1, available_balance = $2, updated_at = CURRENT_TIMESTAMP WHERE id::text = $3`,
            [Math.max(0, newPending), newAvailable, String(wallet.id)]
          );

          await dbClient.query(
            `INSERT INTO transactions (wallet_id, payment_id, type, amount, balance_after, reference_id, description)
             VALUES ($1, $2, 'payment_received', $3, $4, $5, $6)`,
            [String(wallet.id), String(payment.id), actualRelease, newAvailable, `dispute_resolved_${bookingId}`, `Payment released after dispute resolved in provider's favor`]
          );

          paymentReleased = true;
          releasedAmount = actualRelease;
        }

        if (actualRefund > 0) {
          // Record refund transaction (funds removed from pending, refund to client)
          await dbClient.query(
            `INSERT INTO transactions (wallet_id, payment_id, type, amount, balance_after, reference_id, description)
             VALUES ($1, $2, 'refund', $3, $4, $5, $6)`,
            [String(wallet.id), String(payment.id), -actualRefund, currentAvailable + (actualRelease || 0), `dispute_refund_${bookingId}`, `Refund issued after dispute resolved in client's favor (${refundPct}%)`]
          );
          refundedAmount = actualRefund;
        }
      } else {
        // Normal case: sufficient pending balance
        if (releaseAmount > 0) {
          // Release to provider
          const newPending = currentPending - paymentAmount;
          const newAvailable = currentAvailable + releaseAmount;

          await dbClient.query(
            `UPDATE wallets SET pending_balance = $1, available_balance = $2, updated_at = CURRENT_TIMESTAMP WHERE id::text = $3`,
            [Math.max(0, newPending), newAvailable, String(wallet.id)]
          );

          await dbClient.query(
            `INSERT INTO transactions (wallet_id, payment_id, type, amount, balance_after, reference_id, description)
             VALUES ($1, $2, 'payment_received', $3, $4, $5, $6)`,
            [String(wallet.id), String(payment.id), releaseAmount, newAvailable, `dispute_resolved_${bookingId}`, `Payment released after dispute resolved (${100 - refundPct}% to provider)`]
          );

          paymentReleased = true;
          releasedAmount = releaseAmount;
        } else {
          // Full refund case - just reduce pending balance
          const newPending = currentPending - paymentAmount;
          await dbClient.query(
            `UPDATE wallets SET pending_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id::text = $2`,
            [Math.max(0, newPending), String(wallet.id)]
          );
        }

        if (refundAmount > 0) {
          // Record refund transaction
          await dbClient.query(
            `INSERT INTO transactions (wallet_id, payment_id, type, amount, balance_after, reference_id, description)
             VALUES ($1, $2, 'refund', $3, $4, $5, $6)`,
            [String(wallet.id), String(payment.id), -refundAmount, currentAvailable + (releaseAmount || 0), `dispute_refund_${bookingId}`, `Refund issued to client after dispute resolved (${refundPct}% refund)`]
          );
          refundedAmount = refundAmount;

          // Update payment status to reflect partial/full refund
          await dbClient.query(
            `UPDATE payments SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id::text = $2`,
            [refundPct === 100 ? 'refunded' : 'partially_refunded', String(payment.id)]
          );
        }
      }

      console.log(`Dispute resolved for booking ${bookingId}: Released ₱${releasedAmount.toFixed(2)} to provider, Refunded ₱${refundedAmount.toFixed(2)} to client`);
    }

    // Log audit entry for dispute resolution
    try {
      await dbClient.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          currentUserId,
          'dispute_resolved',
          'booking',
          bookingId,
          JSON.stringify({
            resolved_in_favor_of,
            resolution: resolution.trim(),
            refund_percentage: refundPct,
            released_amount: releasedAmount,
            refunded_amount: refundedAmount,
            previous_status: booking.status,
            new_status: finalStatus
          }),
          req.ip || 'unknown'
        ]
      );
    } catch (auditError) {
      console.error('Failed to create audit log for dispute resolution:', auditError);
      // Don't fail the transaction for audit log errors
    }

    await dbClient.query('COMMIT');

      // Notify both parties with resolved user IDs
      await notificationService.notifyDisputeResolved(
        clientUserId,
        bookingId,
        resolution,
        resolved_in_favor_of
      );
      await notificationService.notifyDisputeResolved(
        providerUserId,
        bookingId,
        resolution,
        resolved_in_favor_of
      );

      // Notify provider about payment if released
      if (paymentReleased) {
        await notificationService.notifyPaymentReceived(
          providerUserId,
          clientUserId,
          releasedAmount,
          'Client',
          bookingId
        );
      }

      // Send system message in chat using resolved user IDs
      try {
        const chatId = await ensureBookingChatExists(bookingId, clientUserId, providerUserId);
        if (chatId) {
          const favorText = resolved_in_favor_of === 'client' ? 'the client' : 'the provider';
          let chatMessage = `Dispute has been resolved in favor of ${favorText}. Resolution: ${resolution}`;
          if (paymentReleased) {
            chatMessage += ` Payment of ₱${releasedAmount.toFixed(2)} has been released to the provider.`;
          }
          if (refundedAmount > 0) {
            chatMessage += ` A refund of ₱${refundedAmount.toFixed(2)} has been processed for the client.`;
          }
          await pool.query(
            `INSERT INTO chat_messages (chat_id, sender_id, content, is_system)
             VALUES ($1, NULL, $2, TRUE)`,
            [chatId, chatMessage]
          );
          await pool.query('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [chatId]);

          const io = (req.app as any).get('io');
          if (io) {
            io.to(`booking:${bookingId}`).emit('booking:dispute_resolved', {
              bookingId,
              resolved_in_favor_of,
              final_status: finalStatus,
              paymentReleased,
              releasedAmount
            });
          }
        }
      } catch (chatError) {
        console.error('Failed to send dispute resolution chat message:', chatError);
      }

      const updatedRes = await pool.query('SELECT * FROM bookings WHERE id::text = $1', [bookingId]);

      // Build detailed response message
      let responseMessage = `Dispute resolved in favor of ${resolved_in_favor_of}.`;
      if (releasedAmount > 0) {
        responseMessage += ` ₱${releasedAmount.toFixed(2)} released to provider.`;
      }
      if (refundedAmount > 0) {
        responseMessage += ` ₱${refundedAmount.toFixed(2)} refunded to client.`;
      }

      return res.json({
        data: updatedRes.rows[0],
        message: responseMessage,
        details: {
          released_to_provider: releasedAmount,
          refunded_to_client: refundedAmount,
          refund_percentage: refundPct
        }
      });
  } catch (error) {
    await dbClient.query('ROLLBACK');
    console.error('Error resolving dispute:', error);
    return res.status(500).json({ error: 'Failed to resolve dispute' });
  } finally {
    dbClient.release();
  }
});

export default router;
