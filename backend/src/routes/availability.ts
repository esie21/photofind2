import express, { Request, Response } from 'express';
import { pool } from '../config/database';
import { verifyToken } from '../middleware/auth';

const router = express.Router();

// Constants
const DEFAULT_SLOT_DURATION = 60; // minutes
const DEFAULT_BUFFER_MINUTES = 0;
const HOLD_DURATION_MINUTES = 10;
const SLOT_GENERATION_DAYS = 60; // Generate slots 60 days ahead

// Helper functions
function parseId(raw: any): string | null {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str || str === 'undefined' || str === 'null') return null;
  return str;
}

// Get provider's user_id from providers table if needed
async function getProviderUserId(providerId: string): Promise<string> {
  try {
    const res = await pool.query('SELECT user_id FROM providers WHERE id::text = $1', [providerId]);
    if (res.rows[0]) return String(res.rows[0].user_id);
  } catch (e) {
    // Ignore - might not have providers table
  }
  return providerId;
}

// ==================== AVAILABILITY RULES ====================

// Get provider's availability rules
router.get('/rules/:providerId', async (req: Request, res: Response) => {
  try {
    const providerId = parseId(req.params.providerId);
    if (!providerId) return res.status(400).json({ error: 'Invalid provider ID' });

    const providerUserId = await getProviderUserId(providerId);

    const result = await pool.query(
      `SELECT * FROM availability_rules
       WHERE provider_id::text = $1 AND is_active = TRUE
       ORDER BY day_of_week, start_time`,
      [providerUserId]
    );

    return res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching availability rules:', error);
    return res.status(500).json({ error: 'Failed to fetch availability rules' });
  }
});

