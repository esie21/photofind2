import { Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import xss from 'xss';

// ==============================================
// RATE LIMITING CONFIGURATION
// ==============================================

// General API rate limiter - 100 requests per 15 minutes
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// Strict rate limiter for auth endpoints - 10 requests per 15 minutes
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  validate: { xForwardedForHeader: false },
});

// Login-specific limiter - 5 failed attempts per 15 minutes
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// Password reset limiter - 3 requests per hour
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: { error: 'Too many password reset requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// Payment rate limiter - 10 requests per minute
export const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Too many payment requests, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// Chat rate limiter - 30 messages per minute
export const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Too many messages, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// Admin rate limiter - 50 requests per minute
export const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 50,
  message: { error: 'Too many admin requests, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// File upload limiter - 10 uploads per hour
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { error: 'Too many file uploads, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
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
    preload: true,
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  frameguard: { action: "deny" },
});

// ==============================================
// XSS SANITIZATION
// ==============================================

const xssOptions = {
  whiteList: {}, // No HTML tags allowed
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style'],
};

// Recursively sanitize an object
function sanitizeValue(value: any): any {
  if (typeof value === 'string') {
    return xss(value, xssOptions);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value !== null && typeof value === 'object') {
    const sanitized: any = {};
    for (const key of Object.keys(value)) {
      sanitized[key] = sanitizeValue(value[key]);
    }
    return sanitized;
  }
  return value;
}

// XSS sanitization middleware
export const xssSanitizer: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeValue(req.query);
  }
  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeValue(req.params);
  }
  next();
};

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

// Middleware to set CSRF token cookie
export const csrfTokenSetter: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  // Only set for GET requests (setting up the token)
  if (req.method === 'GET') {
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

// CSRF validation middleware for state-changing requests
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

  // Constant-time comparison to prevent timing attacks
  if (!crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
    res.status(403).json({ error: 'CSRF token invalid' });
    return;
  }

  next();
};

// ==============================================
// SQL INJECTION PREVENTION (Input Validation)
// ==============================================

// Regex patterns for common SQL injection attempts
const SQL_INJECTION_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE)\b)/gi,
  /(--)|(\/\*)|(\*\/)/g,
  /(;|\||`)/g,
  /(\bOR\b\s+\d+\s*=\s*\d+)/gi,
  /(\bAND\b\s+\d+\s*=\s*\d+)/gi,
  /(\'|\")(\s*)(OR|AND)(\s*)(\'|\"|\d)/gi,
];

// Check if a string contains potential SQL injection
function containsSqlInjection(value: string): boolean {
  return SQL_INJECTION_PATTERNS.some(pattern => pattern.test(value));
}

// Validate and sanitize input for SQL safety
function validateInput(value: any, path: string = ''): { valid: boolean; message?: string } {
  if (typeof value === 'string') {
    if (containsSqlInjection(value)) {
      return { valid: false, message: `Potentially malicious input detected in ${path}` };
    }
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const result = validateInput(value[i], `${path}[${i}]`);
      if (!result.valid) return result;
    }
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const result = validateInput(value[key], path ? `${path}.${key}` : key);
      if (!result.valid) return result;
    }
  }
  return { valid: true };
}

// SQL injection prevention middleware
export const sqlInjectionPrevention: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  const bodyResult = validateInput(req.body, 'body');
  if (!bodyResult.valid) {
    res.status(400).json({ error: 'Invalid input detected', details: bodyResult.message });
    return;
  }

  const queryResult = validateInput(req.query, 'query');
  if (!queryResult.valid) {
    res.status(400).json({ error: 'Invalid input detected', details: queryResult.message });
    return;
  }

  const paramsResult = validateInput(req.params, 'params');
  if (!paramsResult.valid) {
    res.status(400).json({ error: 'Invalid input detected', details: paramsResult.message });
    return;
  }

  next();
};

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

// Apply all security middleware for sensitive routes
export const fullSecurityStack = [
  xssSanitizer,
  sqlInjectionPrevention,
];

// Security middleware for auth routes
export const authSecurityStack = [
  authLimiter,
  xssSanitizer,
  sqlInjectionPrevention,
];

// Security middleware for payment routes
export const paymentSecurityStack = [
  paymentLimiter,
  xssSanitizer,
  sqlInjectionPrevention,
];

// Security middleware for chat routes
export const chatSecurityStack = [
  chatLimiter,
  xssSanitizer,
];

// Security middleware for admin routes
export const adminSecurityStack = [
  adminLimiter,
  xssSanitizer,
  sqlInjectionPrevention,
];

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
