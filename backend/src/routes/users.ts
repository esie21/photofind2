import { Router, Request, Response } from 'express';
import pool from '../config/database';
import { verifyToken, checkRole } from '../middleware/auth';
import multer from 'multer';
import { Request as ExpressRequest } from 'express';
import path from 'path';
import fs from 'fs';
const router = Router();

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req: ExpressRequest, file: any, cb: (e: any, p: string) => void) => {
    const userId = (req as any).params.id; // get user id from URL
    const folderType = file.fieldname === 'profile' ? 'avatar' : 'portfolio';
    const uploadPath = path.resolve(__dirname, `../../uploads/users/${userId}/${folderType}`);

    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req: ExpressRequest, file: any, cb: (e: any, p: string) => void) => {
    const ext = path.extname(file.originalname);
    if (file.fieldname === 'profile') {
      cb(null, 'avatar.webp'); // single profile image per user
    } else {
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`); // portfolio images
    }
  },
});


const upload = multer({ storage });

// Get all users - admin only
router.get('/', verifyToken, checkRole('admin'), async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT id, email, name, role, profile_image, portfolio_images, bio, years_experience, location, created_at FROM users');
    res.json(result.rows);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

// Get user by id - owner or admin
router.get('/:id', verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.params.id as string;
    if (String(req.userId) !== userId && req.role !== 'admin') {
      console.warn('Permission denied (GET /users/:id):', { reqUserId: req.userId, targetId: userId, role: req.role });
      return res.status(403).json({ error: 'Insufficient permissions', debug: process.env.NODE_ENV !== 'production' ? { reqUserId: req.userId, targetId: userId, role: req.role } : undefined });
    }

    const result = await pool.query('SELECT id, email, name, role, profile_image, portfolio_images, bio, years_experience, location, created_at FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to retrieve user' });
  }
});

// Update user - owner or admin
router.put('/:id', verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.params.id as string;
    if (String(req.userId) !== userId && req.role !== 'admin') {
      console.warn('Permission denied (PUT /users/:id):', { reqUserId: req.userId, targetId: userId, role: req.role });
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { name, bio, years_experience, location, profile_image, portfolio_images } = req.body;
    console.log('Update user payload', { reqUserId: req.userId, targetId: userId, payload: { name, bio, years_experience, location, profile_image, portfolio_images } });

    // Build dynamic update
    const updates = [] as string[];
    const values: any[] = [];
    let idx = 1;

    if (name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(name);
    }
    if (bio !== undefined) {
      updates.push(`bio = $${idx++}`);
      values.push(bio);
    }
    if (years_experience !== undefined) {
      updates.push(`years_experience = $${idx++}`);
      values.push(years_experience);
    }
    if (location !== undefined) {
      updates.push(`location = $${idx++}`);
      values.push(location);
    }
    if (profile_image !== undefined) {
      updates.push(`profile_image = $${idx++}`);
      values.push(profile_image);
    }
    if (portfolio_images !== undefined) {
      updates.push(`portfolio_images = $${idx++}`);
      values.push(portfolio_images);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    const sql = `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${idx} RETURNING id, email, name, role, profile_image, portfolio_images, bio, years_experience, location`;
    values.push(userId);

    console.log('Executing SQL', { sql, values });
    const result = await pool.query(sql, values);
    console.log('SQL result for update', result.rows[0]);
      // return result including new fields
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user - admin only
router.delete('/:id', verifyToken, checkRole('admin'), async (req: any, res: Response) => {
  try {
    const userId = req.params.id as string;
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// export default must be after all routes are declared

// Profile image upload endpoint
router.post('/:id/upload/profile', verifyToken, upload.single('profile'), async (req: any, res: Response) => {
  try {
    const userId = req.params.id;

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const profileImagePath = `users/${userId}/avatar/${req.file.filename}`; // relative path

    await pool.query(
      'UPDATE users SET profile_image = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [profileImagePath, userId]
    );

    const result = await pool.query(
      'SELECT id, email, name, role, profile_image, portfolio_images, bio, years_experience, location FROM users WHERE id = $1',
      [userId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Upload profile error', err);
    res.status(500).json({ error: 'Failed to upload profile image' });
  }
});


// Portfolio upload endpoint
router.post('/:id/upload/portfolio', verifyToken, upload.array('images', 24), async (req: any, res: Response) => {
  try {
    const userId = req.params.id;
    const files = req.files as any[];

    if (!files || files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    const urls = files.map(f => `users/${userId}/portfolio/${f.filename}`); // relative paths

    // Append to existing portfolio_images
    const existingRes = await pool.query('SELECT portfolio_images FROM users WHERE id = $1', [userId]);
    const existing: string[] = existingRes.rows[0]?.portfolio_images || [];
    const newArr = [...existing, ...urls];

    await pool.query('UPDATE users SET portfolio_images = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newArr, userId]);

    const result = await pool.query('SELECT id, email, name, role, profile_image, portfolio_images, bio, years_experience, location FROM users WHERE id = $1', [userId]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Upload portfolio error', err);
    res.status(500).json({ error: 'Failed to upload portfolio images' });
  }
});


export default router;
