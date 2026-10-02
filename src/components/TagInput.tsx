import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';

/**
 * A list of short provider-typed labels - tags, services - edited as chips.
 *
 * Typing then Enter (or a comma) adds one; Backspace in an empty box removes the last; each
 * chip has its own labelled remove button, so the whole thing works from the keyboard and
 * with a screen reader. Suggestions are plain buttons under the box rather than a dropdown,
 * because a dropdown that opens over the rest of a form on a phone hides the very fields
 * the provider is trying to fill in.
 *
 * Mirrors the backend's normaliseLabelList: whitespace collapsed, duplicates ignored
 * regardless of case, a per-item length cap and a count cap.
 */

interface TagInputProps {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
  max: number;
  maxLength: number;
  placeholder?: string;
  /** Short help shown under the field. */
  hint?: string;
}

const clean = (raw: string) => raw.replace(/\s+/g, ' ').trim();

/** How many suggestions to show at once. Enough to choose from, not a wall. */
const SUGGESTIONS_SHOWN = 8;

export function TagInput({ label, value, onChange, suggestions = [], max, maxLength, placeholder, hint }: TagInputProps) {
  const id = useId();
  const [text, setText] = useState('');
  const full = value.length >= max;

  const has = (candidate: string) => value.some((v) => v.toLowerCase() === candidate.toLowerCase());

  const add = (raw: string) => {
    const label = clean(raw).slice(0, maxLength);
    if (!label || has(label) || full) return;
    onChange([...value, label]);
  };

  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      // Enter would otherwise submit whatever form this sits in.
      e.preventDefault();
      add(text);
      setText('');
    } else if (e.key === 'Backspace' && text === '' && value.length > 0) {
      remove(value.length - 1);
    }
  };

  const visibleSuggestions = useMemo(() => {
    const query = clean(text).toLowerCase();
    return suggestions
      .filter((s) => !has(s) && (!query || s.toLowerCase().includes(query)))
      .slice(0, SUGGESTIONS_SHOWN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions, value, text]);

  return (
    <div className="pf-field">
      <label htmlFor={id} className="pf-field__label">
        {label}
        <span className="pf-field__count">{value.length}/{max}</span>
      </label>

      <div className="pf-tags-box">
        {value.map((tag, index) => (
          <span key={tag} className="pf-chip">
            {tag}
            <button
              type="button"
              onClick={() => remove(index)}
              className="pf-chip__remove"
              aria-label={`Remove ${tag}`}
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          value={text}
          maxLength={maxLength}
          disabled={full}
          onChange={(e) => {
            // A pasted "a, b, c" becomes three chips rather than one with commas in it.
            const next = e.target.value;
            if (next.includes(',')) {
              const parts = next.split(',');
              const rest = parts.pop() || '';
              let list = [...value];
              for (const part of parts) {
                const item = clean(part).slice(0, maxLength);
                if (item && list.length < max && !list.some((v) => v.toLowerCase() === item.toLowerCase())) {
                  list = [...list, item];
                }
              }
              if (list.length !== value.length) onChange(list);
              setText(rest);
            } else {
              setText(next);
            }
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            // Typed but never confirmed is still clearly meant - don't silently drop it.
            if (clean(text)) {
              add(text);
              setText('');
            }
          }}
          placeholder={full ? `Limit of ${max} reached` : value.length === 0 ? placeholder : 'Add another'}
          className="pf-tags-box__input"
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
      </div>

      {hint && (
        <p id={`${id}-hint`} className="pf-field__hint">
          {hint}
        </p>
      )}

      {!full && visibleSuggestions.length > 0 && (
        <div className="pf-suggestions" aria-label={`Suggested ${label.toLowerCase()}`} role="group">
          {visibleSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="pf-suggestion"
              // mousedown, not click: the input's blur would otherwise commit the half-typed
              // text first, and the suggestion the provider actually clicked would land second.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                add(suggestion);
                setText('');
              }}
            >
              + {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
