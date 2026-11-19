import { Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { discardUploads } from '../services/uploadService';

// ==============================================
// RATE LIMITING CONFIGURATION (3x multiplier for development)
// ==============================================

// PayMongo's webhook is exempt from the per-IP limiters below.
//
// Every delivery comes from PayMongo's handful of servers, so a per-IP bucket is one bucket
// shared by every payment on the platform: a busy hour - or PayMongo retrying a backlog after
// an outage on our side - got 429s, and each 429 delayed a client's booking being marked paid
// until PayMongo's next retry. Rate limiting is also the wrong defence for this route. It is
// authenticated by an HMAC over the body with a secret only PayMongo holds (see the webhook
// handler), so a request that is not from PayMongo is refused at the signature check, cheaply,
// without touching the database.
//
// originalUrl rather than path: the limiters are mounted at different prefixes, and path is
// relative to whichever one matched.
export function isPaymongoWebhook(req: Request): boolean {
  return req.method === 'POST' && req.originalUrl.split('?')[0].replace(/\/+$/, '') === '/api/payments/webhook';
}

// General API rate limiter - 300 requests per 15 minutes
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  skip: isPaymongoWebhook,
});

// Strict rate limiter for auth endpoints - 30 requests per 15 minutes
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  message: { error: 'Too many authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  validate: { xForwardedForHeader: false },
});

// Login-specific limiter - 15 failed attempts per 15 minutes
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// Password reset limiter - 9 requests per hour
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 9,
  message: { error: 'Too many password reset requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// Payment rate limiter - 30 requests per minute
export const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Too many payment requests, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  skip: isPaymongoWebhook,
});

// Chat rate limiter - 90 messages per minute
export const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 90,
  message: { error: 'Too many messages, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// Admin rate limiter - 150 requests per minute
export const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 150,
  message: { error: 'Too many admin requests, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// File upload limiter - 30 uploads per hour.
//
// Routes that mix uploads with plain requests on the same endpoint (a message that may
// or may not carry an attachment) put this after multer, so req.file/req.files is
// already populated - `skip` then only counts requests that actually uploaded something,
// instead of throttling every request the route handles. A request multer already wrote
// a file for that then trips the limit still needs that file cleaned up, since the route
// handler that normally does it never runs.
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  message: { error: 'Too many file uploads, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  skip: (req: Request) => {
    const r = req as any;
    return !r.file && !(Array.isArray(r.files) && r.files.length > 0);
  },
  handler: (req: Request, res: Response, _next: NextFunction, options) => {
    discardUploads(req);
    res.status(options.statusCode).json(options.message);
  },
});

// ==============================================
// HELMET SECURITY HEADERS
// ==============================================

export const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow embedding for images
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow cross-origin resource loading
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    // No 'preload': that flag is a declaration of intent to submit the domain to the
    // browser preload list, and this host is a subdomain of onrender.com - not a domain
    // this project can submit. Claiming it changes nothing and misleads the next reader.
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  frameguard: { action: "deny" },
});

// ==============================================
// OUTPUT ENCODING, NOT INPUT MANGLING
// ==============================================
//
// There used to be an `xssSanitizer` here, applied to req.body, req.query and req.params
// of every request. It ran `xss()` with `whiteList: {}` and `stripIgnoreTag: true`, which
// does not escape markup - it DELETES it, and it decides what a tag is by looking for a
// '<' and the next '>'. Ordinary writing is full of those:
//
//     "is the price < 5000 or > 5000?"  ->  "is the price  5000?"
//     "Rate: 5/10 <3"                   ->  "Rate: 5/10 "
//
// Everything between the two angle brackets was silently destroyed, in the request, before
// it was stored - so the damage was permanent and invisible to whoever typed it. That is a
// data-loss bug being paid for as if it bought safety, and it did not buy any:
//
//  - The frontend is React. JSX escapes interpolated strings on render, so a stored
//    "<script>" is displayed as text, never executed. The one dangerouslySetInnerHTML in
//    the codebase (components/ui/chart.tsx) injects CSS built from developer-supplied
//    chart config, never from user input.
//  - The one place user content really is interpolated into markup is the password-reset
//    email in routes/auth.ts, which is a backend template. That is escaped at the point of
//    use - where the context is actually known - rather than by mangling every string in
//    the system on the chance that one of them ends up in HTML.
//
// Sanitise on output, in the encoding the destination needs. Store what the user typed.

