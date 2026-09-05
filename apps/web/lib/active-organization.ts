'use client';

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'seo_active_org';

const listeners = new Set<() => void>();

// `undefined` means "not read yet"; `null` is a cached "nothing stored".
let cachedId: string | null | undefined;

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Which org the product shell shows. A plain localStorage value next to the
 * JWT: one login can own several orgs, and this is the one the user picked in
 * the switcher. Readers go through `selectActiveOrganization`, which falls
 * back when the stored id no longer names a complete org, so a stale value
 * is harmless and never needs cleaning up.
 *
 * localStorage is read once per page load and then cached. `useSyncExternalStore`
 * calls this on every render of a subscriber, so an uncached read would let
 * another tab's switch slip in at the next re-render — without the
 * `router.replace('/home')` a deliberate switch pairs with, which would strand
 * the user on a detail page belonging to the org they just left. Another tab's
 * switch is picked up when this tab reloads.
 */
export function getActiveOrganizationId(): string | null {
  if (typeof window === 'undefined') return null;
  if (cachedId === undefined) cachedId = window.localStorage.getItem(STORAGE_KEY);
  return cachedId;
}

export function setActiveOrganizationId(id: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, id);
  cachedId = id;
  emit();
}

export function clearActiveOrganizationId(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
  cachedId = null;
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
