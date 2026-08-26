import express, { Request, Response } from 'express';
import { pool } from '../config/database';
import { verifyToken } from '../middleware/auth';

const router = express.Router();

// Constants
const DEFAULT_SLOT_DURATION = 30; // minutes - 30 min slots for flexible booking
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

// Business timezone: Asia/Manila is a fixed UTC+8 offset with no DST. Slot
// generation anchors to it explicitly instead of the Node process's local
// timezone, which may be UTC in production and would otherwise shift every
// generated slot and day boundary by hours from what providers/clients see
// (the UI always displays times in Asia/Manila - see availabilityService.ts).
const PROVIDER_TIMEZONE_OFFSET = '+08:00';

// Normalize a date value (a JS Date from a pg DATE column, or a 'YYYY-MM-DD'
// string) to a canonical 'YYYY-MM-DD' string in the business timezone.
function toDateStr(value: string | Date): string {
  if (value instanceof Date) {
    return value.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  }
  const str = String(value);
  return str.length > 10 ? str.slice(0, 10) : str;
}

function manilaTodayStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

/**
 * Rewrites an override row's date to a plain 'YYYY-MM-DD' before it goes out over the API.
 *
 * override_date is a DATE column, which node-pg hands back as a JS Date, so res.json
 * serialised it as a full instant - "2026-08-25T16:00:00.000Z" for what is really
 * 26 August in Manila. Both callers expected a date string and neither survived it: the
 * provider dashboard built `override_date + 'T00:00:00'` and rendered "Invalid Date",
 * and the booking calendar matched `override_date === '2026-08-26'`, which could never be
 * true - so a blocked date never actually showed as blocked to a client.
 *
 * Converting through toDateStr rather than slicing the ISO string matters: that instant
 * is 16:00Z, so a naive slice yields the 25th, a day earlier than the provider blocked.
 */
