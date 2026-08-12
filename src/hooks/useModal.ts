import { useEffect, useRef } from 'react';

/**
 * The behaviour every modal needs and only one of them had.
 *
 * Before this, PayoutRequestForm was the only modal in the app that closed on
 * Escape, locked the page behind it, or told a screen reader it was a dialog. The
 * other thirteen did none of it - the most visible consequence being on a phone,
 * where the page scrolled away behind the modal.
 *
 * Nesting is handled with a stack rather than a boolean, because two modals are
 * genuinely open at once in places (AuthModal opens the terms; the evidence modals
 * open an image lightbox):
 *
 *  - Escape only reaches the topmost modal, so closing the lightbox doesn't also
 *    close the modal that opened it.
 *  - The scroll lock is released when the *last* modal closes, not the first. A
 *    naive save-and-restore in each modal would have the inner one restore
 *    `overflow` while the outer is still open.
 */

const modalStack: symbol[] = [];
let restoreBodyOverflow: string | null = null;

interface UseModalOptions {
  /**
   * Whether the modal is currently open. Defaults to true, for components that only
   * exist while their modal is showing. Modals written inline inside a bigger
   * component's JSX have to pass this: a hook can't be called conditionally, and
   * without it the page behind would be locked from the moment that component
   * mounted, modal open or not.
   */
  enabled?: boolean;
  /** Escape closes the modal. Off while a submit is in flight. */
  closeOnEscape?: boolean;
  /** Clicking the dimmed area closes the modal. */
  closeOnBackdrop?: boolean;
  /** Freeze the page behind the modal. */
  lockScroll?: boolean;
  /** id of the element naming this dialog, for screen readers. */
  labelledBy?: string;
  /** Used when there is no visible title to point at. */
  label?: string;
}

export function useModal(onClose: () => void, options: UseModalOptions = {}) {
  const {
    enabled = true,
    closeOnEscape = true,
    closeOnBackdrop = true,
    lockScroll = true,
    labelledBy,
    label,
  } = options;

  // Held in refs so the effect below can run once, on mount. Callers pass inline
  // arrows for onClose, which change identity every render - as an effect
  // dependency that would re-register the listener and churn the stack on every
  // keystroke inside the modal.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const escapeEnabledRef = useRef(closeOnEscape);
  escapeEnabledRef.current = closeOnEscape;

  useEffect(() => {
    if (!enabled) return;

    const id = Symbol('modal');
    modalStack.push(id);

    if (lockScroll && modalStack.length === 1) {
      restoreBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!escapeEnabledRef.current) return;
      // Topmost only.
      if (modalStack[modalStack.length - 1] !== id) return;
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const at = modalStack.indexOf(id);
      if (at !== -1) modalStack.splice(at, 1);
      if (lockScroll && modalStack.length === 0) {
        document.body.style.overflow = restoreBodyOverflow ?? '';
        restoreBodyOverflow = null;
      }
    };
  }, [enabled, lockScroll]);

  return {
    /** Spread onto the .modal-overlay element. */
    overlayProps: {
      onClick: (e: React.MouseEvent) => {
        // Only a click on the dim area itself, not one that bubbled up from the card.
        if (!closeOnBackdrop) return;
        if (e.target !== e.currentTarget) return;
        onCloseRef.current();
      },
    },
    /** Spread onto the .modal-card element. */
    cardProps: {
      role: 'dialog' as const,
      'aria-modal': true,
      ...(labelledBy ? { 'aria-labelledby': labelledBy } : {}),
      ...(label ? { 'aria-label': label } : {}),
    },
  };
}

export default useModal;
