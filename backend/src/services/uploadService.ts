import path from 'path';
import fs from 'fs';
import type { Request, Response, NextFunction } from 'express';

// Single home for the rules every upload path has to follow. They used to be duplicated
// (or absent) across users.ts, bookings.ts, chat.ts and support.ts, which is how the same
// two holes ended up in all four: a URL parameter interpolated straight into a filesystem
// path, and the file being written to disk before anyone checked whether the request was
// allowed.

export const UPLOADS_ROOT = path.resolve(__dirname, '../../../uploads');

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
// quicktime is here because that is what a .mov from an iPhone or a Mac announces
// itself as, and those are the files providers will actually try to upload.
export const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
export const MEDIA_MIME_TYPES = [...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES];
export const DOCUMENT_MIME_TYPES = [...IMAGE_MIME_TYPES, 'application/pdf'];
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB - images and documents
// Video needs its own ceiling; 10MB is a few seconds of phone footage. Multer only
// accepts a single per-file limit, so an upload that can carry video is configured with
// this one and enforceMediaSizeLimits below holds images to the smaller figure after
// the fact.
export const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB
/** Ceiling for one multi-file request, whatever the mix of types. */
export const MAX_REQUEST_SIZE = 250 * 1024 * 1024; // 250MB

export function isVideoMime(mimetype: string): boolean {
  return VIDEO_MIME_TYPES.includes(mimetype);
}

/** The ceiling that applies to one particular file. */
export function sizeLimitFor(mimetype: string): number {
  return isVideoMime(mimetype) ? MAX_VIDEO_SIZE : MAX_FILE_SIZE;
}

// The extension is derived from the allow-listed type, never from the uploaded filename.
// A file called "evil.html" sent as image/png is stored as .png, so it can never be
// served back as executable content.
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

