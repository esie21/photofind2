import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/authConfig';
import { pool } from '../config/database';

interface AuthRequest extends Request {
  userId?: string;
  role?: string;
}

/**
 * How long a "this account is still active" answer is trusted before it is re-checked.
 *
 * A JWT is good for 24 hours and carries no revocation of any kind, so until now an admin
 * deactivating an account did nothing to whoever was already signed in to it: they kept
 * full access - bookings, chat, wallet, payouts - for up to a day afterwards, because
 * every route trusted the token alone and nothing ever looked at users.deleted_at again.
 *
 * Re-reading the row on every single request would be correct but wasteful: verifyToken
 * runs on nearly every endpoint, including ones the UI polls, and the pool is small. This
 * caches the answer briefly instead, which bounds both costs - at most one extra query per
 * user per TTL, and at most a TTL of continued access after deactivation, rather than 24
 * hours. Deactivating through the admin route invalidates the entry immediately anyway
 * (see invalidateUserAccessCache), so the TTL only matters when the row is changed by some
 * other means, such as by hand in the database.
 */
const ACCESS_CACHE_TTL_MS = 30_000;

/** Stop the cache growing without bound on a long-running process. */
const ACCESS_CACHE_MAX_ENTRIES = 5000;

const accessCache = new Map<string, { active: boolean; checkedAt: number }>();

/**
 * Forget what we know about a user, so the very next request re-reads their row.
 *
 * Called by the admin deactivate/restore routes, which is what makes those take effect at
 * once rather than at the end of the TTL.
 */
export function invalidateUserAccessCache(userId: string): void {
  accessCache.delete(String(userId));
}

function pruneAccessCache(now: number): void {
  for (const [key, entry] of accessCache) {
    if (now - entry.checkedAt >= ACCESS_CACHE_TTL_MS) accessCache.delete(key);
  }
  // Still oversized after dropping the stale ones: drop oldest-first until it fits. Map
  // iterates in insertion order, so this evicts the least recently refreshed.
  if (accessCache.size > ACCESS_CACHE_MAX_ENTRIES) {
    const excess = accessCache.size - ACCESS_CACHE_MAX_ENTRIES;
    let dropped = 0;
    for (const key of accessCache.keys()) {
      accessCache.delete(key);
      if (++dropped >= excess) break;
    }
  }
}

/**
 * Whether this user id still belongs to an account that is allowed in.
 *
 * Throws if the database cannot be reached - the caller turns that into a 503 rather than
 * guessing. Guessing "active" would mean a deactivated account gets back in whenever the
 * database wobbles, which is exactly the case this exists to prevent.
 */
export async function isAccountActive(userId: string): Promise<boolean> {
  const now = Date.now();
  const cached = accessCache.get(userId);
  if (cached && now - cached.checkedAt < ACCESS_CACHE_TTL_MS) {
    return cached.active;
  }

  const result = await pool.query('SELECT deleted_at FROM users WHERE id::text = $1', [userId]);
  const active = result.rows.length > 0 && !result.rows[0].deleted_at;

  accessCache.set(userId, { active, checkedAt: now });
  if (accessCache.size > ACCESS_CACHE_MAX_ENTRIES) pruneAccessCache(now);

  return active;
}

// Middleware to verify JWT token
export async function verifyToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  let decoded: any;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const userId = String(decoded.userId);

  // The token says who they are; this says whether that account is still allowed in.
  let active: boolean;
  try {
    active = await isAccountActive(userId);
  } catch (error) {
    console.error('[verifyToken] Could not check account status:', error);
    return res.status(503).json({ error: 'Service temporarily unavailable. Please try again.' });
  }

  if (!active) {
    // 401, not 403: from the client's point of view this session is over, and apiClient
    // treats 401 as "clear the stored token", which signs them out instead of leaving
    // them clicking around an app where every request fails.
    return res.status(401).json({ error: 'This account is no longer active. Please sign in again.' });
  }

  // Keep userId as string (UUID or numeric string) for consistent comparisons with route params
  req.userId = userId;
  req.role = decoded.role;
  if (process.env.NODE_ENV !== 'production') {
    console.log('[verifyToken] decoded user:', { userId: req.userId, role: req.role });
  }
  next();
}

// Middleware to check user role
export function checkRole(...allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.role || !allowedRoles.includes(req.role)) {
      return res
        .status(403)
        .json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

export default { verifyToken, checkRole };
