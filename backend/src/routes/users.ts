import { Router, Request, Response } from 'express';
import pool from '../config/database';
import { verifyToken, checkRole } from '../middleware/auth';
import multer from 'multer';
import { Request as ExpressRequest } from 'express';
import path from 'path';
import fs from 'fs';
import {
  UPLOADS_ROOT,
  MAX_FILE_SIZE,
  safeSegment,
  resolveInsideRoot,
  generateFilename,
  MAX_VIDEO_SIZE,
  imageFileFilter,
  mediaFileFilter,
  documentFileFilter,
  deleteUploadSafe,
  discardUploads,
  verifyUploadedContent,
  enforceMediaSizeLimits,
  handleUpload,
} from '../services/uploadService';
const router = Router();

// ==============================================
// UPLOAD CONFIGURATION
// ==============================================
// Path building, type checking and cleanup all live in uploadService so the four upload
// routes in this codebase can't drift apart again - see the comments there.

const MAX_PORTFOLIO_FILES = 24;
const MAX_VERIFICATION_FILES = 5;
const MAX_CAPTION_LENGTH = 140;
const MAX_ALBUM_LENGTH = 60;

/**
 * Per-item portfolio metadata, keyed by the stored path. See users.portfolio_meta.
 *
 * caption and album are the provider's to edit. Everything else describes the file -
 * a video's poster and duration, a photo's gallery thumbnail, the original's intrinsic
 * dimensions - and is written only by the preview endpoint. PUT /users/:id carries
 * those through untouched rather than accepting them from the client.
 */
interface PortfolioEntry {
  caption?: string;
  album?: string;
  poster?: string;
  duration?: number;
  thumb?: string;
  width?: number;
  height?: number;
}

type PortfolioMeta = Record<string, PortfolioEntry>;

// Every SELECT that returns a user to the owner or an admin. Kept in one place because
// there are five of them, and a column added to only four is how a field ends up
// mysteriously undefined on exactly one screen.
const USER_COLUMNS =
  'id, email, name, role, profile_image, portfolio_images, portfolio_meta, bio, years_experience, location, category, title, is_verified, verification_status, verification_documents';