// ==============================================
// CSRF PROTECTION (Double Submit Cookie Pattern)
// ==============================================

import crypto from 'crypto';

const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_TOKEN_LENGTH = 32;

// Generate a new CSRF token
export function generateCsrfToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

// Middleware to set CSRF token cookie.
//
// Issues one only when the caller does not already have one. It used to mint a fresh token
// on EVERY GET, which is the one thing a double-submit token must not do: the browser reads
// the cookie when it builds a request, and any GET landing in between (a poll, a prefetch,
// a second tab) rotated the cookie out from under it, so the header and cookie disagreed
// and the request would be rejected. It also meant a Set-Cookie on every single GET
// response for a value nothing was checking.
export const csrfTokenSetter: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  if (req.method === 'GET' && !req.cookies?.[CSRF_COOKIE_NAME]) {
    const token = generateCsrfToken();
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false, // Client needs to read this
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600000, // 1 hour
    });
    (req as any).csrfToken = token;
  }
  next();
};

/**
 * CSRF validation for state-changing requests. Deliberately NOT mounted - see below.
 *
 * Sessions here are bearer tokens: apiClient reads the JWT out of localStorage and sends
 * it as an Authorization header, and middleware/auth.ts's verifyToken reads that header and
 * nothing else. A cross-site request cannot set that header, and the browser will not add
 * it on its own, so there is no CSRF to protect against on any route as things stand.
 *
 * routes/auth.ts does also drop the same JWT into an `auth_token` cookie on login, which
 * looks like the missing half of a CSRF hole - but nothing ever reads that cookie back, and
 * it is sameSite: 'strict', so the browser would not attach it to a cross-site request even
 * if something did. It is inert either way.
 *
 * The moment any route starts accepting that cookie as proof of identity, this must be
 * mounted on every non-GET route. Keeping it here, working and tested, is cheaper than
 * rediscovering it then.
 */
export const csrfProtection: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  // Skip for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME] as string;

  if (!cookieToken || !headerToken) {
    res.status(403).json({ error: 'CSRF token missing' });
    return;
  }

  // Constant-time comparison to prevent timing attacks.
  //
  // The length check is not an optimisation: timingSafeEqual THROWS on buffers of different
  // lengths, so a caller sending a header of the wrong size would have crashed this
  // middleware into a 500 instead of being turned away with a 403. Lengths are not secret -
  // the token length is a constant in this file - so comparing them openly leaks nothing.
  const cookieBuf = Buffer.from(String(cookieToken), 'utf8');
  const headerBuf = Buffer.from(String(headerToken), 'utf8');

  if (cookieBuf.length !== headerBuf.length || !crypto.timingSafeEqual(cookieBuf, headerBuf)) {
    res.status(403).json({ error: 'CSRF token invalid' });
    return;
  }

  next();
};

