import express, { Router, Request, Response } from 'express';
import pool from '../config/database';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = Router();

interface AuthRequest extends Request {
  body: {
    email: string;
    password: string;
    name?: string;
    role?: string;
  };
}

// Login endpoint
router.post('/login', async (req: AuthRequest, res: Response) => {
  try {
    const { email, password } = req.body;

    // Query user from database
    const result = await pool.query(
      'SELECT id, email, password_hash, role FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'your_secret_key'
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
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

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert new user
    const result = await pool.query(
      'INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, email, role',
      [email, name, passwordHash, role || 'client']
    );

    const user = result.rows[0];

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'your_secret_key'
    );

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name,
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
    // This would verify the token and return user info
    // Implementation depends on your auth middleware
    res.json({ message: 'Get current user' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user' });
  }
});

export default router;
