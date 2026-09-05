import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'seo_active_org';

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Which org the product shell shows. A plain localStorage value next to the
 * JWT: one login can own several orgs, and this is the one the user picked in
 * the switcher. Readers go through `selectActiveOrganization`, which falls
 * back when the stored id no longer names a complete org, so a stale value
 * is harmless and never needs cleaning up.
 */
export function getActiveOrganizationId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setActiveOrganizationId(id: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, id);
  emit();
}

export function clearActiveOrganizationId(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
  emit();
}

export function subscribeActiveOrganizationId(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getServerSnapshot(): string | null {
  return null;
}

/** Re-renders when the switcher changes the stored id. No provider needed. */
export function useActiveOrganizationId(): string | null {
  return useSyncExternalStore(
    subscribeActiveOrganizationId,
    getActiveOrganizationId,
    getServerSnapshot,
  );
}
