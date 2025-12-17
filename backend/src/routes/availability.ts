import express, { Request, Response } from 'express';
import { pool } from '../config/database';
import { verifyToken } from '../middleware/auth';

const router = express.Router();

// Handle both UUID and integer provider IDs
function parseProviderId(raw: any): string | null {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str || str === 'undefined' || str === 'null') return null;
  return str;
}

async function getServiceDurationMinutes(serviceId: string | null) {
  if (!serviceId) return 60;
  try {
    const res = await pool.query('SELECT duration_minutes FROM services WHERE id::text = $1', [serviceId]);
    const v = res.rows[0]?.duration_minutes;
    const n = typeof v === 'string' ? parseInt(v, 10) : v;
    return Number.isFinite(n) && n > 0 ? n : 60;
  } catch (e) {
    console.log('Could not get service duration, using default 60 minutes');
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

router.get('/providers/:providerId/slots', async (req: Request, res: Response) => {
  try {
    const providerId = parseProviderId(req.params.providerId);
    if (!providerId) return res.status(400).json({ error: 'Invalid providerId' });

    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;

    const values: any[] = [providerId];
    let where = 'provider_id::text = $1';

    if (from) {
      values.push(from);
      where += ` AND end_time >= $${values.length}`;
    }
    if (to) {
      values.push(to);
      where += ` AND start_time <= $${values.length}`;
    }

    const rows = await pool.query(
      `SELECT id, provider_id, start_time, end_time, is_bookable, created_at, updated_at
       FROM availability_slots
       WHERE ${where}
       ORDER BY start_time ASC`,
      values
    );

    return res.json({ data: rows.rows });
  } catch (e) {
    console.error('GET availability slots error:', e);
    return res.status(500).json({ error: 'Failed to fetch availability slots' });
  }
});

router.get('/providers/:providerId/timeslots', async (req: Request, res: Response) => {
  try {
    const providerId = parseProviderId(req.params.providerId);
    if (!providerId) return res.status(400).json({ error: 'Invalid providerId' });

    const dateStr = req.query.date ? String(req.query.date) : null;
    if (!dateStr) return res.status(400).json({ error: 'Missing date (YYYY-MM-DD)' });

    const serviceId = req.query.service_id ? String(req.query.service_id) : null;
    const durationMinutes = await getServiceDurationMinutes(serviceId);

    await autoCompletePastBookings(providerId);

    const dayStart = new Date(`${dateStr}T00:00:00.000`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999`);

    // Check for configured availability slots
    let slotsRes = await pool.query(
      `
        SELECT id, start_time, end_time
        FROM availability_slots
        WHERE provider_id::text = $1
          AND is_bookable = TRUE
          AND end_time > $2
          AND start_time < $3
        ORDER BY start_time ASC
      `,
      [providerId, dayStart.toISOString(), dayEnd.toISOString()]
    );

    // If no slots configured, generate default availability (9 AM - 6 PM)
    let slots = slotsRes.rows;
    if (slots.length === 0) {
      // Create default working hours for the requested date
      const defaultStart = new Date(`${dateStr}T09:00:00.000`);
      const defaultEnd = new Date(`${dateStr}T18:00:00.000`);
      slots = [{
        id: 'default',
        start_time: defaultStart.toISOString(),
        end_time: defaultEnd.toISOString()
      }];
    }

    const bookingsRes = await pool.query(
      `
        SELECT id, start_date, end_date, status
        FROM bookings
        WHERE provider_id::text = $1
          AND status NOT IN ('cancelled', 'rejected')
          AND end_date > $2
          AND start_date < $3
      `,
      [providerId, dayStart.toISOString(), dayEnd.toISOString()]
    );

    const busy = bookingsRes.rows.map((b: any) => ({
      start: new Date(b.start_date).getTime(),
      end: new Date(b.end_date).getTime(),
    }));

    const now = Date.now();

    const times: string[] = [];
    const stepMinutes = 30;

    for (const s of slots) {
      const slotStart = new Date(s.start_time).getTime();
      const slotEnd = new Date(s.end_time).getTime();

      let t = slotStart;
      while (t + durationMinutes * 60 * 1000 <= slotEnd) {
        const start = t;
        const end = t + durationMinutes * 60 * 1000;

        const isPast = end <= now;
        const overlapsBusy = busy.some((b) => !(b.end <= start || b.start >= end));

        if (!isPast && !overlapsBusy) {
          times.push(new Date(start).toISOString());
        }

        t += stepMinutes * 60 * 1000;
      }
    }

    const unique = Array.from(new Set(times)).sort();

    return res.json({
      data: {
        provider_id: providerId,
        date: dateStr,
        duration_minutes: durationMinutes,
        time_slots: unique,
      },
    });
  } catch (e) {
    console.error('GET availability timeslots error:', e);
    return res.status(500).json({ error: 'Failed to compute availability' });
  }
});

router.post('/', verifyToken, async (req: Request & { userId?: string; role?: string }, res: Response) => {
  try {
    const userId = req.userId;
    const role = (req as any).role;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (role !== 'provider' && role !== 'admin') return res.status(403).json({ error: 'Insufficient permissions' });

    const providerId = String(userId);
    if (!providerId) return res.status(400).json({ error: 'Invalid provider ID' });

    const start_time = req.body?.start_time ? String(req.body.start_time) : null;
    const end_time = req.body?.end_time ? String(req.body.end_time) : null;
    const is_bookable = req.body?.is_bookable === undefined ? true : Boolean(req.body.is_bookable);

    if (!start_time || !end_time) return res.status(400).json({ error: 'Missing start_time or end_time' });

    const start = new Date(start_time);
    const end = new Date(end_time);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return res.status(400).json({ error: 'Invalid datetime format' });
    if (end.getTime() <= start.getTime()) return res.status(400).json({ error: 'end_time must be after start_time' });

    const inserted = await pool.query(
      `
        INSERT INTO availability_slots (provider_id, start_time, end_time, is_bookable)
        VALUES ($1, $2, $3, $4)
        RETURNING id, provider_id, start_time, end_time, is_bookable, created_at, updated_at
      `,
      [providerId, start.toISOString(), end.toISOString(), is_bookable]
    );

    return res.status(201).json({ data: inserted.rows[0] });
  } catch (e) {
    console.error('POST availability slot error:', e);
    return res.status(500).json({ error: 'Failed to create availability slot' });
  }
});

router.put('/:id', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  try {
    const userId = req.userId;
    const role = (req as any).role;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (role !== 'provider' && role !== 'admin') return res.status(403).json({ error: 'Insufficient permissions' });

    const slotId = String(req.params.id || '');
    if (!slotId) return res.status(400).json({ error: 'Invalid slot id' });

    const providerId = String(userId);

    const existingRes = await pool.query(
      'SELECT id, provider_id FROM availability_slots WHERE id::text = $1',
      [slotId]
    );
    const existing = existingRes.rows[0];
    if (!existing) return res.status(404).json({ error: 'Slot not found' });

    if (role !== 'admin' && String(existing.provider_id) !== providerId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const start_time = req.body?.start_time !== undefined ? String(req.body.start_time) : undefined;
    const end_time = req.body?.end_time !== undefined ? String(req.body.end_time) : undefined;
    const is_bookable = req.body?.is_bookable !== undefined ? Boolean(req.body.is_bookable) : undefined;

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (start_time !== undefined) {
      updates.push(`start_time = $${idx++}`);
      values.push(new Date(start_time).toISOString());
    }
    if (end_time !== undefined) {
      updates.push(`end_time = $${idx++}`);
      values.push(new Date(end_time).toISOString());
    }
    if (is_bookable !== undefined) {
      updates.push(`is_bookable = $${idx++}`);
      values.push(is_bookable);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No updates provided' });

    values.push(slotId);

    const updated = await pool.query(
      `
        UPDATE availability_slots
        SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id::text = $${idx}
        RETURNING id, provider_id, start_time, end_time, is_bookable, created_at, updated_at
      `,
      values
    );

    return res.json({ data: updated.rows[0] });
  } catch (e) {
    console.error('PUT availability slot error:', e);
    return res.status(500).json({ error: 'Failed to update availability slot' });
  }
});

router.delete('/:id', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  try {
    const userId = req.userId;
    const role = (req as any).role;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (role !== 'provider' && role !== 'admin') return res.status(403).json({ error: 'Insufficient permissions' });

    const slotId = String(req.params.id || '');
    if (!slotId) return res.status(400).json({ error: 'Invalid slot id' });

    const providerId = String(userId);

    const existingRes = await pool.query(
      'SELECT id, provider_id FROM availability_slots WHERE id::text = $1',
      [slotId]
    );
    const existing = existingRes.rows[0];
    if (!existing) return res.status(404).json({ error: 'Slot not found' });

    if (role !== 'admin' && String(existing.provider_id) !== providerId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await pool.query('DELETE FROM availability_slots WHERE id::text = $1', [slotId]);

    return res.json({ success: true });
  } catch (e) {
    console.error('DELETE availability slot error:', e);
    return res.status(500).json({ error: 'Failed to delete availability slot' });
  }
});

export default router;
