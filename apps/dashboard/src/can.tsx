import { createContext, useContext, type ReactNode } from 'react';

/**
 * The signed-in member's permissions for components deep in a screen (H4), so a button the API would refuse is not
 * shown. `has('*')` is the owner. The API checks every request itself; this only hides what would fail.
 */
const CanContext = createContext<(p: string) => boolean>(() => false);

export function CanProvider({ has, children }: { has: (p: string) => boolean; children: ReactNode }) {
  return <CanContext.Provider value={has}>{children}</CanContext.Provider>;
}

export const useCan = () => useContext(CanContext);
