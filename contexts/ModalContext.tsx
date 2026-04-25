import React, { createContext, useContext } from 'react';
import { useModals } from '../hooks/useModals';

type ModalContextValue = ReturnType<typeof useModals>;

export const ModalContext = createContext<ModalContextValue | null>(null);

export const ModalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const value = useModals();
  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
};

export function useModalContext(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) {
    throw new Error('useModalContext must be used within a ModalContext.Provider');
  }
  return ctx;
}
