/**
 * Portfolio media helpers.
 *
 * A portfolio holds photos and video side by side, so nearly everything that renders one
 * needs to know which it is looking at, and video needs a still to show before it plays.
 *
 * There is no ffmpeg in this stack and adding one to the deployment image for a single
 * still frame would be a heavy dependency. The browser already has a video decoder, so
 * the poster is captured here at upload time and sent alongside - see generatePoster.
 */

export const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
export const MEDIA_MIME_TYPES = [...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES];

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov'];

/** Mirrors isVideoPath in backend/src/routes/users.ts. */
export function isVideoPath(path: string | null | undefined): boolean {
  const value = String(path || '').toLowerCase();
  // Strip any query string before looking at the extension.
  const clean = value.split('?')[0];
  return VIDEO_EXTENSIONS.some((ext) => clean.endsWith(ext));
}

export function isVideoFile(file: File): boolean {
  // Type first, filename as the fallback: some browsers hand over an empty type for a
  // .mov dragged in from the desktop.
  return VIDEO_MIME_TYPES.includes(file.type) || isVideoPath(file.name);
}

/** 95 -> "1:35". Used for the badge on a video thumbnail. */
export function formatDuration(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/** Resolves on the first of `event` or `error`, and rejects if neither arrives. */
function waitForEvent(el: HTMLMediaElement, event: string, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      el.removeEventListener(event, onDone);
      el.removeEventListener('error', onError);
      clearTimeout(timer);
    };
    const onDone = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error(`Could not read the video (${event})`)); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out reading the video')); }, timeoutMs);
    el.addEventListener(event, onDone);
    el.addEventListener('error', onError);
  });
}

/** Loads a video far enough to read its metadata, then throws the element away. */
async function withVideoElement<T>(file: File, fn: (video: HTMLVideoElement) => Promise<T>): Promise<T> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await waitForEvent(video, 'loadedmetadata');
    return await fn(video);
  } finally {
    // Release the decoder and the blob, or a batch of uploads leaves as many decoded
    // videos in memory as it had files.
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

export interface VideoDetails {
  duration: number;
  width: number;
  height: number;
}

/**
 * Reads a video's duration and dimensions without uploading it.
 *
 * Returns null when the browser can't decode the file at all - Chrome and Firefox
 * generally refuse .mov, for instance. That isn't a reason to block the upload; the
 * server accepts the file and other browsers will play it.
 */
export async function probeVideo(file: File): Promise<VideoDetails | null> {
  try {
    return await withVideoElement(file, async (video) => ({
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      width: video.videoWidth,
      height: video.videoHeight,
    }));
  } catch {
    return null;
  }
}

export interface PosterResult {
  poster: File;
  duration: number;
  width: number;
  height: number;
}

/** Longest edge of a generated poster. Enough for a full-bleed cover, small to upload. */
const POSTER_MAX_EDGE = 1280;

/**
 * Longest edge of a gallery thumbnail.
 *
 * The grids render tiles a few hundred pixels wide, but were being handed the
 * provider's originals - a 24-photo portfolio meant tens of megabytes fetched to draw
 * postage stamps. 600px covers a two-column phone layout and a retina tile alike.
 */
const THUMBNAIL_MAX_EDGE = 600;

export interface ThumbnailResult {
  thumb: File;
  /** Intrinsic size of the ORIGINAL, so a gallery can reserve the right space for it. */
  width: number;
  height: number;
}

/** Draws a source onto a canvas scaled to fit maxEdge, and encodes it as JPEG. */
async function encodeScaled(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxEdge: number,
  quality: number
): Promise<File | null> {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality)
  );
  return blob ? new File([blob], 'thumb.jpg', { type: 'image/jpeg' }) : null;
}

/**
 * Produces a small JPEG copy of an image, plus the original's intrinsic dimensions.
 *
 * Done in the browser for the same reason poster frames are: there is no image library
 * in the backend, and adding a native one to the deploy image to resize a few photos
 * would cost more than it saves. The original is uploaded untouched and is still what
 * the full-size viewer loads - this is only what the grids use.
 *
 * Returns null if the browser can't decode the file, in which case callers fall back to
 * the original and everything still works, just not as fast.
 */
