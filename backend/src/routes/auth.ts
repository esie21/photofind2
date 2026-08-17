import express, { Router, Request, Response } from 'express';
import pool from '../config/database';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { isValidEmail, isStrongPassword, setSecureCookie, clearSecureCookie, logSecurityEvent, passwordResetLimiter, loginLimiter } from '../middleware/security';
import { verifyToken } from '../middleware/auth';
import { JWT_SECRET } from '../config/authConfig';

const router = Router();

// Email service configuration (using environment variables)
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || 'noreply@photofind.com';

// Deliberately an opt-in check (must equal 'development'), not the opt-out
// `!== 'production'` this used to be. NODE_ENV isn't guaranteed to be set at all in
// deployment - package.json's start:prod sets it explicitly, but nothing actually invokes
// that script (no Procfile/nixpacks override; the plain `start` script Railway falls back
// to does not set it) - so `!== 'production'` defaulted to "leak" on a plausibly-real
// misconfigured deploy. This defaults to "don't leak" instead.
const IS_DEV = process.env.NODE_ENV === 'development';

interface AuthRequest extends Request {
  body: {
    email: string;
    password: string;
    name?: string;
    role?: string;
    termsAccepted?: boolean;
  };
}

// Token cookie name
const AUTH_COOKIE_NAME = 'auth_token';

// A real bcrypt hash (same cost factor as real password hashing) with no matching
// plaintext. Compared against when the email isn't found, so that path takes about as
// long as a real wrong-password compare - without it, a nonexistent email returned
// almost instantly while a wrong password took ~100ms+, and the gap let an attacker
// enumerate registered emails purely by timing the response.
const DUMMY_PASSWORD_HASH = '$2a$12$Lm9e2hI4iK9bOk.YKAFwL.8Le//5AyTdAFQnvJij21Fl4/z3OFtQ2';

function getGoogleClientId() {
  return process.env.GOOGLE_CLIENT_ID || '';
}

function getGoogleClient() {
  return new OAuth2Client(getGoogleClientId());
}

function issueAuthToken(user: { id: string; role: string }) {
  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
    },
    JWT_SECRET,
    {
      expiresIn: '24h',
      algorithm: 'HS256',
    }
  );
}

function sendAuthResponse(res: Response, user: { id: string; email: string; name: string; role: string }) {
  const token = issueAuthToken(user);
  setSecureCookie(res, AUTH_COOKIE_NAME, token, 24 * 60 * 60 * 1000);
  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
}

