import { Router, Request, Response } from 'express';
import pool from '../config/database';
import path from 'path';

const router = Router();

// Public endpoint: Get providers
router.get('/', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) || '';
    const category = (req.query.category as string) || '';
    const sort = (req.query.sort as string) || 'recommended';
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 12));
    const offset = (page - 1) * limit;
    // We want to select providers and include a featured service (first service by created_at)
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    // Match against ANY service the provider offers, not just the one featured on
    // their card — the featured service is picked separately below (most recent by
    // default, but the matching one is preferred when there's a search query).
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

    // services.provider_id references the providers table's own id on this
    // deployment, not users.id directly - every `services.provider_id = u.id`
    // comparison below used to silently match nothing, which is why every card's
    // featured service, price, and service-text search were all quietly broken (no
    // provider ever had a "featured_service", regardless of query or sort).
    const servicesFkRes = await pool.query(`
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
    const servicesRefTable = servicesFkRes.rows[0]?.foreign_table_name;
    const servicesReferenceProvidersTable = !!servicesRefTable && servicesRefTable !== 'users';
    // The id to compare services.provider_id against for "this user's own services" -
    // either the user's own id, or their row in the separate providers table.
    const providerIdExpr = servicesReferenceProvidersTable ? 'prv.id' : 'u.id';
    const providersJoin = servicesReferenceProvidersTable ? 'LEFT JOIN providers prv ON prv.user_id = u.id' : '';

    const values: any[] = [];
    const whereClauses: string[] = [];
    if (q) {
      values.push(`%${q}%`);
      const qParam = values.length;
      // Was name + service title only, so a query like "wedding" missed a provider
      // whose bio or service description mentioned it but whose titles didn't.
      const serviceTextMatch = [
        'sq.title ILIKE $' + qParam,
        hasDescription ? 'sq.description ILIKE $' + qParam : null,
        hasCategory ? 'sq.category ILIKE $' + qParam : null,
      ].filter(Boolean).join(' OR ');
      whereClauses.push(`(u.name ILIKE $${qParam} OR u.bio ILIKE $${qParam} OR EXISTS (SELECT 1 FROM services sq WHERE sq.provider_id = ${providerIdExpr} AND (${serviceTextMatch})))`);
    }
    if (category) {
      // A provider matches either by their primary category or by offering a
      // service tagged with that category — a provider's headline category
      // and their individual services' categories can differ.
      values.push(category);
      const serviceCategoryMatch = hasCategory
        ? ` OR EXISTS (SELECT 1 FROM services sc WHERE sc.provider_id = ${providerIdExpr} AND sc.category = $${values.length})`
        : '';
      whereClauses.push(`(u.category = $${values.length}${serviceCategoryMatch})`);
    }
    const searchClause = whereClauses.length ? `AND ${whereClauses.join(' AND ')}` : '';

    const serviceSelectParts = [`id`, `title`, `price`];
    if (hasCategory) serviceSelectParts.push('category');
    if (hasImages) serviceSelectParts.push('images');
    if (hasDescription) serviceSelectParts.push('description');
    if (hasCreatedAt) serviceSelectParts.push('created_at');

    const serviceSelect = serviceSelectParts.map((c) => `s.${c} AS service_${c}`).join(', ');
    const orderByService = hasCreatedAt ? 'created_at DESC' : 'id DESC';
    // When searching, feature whichever service actually matched the query (so the
    // card shows why this provider matched) instead of always the most recent one.
    const featuredOrderBy = q ? `(title ILIKE $1) DESC, ${orderByService}` : orderByService;
    console.debug('serviceSelectParts:', serviceSelectParts, 'orderByService:', orderByService);

    // Sort was previously hardcoded to `u.name ASC` regardless of what the client
    // asked for - the "Sort By" dropdown sent nothing, and nothing here read it, so
    // every option in it behaved identically. `service_price` is a SELECT-list alias
    // (see serviceSelect above), not a raw column, but Postgres resolves ORDER BY
    // against output aliases so this is safe - `sort` itself is never interpolated,
    // only used to pick one of these fixed literals, so there's no injection surface.
    let orderBy: string;
    switch (sort) {
      case 'rating':
        orderBy = 'u.rating DESC NULLS LAST, u.review_count DESC NULLS LAST, u.name ASC';
        break;
      case 'price-low':
        orderBy = 'service_price ASC NULLS LAST, u.name ASC';
        break;
      case 'price-high':
        orderBy = 'service_price DESC NULLS LAST, u.name ASC';
        break;
      case 'recommended':
      default:
        // Verified and well-rated providers surface first; alphabetical is only the
        // final tiebreaker, not the primary order it used to be.
        orderBy = 'u.is_verified DESC, u.rating DESC NULLS LAST, u.review_count DESC NULLS LAST, u.name ASC';
        break;
    }

    // Use LATERAL join to fetch featured service
    // Deliberately no portfolio_images or portfolio_meta: this is the card list, which
    // renders a provider's avatar and one featured service. Shipping every provider's
    // full portfolio - up to 24 paths each, plus captions, albums and poster paths -
    // was bytes no caller has ever read. GET /providers/:id still returns them.
    const sql = `SELECT u.id, u.email, u.name, u.role, u.profile_image, u.bio, u.years_experience, u.location, u.category, u.title, u.rating, u.review_count, u.is_verified,
      ${serviceSelect}
      FROM users u
      ${providersJoin}
      LEFT JOIN LATERAL (
        SELECT ${serviceSelectParts.join(', ')}
        FROM services
        WHERE services.provider_id = ${providerIdExpr}
        ORDER BY ${featuredOrderBy}
        LIMIT 1
      ) s ON true
      WHERE u.role = 'provider' ${searchClause}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}`;
    console.debug('Get providers SQL:', sql, 'values:', values);
    const result = await pool.query(sql, values);
    // Get total count for pagination meta
    const countSql = `SELECT COUNT(DISTINCT u.id) as total FROM users u
      ${providersJoin}
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
      bio: r.bio,
      years_experience: r.years_experience,
      location: r.location,
      // Both were missing from the SELECT above, so every consumer of this list saw an
      // undefined category - the profile page fell back to the generic "Professional"
      // and sent the booking flow no service label at all.
      category: r.category,
      title: r.title,
      rating: parseFloat(r.rating) || 0,
      review_count: parseInt(r.review_count) || 0,
      is_verified: !!r.is_verified,
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