export async function generateThumbnail(file: File): Promise<ThumbnailResult | null> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode the image'));
      el.src = url;
    });

    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) return null;

    const thumb = await encodeScaled(image, width, height, THUMBNAIL_MAX_EDGE, 0.75);
    if (!thumb) return null;

    // A tiny source would come back larger as a re-encoded JPEG than it started.
    if (thumb.size >= file.size) return { thumb: file, width, height };

    return { thumb, width, height };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Captures a still from a video to use as its thumbnail.
 *
 * Seeks a second in rather than using frame zero, which on most footage is a fade from
 * black and makes for a poster that shows nothing at all.
 *
 * Returns null on any failure - an unsupported codec, a blocked canvas, a browser that
 * won't seek. Callers fall back to `preload="metadata"`, which asks the browser to show
 * its own first frame.
 */
export async function generatePoster(file: File): Promise<PosterResult | null> {
  try {
    return await withVideoElement(file, async (video) => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const seekTo = duration > 2 ? 1 : duration / 2;

      if (seekTo > 0) {
        video.currentTime = seekTo;
        await waitForEvent(video, 'seeked');
      }

      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return null;

      const poster = await encodeScaled(video, width, height, POSTER_MAX_EDGE, 0.8);
      if (!poster) return null;

      // Dimensions come from the video itself, not the scaled poster, so a gallery can
      // reserve the clip's real shape.
      return { poster, duration, width, height };
    });
  } catch {
    return null;
  }
}

/** Longest edge of a compressed photo: sharp full-screen on a laptop, a fraction of the bytes. */
export const COMPRESSED_MAX_EDGE = 2560;
const COMPRESSED_QUALITY = 0.85;

export interface CompressedPhoto {
  file: File;
  /** False when the original was kept - too small to bother, a GIF, or nothing was saved. */
  compressed: boolean;
}

/** The same name with a new extension: "IMG_2041.HEIC.jpeg" -> "IMG_2041.HEIC.webp". */
function renameExtension(name: string, ext: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name || 'photo'}.${ext}`;
}

/**
 * Re-encodes a large photo as WebP (JPEG where the browser cannot write WebP), at most
 * COMPRESSED_MAX_EDGE on its longest side.
 *
 * Phone cameras produce 4-12MB photos, and the original was what the full-size viewer
 * loaded - slow on mobile data, which is how most clients here browse. Re-encoding also
 * drops the file's metadata, including any GPS location the camera stamped on it.
 *
 * The result is only used when it is actually smaller. GIFs are never touched, since
 * re-encoding would flatten an animation to its first frame. Any failure - a format this
 * browser cannot decode, a canvas it refuses to allocate - returns the original unchanged,
 * and the server's own size limit is then the judge.
 */
export async function compressPhoto(file: File): Promise<CompressedPhoto> {
  const unchanged = { file, compressed: false };
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return unchanged;

  let source: ImageBitmap | HTMLImageElement | null = null;
  let width = 0;
  let height = 0;
  let objectUrl = '';
  try {
    try {
      // from-image applies the camera's EXIF rotation, so portrait phone photos stay upright.
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      source = bitmap;
      width = bitmap.width;
      height = bitmap.height;
    } catch {
      objectUrl = URL.createObjectURL(file);
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Could not decode the image'));
        el.src = objectUrl;
      });
      source = image;
      width = image.naturalWidth;
      height = image.naturalHeight;
    }
    if (!width || !height) return unchanged;

    const scale = Math.min(1, COMPRESSED_MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return unchanged;

    for (const [type, ext] of [['image/webp', 'webp'], ['image/jpeg', 'jpg']] as const) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // JPEG has no transparency; without a background a transparent PNG turns black.
      if (type === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, COMPRESSED_QUALITY));
      // A browser that cannot write WebP hands back a PNG instead of failing; that is not
      // what was asked for, so move on to JPEG rather than keep it.
      if (!blob || blob.type !== type) continue;
      if (blob.size >= file.size) return unchanged;
      return {
        file: new File([blob], renameExtension(file.name, ext), { type, lastModified: file.lastModified }),
        compressed: true,
      };
    }
    return unchanged;
  } catch {
    return unchanged;
  } finally {
    if (source && 'close' in source) source.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