export function extensionFor(mimetype: string): string {
  return EXTENSION_BY_MIME[mimetype] || '.bin';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A database created from database.sql keys these tables by uuid, but one that
// initializeTables built from nothing is SERIAL-keyed: it only chooses uuid when an
// existing users table already uses it, so a fresh deploy gets integers. Both shapes
// are supported by initializeTables, so both have to be accepted here - requiring a
// uuid rejected every upload on an integer-keyed database with 'Invalid identifier'.
const NUMERIC_ID_RE = /^[1-9][0-9]*$/;

/**
 * Guards a value that is about to become a directory name.
 *
 * Every id used this way is a primary key - a uuid or a positive integer depending on
 * how the deployment's database was created - so accepting exactly those two shapes
 * rejects traversal without excluding anything legitimate. Neither can contain a path
 * separator or a dot, which is the property that matters: Express decodes %2F in route
 * params, so without this a request to `/api/users/..%2F..%2Fx/upload/profile` writes
 * outside the uploads directory.
 */
export function safeSegment(value: unknown): string {
  const str = String(value ?? '').trim();
  if (!UUID_RE.test(str) && !NUMERIC_ID_RE.test(str)) {
    throw new Error('Invalid identifier');
  }
  return str;
}

/**
 * Joins segments onto a root and refuses to return anything that escapes it. Defence in
 * depth behind safeSegment - a stored path read back out of the database goes through
 * here too, so a poisoned row can't make us delete or read outside the uploads tree.
 */
export function resolveInsideRoot(root: string, ...segments: string[]): string {
  const resolved = path.resolve(root, ...segments);
  const normalisedRoot = path.resolve(root);
  if (resolved !== normalisedRoot && !resolved.startsWith(normalisedRoot + path.sep)) {
    throw new Error('Resolved path escapes the uploads directory');
  }
  return resolved;
}

export function generateFilename(mimetype: string, prefix = ''): string {
  const timestamp = Date.now();
  const random = Math.round(Math.random() * 1e9);
  return `${prefix}${timestamp}-${random}${extensionFor(mimetype)}`;
}

export function makeFileFilter(allowed: string[]) {
  return (_req: Request, file: Express.Multer.File, cb: any) => {
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed: ${allowed.join(', ')}`));
    }
  };
}

export const imageFileFilter = makeFileFilter(IMAGE_MIME_TYPES);
export const mediaFileFilter = makeFileFilter(MEDIA_MIME_TYPES);
export const documentFileFilter = makeFileFilter(DOCUMENT_MIME_TYPES);

export function deleteUploadSafe(filePath: string | null | undefined): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.warn('Failed to delete upload:', filePath, err);
  }
}

/** Deletes whatever multer attached to this request. Used on every refusal path. */
export function discardUploads(req: any): void {
  if (req?.file?.path) deleteUploadSafe(req.file.path);
  if (Array.isArray(req?.files)) {
    for (const f of req.files) deleteUploadSafe(f?.path);
  }
}

// Leading bytes for the types we accept. `file.mimetype` is just the Content-Type the
// client wrote on the part, so it proves nothing on its own - this checks the bytes that
// actually landed.
// ISO base media (MP4 and modern QuickTime alike) starts with a box length followed by
// the type 'ftyp' at offset 4. Matroska/WebM starts with the EBML magic number.
const isIsoBaseMedia = (b: Buffer) => b.slice(4, 8).toString('ascii') === 'ftyp';

const SIGNATURES: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/png', test: b => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', test: b => b.slice(0, 6).toString('ascii') === 'GIF87a' || b.slice(0, 6).toString('ascii') === 'GIF89a' },
  { mime: 'image/webp', test: b => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' },
  { mime: 'application/pdf', test: b => b.slice(0, 5).toString('ascii') === '%PDF-' },
  { mime: 'video/mp4', test: isIsoBaseMedia },
  { mime: 'video/quicktime', test: isIsoBaseMedia },
  { mime: 'video/webm', test: b => b.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
];

/** True when the file's leading bytes match the type it was uploaded as. */
export function contentMatchesType(filePath: string, mimetype: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    const sig = SIGNATURES.find(s => s.mime === mimetype);
    if (!sig) return false;
    return sig.test(buf);
  } catch {
    return false;
  }
}

/**
 * Express middleware: run AFTER multer, rejects anything whose bytes don't match the
 * declared type and deletes it. Catches "HTML served as image/png".
 */
export function verifyUploadedContent(req: any, res: Response, next: NextFunction) {
  const files: any[] = [];
  if (req.file) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files);

  for (const f of files) {
    if (!contentMatchesType(f.path, f.mimetype)) {
      discardUploads(req);
      return res.status(400).json({
        error: isVideoMime(f.mimetype)
          ? 'That file is not a valid video. Please upload a real MP4, WEBM or MOV.'
          : 'That file is not a valid image. Please upload a real JPEG, PNG, GIF or WEBP.',
      });
    }
  }
  return next();
}

/**
 * Express middleware: run AFTER multer on any upload that accepts both images and
 * video.
 *
 * Multer takes one fileSize limit for the whole request, so an uploader configured to
 * accept a 100MB video would also wave through a 100MB PNG. This applies the real
 * ceiling for each file's own type.
 */
export function enforceMediaSizeLimits(req: any, res: Response, next: NextFunction) {
  const files: any[] = [];
  if (req.file) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files);

  let total = 0;
  for (const f of files) {
    const limit = sizeLimitFor(f.mimetype);
    if (f.size > limit) {
      discardUploads(req);
      const kind = isVideoMime(f.mimetype) ? 'Videos' : 'Images';
      return res.status(400).json({
        error: `${kind} must be ${Math.round(limit / 1024 / 1024)}MB or smaller. "${f.originalname}" is larger than that.`,
      });
    }
    total += f.size;
  }

  // The per-file video ceiling multiplies: a request carrying the maximum number of
  // files at the maximum video size would land 2.4GB on the disk before any handler
  // saw it. This bounds one request as a whole.
  if (total > MAX_REQUEST_SIZE) {
    discardUploads(req);
    return res.status(400).json({
      error: `That's too much at once. Upload up to ${Math.round(MAX_REQUEST_SIZE / 1024 / 1024)}MB per batch.`,
    });
  }
  return next();
}

/**
 * Wraps a multer middleware so its errors become clean 400s instead of a generic 500,
 * and so nothing half-written survives a failure.
 *
 * `maxBytes` must match the `limits.fileSize` of the multer instance being wrapped.
 * Multer's LIMIT_FILE_SIZE error doesn't carry the limit that produced it, and this
 * used to name MAX_FILE_SIZE unconditionally - so the uploaders configured for video
 * (chat attachments and the portfolio, both MAX_VIDEO_SIZE) rejected a 60MB video with
 * "Maximum size is 10MB", a limit that was not the one being enforced.
 */
export function handleUpload(mw: any, maxBytes: number = MAX_FILE_SIZE) {
  return (req: any, res: Response, next: NextFunction) => {
    mw(req, res, (err: any) => {
      if (err) {
        discardUploads(req);
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: `File too large. Maximum size is ${Math.round(maxBytes / 1024 / 1024)}MB` });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ error: 'Too many files in one upload' });
        }
        return res.status(400).json({ error: err.message || 'Upload failed' });
      }
      return next();
    });
  };
}