// Public endpoint: a single provider.
//
// This route simply did not exist. The public profile page asked for it on every visit,
// got a 404, and fell back to scanning the FIRST PAGE of GET /providers - twelve rows -
// for a matching id. Any provider who didn't happen to rank in the top twelve got
// "Provider not found" on their own profile, and nobody could link to them.
//
// Declared after '/categories/stats' on purpose: Express matches in order, and a ':id'
// above it would swallow "categories".
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // users.id is a uuid column; a malformed value makes Postgres throw, which would
    // surface as a 500 for what is really just a bad URL.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(String(id || ''))) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

    // Deliberately narrower than the row we hold internally: this is unauthenticated, so
    // no email, verification documents or anything else a client has no business seeing.
    const result = await pool.query(
      `SELECT id, name, profile_image, portfolio_images, portfolio_meta, bio, years_experience,
              location, category, title, rating, review_count, is_verified
       FROM users
       WHERE id = $1 AND role = 'provider'`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    const r = result.rows[0];
    const ensureArray = (v: any) => {
      if (!v) return [];
      if (Array.isArray(v)) return v;
      try { return JSON.parse(v); } catch { return [v]; }
    };
    // Same absolute-URL handling as the list endpoint, so both paths hand the client
    // identical values.
    const absolutise = (p: string) => (p && p.startsWith('/') ? `${baseUrl}${p}` : p);

    res.json({
      id: r.id,
      name: r.name,
      profile_image: absolutise(r.profile_image),
      portfolio_images: ensureArray(r.portfolio_images).map(absolutise),
      // Keyed by the *stored* path, which is what portfolio_images holds before
      // absolutise() runs - the client resolves both through the same helper.
      portfolio_meta: r.portfolio_meta || {},
      bio: r.bio || '',
      years_experience: r.years_experience || 0,
      location: r.location || '',
      category: r.category || '',
      title: r.title || '',
      rating: parseFloat(r.rating) || 0,
      review_count: parseInt(r.review_count) || 0,
      is_verified: !!r.is_verified,
    });
  } catch (error: any) {
    console.error('Get provider error:', error?.stack || error);
    res.status(500).json({ error: 'Failed to retrieve provider' });
  }
});

export default router;
