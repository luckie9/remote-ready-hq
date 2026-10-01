'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type UnlockContextValue = {
  unlockOpen: boolean;
  openUnlock: () => void;
  closeUnlock: () => void;
};

const UnlockContext = createContext<UnlockContextValue | null>(null);

export function UnlockProvider({ children }: { children: ReactNode }) {
  const [unlockOpen, setUnlockOpen] = useState(false);

  const openUnlock = useCallback(() => setUnlockOpen(true), []);
  const closeUnlock = useCallback(() => setUnlockOpen(false), []);

  const value = useMemo(
    () => ({ unlockOpen, openUnlock, closeUnlock }),
    [unlockOpen, openUnlock, closeUnlock]
  );

  return (
    <UnlockContext.Provider value={value}>{children}</UnlockContext.Provider>
  );
}

export function useUnlock() {
  const ctx = useContext(UnlockContext);
  if (!ctx) throw new Error('useUnlock must be used within UnlockProvider');
  return ctx;
}