// Login endpoint
router.post('/login', loginLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Query user from database (using parameterized query - SQL injection safe)
    const result = await pool.query(
      'SELECT id, email, password_hash, role, name, deleted_at FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      // Runs a real bcrypt compare against a throwaway hash so this path costs about the
      // same as the "wrong password" path below - see DUMMY_PASSWORD_HASH.
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH).catch(() => false);
      // Log failed login attempt
      logSecurityEvent({
        type: 'auth_failure',
        ip: req.ip || 'unknown',
        path: req.path,
        details: `Failed login attempt for email: ${email}`,
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    let passwordMatch = false;
    try {
      passwordMatch = await bcrypt.compare(password, user.password_hash);
    } catch (bcryptErr) {
      console.error('Bcrypt compare failed', bcryptErr);
      passwordMatch = false;
    }

    if (!passwordMatch) {
      // Log failed login attempt
      logSecurityEvent({
        type: 'auth_failure',
        ip: req.ip || 'unknown',
        userId: String(user.id),
        path: req.path,
        details: 'Invalid password',
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // The credentials are correct, but an admin has since removed this account's access -
    // checked only after the password is verified, so a wrong guess still gets the same
    // generic "Invalid credentials" as any other account instead of confirming this one
    // exists and is deactivated.
    if (user.deleted_at) {
      logSecurityEvent({
        type: 'auth_failure',
        ip: req.ip || 'unknown',
        userId: String(user.id),
        path: req.path,
        details: 'Login attempt on deactivated account',
      });
      return res.status(403).json({ error: 'This account has been deactivated. Contact support if you believe this is a mistake.' });
    }

    // Generate JWT token with secure claims
    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role,
        iat: Math.floor(Date.now() / 1000),
      },
      JWT_SECRET,
      {
        expiresIn: '24h',
        algorithm: 'HS256',
      }
    );

    // Set secure HTTP-only cookie
    setSecureCookie(res, AUTH_COOKIE_NAME, token, 24 * 60 * 60 * 1000); // 24 hours

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Google Sign-In
router.post('/google', async (req: Request, res: Response) => {
  try {
    const { credential, role, intent, termsAccepted } = req.body as {
      credential?: string;
      role?: 'client' | 'provider';
      intent?: 'login' | 'signup';
      termsAccepted?: boolean;
    };

    if (!credential) {
      return res.status(400).json({ error: 'Missing Google credential' });
    }

    const googleClientId = getGoogleClientId();
    if (!googleClientId) {
      return res.status(503).json({ error: 'Google sign-in is not configured on the server' });
    }

    const ticket = await getGoogleClient().verifyIdToken({
      idToken: credential,
      audience: googleClientId,
    });

    const payload = ticket.getPayload();
    if (!payload?.email || !payload.sub) {
      return res.status(400).json({ error: 'Invalid Google account data' });
    }

    if (payload.email_verified === false) {
      return res.status(400).json({ error: 'Google email is not verified' });
    }

    const googleId = payload.sub;
    const email = payload.email.toLowerCase().trim();
    const name = (payload.name || email.split('@')[0]).trim();
    const picture = payload.picture || null;

    let userResult = await pool.query(
      'SELECT id, email, name, role, deleted_at FROM users WHERE google_id = $1',
      [googleId]
    );

    if (userResult.rows.length === 0) {
      userResult = await pool.query(
        'SELECT id, email, name, role, google_id, deleted_at FROM users WHERE LOWER(email) = LOWER($1)',
        [email]
      );

      if (userResult.rows[0] && !userResult.rows[0].google_id) {
        await pool.query(
          `UPDATE users
           SET google_id = $1,
               profile_image = COALESCE(profile_image, $2),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [googleId, picture, userResult.rows[0].id]
        );
      }
    }

    if (userResult.rows.length === 0) {
      if (intent === 'login') {
        return res.status(404).json({ error: 'No account found for this Google email. Please sign up first.' });
      }

      const validRoles = ['client', 'provider'];
      if (!role || !validRoles.includes(role)) {
        return res.status(200).json({
          needsRole: true,
          profile: { email, name, picture },
        });
      }

      if (termsAccepted !== true) {
        return res.status(400).json({ error: 'You must agree to the Terms and Conditions to create an account' });
      }

      // password_hash is a random value the account owner never sees - password_set_at
      // is deliberately left NULL so change-password knows not to ask for it as a
      // "current password" later.
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
      const created = await pool.query(
        `INSERT INTO users (email, name, password_hash, role, google_id, profile_image, terms_accepted_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
         RETURNING id, email, name, role`,
        [email, name, passwordHash, role, googleId, picture]
      );

      return sendAuthResponse(res.status(201), created.rows[0]);
    }

    // Same access-revocation gap as /login - an admin-deleted account authenticating via
    // Google bypassed the check entirely since this path never queried deleted_at at all.
    if (userResult.rows[0].deleted_at) {
      logSecurityEvent({
        type: 'auth_failure',
        ip: req.ip || 'unknown',
        userId: String(userResult.rows[0].id),
        path: req.path,
        details: 'Google sign-in attempt on deactivated account',
      });
      return res.status(403).json({ error: 'This account has been deactivated. Contact support if you believe this is a mistake.' });
    }

    return sendAuthResponse(res, userResult.rows[0]);
  } catch (error) {
    console.error('Google sign-in error:', error);
    return res.status(401).json({ error: 'Google sign-in failed. Please try again.' });
  }
});

// Check email availability endpoint
router.post('/check-email', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const result = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [email.trim()]
    );

    return res.json({
      available: result.rows.length === 0,
      message: result.rows.length === 0 ? 'Email is available' : 'Email is already registered'
    });
  } catch (error) {
    console.error('Check email error:', error);
    return res.status(500).json({ error: 'Failed to check email availability' });
  }
});

// Signup endpoint
router.post('/signup', async (req: AuthRequest, res: Response) => {
  try {
    const { email, password, name, role, termsAccepted } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name required' });
    }

    if (termsAccepted !== true) {
      return res.status(400).json({ error: 'You must agree to the Terms and Conditions to create an account' });
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password strength
    const passwordCheck = isStrongPassword(password);
    if (!passwordCheck.valid) {
      return res.status(400).json({ error: passwordCheck.message });
    }

    // Validate name length
    if (name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({ error: 'Name must be between 2 and 100 characters' });
    }

    // Validate role
    const validRoles = ['client', 'provider'];
    const userRole = role && validRoles.includes(role) ? role : 'client';

    // Check if user already exists (case-insensitive email)
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [email.trim()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password with strong salt rounds
    const passwordHash = await bcrypt.hash(password, 12);

    // Insert new user (parameterized query - SQL injection safe). password_set_at is
    // stamped here too - this password was chosen and typed by the person creating the
    // account, unlike the random one Google sign-up generates.
    const result = await pool.query(
      'INSERT INTO users (email, name, password_hash, role, terms_accepted_at, password_set_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id, email, role, name',
      [email.toLowerCase().trim(), name.trim(), passwordHash, userRole]
    );

    const user = result.rows[0];

    // Generate JWT token with secure claims
    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role,
        iat: Math.floor(Date.now() / 1000),
      },
      JWT_SECRET,
      {
        expiresIn: '24h',
        algorithm: 'HS256',
      }
    );

    // Set secure HTTP-only cookie
    setSecureCookie(res, AUTH_COOKIE_NAME, token, 24 * 60 * 60 * 1000); // 24 hours

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// Get current user endpoint
router.get('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded: any = jwt.verify(
      token,
      JWT_SECRET
    );

    const result = await pool.query(
      `SELECT id, email, name, role, profile_image, portfolio_images, portfolio_meta, bio, years_experience, location, category, title, is_verified, verification_status, verification_documents,
              (password_set_at IS NOT NULL) as has_password
       FROM users WHERE id = $1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Change password - works for both a normal account (verifies the current password)
// and a Google-only account setting a real password for the first time (password_set_at
// is NULL, so none is required or checked).
router.post('/change-password', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  try {
    const userId = req.userId;
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };

    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required' });
    }

    const passwordCheck = isStrongPassword(newPassword);
    if (!passwordCheck.valid) {
      return res.status(400).json({ error: passwordCheck.message });
    }

    const result = await pool.query(
      'SELECT password_hash, password_set_at FROM users WHERE id::text = $1',
      [userId]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.password_set_at) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required' });
      }

      let passwordMatch = false;
      try {
        passwordMatch = await bcrypt.compare(currentPassword, user.password_hash);
      } catch (bcryptErr) {
        console.error('Bcrypt compare failed', bcryptErr);
        passwordMatch = false;
      }

      if (!passwordMatch) {
        logSecurityEvent({
          type: 'auth_failure',
          ip: req.ip || 'unknown',
          userId: String(userId),
          path: req.path,
          details: 'Change-password attempt with incorrect current password',
        });
        // 400, not 401: this request already carried a valid session token, and
        // apiClient treats any 401 as an expired/invalid token and clears it - a wrong
        // current password would otherwise silently sign the user out mid-form.
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
    }
    // Else: no known current password (fresh Google account) - nothing to verify against.

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      'UPDATE users SET password_hash = $1, password_set_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id::text = $2',
      [passwordHash, userId]
    );

    return res.json({ success: true, has_password: true });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ error: 'Failed to change password' });
  }
});

// Logout endpoint - clears secure cookie
router.post('/logout', async (req: Request, res: Response) => {
  try {
    // Clear the auth cookie
    clearSecureCookie(res, AUTH_COOKIE_NAME);
    return res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ error: 'Logout failed' });
  }
});

// Forgot password - request password reset
router.post('/forgot-password', passwordResetLimiter, async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Find user by email
    const userResult = await pool.query(
      'SELECT id, email, name, deleted_at FROM users WHERE LOWER(email) = LOWER($1)',
      [email.trim()]
    );

    // Always return success to prevent email enumeration attacks. A deleted/banned
    // account gets the same generic response as a nonexistent one, for the same reason -
    // login already refuses it either way (see /login), so there's nothing to gain by
    // letting this endpoint confirm the address belongs to a real, if deactivated, account.
    if (userResult.rows.length === 0 || userResult.rows[0].deleted_at) {
      console.log(`Password reset requested for non-existent or deactivated email: ${email}`);
      return res.json({
        success: true,
        message: 'If an account exists with that email, you will receive a password reset link.'
      });
    }

    const user = userResult.rows[0];

    // Generate secure reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Delete any existing reset tokens for this user
    await pool.query(
      'DELETE FROM password_reset_tokens WHERE user_id = $1',
      [user.id]
    );

    // Store hashed token in database
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );

    // Build reset URL
    const resetUrl = `${FRONTEND_URL}/reset-password?token=${resetToken}`;

    // Try to send email if SMTP is configured
    if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
      try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
          host: SMTP_HOST,
          port: SMTP_PORT,
          secure: SMTP_PORT === 465,
          auth: {
            user: SMTP_USER,
            pass: SMTP_PASS,
          },
        });

        await transporter.sendMail({
          from: SMTP_FROM,
          to: user.email,
          subject: 'Reset Your PhotoFind Password',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #7c3aed;">Reset Your Password</h2>
              <p>Hi ${user.name || 'there'},</p>
              <p>You requested to reset your password for your PhotoFind account.</p>
              <p>Click the button below to reset your password. This link will expire in 1 hour.</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}"
                   style="background-color: #7c3aed; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; display: inline-block;">
                  Reset Password
                </a>
              </div>
              <p style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
              <p style="color: #666; font-size: 14px;">Or copy and paste this link in your browser:</p>
              <p style="color: #7c3aed; font-size: 14px; word-break: break-all;">${resetUrl}</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
              <p style="color: #999; font-size: 12px;">PhotoFind - Connect with creative professionals</p>
            </div>
          `,
          text: `Reset your PhotoFind password by visiting: ${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, you can safely ignore this email.`,
        });

        console.log(`Password reset email sent to: ${user.email}`);
      } catch (emailError) {
        console.error('Failed to send password reset email:', emailError);
        // Continue anyway - user can try again
      }
    } else if (IS_DEV) {
      // Log the reset URL for local development only - this is a live, unused
      // account-takeover link, not something to ever put in a log a wider audience than
      // the developer running this locally might read.
      console.log(`[DEV] Password reset URL for ${user.email}: ${resetUrl}`);
    } else {
      // SMTP isn't configured and this isn't local dev - the reset silently succeeded
      // from the requester's point of view but no email went anywhere. Fail loudly here
      // instead of quietly logging the one thing that must never end up in a log an
      // attacker (or just a wider audience than intended) might read.
      console.warn('Password reset requested but SMTP is not configured - no email was sent. Set SMTP_HOST/SMTP_USER/SMTP_PASS.');
    }

    return res.json({
      success: true,
      message: 'If an account exists with that email, you will receive a password reset link.',
      // Dev-only convenience so a local run doesn't need a real mailbox to test the flow.
      ...(IS_DEV && { devResetUrl: resetUrl }),
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

// Reset password - actually reset the password with token
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Reset token is required' });
    }

    if (!password) {
      return res.status(400).json({ error: 'New password is required' });
    }

    // Validate password strength
    const passwordCheck = isStrongPassword(password);
    if (!passwordCheck.valid) {
      return res.status(400).json({ error: passwordCheck.message });
    }

    // Hash the provided token to compare with stored hash
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find valid reset token
    const tokenResult = await pool.query(
      `SELECT prt.id, prt.user_id, prt.expires_at, u.email, u.name
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token_hash = $1 AND prt.used_at IS NULL`,
      [tokenHash]
    );

    if (tokenResult.rows.length === 0) {
      logSecurityEvent({
        type: 'auth_failure',
        ip: req.ip || 'unknown',
        path: req.path,
        details: 'Invalid or expired password reset token',
      });
      return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
    }

    const resetToken = tokenResult.rows[0];

    // Check if token is expired
    if (new Date(resetToken.expires_at) < new Date()) {
      // Mark token as used
      await pool.query(
        'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1',
        [resetToken.id]
      );
      return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 12);

    // Update user's password. Stamping password_set_at here too matters for a Google
    // account that never had a real password - after this reset they do know one, so
    // change-password should start asking for it as their "current password".
    await pool.query(
      'UPDATE users SET password_hash = $1, password_set_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [passwordHash, resetToken.user_id]
    );

    // Mark token as used
    await pool.query(
      'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1',
      [resetToken.id]
    );

    // Clear any existing auth cookies
    clearSecureCookie(res, AUTH_COOKIE_NAME);

    console.log(`Password reset successful for user: ${resetToken.email}`);

    return res.json({
      success: true,
      message: 'Password reset successful. You can now log in with your new password.'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Verify reset token (check if it's valid before showing reset form)
router.get('/verify-reset-token', async (req: Request, res: Response) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ valid: false, error: 'Token is required' });
    }

    // Hash the provided token
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find valid reset token
    const tokenResult = await pool.query(
      `SELECT prt.expires_at, u.email
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token_hash = $1 AND prt.used_at IS NULL`,
      [tokenHash]
    );

    if (tokenResult.rows.length === 0) {
      return res.json({ valid: false, error: 'Invalid or already used reset link' });
    }

    const resetToken = tokenResult.rows[0];

    // Check if expired
    if (new Date(resetToken.expires_at) < new Date()) {
      return res.json({ valid: false, error: 'Reset link has expired' });
    }

    return res.json({
      valid: true,
      email: resetToken.email, // Show user which email they're resetting
    });
  } catch (error) {
    console.error('Verify reset token error:', error);
    return res.status(500).json({ valid: false, error: 'Failed to verify token' });
  }
});

export default router;
