import express, { Router, Request, Response } from 'express';
import pool from '../config/database';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { isValidEmail, isStrongPassword, setSecureCookie, clearSecureCookie, logSecurityEvent, passwordResetLimiter } from '../middleware/security';

const router = Router();

// Email service configuration (using environment variables)
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || 'noreply@photofind.com';

interface AuthRequest extends Request {
  body: {
    email: string;
    password: string;
    name?: string;
    role?: string;
  };
}

// Token cookie name
const AUTH_COOKIE_NAME = 'auth_token';

// Login endpoint
router.post('/login', async (req: AuthRequest, res: Response) => {
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
      'SELECT id, email, password_hash, role, name FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
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

    // Generate JWT token with secure claims
    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role,
        iat: Math.floor(Date.now() / 1000),
      },
      process.env.JWT_SECRET || 'your_secret_key',
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
    const { email, password, name, role } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name required' });
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

    // Insert new user (parameterized query - SQL injection safe)
    const result = await pool.query(
      'INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, email, role, name',
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
      process.env.JWT_SECRET || 'your_secret_key',
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
      process.env.JWT_SECRET || 'your_secret_key'
    );

    const result = await pool.query(
      'SELECT id, email, name, role, profile_image, portfolio_images, bio, years_experience, location FROM users WHERE id = $1',
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
      'SELECT id, email, name FROM users WHERE LOWER(email) = LOWER($1)',
      [email.trim()]
    );

    // Always return success to prevent email enumeration attacks
    if (userResult.rows.length === 0) {
      console.log(`Password reset requested for non-existent email: ${email}`);
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
    } else {
      // Log the reset URL for development
      console.log(`[DEV] Password reset URL for ${user.email}: ${resetUrl}`);
    }

    return res.json({
      success: true,
      message: 'If an account exists with that email, you will receive a password reset link.',
      // Include token in dev mode for testing
      ...(process.env.NODE_ENV !== 'production' && { devResetUrl: resetUrl }),
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

    // Update user's password
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
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
