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
export const DOCUMENT_MIME_TYPES = [...IMAGE_MIME_TYPES, 'application/pdf'];
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// The extension is derived from the allow-listed type, never from the uploaded filename.
// A file called "evil.html" sent as image/png is stored as .png, so it can never be
// served back as executable content.
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

export function extensionFor(mimetype: string): string {
  return EXTENSION_BY_MIME[mimetype] || '.bin';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guards a value that is about to become a directory name.
 *
 * Every id used this way is a uuid column (users, bookings, support_tickets, chats), so
 * requiring a well-formed UUID rejects traversal without excluding anything legitimate.
 * Express decodes %2F in route params, so without this a request to
 * `/api/users/..%2F..%2Fx/upload/profile` writes outside the uploads directory.
 */
export function safeSegment(value: unknown): string {
  const str = String(value ?? '').trim();
  if (!UUID_RE.test(str)) {
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
const SIGNATURES: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/png', test: b => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', test: b => b.slice(0, 6).toString('ascii') === 'GIF87a' || b.slice(0, 6).toString('ascii') === 'GIF89a' },
  { mime: 'image/webp', test: b => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' },
  { mime: 'application/pdf', test: b => b.slice(0, 5).toString('ascii') === '%PDF-' },
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
        error: 'That file is not a valid image. Please upload a real JPEG, PNG, GIF or WEBP.',
      });
    }
  }
  return next();
}

/**
 * Wraps a multer middleware so its errors become clean 400s instead of a generic 500,
 * and so nothing half-written survives a failure.
 */
export function handleUpload(mw: any) {
  return (req: any, res: Response, next: NextFunction) => {
    mw(req, res, (err: any) => {
      if (err) {
        discardUploads(req);
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` });
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
