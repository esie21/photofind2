import { Play } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { getUploadUrl } from '../api/config';
import type { PortfolioImageMeta } from '../api/services/authService';
import { isVideoPath, formatDuration } from '../utils/media';

/**
 * A portfolio item is a photo or a video, and both the provider's editor and the public
 * gallery have to render either. Keeping that decision here means the two can't drift -
 * and there is exactly one place that knows a video needs a play badge.
 */

interface PortfolioMediaProps {
  /** Stored path of the item, e.g. "users/<id>/portfolio/123.mp4". */
  path: string;
  meta?: PortfolioImageMeta;
  alt: string;
}

/**
 * Still representation of one item, for a grid.
 *
 * Video shows the poster frame captured at upload. When there is none - the provider's
 * browser couldn't decode the file, or the upload predates posters - it falls back to a
 * <video preload="metadata">, which asks the viewer's browser for its own first frame
 * without fetching the whole file.
 */
export function PortfolioThumbnail({ path, meta, alt }: PortfolioMediaProps) {
  const isVideo = isVideoPath(path);
  // Grids render a small derived copy, never the original: a portfolio of 24 photos
  // meant tens of megabytes fetched to draw tiles a few hundred pixels wide. Items
  // uploaded before previews existed have neither, and fall back to the original.
  const source = isVideo ? meta?.poster : meta?.thumb || path;

  return (
    <>
      {source ? (
        <ImageWithFallback
          src={getUploadUrl(source)}
          alt={alt}
          loading="lazy"
          decoding="async"
          // Reserving the real shape stops the masonry columns reflowing as each photo
          // arrives. Only set when both are known, so a partial value can't distort it.
          {...(meta?.width && meta?.height ? { width: meta.width, height: meta.height } : {})}
        />
      ) : (
        <video src={getUploadUrl(path)} preload="metadata" muted playsInline />
      )}

      {isVideo && (
        <>
          <span className="portfolio-play" aria-hidden="true">
            <Play className="w-5 h-5" />
          </span>
          {meta?.duration ? (
            <span className="portfolio-duration">{formatDuration(meta.duration)}</span>
          ) : null}
        </>
      )}
    </>
  );
}

/**
 * Full-size representation, for a viewer.
 *
 * Video is never autoplayed: it is someone else's work opening over their profile, and
 * sound starting unbidden is the wrong first impression. `key` is the path so that
 * stepping to the next item tears the element down - a video left mounted would keep
 * playing behind the one now on screen.
 */
export function PortfolioPlayer({ path, meta, alt }: PortfolioMediaProps) {
  if (isVideoPath(path)) {
    return (
      <video
        key={path}
        src={getUploadUrl(path)}
        poster={meta?.poster ? getUploadUrl(meta.poster) : undefined}
        controls
        playsInline
        preload="metadata"
      />
    );
  }

  return <img key={path} src={getUploadUrl(path)} alt={alt} />;
}
