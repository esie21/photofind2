import { AlertCircle, CheckCircle, Film, Image as ImageIcon, Loader2 } from 'lucide-react';
import { formatBytes } from '../utils/mediaValidation';

/**
 * One row per file in an upload, each with its own progress and its own outcome.
 *
 * The uploader used to send a batch as one request with one progress bar, and the server
 * rejected the whole batch if any file failed its checks - so one oversized photo, or one
 * clip a few seconds too long, meant none of the other nineteen arrived either, and the
 * message named only the first problem it found. Files now go up one at a time, and this
 * shows where each one is and, if it failed, exactly why.
 */

export type UploadStatus = 'waiting' | 'preparing' | 'uploading' | 'done' | 'failed';

export interface UploadItem {
  id: string;
  name: string;
  isVideo: boolean;
  originalSize: number;
  /** Size actually sent, once known - smaller than originalSize when compressed. */
  sentSize?: number;
  compressed?: boolean;
  status: UploadStatus;
  /** 0-100, while uploading. */
  progress: number;
  error?: string;
}

const STATUS_TEXT: Record<UploadStatus, string> = {
  waiting: 'Waiting',
  preparing: 'Preparing',
  uploading: 'Uploading',
  done: 'Added',
  failed: 'Not added',
};

interface PortfolioUploadListProps {
  items: UploadItem[];
  /** Shown once nothing is still in progress, to clear the list. */
  onDismiss: () => void;
}

export function PortfolioUploadList({ items, onDismiss }: PortfolioUploadListProps) {
  if (items.length === 0) return null;
  const active = items.some((item) => ['waiting', 'preparing', 'uploading'].includes(item.status));
  const done = items.filter((item) => item.status === 'done').length;
  const failed = items.filter((item) => item.status === 'failed').length;

  return (
    <div className="pf-uploads">
      <div className="pf-uploads__head">
        {/* Polite and summary-only: announcing every percent would drown a screen reader. */}
        <p className="pf-uploads__summary" aria-live="polite">
          {active
            ? `Adding ${items.length} file${items.length === 1 ? '' : 's'}: ${done} done${failed ? `, ${failed} not added` : ''}`
            : failed
              ? `${done} added, ${failed} not added`
              : `${done} file${done === 1 ? '' : 's'} added`}
        </p>
        {!active && (
          <button type="button" className="pf-link-button" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>

      <ul className="pf-uploads__list">
        {items.map((item) => (
          <li key={item.id} className={`pf-upload pf-upload--${item.status}`}>
            <span className="pf-upload__icon" aria-hidden="true">
              {item.status === 'done' ? (
                <CheckCircle className="w-4 h-4" />
              ) : item.status === 'failed' ? (
                <AlertCircle className="w-4 h-4" />
              ) : item.status === 'preparing' || item.status === 'uploading' ? (
                <Loader2 className="w-4 h-4 pf-spin" />
              ) : item.isVideo ? (
                <Film className="w-4 h-4" />
              ) : (
                <ImageIcon className="w-4 h-4" />
              )}
            </span>
            <div className="pf-upload__body">
              <div className="pf-upload__line">
                <span className="pf-upload__name" title={item.name}>{item.name}</span>
                <span className="pf-upload__status">
                  {STATUS_TEXT[item.status]}
                  {item.status === 'uploading' && item.progress > 0 ? ` ${item.progress}%` : ''}
                </span>
              </div>
              <p className="pf-upload__meta">
                {formatBytes(item.originalSize)}
                {item.compressed && item.sentSize ? ` → ${formatBytes(item.sentSize)}, compressed` : ''}
              </p>
              {(item.status === 'uploading' || item.status === 'preparing') && (
                <span
                  className="pf-upload__bar"
                  role="progressbar"
                  aria-label={`Uploading ${item.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={item.status === 'uploading' ? item.progress : 0}
                >
                  <span
                    className={`pf-upload__fill ${item.status === 'preparing' ? 'pf-upload__fill--busy' : ''}`}
                    style={{ width: item.status === 'uploading' ? `${item.progress}%` : '30%' }}
                  />
                </span>
              )}
              {item.status === 'failed' && item.error && <p className="pf-upload__error">{item.error}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
