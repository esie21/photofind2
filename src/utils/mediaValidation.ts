import { IMAGE_MIME_TYPES, MEDIA_MIME_TYPES, isVideoFile } from './media';

/**
 * Upload limits shared by the portfolio editor and the profile photo.
 *
 * These mirror the server's own rules (uploadService.MAX_FILE_SIZE, MAX_VIDEO_SIZE,
 * MEDIA_MIME_TYPES and users.ts MAX_PORTFOLIO_FILES). Checking here first means a
 * provider who picks thirty photos, a 25MB RAW export or a ten-minute clip is told
 * immediately, instead of waiting out a long upload only for the backend to reject
 * the entire batch.
 */
export const MAX_PORTFOLIO_IMAGES = 24;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_BATCH_BYTES = 250 * 1024 * 1024;
// Nothing enforces this server-side - the file is whatever length it is - but a
// portfolio is a showreel, not a feature. Capping it keeps both the upload and the
// client's eventual download honest, since nothing here transcodes.
export const MAX_VIDEO_SECONDS = 60;
export const ALLOWED_IMAGE_TYPES = IMAGE_MIME_TYPES;
export const ALLOWED_MEDIA_TYPES = MEDIA_MIME_TYPES;

/**
 * Returns an error message if these files can't be uploaded, or null if they can.
 *
 * `slotsLeft` is only meaningful for the portfolio; pass null for single uploads.
 * `allowVideo` is false for the profile photo, which is an image and nothing else.
 */
export function validateMediaFiles(
  files: File[],
  slotsLeft: number | null,
  allowVideo = true
): string | null {
  if (slotsLeft !== null && files.length > slotsLeft) {
    return slotsLeft === 0
      ? `You've reached the ${MAX_PORTFOLIO_IMAGES}-item limit. Remove one to add another.`
      : `You can add ${slotsLeft} more item${slotsLeft === 1 ? '' : 's'} - you selected ${files.length}.`;
  }

  const allowed = allowVideo ? ALLOWED_MEDIA_TYPES : ALLOWED_IMAGE_TYPES;
  const wrongType = files.find((f) => !allowed.includes(f.type) && !(allowVideo && isVideoFile(f)));
  if (wrongType) {
    return allowVideo
      ? `"${wrongType.name}" isn't a supported file. Use JPEG, PNG, GIF, WEBP, MP4, WEBM or MOV.`
      : `"${wrongType.name}" isn't a supported image. Use JPEG, PNG, GIF or WEBP.`;
  }

  const tooBig = files.find((f) => f.size > (isVideoFile(f) ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES));
  if (tooBig) {
    const limit = isVideoFile(tooBig) ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES;
    return `"${tooBig.name}" is larger than ${limit / 1024 / 1024}MB.`;
  }

  // Matches uploadService.MAX_REQUEST_SIZE - the server rejects the whole batch past
  // this, so catching it here saves sending the bytes first.
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_BATCH_BYTES) {
    return `That's ${Math.round(total / 1024 / 1024)}MB at once. Upload up to ${MAX_BATCH_BYTES / 1024 / 1024}MB per batch.`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Per-file checks for the portfolio uploader, which handles each file on its own so one
// bad file no longer sinks a whole batch. validateMediaFiles above stays for the profile
// photo, which is a single file anyway.
// ---------------------------------------------------------------------------------------

/** Photos bigger than this are re-encoded in the browser before upload (see compressPhoto). */
export const COMPRESS_ABOVE_BYTES = 3 * 1024 * 1024;
/**
 * The biggest photo worth trying to shrink. Decoding a 40MB image already takes a few
 * hundred MB of memory on a phone; past that a tab is likelier to crash than to succeed.
 */
export const MAX_COMPRESSIBLE_BYTES = 40 * 1024 * 1024;

/** 4718592 -> "4.5 MB", 524288 -> "512 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / 1024 / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

const mb = (bytes: number) => `${bytes / 1024 / 1024}MB`;

/** What is wrong with this file before any processing, or null. */
export function fileProblemBeforeProcessing(file: File): string | null {
  const isVideo = isVideoFile(file);
  if (!isVideo && !ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return 'Not a supported file. Use a photo (JPEG, PNG, WEBP or GIF) or a video (MP4, WEBM or MOV).';
  }
  if (isVideo && file.size > MAX_VIDEO_BYTES) {
    return `This video is ${formatBytes(file.size)}. Videos can be up to ${mb(MAX_VIDEO_BYTES)} - trim it, or export it at a lower resolution.`;
  }
  if (file.type === 'image/gif' && file.size > MAX_UPLOAD_BYTES) {
    return `This GIF is ${formatBytes(file.size)}. GIFs can be up to ${mb(MAX_UPLOAD_BYTES)}.`;
  }
  if (!isVideo && file.size > MAX_COMPRESSIBLE_BYTES) {
    return `This photo is ${formatBytes(file.size)}, too large to shrink here. Photos can be up to ${mb(MAX_COMPRESSIBLE_BYTES)}.`;
  }
  return null;
}

/** What is wrong with the file as it will actually be sent (after compression), or null. */
export function fileProblemAfterProcessing(file: File, compressed: boolean): string | null {
  if (isVideoFile(file) || file.size <= MAX_UPLOAD_BYTES) return null;
  return compressed
    ? `Still ${formatBytes(file.size)} after shrinking. Photos can be up to ${mb(MAX_UPLOAD_BYTES)}.`
    : `This photo is ${formatBytes(file.size)}. Photos can be up to ${mb(MAX_UPLOAD_BYTES)}.`;
}