// Create/update availability rules (provider only)
router.post('/rules', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  try {
    const userId = req.userId;
    const role = (req as any).role;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (role !== 'provider' && role !== 'admin') return res.status(403).json({ error: 'Access denied' });

    const { rules } = req.body;
    if (!Array.isArray(rules)) return res.status(400).json({ error: 'Rules must be an array' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Deactivate all existing rules
      await client.query(
        'UPDATE availability_rules SET is_active = FALSE WHERE provider_id::text = $1',
        [userId]
      );

      const insertedRules = [];

      for (const rule of rules) {
        const { day_of_week, start_time, end_time, slot_duration, buffer_minutes } = rule;

        if (day_of_week < 0 || day_of_week > 6) continue;
        if (!start_time || !end_time) continue;

        const result = await client.query(
          `INSERT INTO availability_rules
           (provider_id, day_of_week, start_time, end_time, slot_duration, buffer_minutes, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE)
           ON CONFLICT ON CONSTRAINT unique_provider_slot DO UPDATE
           SET start_time = EXCLUDED.start_time,
               end_time = EXCLUDED.end_time,
               slot_duration = EXCLUDED.slot_duration,
               buffer_minutes = EXCLUDED.buffer_minutes,
               is_active = TRUE,
               updated_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [
            userId,
            day_of_week,
            start_time,
            end_time,
            slot_duration || DEFAULT_SLOT_DURATION,
            buffer_minutes || DEFAULT_BUFFER_MINUTES
          ]
        );

        insertedRules.push(result.rows[0]);
      }

      await client.query('COMMIT');

      // Regenerate slots for the next 60 days
      await generateSlotsForProvider(userId, SLOT_GENERATION_DAYS);

      return res.json({ data: insertedRules });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error saving availability rules:', error);
    return res.status(500).json({ error: 'Failed to save availability rules' });
  }
});

// Delete a rule
router.delete('/rules/:ruleId', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  try {
    const userId = req.userId;
    const role = (req as any).role;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (role !== 'provider' && role !== 'admin') return res.status(403).json({ error: 'Access denied' });

    const ruleId = parseId(req.params.ruleId);
    if (!ruleId) return res.status(400).json({ error: 'Invalid rule ID' });

    await pool.query(
      'DELETE FROM availability_rules WHERE id::text = $1 AND provider_id::text = $2',
      [ruleId, userId]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting rule:', error);
    return res.status(500).json({ error: 'Failed to delete rule' });
  }
});

// ==================== AVAILABILITY OVERRIDES ====================

// Get provider's overrides for a date range
router.get('/overrides/:providerId', async (req: Request, res: Response) => {
  try {
    const providerId = parseId(req.params.providerId);
    if (!providerId) return res.status(400).json({ error: 'Invalid provider ID' });

    const providerUserId = await getProviderUserId(providerId);

    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;

    let query = 'SELECT * FROM availability_overrides WHERE provider_id::text = $1';
    const values: any[] = [providerUserId];

    if (from) {
      values.push(from);
      query += ` AND override_date >= $${values.length}`;
    }
    if (to) {
      values.push(to);
      query += ` AND override_date <= $${values.length}`;
    }

    query += ' ORDER BY override_date';

    const result = await pool.query(query, values);
    return res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching overrides:', error);
    return res.status(500).json({ error: 'Failed to fetch overrides' });
  }
});

// Create/update override (provider only)
router.post('/overrides', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  try {
    const userId = req.userId;
    const role = (req as any).role;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (role !== 'provider' && role !== 'admin') return res.status(403).json({ error: 'Access denied' });

    const { override_date, is_available, start_time, end_time, reason } = req.body;
    if (!override_date) return res.status(400).json({ error: 'override_date is required' });

    const result = await pool.query(
      `INSERT INTO availability_overrides
       (provider_id, override_date, is_available, start_time, end_time, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ON CONSTRAINT unique_provider_date
       DO UPDATE SET
         is_available = EXCLUDED.is_available,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         reason = EXCLUDED.reason
       RETURNING *`,
      [userId, override_date, is_available ?? false, start_time, end_time, reason]
    );

    // Regenerate slots for that date
    await regenerateSlotsForDate(userId, override_date);

    return res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error saving override:', error);
    return res.status(500).json({ error: 'Failed to save override' });
  }
});

// Delete override
router.delete('/overrides/:overrideId', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  try {
    const userId = req.userId;
    const role = (req as any).role;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (role !== 'provider' && role !== 'admin') return res.status(403).json({ error: 'Access denied' });

    const overrideId = parseId(req.params.overrideId);
    if (!overrideId) return res.status(400).json({ error: 'Invalid override ID' });

    const existing = await pool.query(
      'SELECT override_date FROM availability_overrides WHERE id::text = $1 AND provider_id::text = $2',
      [overrideId, userId]
    );

    if (existing.rows[0]) {
      await pool.query(
        'DELETE FROM availability_overrides WHERE id::text = $1',
        [overrideId]
      );
      // Regenerate slots for that date
      await regenerateSlotsForDate(userId, existing.rows[0].override_date);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting override:', error);
    return res.status(500).json({ error: 'Failed to delete override' });
  }
});

// ==================== TIME SLOTS ====================

// Get available slots for a provider on a specific date
router.get('/slots/:providerId', async (req: Request, res: Response) => {
  try {
    const providerId = parseId(req.params.providerId);
    if (!providerId) return res.status(400).json({ error: 'Invalid provider ID' });

    const providerUserId = await getProviderUserId(providerId);
    const date = req.query.date ? String(req.query.date) : null;

    // First, ensure slots are generated for this provider
    await generateSlotsForProvider(providerUserId, SLOT_GENERATION_DAYS);

    // Release expired holds
    await releaseExpiredHolds();

    let query = `
      SELECT ts.*,
             CASE WHEN ts.status = 'held' AND ts.hold_expires_at > NOW() THEN TRUE ELSE FALSE END as is_held
      FROM time_slots ts
      WHERE ts.provider_id::text = $1
        AND ts.start_datetime > NOW()
    `;
    const values: any[] = [providerUserId];

    if (date) {
      values.push(date);
      query += ` AND DATE(ts.start_datetime) = $${values.length}::date`;
    }

    query += ' ORDER BY ts.start_datetime';

    const result = await pool.query(query, values);
    return res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching time slots:', error);
    return res.status(500).json({ error: 'Failed to fetch time slots' });
  }
});

// Get available time slots for booking (public)
router.get('/providers/:providerId/timeslots', async (req: Request, res: Response) => {
  try {
    const providerId = parseId(req.params.providerId);
    if (!providerId) return res.status(400).json({ error: 'Invalid providerId' });

    const dateStr = req.query.date ? String(req.query.date) : null;
    if (!dateStr) return res.status(400).json({ error: 'Missing date (YYYY-MM-DD)' });

    const providerUserId = await getProviderUserId(providerId);

    // Ensure slots are generated
    await generateSlotsForProvider(providerUserId, SLOT_GENERATION_DAYS);

    // Release expired holds
    await releaseExpiredHolds();

    // Get available slots only
    const result = await pool.query(
      `SELECT id, start_datetime, end_datetime, status
       FROM time_slots
       WHERE provider_id::text = $1
         AND DATE(start_datetime) = $2::date
         AND status = 'available'
         AND start_datetime > NOW()
       ORDER BY start_datetime`,
      [providerUserId, dateStr]
    );

    return res.json({
      data: {
        provider_id: providerId,
        date: dateStr,
        slots: result.rows.map(s => ({
          id: s.id,
          start: s.start_datetime,
          end: s.end_datetime,
          status: s.status
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching timeslots:', error);
    return res.status(500).json({ error: 'Failed to fetch timeslots' });
  }
});

// Get calendar data for a month (shows which days have availability)
router.get('/calendar/:providerId', async (req: Request, res: Response) => {
  try {
    const providerId = parseId(req.params.providerId);
    if (!providerId) return res.status(400).json({ error: 'Invalid provider ID' });

    const month = req.query.month ? parseInt(String(req.query.month)) : new Date().getMonth() + 1;
    const year = req.query.year ? parseInt(String(req.query.year)) : new Date().getFullYear();

    const providerUserId = await getProviderUserId(providerId);

    // Ensure slots are generated
    await generateSlotsForProvider(providerUserId, SLOT_GENERATION_DAYS);

    // Release expired holds
    await releaseExpiredHolds();

    // Get slot counts per day
    const result = await pool.query(
      `SELECT
         DATE(start_datetime) as date,
         COUNT(*) FILTER (WHERE status = 'available') as available_count,
         COUNT(*) FILTER (WHERE status = 'held') as held_count,
         COUNT(*) FILTER (WHERE status = 'booked') as booked_count,
         COUNT(*) as total_count
       FROM time_slots
       WHERE provider_id::text = $1
         AND EXTRACT(MONTH FROM start_datetime) = $2
         AND EXTRACT(YEAR FROM start_datetime) = $3
         AND start_datetime > NOW()
       GROUP BY DATE(start_datetime)
       ORDER BY date`,
      [providerUserId, month, year]
    );

    // Get overrides for the month
    const overrides = await pool.query(
      `SELECT override_date, is_available, reason
       FROM availability_overrides
       WHERE provider_id::text = $1
         AND EXTRACT(MONTH FROM override_date) = $2
         AND EXTRACT(YEAR FROM override_date) = $3`,
      [providerUserId, month, year]
    );

    return res.json({
      data: {
        month,
        year,
        days: result.rows,
        overrides: overrides.rows
      }
    });
  } catch (error) {
    console.error('Error fetching calendar:', error);
    return res.status(500).json({ error: 'Failed to fetch calendar data' });
  }
});

// ==================== SLOT HOLDING ====================

// Hold a slot (temporary lock)
router.post('/slots/hold', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { slot_id, slot_ids } = req.body;
    const slotIdsToHold = slot_ids || (slot_id ? [slot_id] : []);

    if (!slotIdsToHold.length) {
      return res.status(400).json({ error: 'slot_id or slot_ids required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Release any existing holds by this user
      await client.query(
        `UPDATE time_slots
         SET status = 'available', held_by = NULL, hold_expires_at = NULL
         WHERE held_by::text = $1 AND status = 'held'`,
        [userId]
      );

      const holdExpiresAt = new Date(Date.now() + HOLD_DURATION_MINUTES * 60 * 1000);
      const heldSlots = [];

      for (const slotId of slotIdsToHold) {
        // Lock the slot row for update
        const slotRes = await client.query(
          `SELECT * FROM time_slots WHERE id::text = $1 FOR UPDATE`,
          [slotId]
        );

        const slot = slotRes.rows[0];
        if (!slot) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: `Slot ${slotId} not found` });
        }

        if (slot.status !== 'available') {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: 'Slot not available',
            slot_id: slotId,
            current_status: slot.status
          });
        }

        // Hold the slot
        const updated = await client.query(
          `UPDATE time_slots
           SET status = 'held', held_by = $1, hold_expires_at = $2
           WHERE id::text = $3
           RETURNING *`,
          [userId, holdExpiresAt.toISOString(), slotId]
        );

        heldSlots.push(updated.rows[0]);
      }

      await client.query('COMMIT');

      return res.json({
        data: {
          slots: heldSlots,
          hold_expires_at: holdExpiresAt.toISOString(),
          hold_duration_minutes: HOLD_DURATION_MINUTES
        }
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error holding slot:', error);
    return res.status(500).json({ error: 'Failed to hold slot' });
  }
});

// Release a held slot
router.post('/slots/release', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { slot_id, slot_ids } = req.body;
    const slotIdsToRelease = slot_ids || (slot_id ? [slot_id] : []);

    if (!slotIdsToRelease.length) {
      // Release all holds by this user
      await pool.query(
        `UPDATE time_slots
         SET status = 'available', held_by = NULL, hold_expires_at = NULL
         WHERE held_by::text = $1 AND status = 'held'`,
        [userId]
      );
    } else {
      // Release specific slots
      for (const slotId of slotIdsToRelease) {
        await pool.query(
          `UPDATE time_slots
           SET status = 'available', held_by = NULL, hold_expires_at = NULL
           WHERE id::text = $1 AND held_by::text = $2 AND status = 'held'`,
          [slotId, userId]
        );
      }
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Error releasing slot:', error);
    return res.status(500).json({ error: 'Failed to release slot' });
  }
});

// ==================== BOOKING CONFIRMATION WITH LOCKING ====================

// Confirm booking (critical section with transaction)
router.post('/slots/book', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { slot_id, slot_ids, service_id, notes } = req.body;
    const slotIdsToBook = slot_ids || (slot_id ? [slot_id] : []);

    if (!slotIdsToBook.length) {
      return res.status(400).json({ error: 'slot_id or slot_ids required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get all slots with row-level lock
      const slotsRes = await client.query(
        `SELECT * FROM time_slots
         WHERE id::text = ANY($1)
         FOR UPDATE`,
        [slotIdsToBook]
      );

      if (slotsRes.rows.length !== slotIdsToBook.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'One or more slots not found' });
      }

      // Validate all slots
      for (const slot of slotsRes.rows) {
        // Slot must be held by this user OR available
        if (slot.status === 'booked') {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: 'Slot already booked',
            slot_id: slot.id
          });
        }

        if (slot.status === 'held' && String(slot.held_by) !== String(userId)) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: 'Slot held by another user',
            slot_id: slot.id
          });
        }
      }

      // All slots are valid - get provider and calculate times
      const firstSlot = slotsRes.rows[0];
      const lastSlot = slotsRes.rows[slotsRes.rows.length - 1];
      const providerId = firstSlot.provider_id;
      const startDatetime = new Date(Math.min(...slotsRes.rows.map(s => new Date(s.start_datetime).getTime())));
      const endDatetime = new Date(Math.max(...slotsRes.rows.map(s => new Date(s.end_datetime).getTime())));

      // Get service info
      let totalPrice = 0;
      let serviceDuration = 60;
      if (service_id) {
        const serviceRes = await client.query(
          'SELECT price, duration_minutes FROM services WHERE id::text = $1',
          [service_id]
        );
        if (serviceRes.rows[0]) {
          totalPrice = parseFloat(serviceRes.rows[0].price) || 0;
          serviceDuration = serviceRes.rows[0].duration_minutes || 60;
        }
      }

      // Create the booking
      const bookingRes = await client.query(
        `INSERT INTO bookings
         (client_id, provider_id, service_id, start_date, end_date, status, total_price, notes)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
         RETURNING *`,
        [
          userId,
          providerId,
          service_id,
          startDatetime.toISOString(),
          endDatetime.toISOString(),
          totalPrice,
          notes || null
        ]
      );

      const booking = bookingRes.rows[0];

      // Update all slots to booked status
      await client.query(
        `UPDATE time_slots
         SET status = 'booked',
             booking_id = $1,
             held_by = NULL,
             hold_expires_at = NULL
         WHERE id::text = ANY($2)`,
        [booking.id, slotIdsToBook]
      );

      await client.query('COMMIT');

      return res.status(201).json({
        data: {
          booking,
          slots: slotsRes.rows.map(s => s.id)
        }
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error booking slot:', error);
    return res.status(500).json({ error: 'Failed to create booking' });
  }
});

// ==================== SLOT GENERATION SERVICE ====================

async function generateSlotsForProvider(providerId: string, daysAhead: number = 60) {
  const client = await pool.connect();
  try {
    // Get provider's rules
    const rulesRes = await client.query(
      `SELECT * FROM availability_rules
       WHERE provider_id::text = $1 AND is_active = TRUE`,
      [providerId]
    );

    if (rulesRes.rows.length === 0) {
      // No rules defined - create default rules (Mon-Fri 9am-5pm)
      const defaultDays = [1, 2, 3, 4, 5]; // Monday to Friday
      for (const day of defaultDays) {
        await client.query(
          `INSERT INTO availability_rules
           (provider_id, day_of_week, start_time, end_time, slot_duration, buffer_minutes, is_active)
           VALUES ($1, $2, '09:00', '17:00', 60, 0, TRUE)
           ON CONFLICT DO NOTHING`,
          [providerId, day]
        );
      }

      // Re-fetch rules
      const newRulesRes = await client.query(
        `SELECT * FROM availability_rules
         WHERE provider_id::text = $1 AND is_active = TRUE`,
        [providerId]
      );
      rulesRes.rows = newRulesRes.rows;
    }

    // Get overrides
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + daysAhead);

    const overridesRes = await client.query(
      `SELECT * FROM availability_overrides
       WHERE provider_id::text = $1
         AND override_date >= $2::date
         AND override_date <= $3::date`,
      [providerId, today.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
    );

    const overridesMap = new Map();
    for (const override of overridesRes.rows) {
      const dateKey = new Date(override.override_date).toISOString().split('T')[0];
      overridesMap.set(dateKey, override);
    }

    // Group rules by day_of_week
    const rulesByDay = new Map();
    for (const rule of rulesRes.rows) {
      if (!rulesByDay.has(rule.day_of_week)) {
        rulesByDay.set(rule.day_of_week, []);
      }
      rulesByDay.get(rule.day_of_week).push(rule);
    }

    // Generate slots for each day
    const currentDate = new Date(today);
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayOfWeek = currentDate.getDay();
      const override = overridesMap.get(dateStr);

      // Check if this day is blocked
      if (override && !override.is_available) {
        // Day is blocked - delete any existing available slots
        await client.query(
          `DELETE FROM time_slots
           WHERE provider_id::text = $1
             AND DATE(start_datetime) = $2::date
             AND status = 'available'`,
          [providerId, dateStr]
        );
        currentDate.setDate(currentDate.getDate() + 1);
        continue;
      }

      // Get rules for this day (or override times)
      let dayRules = rulesByDay.get(dayOfWeek) || [];

      if (override && override.is_available && override.start_time && override.end_time) {
        // Override with custom times
        dayRules = [{
          start_time: override.start_time,
          end_time: override.end_time,
          slot_duration: DEFAULT_SLOT_DURATION,
          buffer_minutes: DEFAULT_BUFFER_MINUTES
        }];
      }

      // Generate slots for this day's rules
      for (const rule of dayRules) {
        const startTimeParts = rule.start_time.split(':');
        const endTimeParts = rule.end_time.split(':');

        const slotStart = new Date(currentDate);
        slotStart.setHours(parseInt(startTimeParts[0]), parseInt(startTimeParts[1]), 0, 0);

        const dayEnd = new Date(currentDate);
        dayEnd.setHours(parseInt(endTimeParts[0]), parseInt(endTimeParts[1]), 0, 0);

        const slotDuration = rule.slot_duration || DEFAULT_SLOT_DURATION;
        const bufferMinutes = rule.buffer_minutes || DEFAULT_BUFFER_MINUTES;
        const stepMinutes = slotDuration + bufferMinutes;

        while (slotStart.getTime() + slotDuration * 60 * 1000 <= dayEnd.getTime()) {
          const slotEnd = new Date(slotStart.getTime() + slotDuration * 60 * 1000);

          // Only create if not in the past and doesn't exist
          if (slotStart.getTime() > Date.now()) {
            await client.query(
              `INSERT INTO time_slots (provider_id, start_datetime, end_datetime, status)
               VALUES ($1, $2, $3, 'available')
               ON CONFLICT ON CONSTRAINT unique_provider_slot DO NOTHING`,
              [providerId, slotStart.toISOString(), slotEnd.toISOString()]
            );
          }

          slotStart.setMinutes(slotStart.getMinutes() + stepMinutes);
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }
  } finally {
    client.release();
  }
}

async function regenerateSlotsForDate(providerId: string, date: string) {
  // Delete existing available slots for the date
  await pool.query(
    `DELETE FROM time_slots
     WHERE provider_id::text = $1
       AND DATE(start_datetime) = $2::date
       AND status = 'available'`,
    [providerId, date]
  );

  // Regenerate
  await generateSlotsForProvider(providerId, 1);
}

async function releaseExpiredHolds() {
  try {
    await pool.query(
      `UPDATE time_slots
       SET status = 'available', held_by = NULL, hold_expires_at = NULL
       WHERE status = 'held' AND hold_expires_at < NOW()`
    );
  } catch (e) {
    console.error('Error releasing expired holds:', e);
  }
}

// ==================== HOLD EXPIRATION CLEANUP (call periodically) ====================

router.post('/cleanup-holds', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `UPDATE time_slots
       SET status = 'available', held_by = NULL, hold_expires_at = NULL
       WHERE status = 'held' AND hold_expires_at < NOW()
       RETURNING id`
    );

    return res.json({
      success: true,
      released_count: result.rowCount
    });
  } catch (error) {
    console.error('Error cleaning up holds:', error);
    return res.status(500).json({ error: 'Failed to cleanup holds' });
  }
});

// ==================== LEGACY COMPATIBILITY ====================

// Keep the old endpoints working
router.get('/providers/:providerId/slots', async (req: Request, res: Response) => {
  try {
    const providerId = parseId(req.params.providerId);
    if (!providerId) return res.status(400).json({ error: 'Invalid providerId' });

    const providerUserId = await getProviderUserId(providerId);
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;

    // Ensure slots are generated
    await generateSlotsForProvider(providerUserId, SLOT_GENERATION_DAYS);

    let query = `
      SELECT id, provider_id, start_datetime as start_time, end_datetime as end_time,
             CASE WHEN status = 'available' THEN TRUE ELSE FALSE END as is_bookable,
             created_at
      FROM time_slots
      WHERE provider_id::text = $1
    `;
    const values: any[] = [providerUserId];

    if (from) {
      values.push(from);
      query += ` AND start_datetime >= $${values.length}`;
    }
    if (to) {
      values.push(to);
      query += ` AND end_datetime <= $${values.length}`;
    }

    query += ' ORDER BY start_datetime ASC';

    const result = await pool.query(query, values);
    return res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching slots:', error);
    return res.status(500).json({ error: 'Failed to fetch slots' });
  }
});

// Create availability slot (legacy - creates a rule instead)
router.post('/', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  try {
    const userId = req.userId;
    const role = (req as any).role;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (role !== 'provider' && role !== 'admin') return res.status(403).json({ error: 'Access denied' });

    const { start_time, end_time, is_bookable } = req.body;
    if (!start_time || !end_time) return res.status(400).json({ error: 'Missing start_time or end_time' });

    const start = new Date(start_time);
    const end = new Date(end_time);

    // Create a slot directly in time_slots for backward compatibility
    const result = await pool.query(
      `INSERT INTO time_slots (provider_id, start_datetime, end_datetime, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ON CONSTRAINT unique_provider_slot
       DO UPDATE SET status = EXCLUDED.status
       RETURNING *`,
      [userId, start.toISOString(), end.toISOString(), is_bookable !== false ? 'available' : 'booked']
    );

    return res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error creating slot:', error);
    return res.status(500).json({ error: 'Failed to create slot' });
  }
});

// Delete a specific slot (legacy endpoint)
router.delete('/:slotId', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  try {
    const userId = req.userId;
    const role = (req as any).role;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (role !== 'provider' && role !== 'admin') return res.status(403).json({ error: 'Access denied' });

    const slotId = parseId(req.params.slotId);
    if (!slotId) return res.status(400).json({ error: 'Invalid slot ID' });

    // Only allow deleting available slots that belong to this provider
    const result = await pool.query(
      `DELETE FROM time_slots
       WHERE id::text = $1
         AND provider_id::text = $2
         AND status = 'available'
       RETURNING id`,
      [slotId, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Slot not found or cannot be deleted' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting slot:', error);
    return res.status(500).json({ error: 'Failed to delete slot' });
  }
});

export default router;
