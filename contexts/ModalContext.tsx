import React, { createContext, useContext } from 'react';
import { useModals } from '../hooks/useModals';

// The context value is the exact return type of useModals
type ModalContextValue = ReturnType<typeof useModals>;

// Derive callback types directly from useModals to prevent silent drift
type UseModalsParams = Parameters<typeof useModals>;

const ModalContext = createContext<ModalContextValue | null>(null);

/**
 * ModalProvider — convenience wrapper for components that want to own
 * their own isolated modal state tree. App.tsx uses ModalContext.Provider
 * directly (after calling useModals() itself) because it needs to pass
 * async callbacks that close over App-level variables.
 */
interface ModalProviderProps {
  children: React.ReactNode;
  onDeleteTransaction?: UseModalsParams[0];
  onDeletePaymentSource?: UseModalsParams[1];
  onDeleteGroup?: UseModalsParams[2];
  onArchiveGroup?: UseModalsParams[3];
  onLeaveGroup?: UseModalsParams[4];
}

export function ModalProvider({
  children,
  onDeleteTransaction,
  onDeletePaymentSource,
  onDeleteGroup,
  onArchiveGroup,
  onLeaveGroup,
}: ModalProviderProps) {
  const value = useModals(
    onDeleteTransaction,
    onDeletePaymentSource,
    onDeleteGroup,
    onArchiveGroup,
    onLeaveGroup,
  );
  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
}

export function useModalContext(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModalContext must be used inside ModalContext.Provider');
  return ctx;
}

export { ModalContext };