// Stored image paths are relative to the uploads root ("users/<id>/avatar/x.png").
// Clients that post back a *display* URL instead ("/uploads/users/...") used to have it
// stored verbatim, and since the profile form re-sent whatever it was given, each save
// prepended another "/uploads/" until the image 404'd. Normalise on the way in so a
// stale client can't corrupt the column.
const normaliseStoredPath = (value: unknown): string => {
  let v = String(value ?? '').trim();
  if (!v) return v;
  if (/^https?:\/\//i.test(v)) {
    const at = v.indexOf('/uploads/');
    if (at === -1) return v; // genuinely external (Google avatar, Unsplash, ...)
    v = v.slice(at);
  }
  // strip any number of leading "/uploads/" segments
  v = v.replace(/^\/+/, '');
  while (/^uploads\//i.test(v)) v = v.replace(/^uploads\//i, '');
  return v;
};

// Authorization runs BEFORE multer in every chain below. Previously the file was written
// to disk by the multer middleware and only then did the handler check ownership, so a
// refused upload still left the attacker's file sitting in the victim's folder.
const requireSelfOrAdmin = (req: any, res: Response, next: any) => {
  let userId: string;
  try {
    userId = safeSegment(req.params.id);
  } catch {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  if (String(req.userId) !== String(userId) && req.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized to update this profile' });
  }
  return next();
};

const makeUserStorage = (folderOf: (file: Express.Multer.File) => string, prefix: string) =>
  multer.diskStorage({
    destination: (req: ExpressRequest, file: any, cb: (e: any, p: string) => void) => {
      try {
        // safeSegment rejects anything that isn't a UUID, and resolveInsideRoot refuses a
        // result outside the uploads tree. Without these, '..%2F..' in the URL escaped it.
        const userId = safeSegment((req as any).params.id);
        const uploadPath = resolveInsideRoot(UPLOADS_ROOT, 'users', userId, folderOf(file));
        fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
      } catch (e) {
        cb(e as Error, '');
      }
    },
    filename: (_req: ExpressRequest, file: any, cb: (e: any, p: string) => void) => {
      cb(null, generateFilename(file.mimetype, prefix));
    },
  });

// A profile photo is an image and nothing else, so it keeps the strict filter and the
// small ceiling. The portfolio is the only place video is accepted.
const upload = multer({
  storage: makeUserStorage(() => 'avatar', ''),
  fileFilter: imageFileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
});

const uploadPortfolio = multer({
  storage: makeUserStorage(() => 'portfolio', ''),
  fileFilter: mediaFileFilter,
  // The larger of the two limits, because multer only takes one; enforceMediaSizeLimits
  // then holds images to MAX_FILE_SIZE.
  limits: { fileSize: MAX_VIDEO_SIZE, files: MAX_PORTFOLIO_FILES },
});

// Previews - a video's poster frame, a photo's gallery thumbnail - are generated in the
// browser and uploaded separately, because there is neither ffmpeg nor an image library
// in this stack to derive them here.
const uploadPreview = multer({
  storage: makeUserStorage(() => 'previews', 'preview-'),
  fileFilter: imageFileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
});

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov'];
export const isVideoPath = (value: string) =>
  VIDEO_EXTENSIONS.includes(path.extname(String(value || '')).toLowerCase());

const uploadVerification = multer({
  storage: makeUserStorage(() => 'verification', 'doc-'),
  fileFilter: documentFileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_VERIFICATION_FILES },
});

// Get all users - admin only
router.get('/', verifyToken, checkRole('admin'), async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`SELECT ${USER_COLUMNS}, created_at FROM users`);
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

    const result = await pool.query(`SELECT ${USER_COLUMNS}, created_at FROM users WHERE id = $1`, [userId]);
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

    const { name, bio, years_experience, location, category, title, profile_image, portfolio_images, portfolio_meta } = req.body;

    // Validate before touching the database. Without this, values that simply don't fit
    // the column (a name over 100 chars, a location over 255, a years_experience outside
    // int range) made Postgres throw and surfaced as a generic 500 - which the profile
    // form swallowed, so Save looked like it did nothing. Meanwhile an empty name or a
    // negative years_experience sailed through and were stored as-is.
    const LIMITS: Record<string, number> = { name: 100, location: 255, title: 255, category: 100, bio: 5000 };
    const tooLong = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > max;

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Name is required' });
      }
      if (tooLong(name, LIMITS.name)) {
        return res.status(400).json({ error: `Name must be ${LIMITS.name} characters or fewer` });
      }
    }
    for (const [field, value] of Object.entries({ location, title, category, bio })) {
      if (value !== undefined && value !== null) {
        if (typeof value !== 'string') {
          return res.status(400).json({ error: `${field} must be text` });
        }
        if (tooLong(value, LIMITS[field])) {
          return res.status(400).json({ error: `${field} must be ${LIMITS[field]} characters or fewer` });
        }
      }
    }
    if (years_experience !== undefined && years_experience !== null && years_experience !== '') {
      const years = Number(years_experience);
      if (!Number.isInteger(years) || years < 0 || years > 80) {
        return res.status(400).json({ error: 'Years of experience must be a whole number between 0 and 80' });
      }
    }
    if (portfolio_images !== undefined && portfolio_images !== null && !Array.isArray(portfolio_images)) {
      return res.status(400).json({ error: 'portfolio_images must be an array' });
    }

    // Captions and albums arrive as a path -> { caption, album } map. Validate every
    // entry rather than trusting the shape: this lands in a JSONB column that both the
    // dashboard and the public profile render.
    let incomingMeta: PortfolioMeta | undefined;
    if (portfolio_meta !== undefined && portfolio_meta !== null) {
      if (typeof portfolio_meta !== 'object' || Array.isArray(portfolio_meta)) {
        return res.status(400).json({ error: 'portfolio_meta must be an object' });
      }
      const entries = Object.entries(portfolio_meta as Record<string, any>);
      if (entries.length > MAX_PORTFOLIO_FILES) {
        return res.status(400).json({ error: `portfolio_meta cannot describe more than ${MAX_PORTFOLIO_FILES} images` });
      }
      incomingMeta = {};
      for (const [key, value] of entries) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return res.status(400).json({ error: 'Each portfolio_meta entry must be an object' });
        }
        const caption = value.caption == null ? '' : String(value.caption).trim();
        const album = value.album == null ? '' : String(value.album).trim();
        if (caption.length > MAX_CAPTION_LENGTH) {
          return res.status(400).json({ error: `Captions must be ${MAX_CAPTION_LENGTH} characters or fewer` });
        }
        if (album.length > MAX_ALBUM_LENGTH) {
          return res.status(400).json({ error: `Album names must be ${MAX_ALBUM_LENGTH} characters or fewer` });
        }
        // An entry with neither is just noise - don't persist it.
        if (!caption && !album) continue;
        incomingMeta[normaliseStoredPath(key)] = {
          ...(caption ? { caption } : {}),
          ...(album ? { album } : {}),
        };
      }
    }

    // Read the current portfolio up front. It is needed for knowing which files are
    // about to become orphans, for keeping metadata in step with the items that still
    // exist, and for carrying poster frames through - all before the UPDATE is built.
    let droppedImages: string[] = [];
    let droppedPosters: string[] = [];
    let metaToWrite: PortfolioMeta | undefined;

    if (Array.isArray(portfolio_images) || incomingMeta !== undefined) {
      const before = await pool.query(
        'SELECT portfolio_images, portfolio_meta FROM users WHERE id = $1',
        [userId]
      );
      const previousImages: string[] = before.rows[0]?.portfolio_images || [];
      const previousMeta: PortfolioMeta = before.rows[0]?.portfolio_meta || {};

      // Whether the client sent metadata or not, what gets stored is pruned to the items
      // that remain. Otherwise a caption for a deleted photo would sit in the column
      // indefinitely and reattach itself if that path were ever reused.
      const source: PortfolioMeta = incomingMeta ?? previousMeta;
      const keeping = Array.isArray(portfolio_images)
        ? new Set(portfolio_images.map((v: any) => normaliseStoredPath(v)))
        : null;

      metaToWrite = {};
      const paths = new Set([...Object.keys(source), ...Object.keys(previousMeta)]);
      for (const key of paths) {
        const path = normaliseStoredPath(key);
        if (keeping && !keeping.has(path)) continue;

        const submitted = source[key] || source[path] || {};
        const held = previousMeta[key] || previousMeta[path] || {};
        const entry: PortfolioEntry = {
          ...(submitted.caption ? { caption: submitted.caption } : {}),
          ...(submitted.album ? { album: submitted.album } : {}),
          // Everything below is written by the preview endpoint, which validates the file
          // and the path it belongs to. A profile save must not be able to set, change
          // or - as it previously would have - silently drop them.
          ...(held.poster ? { poster: held.poster } : {}),
          ...(held.duration ? { duration: held.duration } : {}),
          ...(held.thumb ? { thumb: held.thumb } : {}),
          ...(held.width && held.height ? { width: held.width, height: held.height } : {}),
        };
        if (Object.keys(entry).length > 0) metaToWrite[path] = entry;
      }

      if (Array.isArray(portfolio_images)) {
        // Removing an item used to only rewrite this column, leaving the file on disk
        // forever - uploads grew but never shrank.
        droppedImages = previousImages.filter(img => !keeping!.has(normaliseStoredPath(img)));
        // A removed item's derived files - poster frame, thumbnail - are just as
        // orphaned as the original.
        droppedPosters = droppedImages.flatMap((img) => {
          const held = previousMeta[normaliseStoredPath(img)] || {};
          return [held.poster, held.thumb].filter((p): p is string => !!p);
        });
      }
    }

    // Build dynamic update
    const updates = [] as string[];
    const values: any[] = [];
    let idx = 1;

    if (name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(name.trim());
    }
    if (bio !== undefined) {
      updates.push(`bio = $${idx++}`);
      values.push(bio === null ? null : String(bio).trim());
    }
    if (years_experience !== undefined) {
      updates.push(`years_experience = $${idx++}`);
      // '' from an emptied number input means "not set", not 0.
      values.push(
        years_experience === null || years_experience === '' ? null : Number(years_experience)
      );
    }
    if (location !== undefined) {
      updates.push(`location = $${idx++}`);
      values.push(location === null ? null : String(location).trim());
    }
    if (profile_image !== undefined) {
      updates.push(`profile_image = $${idx++}`);
      values.push(profile_image === null ? null : normaliseStoredPath(profile_image));
    }
    if (portfolio_images !== undefined) {
      updates.push(`portfolio_images = $${idx++}`);
      values.push(
        Array.isArray(portfolio_images) ? portfolio_images.map(normaliseStoredPath) : portfolio_images
      );
    }
    if (metaToWrite !== undefined) {
      updates.push(`portfolio_meta = $${idx++}`);
      values.push(JSON.stringify(metaToWrite));
    }
    if (category !== undefined) {
      updates.push(`category = $${idx++}`);
      values.push(category === null ? null : String(category).trim());
    }
    if (title !== undefined) {
      updates.push(`title = $${idx++}`);
      values.push(title === null ? null : String(title).trim());
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    const sql = `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${idx} RETURNING ${USER_COLUMNS}`;
    values.push(userId);

    const result = await pool.query(sql, values);

    for (const img of [...droppedImages, ...droppedPosters]) {
      try {
        deleteUploadSafe(resolveInsideRoot(UPLOADS_ROOT, img));
      } catch {
        console.warn('Refusing to delete a stored path outside uploads:', img);
      }
    }

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
router.post('/:id/upload/profile',
  verifyToken,
  requireSelfOrAdmin,
  handleUpload(upload.single('profile')),
  verifyUploadedContent,
  async (req: any, res: Response) => {
  try {
    const userId = req.params.id;

    // Verify user owns this profile
    if (String(req.userId) !== String(userId) && req.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to update this profile' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Get old profile image to delete
    const oldResult = await pool.query('SELECT profile_image FROM users WHERE id = $1', [userId]);
    const oldImagePath = oldResult.rows[0]?.profile_image;

    // Delete old profile image if it exists
    if (oldImagePath) {
      try {
        deleteUploadSafe(resolveInsideRoot(UPLOADS_ROOT, oldImagePath));
      } catch {
        console.warn('Refusing to delete a stored path outside uploads:', oldImagePath);
      }
    }

    // Save new profile image path (relative)
    const profileImagePath = `users/${userId}/avatar/${req.file.filename}`;

    await pool.query(
      'UPDATE users SET profile_image = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [profileImagePath, userId]
    );

    const result = await pool.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
      [userId]
    );

    console.log('Profile image uploaded:', profileImagePath);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Upload profile error', err);
    res.status(500).json({ error: 'Failed to upload profile image' });
  }
});


// Portfolio upload endpoint
router.post('/:id/upload/portfolio',
  verifyToken,
  requireSelfOrAdmin,
  handleUpload(uploadPortfolio.array('images', MAX_PORTFOLIO_FILES)),
  verifyUploadedContent,
  enforceMediaSizeLimits,
  async (req: any, res: Response) => {
  try {
    const userId = req.params.id;

    // Verify user owns this profile
    if (String(req.userId) !== String(userId) && req.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to update this profile' });
    }

    const files = req.files as any[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const urls = files.map(f => `users/${userId}/portfolio/${f.filename}`);

    // Append to existing portfolio_images
    const existingRes = await pool.query('SELECT portfolio_images FROM users WHERE id = $1', [userId]);
    const existing: string[] = existingRes.rows[0]?.portfolio_images || [];
    const newArr = [...existing, ...urls];

    // Check total count doesn't exceed limit
    if (newArr.length > MAX_PORTFOLIO_FILES) {
      // Delete the just-uploaded files since we're rejecting
      files.forEach(f => deleteUploadSafe(f.path));
      return res.status(400).json({
        error: `Portfolio limit exceeded. Maximum ${MAX_PORTFOLIO_FILES} images allowed. You have ${existing.length}.`
      });
    }

    await pool.query('UPDATE users SET portfolio_images = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newArr, userId]);

    const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [userId]);

    console.log('Portfolio images uploaded:', urls.length, 'files');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Upload portfolio error', err);
    res.status(500).json({ error: 'Failed to upload portfolio images' });
  }
});

// Derived preview image for a portfolio item: a video's poster frame, or a photo's
// gallery-sized thumbnail.
//
// Both are produced in the browser - there is no image or video library in this backend
// - and both are sent as their own request naming the item they belong to. Riding along
// with the original upload and pairing by position would silently attach the wrong
// preview to the wrong item the moment one file failed its checks.
router.post('/:id/upload/portfolio-preview',
  verifyToken,
  requireSelfOrAdmin,
  handleUpload(uploadPreview.single('preview')),
  verifyUploadedContent,
  async (req: any, res: Response) => {
  try {
    const userId = req.params.id;

    if (!req.file) {
      return res.status(400).json({ error: 'No preview uploaded' });
    }

    const kind = String(req.body?.kind || '');
    if (kind !== 'poster' && kind !== 'thumb') {
      discardUploads(req);
      return res.status(400).json({ error: "kind must be 'poster' or 'thumb'" });
    }

    const target = normaliseStoredPath(req.body?.target);
    if (!target) {
      discardUploads(req);
      return res.status(400).json({ error: 'Which portfolio item this belongs to must be given' });
    }

    const existing = await pool.query(
      'SELECT portfolio_images, portfolio_meta FROM users WHERE id = $1',
      [userId]
    );
    const images: string[] = existing.rows[0]?.portfolio_images || [];

    // The target has to be one of this user's own portfolio entries. Without the check,
    // any authenticated user could write an arbitrary path into their metadata and have
    // it rendered against their profile.
    if (!images.some((img) => normaliseStoredPath(img) === target)) {
      discardUploads(req);
      return res.status(404).json({ error: 'That item is not in your portfolio' });
    }
    if (kind === 'poster' && !isVideoPath(target)) {
      discardUploads(req);
      return res.status(400).json({ error: 'Only videos have poster frames' });
    }

    const meta: PortfolioMeta = existing.rows[0]?.portfolio_meta || {};
    const entry = meta[target] || {};
    const replaced = kind === 'poster' ? entry.poster : entry.thumb;

    // Duration and dimensions are only ever used for a badge and for reserving layout
    // space, but they still come off the wire, so they are range-checked rather than
    // stored as given.
    const inRange = (value: unknown, max: number) => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 && n < max ? Math.round(n) : undefined;
    };
    const duration = inRange(req.body?.duration, 86400);
    const width = inRange(req.body?.width, 100000);
    const height = inRange(req.body?.height, 100000);

    const storedPath = `users/${userId}/previews/${req.file.filename}`;
    meta[target] = {
      ...entry,
      ...(kind === 'poster' ? { poster: storedPath } : { thumb: storedPath }),
      ...(duration ? { duration } : {}),
      ...(width && height ? { width, height } : {}),
    };

    await pool.query(
      'UPDATE users SET portfolio_meta = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [JSON.stringify(meta), userId]
    );

    // Replacing a preview leaves the old file on disk otherwise.
    if (replaced && replaced !== storedPath) {
      try {
        deleteUploadSafe(resolveInsideRoot(UPLOADS_ROOT, replaced));
      } catch {
        console.warn('Refusing to delete a stored path outside uploads:', replaced);
      }
    }

    const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [userId]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Upload portfolio preview error', err);
    discardUploads(req);
    res.status(500).json({ error: 'Failed to upload preview image' });
  }
});

// Verification documents upload endpoint (ID, business permit, etc.)
router.post('/:id/upload/verification',
  verifyToken,
  requireSelfOrAdmin,
  handleUpload(uploadVerification.array('documents', MAX_VERIFICATION_FILES)),
  verifyUploadedContent,
  async (req: any, res: Response) => {
  try {
    const userId = req.params.id;

    // Verify user owns this profile
    if (String(req.userId) !== String(userId) && req.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to update this profile' });
    }

    const files = req.files as any[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const newDocs = files.map(f => ({
      path: `users/${userId}/verification/${f.filename}`,
      original_name: f.originalname,
      uploaded_at: new Date().toISOString(),
    }));

    const existingRes = await pool.query('SELECT verification_documents FROM users WHERE id = $1', [userId]);
    const existingRaw = existingRes.rows[0]?.verification_documents;
    const existing = Array.isArray(existingRaw) ? existingRaw : [];
    const combined = [...existing, ...newDocs];

    if (combined.length > MAX_VERIFICATION_FILES) {
      files.forEach(f => deleteUploadSafe(f.path));
      return res.status(400).json({
        error: `Document limit exceeded. Maximum ${MAX_VERIFICATION_FILES} files allowed. You have ${existing.length}.`
      });
    }

    // Submitting documents (re)starts review - this covers both the first submission
    // and resubmission after a rejection, so the provider isn't stuck once rejected.
    await pool.query(
      `UPDATE users SET verification_documents = $1, verification_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [JSON.stringify(combined), userId]
    );

    const result = await pool.query(
      'SELECT id, verification_status, verification_documents FROM users WHERE id = $1',
      [userId]
    );

    console.log('Verification documents uploaded:', newDocs.length, 'files');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Upload verification documents error', err);
    res.status(500).json({ error: 'Failed to upload verification documents' });
  }
});

// Delete a specific portfolio image
router.delete('/:id/portfolio/:imagePath(*)', verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.params.id;
    const imagePath = req.params.imagePath;

    // Verify user owns this profile
    if (String(req.userId) !== String(userId) && req.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to update this profile' });
    }

    // Get current portfolio images
    const result = await pool.query('SELECT portfolio_images FROM users WHERE id = $1', [userId]);
    const existing: string[] = result.rows[0]?.portfolio_images || [];

    // Find and remove the image
    const fullPath = `users/${userId}/portfolio/${imagePath}`;
    const newArr = existing.filter(img => img !== fullPath && img !== imagePath);

    if (newArr.length === existing.length) {
      return res.status(404).json({ error: 'Image not found in portfolio' });
    }

    // Delete from filesystem
    try {
      deleteUploadSafe(resolveInsideRoot(UPLOADS_ROOT, fullPath));
    } catch {
      console.warn('Refusing to delete a stored path outside uploads:', fullPath);
    }

    // Update database
    await pool.query('UPDATE users SET portfolio_images = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newArr, userId]);

    console.log('Portfolio image deleted:', fullPath);
    res.json({ success: true, portfolio_images: newArr });
  } catch (err) {
    console.error('Delete portfolio image error', err);
    res.status(500).json({ error: 'Failed to delete portfolio image' });
  }
});

export default router;