function serialiseOverride<T extends { override_date: string | Date }>(row: T) {
  return { ...row, override_date: toDateStr(row.override_date) };
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

// A calendar date's day-of-week doesn't depend on timezone, only the date itself.
function dayOfWeekForDateStr(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

// The absolute instant for a wall-clock HH:MM on a given calendar date, anchored
// to the business timezone rather than the server's local timezone.
function manilaDateTime(dateStr: string, hours: number, minutes: number): Date {
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return new Date(`${dateStr}T${hh}:${mm}:00${PROVIDER_TIMEZONE_OFFSET}`);
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
           ON CONFLICT ON CONSTRAINT unique_provider_rule_slot DO UPDATE
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
    return res.json({ data: result.rows.map(serialiseOverride) });
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

    return res.json({ data: serialiseOverride(result.rows[0]) });
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
    console.log(`[Timeslots] Fetching for provider ${providerId} (userId: ${providerUserId}), date: ${dateStr}`);

    // Ensure slots are generated
    await generateSlotsForProvider(providerUserId, SLOT_GENERATION_DAYS);

    // Release expired holds
    await releaseExpiredHolds();

    // Get available, held, AND booked slots. Booked ones are included (not just
    // available/held) so the client sees them as visibly unavailable in the grid
    // instead of the slot just silently missing with no explanation.
    const result = await pool.query(
      `SELECT id, start_datetime, end_datetime, status, held_by, hold_expires_at
       FROM time_slots
       WHERE provider_id::text = $1
         AND DATE(start_datetime) = $2::date
         AND status IN ('available', 'held', 'booked')
         AND start_datetime > NOW()
       ORDER BY start_datetime`,
      [providerUserId, dateStr]
    );

    console.log(`[Timeslots] Found ${result.rows.length} slots for ${dateStr}`);

    // Debug: If no slots, check what's in the database
    if (result.rows.length === 0) {
      const debugResult = await pool.query(
        `SELECT COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'available') as available,
                COUNT(*) FILTER (WHERE status = 'held') as held,
                COUNT(*) FILTER (WHERE status = 'booked') as booked,
                MIN(start_datetime) as first_slot,
                MAX(start_datetime) as last_slot
         FROM time_slots
         WHERE provider_id::text = $1`,
        [providerUserId]
      );
      console.log(`[Timeslots] Debug - Total slots in DB for provider:`, debugResult.rows[0]);

      // Check if date filter is the issue
      const dateDebug = await pool.query(
        `SELECT COUNT(*) as count, DATE(start_datetime) as slot_date
         FROM time_slots
         WHERE provider_id::text = $1
         GROUP BY DATE(start_datetime)
         ORDER BY slot_date
         LIMIT 5`,
        [providerUserId]
      );
      console.log(`[Timeslots] Debug - Slots by date:`, dateDebug.rows);
    }

    return res.json({
      data: {
        provider_id: providerId,
        date: dateStr,
        slots: result.rows.map(s => ({
          id: s.id,
          start: s.start_datetime,
          end: s.end_datetime,
          status: s.status,
          is_held: s.status === 'held',
          hold_expires_at: s.hold_expires_at
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
        overrides: overrides.rows.map(serialiseOverride)
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

      const distinctProviderIds = new Set(slotsRes.rows.map(s => String(s.provider_id)));
      if (distinctProviderIds.size > 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'All slots in a booking must belong to the same provider' });
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

    // Only providers with no rules at all get a default schedule. Providers who have
    // configured custom hours via POST /rules must keep them - this used to get
    // detected as "outdated" and silently overwritten with 24/7 rules on every
    // slot-generation call (including right after saving custom rules).
    const hasNoRules = rulesRes.rows.length === 0;

    if (hasNoRules) {
      console.log(`[Availability] Creating default 24/7 rules for provider ${providerId}`);

      // Create new 24/7 rules for all days. ON CONFLICT DO NOTHING guards against two
      // concurrent first-time requests for the same brand-new provider (e.g. the
      // timeslots and calendar endpoints both firing on page load) racing to insert
      // the same (provider_id, day_of_week, start_time) row.
      const defaultDays = [0, 1, 2, 3, 4, 5, 6]; // Sunday to Saturday
      for (const day of defaultDays) {
        await client.query(
          `INSERT INTO availability_rules
           (provider_id, day_of_week, start_time, end_time, slot_duration, buffer_minutes, is_active)
           VALUES ($1, $2, '00:00', '23:30', 30, 0, TRUE)
           ON CONFLICT ON CONSTRAINT unique_provider_rule_slot DO NOTHING`,
          [providerId, day]
        );
      }

      // Re-fetch new rules
      const newRulesRes = await client.query(
        `SELECT * FROM availability_rules
         WHERE provider_id::text = $1 AND is_active = TRUE`,
        [providerId]
      );
      rulesRes.rows = newRulesRes.rows;
      console.log(`[Availability] Created ${rulesRes.rows.length} rules (24/7) for provider ${providerId}`);
    }

    // Get overrides
    const todayStr = manilaTodayStr();
    const endDateStr = addDaysToDateStr(todayStr, daysAhead);

    const overridesRes = await client.query(
      `SELECT * FROM availability_overrides
       WHERE provider_id::text = $1
         AND override_date >= $2::date
         AND override_date <= $3::date`,
      [providerId, todayStr, endDateStr]
    );

    const overridesMap = new Map();
    for (const override of overridesRes.rows) {
      overridesMap.set(toDateStr(override.override_date), override);
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
    for (let dateStr = todayStr; dateStr <= endDateStr; dateStr = addDaysToDateStr(dateStr, 1)) {
      const dayOfWeek = dayOfWeekForDateStr(dateStr);
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
      let slotsCreatedForDay = 0;
      for (const rule of dayRules) {
        const startTimeParts = String(rule.start_time).split(':');
        const endTimeParts = String(rule.end_time).split(':');

        const slotStart = manilaDateTime(dateStr, parseInt(startTimeParts[0]), parseInt(startTimeParts[1]));
        const dayEnd = manilaDateTime(dateStr, parseInt(endTimeParts[0]), parseInt(endTimeParts[1]));

        const slotDuration = rule.slot_duration || DEFAULT_SLOT_DURATION;
        const bufferMinutes = rule.buffer_minutes || DEFAULT_BUFFER_MINUTES;
        const stepMinutes = slotDuration + bufferMinutes;

        while (slotStart.getTime() + slotDuration * 60 * 1000 <= dayEnd.getTime()) {
          const slotEnd = new Date(slotStart.getTime() + slotDuration * 60 * 1000);

          // Only create if not in the past and doesn't exist
          if (slotStart.getTime() > Date.now()) {
            try {
              const insertResult = await client.query(
                `INSERT INTO time_slots (provider_id, start_datetime, end_datetime, status)
                 VALUES ($1, $2, $3, 'available')
                 ON CONFLICT DO NOTHING
                 RETURNING id`,
                [providerId, slotStart.toISOString(), slotEnd.toISOString()]
              );
              if (insertResult.rowCount && insertResult.rowCount > 0) {
                slotsCreatedForDay++;
              }
            } catch (insertErr) {
              // Log but continue - slot might already exist
              console.error(`[Availability] Failed to insert slot:`, insertErr);
            }
          }

          slotStart.setTime(slotStart.getTime() + stepMinutes * 60 * 1000);
        }
      }
      if (slotsCreatedForDay > 0) {
        console.log(`[Availability] Created ${slotsCreatedForDay} slots for ${dateStr}`);
      }
    }
  } finally {
    client.release();
  }
}

async function regenerateSlotsForDate(providerId: string, dateInput: string | Date) {
  const client = await pool.connect();
  try {
    const dateStr = toDateStr(dateInput);

    // Delete existing available slots for the date
    await client.query(
      `DELETE FROM time_slots
       WHERE provider_id::text = $1
         AND DATE(start_datetime) = $2::date
         AND status = 'available'`,
      [providerId, dateStr]
    );

    const dayOfWeek = dayOfWeekForDateStr(dateStr);

    // Get provider's rules for this day of week
    const rulesRes = await client.query(
      `SELECT * FROM availability_rules
       WHERE provider_id::text = $1 AND is_active = TRUE AND day_of_week = $2`,
      [providerId, dayOfWeek]
    );

    // Check for override on this date
    const overrideRes = await client.query(
      `SELECT * FROM availability_overrides
       WHERE provider_id::text = $1 AND override_date = $2::date`,
      [providerId, dateStr]
    );
    const override = overrideRes.rows[0];

    // If day is blocked by override, don't generate slots
    if (override && !override.is_available) {
      return;
    }

    // Determine rules to use
    let rulesToUse = rulesRes.rows;

    // If override has custom times, use those instead
    if (override && override.is_available && override.start_time && override.end_time) {
      rulesToUse = [{
        start_time: override.start_time,
        end_time: override.end_time,
        slot_duration: DEFAULT_SLOT_DURATION,
        buffer_minutes: DEFAULT_BUFFER_MINUTES
      }];
    }

    // Generate slots for this specific date
    for (const rule of rulesToUse) {
      const startTimeParts = String(rule.start_time).split(':');
      const endTimeParts = String(rule.end_time).split(':');

      const slotStart = manilaDateTime(dateStr, parseInt(startTimeParts[0]), parseInt(startTimeParts[1]));
      const dayEnd = manilaDateTime(dateStr, parseInt(endTimeParts[0]), parseInt(endTimeParts[1]));

      const slotDuration = rule.slot_duration || DEFAULT_SLOT_DURATION;
      const bufferMinutes = rule.buffer_minutes || DEFAULT_BUFFER_MINUTES;
      const stepMinutes = slotDuration + bufferMinutes;

      while (slotStart.getTime() + slotDuration * 60 * 1000 <= dayEnd.getTime()) {
        const slotEnd = new Date(slotStart.getTime() + slotDuration * 60 * 1000);

        // Only create if not in the past
        if (slotStart.getTime() > Date.now()) {
          await client.query(
            `INSERT INTO time_slots (provider_id, start_datetime, end_datetime, status)
             VALUES ($1, $2, $3, 'available')
             ON CONFLICT ON CONSTRAINT unique_provider_slot DO NOTHING`,
            [providerId, slotStart.toISOString(), slotEnd.toISOString()]
          );
        }

        slotStart.setTime(slotStart.getTime() + stepMinutes * 60 * 1000);
      }
    }
  } finally {
    client.release();
  }
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

    if (is_bookable === false) {
      // "Not bookable" has no real booking behind it - marking the slot 'booked' would
      // corrupt the invariant (elsewhere) that a booked slot always has a booking_id.
      // Instead just remove any available slot at this time, so it's simply absent.
      const deleted = await pool.query(
        `DELETE FROM time_slots
         WHERE provider_id::text = $1 AND start_datetime = $2 AND status = 'available'
         RETURNING id`,
        [userId, start.toISOString()]
      );
      return res.status(200).json({
        data: {
          provider_id: userId,
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          is_bookable: false,
          removed: (deleted.rowCount ?? 0) > 0
        }
      });
    }

    // Create a slot directly in time_slots for backward compatibility
    const result = await pool.query(
      `INSERT INTO time_slots (provider_id, start_datetime, end_datetime, status)
       VALUES ($1, $2, $3, 'available')
       ON CONFLICT ON CONSTRAINT unique_provider_slot
       DO UPDATE SET status = EXCLUDED.status
       RETURNING *`,
      [userId, start.toISOString(), end.toISOString()]
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
