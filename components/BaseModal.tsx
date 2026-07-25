import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * BaseModal
 * Reusable accessible modal wrapper providing:
 * - Portal rendering
 * - Backdrop + scroll lock
 * - Escape & backdrop close (configurable)
 * - Focus capture & restoration
 * - Standard header/body/footer layout
 *
 * Styling uses design-system tokens only (bg-card, border-border, text-foreground, …).
 */
export interface BaseModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  showCloseButton?: boolean;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement>;
  ariaLabel?: string; // used only if no visible title provided
  footer?: React.ReactNode; // custom footer (actions)
  className?: string; // extra panel classes
  children: React.ReactNode;
  afterOpen?: () => void; // fired after first focus frame
  beforeClose?: (proceed: () => void) => void; // intercept close (e.g. unsaved changes)
}

const SIZE_CLASS: Record<NonNullable<BaseModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  full: 'w-full h-full m-0 rounded-none',
};

export const BaseModal: React.FC<BaseModalProps> = ({
  open,
  onClose,
  title,
  description,
  size = 'md',
  showCloseButton = true,
  closeOnBackdrop = true,
  closeOnEsc = true,
  initialFocusRef,
  ariaLabel,
  footer,
  className = '',
  children,
  afterOpen,
  beforeClose,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`);
  const descId = useRef(`modal-desc-${Math.random().toString(36).slice(2)}`);

  const reallyClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (beforeClose) return beforeClose(reallyClose);
    reallyClose();
  }, [beforeClose, reallyClose]);

  // Escape key handling
  useEffect(() => {
    if (!open || !closeOnEsc) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        requestClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, closeOnEsc, requestClose]);

  // Body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Focus management (capture & restore)
  useEffect(() => {
    if (open) {
      lastFocusedRef.current = document.activeElement as HTMLElement | null;
      const focusTarget =
        initialFocusRef?.current || panelRef.current?.querySelector<HTMLElement>('[data-autofocus]');
      requestAnimationFrame(() => {
        focusTarget?.focus();
        afterOpen?.();
      });
    } else if (lastFocusedRef.current) {
      lastFocusedRef.current.focus();
    }
  }, [open, initialFocusRef, afterOpen]);

  if (!open) return null;

  // Ensure portal root exists
  let root = document.getElementById('modal-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'modal-root';
    document.body.appendChild(root);
  }

  const panelBase =
    'relative bg-card text-card-foreground backdrop-blur-xl border border-border rounded-2xl shadow-2xl flex flex-col max-h-[90vh] w-full ring-1 ring-border/50';

  const content = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-page animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId.current : undefined}
      aria-describedby={description ? descId.current : undefined}
      aria-label={!title && ariaLabel ? ariaLabel : undefined}
    >
      <div
        className="absolute inset-0 bg-overlay/60"
        onClick={() => closeOnBackdrop && requestClose()}
        aria-hidden
      />
      <div
        ref={panelRef}
        className={`${panelBase} ${SIZE_CLASS[size]} ${size === 'full' ? '' : 'mx-auto'} ${className}`}
        tabIndex={-1}
      >
        {(title || showCloseButton) && (
          <div className="flex items-start justify-between px-6 py-4 border-b border-border shrink-0">
            {title && (
              <h2 id={titleId.current} className="text-2xl font-bold text-foreground tracking-tight">
                {title}
              </h2>
            )}
            {showCloseButton && (
              <button
                type="button"
                onClick={requestClose}
                aria-label="Close dialog"
                className="ml-4 inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                ×
              </button>
            )}
          </div>
        )}
        {description && (
          <p id={descId.current} className="px-6 pt-3 text-sm text-muted-foreground shrink-0">
            {description}
          </p>
        )}
        <div className="px-6 py-5 overflow-y-auto custom-scrollbar min-h-0">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-border flex justify-end gap-3 shrink-0 bg-card">
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(content, root);
};

export default BaseModal;
