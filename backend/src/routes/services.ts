import express, { Request, Response } from 'express';
import { pool } from '../config/database';
import { verifyToken } from '../middleware/auth';
import { CATEGORY_OPTIONS } from '../constants/categories';

const router = express.Router();

/**
 * Rejects a rate that would poison the booking price floor.
 *
 * Only `price` was ever checked, while hourly_rate and package_price went into the row
 * as `value || null`. config/pricingConfig.ts prices an hourly booking off hourly_rate,
 * so a negative one there produced a negative minimum - a booking that clears
 * validation at any price at all. Absent means "not set" and stays allowed; present
 * means it has to be a real, positive amount.
 */
function rateError(label: string, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return `${label} must be greater than zero`;
  return null;
}

function validateRates(body: any): string | null {
  return (
    rateError('Hourly rate', body?.hourly_rate) ||
    rateError('Package price', body?.package_price)
  );
}

// Helper function to get provider ID from user ID
async function getProviderIdFromUserId(userId: string): Promise<string> {
  try {
    // Check if providers table exists and services references it
    const tableCheck = await pool.query(`
      SELECT 
        ccu.table_name AS foreign_table_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'services' 
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'provider_id'
    `);
    
    if (tableCheck.rows.length > 0 && tableCheck.rows[0].foreign_table_name === 'providers') {
      // Oldest row wins, deterministically. This used to take rows[0] of an unordered
      // query, so for a user who had ended up with more than one providers row it
      // returned an arbitrary one - and any service filed under the other row then
      // failed the ownership check with "You can only update your own services".
      const providerResult = await pool.query(
        'SELECT id FROM providers WHERE user_id = $1 ORDER BY created_at ASC, id ASC LIMIT 1',
        [userId]
      );

      if (providerResult.rows.length > 0) {
        return providerResult.rows[0].id;
      }

      // Create on first use. ON CONFLICT makes two concurrent callers safe - a plain
      // INSERT here is how duplicate rows got created in the first place.
      const newProvider = await pool.query(
        `INSERT INTO providers (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING
         RETURNING id`,
        [userId]
      );
      if (newProvider.rows[0]) {
        return newProvider.rows[0].id;
      }
      const existing = await pool.query(
        'SELECT id FROM providers WHERE user_id = $1 ORDER BY created_at ASC, id ASC LIMIT 1',
        [userId]
      );
      return existing.rows[0].id;
    }
  } catch (error) {
    // If providers table doesn't exist, use userId directly
    console.log('Could not check provider reference, using userId directly');
  }
  
  return userId;
}

