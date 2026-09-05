import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  api: {},
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/',
  Link: () => null,
}));

import { type ProductOrganization, selectActiveOrganization } from '../lib/organizations';

function org(overrides: Partial<ProductOrganization> = {}): ProductOrganization {
  return {
    billing_tier: 'free',
    capabilities: { keyword_research: false, keyword_scheduling: false },
    id: 'org-1',
    name: 'Org 1',
    role: 'owner',
    setup_status: 'setup_complete',
    website_url: 'https://one.example',
    ...overrides,
  };
}

describe('selectActiveOrganization', () => {
  const complete1 = org({ id: 'c1' });
  const complete2 = org({ id: 'c2' });
  const scanning = org({ id: 's1', setup_status: 'setup_scan_in_progress' });

  test('returns the preferred org when it is complete', () => {
    expect(selectActiveOrganization([complete1, complete2], 'c2')).toBe(complete2);
  });

  test('falls back to the first complete org when the preferred id is unknown', () => {
    expect(selectActiveOrganization([scanning, complete1, complete2], 'gone')).toBe(complete1);
  });

  test('ignores a preferred org that is not complete', () => {
    expect(selectActiveOrganization([scanning, complete1], 's1')).toBe(complete1);
  });

  test('falls back to the first org when none is complete', () => {
    expect(selectActiveOrganization([scanning], null)).toBe(scanning);
  });

  test('returns null for an empty list', () => {
    expect(selectActiveOrganization([], 'c1')).toBeNull();
  });
});

describe('active organization store', () => {
  const storage = new Map<string, string>();

  // The store caches the localStorage read for the life of the module, so each
  // test gets a fresh module instead of inheriting the previous test's cache.
  function loadStore() {
    vi.resetModules();
    return import('../lib/active-organization');
  }

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('round-trips set, get and clear through localStorage', async () => {
    const { clearActiveOrganizationId, getActiveOrganizationId, setActiveOrganizationId } =
      await loadStore();

    expect(getActiveOrganizationId()).toBeNull();
    setActiveOrganizationId('c2');
    expect(getActiveOrganizationId()).toBe('c2');
    expect(storage.get('seo_active_org')).toBe('c2');
    clearActiveOrganizationId();
    expect(getActiveOrganizationId()).toBeNull();
  });

  test('reads localStorage once per page load', async () => {
    storage.set('seo_active_org', 'c1');
    const { getActiveOrganizationId } = await loadStore();

    expect(getActiveOrganizationId()).toBe('c1');
    // Stands in for another tab writing the key: this tab keeps its snapshot
    // until it reloads, so the shell never moves org without navigating.
    storage.set('seo_active_org', 'c2');
    expect(getActiveOrganizationId()).toBe('c1');
  });

  test('caches an absent value too', async () => {
    const { getActiveOrganizationId } = await loadStore();

    expect(getActiveOrganizationId()).toBeNull();
    storage.set('seo_active_org', 'c2');
    expect(getActiveOrganizationId()).toBeNull();
  });

  test('notifies subscribers on set and clear, and stops after unsubscribe', async () => {
    const { clearActiveOrganizationId, setActiveOrganizationId, subscribeActiveOrganizationId } =
      await loadStore();

    const listener = vi.fn();
    const unsubscribe = subscribeActiveOrganizationId(listener);
    setActiveOrganizationId('c1');
    clearActiveOrganizationId();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setActiveOrganizationId('c2');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('reads null when there is no window', async () => {
    const { getActiveOrganizationId } = await loadStore();

    vi.unstubAllGlobals();
    expect(getActiveOrganizationId()).toBeNull();
  });

  test('clearToken drops the active org along with the session', async () => {
    storage.set('seo_jwt', 'token');
    storage.set('seo_active_org', 'c1');
    vi.resetModules();
    const { clearToken } = await import('../lib/auth');
    const { getActiveOrganizationId } = await import('../lib/active-organization');

    clearToken();

    expect(storage.has('seo_jwt')).toBe(false);
    expect(storage.has('seo_active_org')).toBe(false);
    expect(getActiveOrganizationId()).toBeNull();
  });
});
