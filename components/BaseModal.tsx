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
 * Keep this intentionally dependency-light. Incremental enhancements (focus trap loop,
 * animations, stacking) can be layered later without changing consumer APIs.
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
  full: 'w-full h-full m-0 rounded-none'
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
  beforeClose
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
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Focus management (capture & restore)
  useEffect(() => {
    if (open) {
      lastFocusedRef.current = document.activeElement as HTMLElement | null;
      const focusTarget = initialFocusRef?.current || panelRef.current?.querySelector<HTMLElement>('[data-autofocus]');
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

  const panelBase = 'relative bg-white/95 dark:bg-slate-800/60 backdrop-blur-xl border border-slate-200 dark:border-white/20 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] w-full';

  const content = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId.current : undefined}
      aria-describedby={description ? descId.current : undefined}
      aria-label={!title && ariaLabel ? ariaLabel : undefined}
    >
      <div
        className="absolute inset-0 bg-slate-900/40 dark:bg-black/70"
        onClick={() => closeOnBackdrop && requestClose()}
      />
      <div
        ref={panelRef}
        className={`${panelBase} ${SIZE_CLASS[size]} ${size === 'full' ? '' : 'mx-auto'} ${className}`}
        tabIndex={-1}
      >
        {(title || showCloseButton) && (
          <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 dark:border-white/15">
            {title && <h2 id={titleId.current} className="text-2xl font-bold text-slate-900 dark:text-white">{title}</h2>}
            {showCloseButton && (
              <button
                type="button"
                onClick={requestClose}
                aria-label="Close dialog"
                className="ml-4 inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 focus:outline-none focus-visible:ring focus-visible:ring-indigo-500"
              >
                ×
              </button>
            )}
          </div>
        )}
        {description && (
          <p id={descId.current} className="px-6 pt-3 text-sm text-slate-600 dark:text-slate-300">{description}</p>
        )}
        <div className="px-6 py-5 overflow-y-auto custom-scrollbar">
          {children}
        </div>
        {footer && (
          <div className="px-6 py-4 border-t border-slate-200 dark:border-white/10 flex justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(content, root);
};

export default BaseModal;