// True when `providerIdOnRow` belongs to `userId` - either it IS the user id (older
// schemas where services referenced users directly) or it is one of that user's rows in
// the providers table. Checking membership rather than equality against a single
// resolved id means a user who ended up with more than one providers row can still
// manage every service they own.
async function ownsProviderRow(userId: string, providerIdOnRow: string): Promise<boolean> {
  if (String(providerIdOnRow) === String(userId)) return true;
  try {
    const r = await pool.query(
      'SELECT 1 FROM providers WHERE id::text = $1 AND user_id::text = $2 LIMIT 1',
      [String(providerIdOnRow), String(userId)]
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

// Get all services (public)
router.get('/', async (req: Request, res: Response) => {
  try {
    // Check if providers table exists and if services references it
    let query = '';
    let refTable: string | undefined = undefined;
    
    try {
      const tableCheck = await pool.query(`
        SELECT ccu.table_name AS foreign_table_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'services' 
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'provider_id'
        LIMIT 1
      `);
      
      refTable = tableCheck.rows[0]?.foreign_table_name;
      
      // Try to check if created_at column exists
      let orderBy = 'id DESC';
      try {
        await pool.query('SELECT created_at FROM services LIMIT 1');
        orderBy = 'created_at DESC';
      } catch (e) {
        // created_at doesn't exist, use id
      }
      
      if (refTable === 'providers') {
        // Get existing columns in services table
        const columnCheck = await pool.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'services'
          ORDER BY ordinal_position
        `);
        const serviceColumns = columnCheck.rows.map((r: any) => `s.${r.column_name}`).join(', ');
        
        // Join with providers table to get user_id
        query = `
          SELECT 
            ${serviceColumns},
            p.user_id as provider_user_id
          FROM services s
          LEFT JOIN providers p ON s.provider_id = p.id
          ORDER BY ${orderBy}
        `;
      } else {
        // services.provider_id directly references users(id)
        query = `SELECT * FROM services ORDER BY ${orderBy}`;
      }
    } catch (checkError) {
      // Fallback to simple query - try to join anyway if providers table might exist
      try {
        query = `
          SELECT s.*, p.user_id as provider_user_id
          FROM services s
          LEFT JOIN providers p ON s.provider_id = p.id
          ORDER BY id DESC
        `;
        refTable = 'providers'; // Assume providers table exists if join succeeds
      } catch (joinError) {
        // If join fails, use simple query
        query = 'SELECT * FROM services ORDER BY id DESC';
      }
    }
    
    const result = await pool.query(query);
    
    // Log for debugging
    if (process.env.NODE_ENV !== 'production') {
      console.log('Services query result:', result.rows.length, 'rows');
      console.log('Reference table:', refTable);
      if (result.rows.length > 0) {
        console.log('First service sample (raw):', JSON.stringify(result.rows[0], null, 2));
      }
    }
    
    // Transform the results to include user_id for frontend compatibility
    const transformed = result.rows.map((row: any) => {
      // Start with all row data, excluding internal fields
      const service: any = { ...row };
      
      // Keep the original provider_id for reference
      service.original_provider_id = row.provider_id;
      
      // If we have provider_user_id from join, use it as providerId/provider_id for frontend
      if (row.provider_user_id) {
        service.providerId = row.provider_user_id;
        service.provider_id = row.provider_user_id; // Override with user_id for filtering
      } else if (row.provider_id && refTable !== 'providers') {
        // If provider_id references users directly, use it
        service.providerId = row.provider_id;
        service.provider_id = row.provider_id;
      } else if (row.provider_id && refTable === 'providers') {
        // JOIN didn't return user_id - try to fetch it directly
        // This will be handled asynchronously if needed, but for now log it
        if (process.env.NODE_ENV !== 'production') {
          console.warn('Provider user_id not found for provider_id:', row.provider_id);
        }
        // Fallback: keep provider_id as is (filtering will fail but at least we have the data)
        service.providerId = row.provider_id;
        service.provider_id = row.provider_id;
      } else {
        // Fallback: keep provider_id as is
        service.providerId = row.provider_id;
        service.provider_id = row.provider_id;
      }
      
      // Remove internal field
      delete service.provider_user_id;
      
      return service;
    });
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('Transformed services:', transformed.length);
      if (transformed.length > 0) {
        console.log('First transformed service:', JSON.stringify(transformed[0], null, 2));
      }
    }
    
    return res.json(transformed || []);
  } catch (error: any) {
    console.error('Error fetching services:', error);
    console.error('Error details:', {
      code: error?.code,
      message: error?.message,
      detail: error?.detail,
      stack: error?.stack
    });
    // If table doesn't exist (error code 42P01), return empty array
    if (error?.code === '42P01') {
      console.log('Services table does not exist yet, returning empty array');
      return res.json([]);
    }
    // For other errors, return error response
    return res.status(500).json({ 
      error: 'Failed to fetch services',
      detail: process.env.NODE_ENV !== 'production' ? error?.message : undefined,
      code: process.env.NODE_ENV !== 'production' ? error?.code : undefined
    });
  }
});

// Get services by provider ID (public)
router.get('/provider/:providerId', async (req: Request, res: Response) => {
  try {
    const { providerId } = req.params;

    // First check if services table exists
    const tableExists = await pool.query(`SELECT to_regclass('public.services') as exists`);
    if (!tableExists.rows[0].exists) {
      console.log('Services table does not exist, returning empty array');
      return res.json([]);
    }

    // Check which columns exist in the services table
    const columnCheck = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'services'
    `);
    const existingColumns = columnCheck.rows.map((r: any) => r.column_name);

    if (existingColumns.length === 0) {
      console.log('No columns found in services table, returning empty array');
      return res.json([]);
    }

    const hasCreatedAt = existingColumns.includes('created_at');
    const orderBy = hasCreatedAt ? 'created_at DESC NULLS LAST' : 'id DESC';

    // Determine if services.provider_id references users or providers table
    let refTable: string | undefined = undefined;

    try {
      const tableCheck = await pool.query(`
        SELECT ccu.table_name AS foreign_table_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'services'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'provider_id'
        LIMIT 1
      `);

      refTable = tableCheck.rows[0]?.foreign_table_name;
    } catch (checkError) {
      // Ignore - will use fallback
    }

    let result;
    if (refTable === 'providers') {
      // Need to join with providers to match by user_id
      result = await pool.query(`
        SELECT s.*, p.user_id as provider_user_id
        FROM services s
        JOIN providers p ON s.provider_id = p.id
        WHERE p.user_id = $1
        ORDER BY s.${hasCreatedAt ? 'created_at DESC NULLS LAST' : 'id DESC'}
      `, [providerId]);
    } else {
      // provider_id directly references users(id)
      result = await pool.query(`
        SELECT * FROM services
        WHERE provider_id = $1
        ORDER BY ${orderBy}
      `, [providerId]);
    }

    // Transform results for frontend consistency
    const transformed = result.rows.map((row: any) => ({
      ...row,
      providerId: row.provider_user_id || row.provider_id,
      provider_id: row.provider_user_id || row.provider_id,
    }));

    return res.json(transformed);
  } catch (error: any) {
    console.error('Error fetching services by provider:', error);
    // Return empty array for table/column not found errors
    if (error?.code === '42P01' || error?.code === '42703') {
      return res.json([]);
    }
    return res.status(500).json({ error: 'Failed to fetch services', detail: error?.message });
  }
});

// Get service by ID (public)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM services WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching service:', error);
    return res.status(500).json({ error: 'Failed to fetch service' });
  }
});

// Create a new service (protected - providers only)
router.post('/', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  try {
    const userId = req.userId;
    const { title, description, price, hourly_rate, package_price, category, images, pricing_type, duration_minutes, accepts_cash } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!title || price === undefined || price === null) {
      return res.status(400).json({ error: 'Title and price are required' });
    }

    // A zero price isn't just cosmetic: booking price validation and the payment
    // underpayment check are both guarded by `servicePrice > 0`, so a free service
    // skips price validation entirely and can be booked for any amount.
    if (Number(price) <= 0 || !Number.isFinite(Number(price))) {
      return res.status(400).json({ error: 'Price must be greater than zero' });
    }

    const rateProblem = validateRates(req.body);
    if (rateProblem) {
      return res.status(400).json({ error: rateProblem });
    }

    // providers.ts's category filter and stats queries match stored values with exact
    // string equality, so a category outside the picker's own options would silently
    // make this service unfindable by category rather than erroring anywhere.
    if (category !== undefined && category !== null && String(category).trim() !== '' && !CATEGORY_OPTIONS.includes(String(category).trim())) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    // Get provider_id from user_id (handles both direct users reference and providers table)
    const providerId = await getProviderIdFromUserId(userId);

    // Check which columns exist in the services table
    const columnCheck = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'services'
    `);

    const existingColumns = columnCheck.rows.map((r: any) => r.column_name);
    const hasCategory = existingColumns.includes('category');
    const hasImages = existingColumns.includes('images');
    const hasDescription = existingColumns.includes('description');
    const hasPricingType = existingColumns.includes('pricing_type');
    const hasDurationMinutes = existingColumns.includes('duration_minutes');
    // 'hourly_rate' and 'package_price' are what the pricing editor actually sends and
    // what every read path (toPackage(), the booking flow) reads back. 'hourly_price' is
    // a legacy column nothing writes to on purpose; matching its name here silently
    // dropped every hourly rate and package price the moment a service used both pricing
    // modes at once, since neither had anywhere real to land.
    const hasHourlyRate = existingColumns.includes('hourly_rate');
    const hasPackagePrice = existingColumns.includes('package_price');
    const hasAcceptsCash = existingColumns.includes('accepts_cash');

    // Build dynamic INSERT query based on existing columns
    const columns: string[] = ['provider_id', 'title', 'price'];
    const placeholders: string[] = ['$1', '$2', '$3'];
    const values: any[] = [providerId, title, price];
    let paramIndex = 4;

    if (hasDescription) {
      columns.push('description');
      placeholders.push(`$${paramIndex}`);
      values.push(description || null);
      paramIndex++;
    }

    if (hasCategory) {
      columns.push('category');
      placeholders.push(`$${paramIndex}`);
      values.push(category || null);
      paramIndex++;
    }

    if (hasImages) {
      columns.push('images');
      placeholders.push(`$${paramIndex}`);
      values.push(images || []);
      paramIndex++;
    }

    if (hasPricingType) {
      columns.push('pricing_type');
      placeholders.push(`$${paramIndex}`);
      // Default to 'package' if not specified
      values.push(pricing_type || 'package');
      paramIndex++;
    }

    if (hasDurationMinutes) {
      columns.push('duration_minutes');
      placeholders.push(`$${paramIndex}`);
      // Default to 60 minutes if not specified
      values.push(duration_minutes || 60);
      paramIndex++;
    }

    if (hasHourlyRate) {
      columns.push('hourly_rate');
      placeholders.push(`$${paramIndex}`);
      values.push(hourly_rate || null);
      paramIndex++;
    }

    if (hasPackagePrice) {
      columns.push('package_price');
      placeholders.push(`$${paramIndex}`);
      values.push(package_price || null);
      paramIndex++;
    }

    // Whether this service can be paid for in cash on the day. Off unless the provider
    // explicitly turns it on - a service that silently accepted cash would strip the
    // client of escrow protection without either party choosing that.
    if (hasAcceptsCash) {
      columns.push('accepts_cash');
      placeholders.push(`$${paramIndex}`);
      values.push(accepts_cash === true);
      paramIndex++;
    }

    const insertQuery = `
      INSERT INTO services (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *
    `;

    const result = await pool.query(insertQuery, values);
    return res.status(201).json(result.rows[0]);
  } catch (error: any) {
    console.error('Error creating service:', error);
    // Provide more detailed error information
    const errorMessage = error?.message || 'Failed to create service';
    const errorDetail = error?.detail || '';
    
    // Check for missing column (column does not exist)
    if (error?.code === '42703') {
      return res.status(500).json({ 
        error: 'Database schema mismatch: services table is missing required columns',
        detail: process.env.NODE_ENV !== 'production' ? errorMessage : 'Contact administrator'
      });
    }
    
    // Check for type mismatch (invalid input syntax)
    if (error?.code === '22P02' || error?.code === '42804') {
      return res.status(400).json({ 
        error: 'Type mismatch: services table schema may need to be updated to use UUID',
        detail: process.env.NODE_ENV !== 'production' ? errorMessage : 'Contact administrator'
      });
    }
    
    // Check for common database errors
    if (error?.code === '23503') {
      // Foreign key constraint violation
      return res.status(400).json({ 
        error: 'Invalid provider: provider does not exist',
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
      error: 'Failed to create service',
      detail: process.env.NODE_ENV !== 'production' ? errorMessage : undefined
    });
  }
});

// Update a service (protected - owner only)
router.put('/:id', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const { title, description, price, hourly_rate, package_price, category, images, pricing_type, duration_minutes, accepts_cash } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Same zero-price rule as service creation - see the comment there.
    if (price !== undefined && price !== null && (Number(price) <= 0 || !Number.isFinite(Number(price)))) {
      return res.status(400).json({ error: 'Price must be greater than zero' });
    }

    // Same category allowlist check as service creation - see the comment there.
    if (category !== undefined && category !== null && String(category).trim() !== '' && !CATEGORY_OPTIONS.includes(String(category).trim())) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    // Same rate check as service creation - an update can set these just as freely.
    const rateProblem = validateRates(req.body);
    if (rateProblem) {
      return res.status(400).json({ error: rateProblem });
    }

    // Get provider ID from user ID
    const providerId = await getProviderIdFromUserId(userId);

    // Check if service exists and belongs to the provider
    const checkResult = await pool.query(
      'SELECT provider_id FROM services WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Compare as strings to handle both UUID and integer
    if (!(await ownsProviderRow(String(userId), String(checkResult.rows[0].provider_id)))) {
      return res.status(403).json({ error: 'You can only update your own services' });
    }

    // Check which columns exist in the services table
    const columnCheck = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'services'
    `);

    const existingColumns = columnCheck.rows.map((r: any) => r.column_name);
    const hasCategory = existingColumns.includes('category');
    const hasImages = existingColumns.includes('images');
    const hasDescription = existingColumns.includes('description');
    const hasUpdatedAt = existingColumns.includes('updated_at');
    const hasPricingType = existingColumns.includes('pricing_type');
    const hasDurationMinutes = existingColumns.includes('duration_minutes');
    // Same fix as the create route above: write the columns the pricing editor and the
    // booking flow actually read ('hourly_rate', 'package_price'), not the unused legacy
    // 'hourly_price' column.
    const hasHourlyRate = existingColumns.includes('hourly_rate');
    const hasPackagePrice = existingColumns.includes('package_price');
    const hasAcceptsCash = existingColumns.includes('accepts_cash');

    // Build dynamic UPDATE query based on existing columns
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramIndex}`);
      values.push(title);
      paramIndex++;
    }

    if (hasDescription && description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      values.push(description);
      paramIndex++;
    }

    if (price !== undefined) {
      updates.push(`price = $${paramIndex}`);
      values.push(price);
      paramIndex++;
    }

    if (hasCategory && category !== undefined) {
      updates.push(`category = $${paramIndex}`);
      values.push(category);
      paramIndex++;
    }

    if (hasImages && images !== undefined) {
      updates.push(`images = $${paramIndex}`);
      values.push(images);
      paramIndex++;
    }

    if (hasPricingType && pricing_type !== undefined) {
      updates.push(`pricing_type = $${paramIndex}`);
      values.push(pricing_type);
      paramIndex++;
    }

    if (hasDurationMinutes && duration_minutes !== undefined) {
      updates.push(`duration_minutes = $${paramIndex}`);
      values.push(duration_minutes);
      paramIndex++;
    }

    if (hasHourlyRate && hourly_rate !== undefined) {
      updates.push(`hourly_rate = $${paramIndex}`);
      values.push(hourly_rate);
      paramIndex++;
    }

    if (hasPackagePrice && package_price !== undefined) {
      updates.push(`package_price = $${paramIndex}`);
      values.push(package_price);
      paramIndex++;
    }

    // Turning this off only affects bookings made from now on: an existing booking
    // carries its own payment_method, so a client who was promised cash keeps it.
    if (hasAcceptsCash && accepts_cash !== undefined) {
      updates.push(`accepts_cash = $${paramIndex}`);
      values.push(accepts_cash === true);
      paramIndex++;
    }

    if (hasUpdatedAt) {
      updates.push(`updated_at = CURRENT_TIMESTAMP`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    const updateQuery = `
      UPDATE services
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(updateQuery, values);

    return res.json(result.rows[0]);
  } catch (error: any) {
    console.error('Error updating service:', error);
    return res.status(500).json({ error: 'Failed to update service' });
  }
});

// Delete a service (protected - owner only)
router.delete('/:id', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get provider ID from user ID
    const providerId = await getProviderIdFromUserId(userId);

    // Check if service exists and belongs to the provider
    const checkResult = await pool.query(
      'SELECT provider_id FROM services WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Compare as strings to handle both UUID and integer
    if (!(await ownsProviderRow(String(userId), String(checkResult.rows[0].provider_id)))) {
      return res.status(403).json({ error: 'You can only delete your own services' });
    }

    await pool.query('DELETE FROM services WHERE id = $1', [id]);
    return res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting service:', error);
    return res.status(500).json({ error: 'Failed to delete service' });
  }
});

export default router;