// ==============================================
// WHY THERE IS NO SQL "INJECTION PREVENTION" MIDDLEWARE HERE
// ==============================================
//
// A `sqlInjectionPrevention` middleware used to sit on /api/auth, /api/payments,
// /api/wallet, /api/payouts and /api/admin. It rejected any request whose body, query or
// params contained a ';', a '|', a backtick, a '--', or one of SELECT/INSERT/UPDATE/
// DELETE/DROP/UNION/ALTER/CREATE/TRUNCATE as a whole word. It was removed, for two
// separate reasons.
//
// The first is that it did not work reliably. Its patterns were module-level regexes
// carrying the /g flag, and it tested them with `pattern.test(value)`. A /g regex keeps
// `lastIndex` between calls, so each test resumed from wherever the previous request's
// string happened to leave off - on a shared, long-lived object. The same input was
// therefore accepted or rejected depending on what had been sent just before it, by
// anyone. A security control that fails open half the time is not a security control, and
// one that fails closed half the time is an outage.
//
// The second is that it was defending a door that is not there. Every query in this
// codebase is parameterised - values travel as $1, $2, ... and are never concatenated into
// SQL. The only interpolation into a query string anywhere is an identifier chosen from a
// fixed whitelist in this repo (routes/admin.ts's sort column and direction, its INTERVAL
// literal from a switch, config/database.ts's column names from a hardcoded migration
// list). None of those can be reached by anything a request carries.
//
// What it did do was reject ordinary writing. An admin could not decline a payout with the
// reason "account details are incorrect; please update and resubmit" - two separate hits -
// and a password containing ';' could not be used to sign up. Those were real, reported-as-
// broken behaviours bought in exchange for nothing.
//
// If a query ever does need to interpolate something a user supplied, fix it there, with a
// whitelist or a parameter. Not with a blocklist over every string in the system.

// ==============================================
// SECURE COOKIE CONFIGURATION
// ==============================================

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  path: '/',
};

// Set secure cookie helper
export function setSecureCookie(res: Response, name: string, value: string, maxAge?: number): void {
  res.cookie(name, value, {
    ...cookieOptions,
    maxAge: maxAge || cookieOptions.maxAge,
  });
}

// Clear cookie helper
export function clearSecureCookie(res: Response, name: string): void {
  res.clearCookie(name, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });
}

// ==============================================
// REQUEST VALIDATION HELPERS
// ==============================================

// Validate email format
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

// Validate password strength
export function isStrongPassword(password: string): { valid: boolean; message?: string } {
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number' };
  }
  return { valid: true };
}

// Validate UUID format
export function isValidUUID(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

// Validate numeric ID
export function isValidNumericId(id: string): boolean {
  return /^\d+$/.test(id) && parseInt(id, 10) > 0;
}

// ==============================================
// COMBINED SECURITY MIDDLEWARE
// ==============================================

// Per-area rate limiting. These used to also carry xssSanitizer and
// sqlInjectionPrevention; both were removed for the reasons set out above, which leaves
// the limiter as the thing each of these stacks is actually for. They stay as named
// stacks rather than collapsing to bare limiters at the mount points, so there is still
// one place to add a real per-area control when one is needed.

// Security middleware for auth routes
export const authSecurityStack = [authLimiter];

// Security middleware for payment routes
export const paymentSecurityStack = [paymentLimiter];

// Security middleware for chat routes
export const chatSecurityStack = [chatLimiter];

// Security middleware for admin routes
export const adminSecurityStack = [adminLimiter];

// ==============================================
// SECURITY LOGGING
// ==============================================

interface SecurityEvent {
  type: 'rate_limit' | 'csrf_failure' | 'sql_injection' | 'xss_attempt' | 'auth_failure';
  ip: string;
  userId?: string;
  path: string;
  timestamp: Date;
  details?: string;
}

const securityEvents: SecurityEvent[] = [];

export function logSecurityEvent(event: Omit<SecurityEvent, 'timestamp'>): void {
  const fullEvent: SecurityEvent = {
    ...event,
    timestamp: new Date(),
  };
  securityEvents.push(fullEvent);

  // Keep only last 1000 events in memory
  if (securityEvents.length > 1000) {
    securityEvents.shift();
  }

  // Log to console for monitoring
  console.warn(`[SECURITY] ${event.type} - IP: ${event.ip} - Path: ${event.path}`, event.details || '');
}

export function getSecurityEvents(limit: number = 100): SecurityEvent[] {
  return securityEvents.slice(-limit);
}
