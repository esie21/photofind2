import { Router, Request, Response } from 'express';
import pool from '../config/database';
import path from 'path';
import { getProviderStats } from '../services/providerStats';
import { rankScore } from '../utils/providerRanking';

const router = Router();

/**
 * Whether `services.provider_id` is a foreign key to a separate `providers` table's
 * id, rather than straight to `users.id` - true on at least one live deployment
 * (discovered here the hard way: every `services.provider_id = u.id` comparison
 * silently matched nothing there, so every card's featured service, price, and
 * service-text search were quietly broken). Callers should alias the providers
 * table `prv` and users `u` to match providerIdExpr/providersJoin.
 */
async function getServicesProviderJoin(): Promise<{ providerIdExpr: string; providersJoin: string; referencesProvidersTable: boolean }> {
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
  return {
    providerIdExpr: servicesReferenceProvidersTable ? 'prv.id' : 'u.id',
    providersJoin: servicesReferenceProvidersTable ? 'LEFT JOIN providers prv ON prv.user_id = u.id' : '',
    referencesProvidersTable: servicesReferenceProvidersTable,
  };
}

// Public endpoint: Get providers
router.get('/', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) || '';
    const category = (req.query.category as string) || '';
    const sort = (req.query.sort as string) || 'best';
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

    const { providerIdExpr, providersJoin } = await getServicesProviderJoin();

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

    // ---- Filters (all optional, all parameterised) ----
    // Absent -> no filter; present but malformed -> 400, rather than silently ignoring the
    // filter and showing the user results they asked not to see.
    const num = (v: unknown): number | null | 'bad' => {
      if (v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : 'bad';
    };
    const minPrice = num(req.query.min_price);
    const maxPrice = num(req.query.max_price);
    const minRating = num(req.query.min_rating);
    const lat = num(req.query.lat);
    const lng = num(req.query.lng);
    const radiusKm = num(req.query.radius_km);
    if ([minPrice, maxPrice, minRating, lat, lng, radiusKm].includes('bad')) {
      return res.status(400).json({ error: 'min_price, max_price, min_rating, lat, lng and radius_km must be numbers' });
    }
    if ((minPrice !== null && (minPrice as number) < 0) || (maxPrice !== null && (maxPrice as number) < 0)) {
      return res.status(400).json({ error: 'Prices cannot be negative' });
    }
    if (minPrice !== null && maxPrice !== null && (minPrice as number) > (maxPrice as number)) {
      return res.status(400).json({ error: 'min_price cannot be greater than max_price' });
    }
    if (minRating !== null && ((minRating as number) < 0 || (minRating as number) > 5)) {
      return res.status(400).json({ error: 'min_rating must be between 0 and 5' });
    }
    if ((lat === null) !== (lng === null)) {
      return res.status(400).json({ error: 'lat and lng must be provided together' });
    }
    if (lat !== null && (Math.abs(lat as number) > 90 || Math.abs(lng as number) > 180)) {
      return res.status(400).json({ error: 'lat/lng out of range' });
    }
    if (radiusKm !== null && (lat === null || (radiusKm as number) <= 0 || (radiusKm as number) > 500)) {
      return res.status(400).json({ error: 'radius_km must be between 0 and 500 and needs lat/lng' });
    }
    if (sort === 'distance' && lat === null) {
      return res.status(400).json({ error: 'sort=distance needs lat and lng' });
    }

    if (minPrice !== null || maxPrice !== null) {
      // Matches a provider offering ANY service in the range (same rule as search/category above).
      const priceConds: string[] = [];
      if (minPrice !== null) { values.push(minPrice); priceConds.push(`sp.price >= $${values.length}`); }
      if (maxPrice !== null) { values.push(maxPrice); priceConds.push(`sp.price <= $${values.length}`); }
      whereClauses.push(`EXISTS (SELECT 1 FROM services sp WHERE sp.provider_id = ${providerIdExpr} AND ${priceConds.join(' AND ')})`);
    }
    if (minRating !== null) {
      values.push(minRating);
      whereClauses.push(`u.rating >= $${values.length}`);
    }
    if (String(req.query.verified || '') === '1' || String(req.query.verified || '') === 'true') {
      whereClauses.push('u.is_verified = TRUE');
    }

    const availableDate = req.query.available_date ? String(req.query.available_date) : '';
    if (availableDate) {
      const parsed = new Date(`${availableDate}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(availableDate) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== availableDate) {
        return res.status(400).json({ error: 'available_date must be a real date in YYYY-MM-DD format' });
      }
      values.push(availableDate);
      const d = `$${values.length}::date`;
      // Same sources the booking calendar uses. A day-specific override wins: unavailable
      // removes the provider, available keeps them. Otherwise the provider needs a weekly
      // rule for that weekday (Sunday = 0 in both Postgres DOW and availability_rules).
      // Slots are generated lazily when a provider's calendar is opened, so they are only
      // consulted when they already exist for that date - then at least one must be free.
      whereClauses.push(`(
        CASE
          WHEN EXISTS (SELECT 1 FROM availability_overrides ao WHERE ao.provider_id::text = u.id::text AND ao.override_date = ${d})
            THEN EXISTS (SELECT 1 FROM availability_overrides ao WHERE ao.provider_id::text = u.id::text AND ao.override_date = ${d} AND ao.is_available = TRUE)
          ELSE EXISTS (SELECT 1 FROM availability_rules ar WHERE ar.provider_id::text = u.id::text AND ar.is_active = TRUE AND ar.day_of_week = EXTRACT(DOW FROM ${d})::int)
        END
        AND (
          NOT EXISTS (SELECT 1 FROM time_slots t WHERE t.provider_id::text = u.id::text AND DATE(t.start_datetime) = ${d})
          OR EXISTS (SELECT 1 FROM time_slots t WHERE t.provider_id::text = u.id::text AND DATE(t.start_datetime) = ${d}
                       AND t.start_datetime > NOW()
                       AND (t.status = 'available' OR (t.status = 'held' AND t.hold_expires_at <= NOW())))
        )
      )`);
    }

    // Great-circle distance in km (haversine). Providers without coordinates have a NULL
    // distance and are excluded whenever a location is supplied.
    let distanceExpr = '';
    if (lat !== null) {
      values.push(lat);
      const latP = `$${values.length}::float8`;
      values.push(lng);
      const lngP = `$${values.length}::float8`;
      distanceExpr = `(6371 * 2 * ASIN(SQRT(LEAST(1,
        POWER(SIN(RADIANS(u.latitude - ${latP}) / 2), 2)
        + COS(RADIANS(${latP})) * COS(RADIANS(u.latitude)) * POWER(SIN(RADIANS(u.longitude - ${lngP}) / 2), 2)))))`;
      whereClauses.push('u.latitude IS NOT NULL AND u.longitude IS NOT NULL');
      if (radiusKm !== null) whereClauses.push(`${distanceExpr} <= ${radiusKm}`);
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
    // 'best' (alias: the old 'recommended') ranks by a blended score - rating, response time
    // and completion rate - that can't be expressed as a column, so it is computed in
    // JS (see below) and the SQL ORDER BY is only used by the other sorts.
    const useScoreSort = sort === 'best' || sort === 'recommended' || !['rating', 'price-low', 'price-high', 'distance'].includes(sort);
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
      case 'distance':
        orderBy = 'distance_km ASC, u.name ASC';
        break;
      default:
        orderBy = 'u.name ASC';
        break;
    }

    // Score every matching provider, then page the ranked ids. Stats come from one grouped
    // query for the whole match set, so cost scales with matches, not with page count.
    let pageIds: string[] | null = null;
    let scoreById = new Map<string, number>();
    let scoredTotal = 0;
    if (useScoreSort) {
      const idsRes = await pool.query(
        `SELECT u.id::text AS id, u.rating, u.review_count, u.is_verified, u.name
           FROM users u ${providersJoin}
          WHERE u.role = 'provider' ${searchClause}`,
        values
      );
      const stats = await getProviderStats(idsRes.rows.map((r: any) => r.id));
      const ranked = idsRes.rows
        .map((r: any) => ({
          id: String(r.id),
          name: String(r.name || ''),
          verified: !!r.is_verified,
          reviews: parseInt(r.review_count) || 0,
          score: rankScore(parseFloat(r.rating) || 0, parseInt(r.review_count) || 0, stats.get(String(r.id))),
        }))
        .sort((a: any, b: any) =>
          b.score - a.score || Number(b.verified) - Number(a.verified) || b.reviews - a.reviews || a.name.localeCompare(b.name));
      scoredTotal = ranked.length;
      scoreById = new Map(ranked.map((r: any) => [r.id, r.score]));
      pageIds = ranked.slice(offset, offset + limit).map((r: any) => r.id);
    }

    // Use LATERAL join to fetch featured service
    // Deliberately no portfolio_images or portfolio_meta: this is the card list, which
    // renders a provider's avatar and one featured service. Shipping every provider's
    // full portfolio - up to 24 paths each, plus captions, albums and poster paths -
    // was bytes no caller has ever read. GET /providers/:id still returns them.
    const sql = `SELECT u.id, u.email, u.name, u.role, u.profile_image, u.bio, u.years_experience, u.location, u.category, u.title, u.rating, u.review_count, u.is_verified,
      ${distanceExpr ? `${distanceExpr} AS distance_km,` : ''}
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
      WHERE u.role = 'provider' ${searchClause}${pageIds ? ` AND u.id::text = ANY($${values.length + 1}::text[])` : ''}
      ORDER BY ${orderBy}
      ${pageIds ? '' : `LIMIT ${limit} OFFSET ${offset}`}`;
    console.debug('Get providers SQL:', sql, 'values:', values);
    const result = await pool.query(sql, pageIds ? [...values, pageIds] : values);
    // Get total count for pagination meta
    const countSql = `SELECT COUNT(DISTINCT u.id) as total FROM users u
      ${providersJoin}
      WHERE u.role = 'provider' ${searchClause}`;
    const total = useScoreSort ? scoredTotal : Number((await pool.query(countSql, values)).rows[0]?.total || 0);
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
      ...(r.distance_km !== undefined && r.distance_km !== null ? { distance_km: Number(Number(r.distance_km).toFixed(1)) } : {}),
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
    if (pageIds) {
      // The page query has no meaningful ORDER BY; restore the ranked order here.
      const position = new Map(pageIds.map((id, i) => [id, i]));
      rows.sort((a: any, b: any) => (position.get(String(a.id)) ?? 0) - (position.get(String(b.id)) ?? 0));
      rows = rows.map((r: any) => ({ ...r, rank_score: Number((scoreById.get(String(r.id)) ?? 0).toFixed(3)) }));
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
    // A provider counts toward a category if EITHER their primary category matches
    // OR they offer a service tagged with it - the same OR that GET / filters by
    // (line ~79). This used to run those two as separate GROUP BYs and take
    // Math.max(userCount, serviceCount) per category, which undercounts whenever
    // the two provider sets aren't a subset of one another: e.g. 3 providers whose
    // primary category is "Videography" plus 2 *other* providers (different
    // primary category) who each added one Videography-tagged service should read
    // 5, but max(3, 2) read 3. Folding both signals into one set of (provider_id,
    // category) pairs before counting distinct providers gives the true union -
    // the same number the category filter actually returns.
    //
    // The service-side branch has to resolve back to the *user*'s id the same way
    // GET / does - on the deployment where services.provider_id is a FK to a
    // separate providers table (not users.id directly, see getServicesProviderJoin),
    // joining straight to users on s.provider_id silently matches nothing and drops
    // every service-only category from the count, reproducing the exact undercount
    // this query exists to fix.
    const { referencesProvidersTable } = await getServicesProviderJoin();
    const serviceCategoryJoin = referencesProvidersTable
      ? 'JOIN providers prv ON prv.id = s.provider_id JOIN users u ON u.id = prv.user_id'
      : 'JOIN users u ON u.id = s.provider_id';
    const categoryResult = await pool.query(`
      SELECT category, COUNT(DISTINCT provider_id) as count
      FROM (
        SELECT id AS provider_id, category
        FROM users
        WHERE role = 'provider' AND category IS NOT NULL AND category != ''
        UNION
        SELECT u.id AS provider_id, s.category
        FROM services s
        ${serviceCategoryJoin}
        WHERE u.role = 'provider' AND s.category IS NOT NULL AND s.category != ''
      ) provider_categories
      GROUP BY category
      ORDER BY count DESC
    `);

    // Get total provider count
    const totalResult = await pool.query(`
      SELECT COUNT(*) as total FROM users WHERE role = 'provider'
    `);
    const totalProviders = parseInt(totalResult.rows[0]?.total || '0');

    const categories = categoryResult.rows.map((row: any) => ({
      name: row.category,
      count: parseInt(row.count),
    }));

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

    // users.id is a uuid column on a database created from database.sql and a SERIAL
    // integer on one initializeTables built from nothing, so a legitimate id is either
    // shape. Screening for both still keeps a malformed value away from Postgres, which
    // would throw and surface as a 500 for what is really just a bad URL - but assuming
    // uuid alone 404'd every provider on an integer-keyed database, including ones the
    // list endpoint had just returned.
    const ID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[1-9][0-9]*)$/i;
    if (!ID_RE.test(String(id || ''))) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

    // Deliberately narrower than the row we hold internally: this is unauthenticated, so
    // no email, verification documents or anything else a client has no business seeing.
    const result = await pool.query(
      `SELECT id, name, profile_image, portfolio_images, portfolio_meta, portfolio_albums, portfolio_cover, bio, years_experience,
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
      // Keyed by album name, not by path - see users.portfolio_albums.
      portfolio_albums: r.portfolio_albums || {},
      // A stored path, like the keys of portfolio_meta. '' means "choose automatically".
      portfolio_cover: r.portfolio_cover || '',
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
