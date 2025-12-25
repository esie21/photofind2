import { Router, Request, Response } from 'express';
import pool from '../config/database';
import path from 'path';

const router = Router();

// Public endpoint: Get providers
router.get('/', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) || '';
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 12));
    const offset = (page - 1) * limit;
    // We want to select providers and include a featured service (first service by created_at)
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const searchClause = q ? `AND (u.name ILIKE $1 OR s.title ILIKE $1)` : '';
    const values: any[] = [];
    if (q) values.push(`%${q}%`);
    // Detect which service columns exist to build SQL dynamically
    const colRes = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'services' AND column_name IN ('category','images','description','created_at')
    `);
    const existingCols = colRes.rows.map((r: any) => String(r.column_name));
    console.debug('services existing cols:', existingCols);
    const hasCategory = existingCols.includes('category');
    const hasImages = existingCols.includes('images');
    const hasDescription = existingCols.includes('description');
    const hasCreatedAt = existingCols.includes('created_at');

    const serviceSelectParts = [`id`, `title`, `price`];
    if (hasCategory) serviceSelectParts.push('category');
    if (hasImages) serviceSelectParts.push('images');
    if (hasDescription) serviceSelectParts.push('description');
    if (hasCreatedAt) serviceSelectParts.push('created_at');

    const serviceSelect = serviceSelectParts.map((c) => `s.${c} AS service_${c}`).join(', ');
    const orderByService = hasCreatedAt ? 'created_at DESC' : 'id DESC';
    console.debug('serviceSelectParts:', serviceSelectParts, 'orderByService:', orderByService);

    // Use LATERAL join to fetch featured service
    const sql = `SELECT u.id, u.email, u.name, u.role, u.profile_image, u.portfolio_images, u.bio, u.years_experience, u.location, u.rating, u.review_count,
      ${serviceSelect}
      FROM users u
      LEFT JOIN LATERAL (
        SELECT ${serviceSelectParts.join(', ')}
        FROM services
        WHERE services.provider_id = u.id
        ORDER BY ${orderByService}
        LIMIT 1
      ) s ON true
      WHERE u.role = 'provider' ${searchClause}
      ORDER BY u.name ASC
      LIMIT ${limit} OFFSET ${offset}`;
    console.debug('Get providers SQL:', sql, 'values:', values);
    const result = await pool.query(sql, values);
    // Get total count for pagination meta
    const countSql = `SELECT COUNT(DISTINCT u.id) as total FROM users u
      LEFT JOIN services s ON s.provider_id = u.id
      WHERE u.role = 'provider' ${searchClause}`;
    const countResult = await pool.query(countSql, values);
    const total = Number(countResult.rows[0]?.total || 0);
    const ensureArray = (v: any) => {
      if (!v) return [];
      if (Array.isArray(v)) return v;
      try { return JSON.parse(v); } catch (e) { return [v]; }
    };

    let rows: any[] = [];
    try {
      rows = result.rows.map((r: any) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      profile_image: r.profile_image && r.profile_image.startsWith('/') ? `${baseUrl}${r.profile_image}` : r.profile_image,
      portfolio_images: ensureArray(r.portfolio_images).map((p: string) => p && p.startsWith('/') ? `${baseUrl}${p}` : p),
      bio: r.bio,
      years_experience: r.years_experience,
      location: r.location,
      rating: parseFloat(r.rating) || 0,
      review_count: parseInt(r.review_count) || 0,
      featured_service: r.service_id ? {
        id: r.service_id,
        title: r.service_title,
        price: r.service_price,
        ...(hasCategory ? { category: r.service_category } : {}),
        ...(hasDescription ? { description: r.service_description } : {}),
        ...(hasImages ? { images: ensureArray(r.service_images).map((img: string) => img && img.startsWith('/') ? `${baseUrl}${img}` : img) } : {}),
      } : null,
    }));
    } catch (mapErr) {
      console.error('Error mapping provider rows:', mapErr, 'sampleRow:', result.rows[0]);
      throw mapErr; // rethrow to be handled by outer catch
    }
    res.json({ data: rows, meta: { page, limit, total } });
  } catch (error: any) {
    console.error('Get providers error:', error?.stack || error);
    res.status(500).json({ error: error?.message || 'Failed to retrieve providers', detail: error });
  }
});

// Get category statistics (count of providers per category)
router.get('/categories/stats', async (req: Request, res: Response) => {
  try {
    // Count providers by their category field in users table
    const userCategoryResult = await pool.query(`
      SELECT category, COUNT(*) as count
      FROM users
      WHERE role = 'provider' AND category IS NOT NULL AND category != ''
      GROUP BY category
      ORDER BY count DESC
    `);

    // Also count by service categories for a more complete picture
    const serviceCategoryResult = await pool.query(`
      SELECT s.category, COUNT(DISTINCT s.provider_id) as count
      FROM services s
      JOIN users u ON u.id = s.provider_id
      WHERE u.role = 'provider' AND s.category IS NOT NULL AND s.category != ''
      GROUP BY s.category
      ORDER BY count DESC
    `);

    // Merge the counts (prioritize user category, add service categories that aren't in user categories)
    const categoryMap = new Map<string, number>();

    // Add user categories
    for (const row of userCategoryResult.rows) {
      categoryMap.set(row.category, parseInt(row.count));
    }

    // Add service categories (don't override existing)
    for (const row of serviceCategoryResult.rows) {
      if (!categoryMap.has(row.category)) {
        categoryMap.set(row.category, parseInt(row.count));
      } else {
        // Take the max of user count or service count
        const existing = categoryMap.get(row.category) || 0;
        categoryMap.set(row.category, Math.max(existing, parseInt(row.count)));
      }
    }

    // Get total provider count
    const totalResult = await pool.query(`
      SELECT COUNT(*) as total FROM users WHERE role = 'provider'
    `);
    const totalProviders = parseInt(totalResult.rows[0]?.total || '0');

    // Convert to array and sort by count
    const categories = Array.from(categoryMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      data: categories,
      meta: {
        total_providers: totalProviders,
        total_categories: categories.length
      }
    });
  } catch (error: any) {
    console.error('Get category stats error:', error);
    res.status(500).json({ error: 'Failed to retrieve category statistics' });
  }
});

export default router;
