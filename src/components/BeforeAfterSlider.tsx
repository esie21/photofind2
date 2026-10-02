import { useId, useState } from 'react';
import { getUploadUrl } from '../api/config';
import type { PortfolioImageMeta } from '../api/services/authService';

/**
 * A before/after comparison: the "after" photo, with the "before" photo over it clipped to
 * the slider position.
 *
 * The control is a real <input type="range"> stretched over the whole image and made
 * transparent, rather than a custom drag handler. That gets every input method for free -
 * dragging with a mouse, tapping or dragging on a phone, arrow keys and Home/End from the
 * keyboard - and a screen reader announces it as a slider with its value. The visible
 * handle is decoration that follows the value.
 *
 * touch-action: pan-y keeps a vertical swipe on the image scrolling the page; only a
 * horizontal drag moves the slider.
 */

interface BeforeAfterSliderProps {
  before: string;
  after: string;
  beforeMeta: PortfolioImageMeta;
  afterMeta: PortfolioImageMeta;
  /** What the pair shows, for the slider's accessible name. */
  label: string;
}

export function BeforeAfterSlider({ before, after, beforeMeta, afterMeta, label }: BeforeAfterSliderProps) {
  const id = useId();
  const [position, setPosition] = useState(50);
  // The "after" decides the frame's shape; the "before" is cropped to match.
  const ratio =
    afterMeta.width && afterMeta.height ? `${afterMeta.width} / ${afterMeta.height}` : '4 / 3';

  return (
    <figure className="pf-compare">
      <div className="pf-compare__frame" style={{ aspectRatio: ratio }}>
        <img
          src={getUploadUrl(after)}
          alt={afterMeta.alt || afterMeta.caption || `After: ${label}`}
          className="pf-compare__img"
          loading="lazy"
          decoding="async"
        />
        <img
          src={getUploadUrl(before)}
          alt={beforeMeta.alt || beforeMeta.caption || `Before: ${label}`}
          className="pf-compare__img pf-compare__img--before"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
          loading="lazy"
          decoding="async"
        />
        <span className="pf-compare__label pf-compare__label--before" aria-hidden="true">Before</span>
        <span className="pf-compare__label pf-compare__label--after" aria-hidden="true">After</span>
        <span className="pf-compare__divider" style={{ left: `${position}%` }} aria-hidden="true">
          <span className="pf-compare__knob">‹ ›</span>
        </span>
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={1}
          value={position}
          onChange={(e) => setPosition(Number(e.target.value))}
          className="pf-compare__range"
          aria-label={`Before and after: ${label}`}
          aria-valuetext={`Showing ${position}% before`}
        />
      </div>
      {(afterMeta.caption || beforeMeta.caption) && (
        <figcaption className="pf-compare__caption">{afterMeta.caption || beforeMeta.caption}</figcaption>
      )}
    </figure>
  );
}
