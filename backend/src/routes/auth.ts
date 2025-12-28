import express, { Router, Request, Response } from 'express';
import pool from '../config/database';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { isValidEmail, isStrongPassword, setSecureCookie, clearSecureCookie, logSecurityEvent } from '../middleware/security';

const router = Router();

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

export default router;
