import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  api: {},
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/',
  Link: () => null,
}));

import {
  clearActiveOrganizationId,
  getActiveOrganizationId,
  setActiveOrganizationId,
  subscribeActiveOrganizationId,
} from '../lib/active-organization';
import { type ProductOrganization, selectActiveOrganization } from '../lib/organizations';

function org(overrides: Partial<ProductOrganization> = {}): ProductOrganization {
  return {
    billing_tier: 'free',
    capabilities: { keyword_research: false, keyword_scheduling: false },
    id: 'org-1',
    name: 'Org 1',
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

  test('round-trips set, get and clear through localStorage', () => {
    expect(getActiveOrganizationId()).toBeNull();
    setActiveOrganizationId('c2');
    expect(getActiveOrganizationId()).toBe('c2');
    expect(storage.get('seo_active_org')).toBe('c2');
    clearActiveOrganizationId();
    expect(getActiveOrganizationId()).toBeNull();
  });

  test('notifies subscribers on set and clear, and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeActiveOrganizationId(listener);
    setActiveOrganizationId('c1');
    clearActiveOrganizationId();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setActiveOrganizationId('c2');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('reads null when there is no window', () => {
    vi.unstubAllGlobals();
    expect(getActiveOrganizationId()).toBeNull();
  });
});
