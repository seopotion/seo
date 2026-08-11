import { beforeEach, describe, expect, test, vi } from 'vitest';

const { querySearchAnalytics } = vi.hoisted(() => ({ querySearchAnalytics: vi.fn() }));
vi.mock('../src/clients/gsc', () => ({ querySearchAnalytics }));

const { cacheGet, cachePut } = vi.hoisted(() => ({ cacheGet: vi.fn(), cachePut: vi.fn() }));
vi.mock('@shared/db', () => ({
  GscAnalyticsCacheRepo: { get: cacheGet, put: cachePut },
}));

import { cachedSearchAnalytics, cacheKey } from '../src/lib/gsc-cache';
import type { SearchAnalyticsParams } from '../src/clients/gsc';

const access = { token: 'rt-1', siteUrl: 'sc-domain:clewas.com' };
const params: SearchAnalyticsParams = {
  startDate: '2026-06-17',
  endDate: '2026-07-15',
  dimensions: ['date'],
};
const rows = [{ keys: ['2026-07-01'], clicks: 5, impressions: 100, ctr: 0.05, position: 3.2 }];

beforeEach(() => {
  vi.clearAllMocks();
  cacheGet.mockResolvedValue(null);
  cachePut.mockResolvedValue(undefined);
});

describe('cacheKey', () => {
  test('is deterministic for identical inputs', () => {
    expect(cacheKey('sc-domain:x.com', { ...params })).toBe(
      cacheKey('sc-domain:x.com', { ...params }),
    );
  });

  test('changes when any part of the query changes', () => {
    const base = cacheKey('sc-domain:x.com', { ...params });
    expect(cacheKey('sc-domain:y.com', { ...params })).not.toBe(base);
    expect(cacheKey('sc-domain:x.com', { ...params, endDate: '2026-07-16' })).not.toBe(base);
    expect(cacheKey('sc-domain:x.com', { ...params, dimensions: ['page'] })).not.toBe(base);
    expect(cacheKey('sc-domain:x.com', { ...params, rowLimit: 25000 })).not.toBe(base);
    expect(
      cacheKey('sc-domain:x.com', {
        ...params,
        dimensionFilterGroups: [
          { filters: [{ dimension: 'page', operator: 'equals', expression: 'https://x.com/a' }] },
        ],
      }),
    ).not.toBe(base);
  });
});

describe('cachedSearchAnalytics', () => {
  test('miss: calls GSC, stores the rows under the key, returns them', async () => {
    querySearchAnalytics.mockResolvedValue(rows);
    const result = await cachedSearchAnalytics('org_1', access, { ...params });
    expect(result).toEqual(rows);
    expect(querySearchAnalytics).toHaveBeenCalledWith(access.token, access.siteUrl, { ...params });
    expect(cachePut).toHaveBeenCalledWith(cacheKey(access.siteUrl, { ...params }), 'org_1', rows);
  });

  test('hit: returns stored rows without calling GSC', async () => {
    cacheGet.mockResolvedValue(rows);
    const result = await cachedSearchAnalytics('org_1', access, { ...params });
    expect(result).toEqual(rows);
    expect(querySearchAnalytics).not.toHaveBeenCalled();
    expect(cachePut).not.toHaveBeenCalled();
  });

  test('an empty cached array is a hit, not a refetch', async () => {
    cacheGet.mockResolvedValue([]);
    expect(await cachedSearchAnalytics('org_1', access, { ...params })).toEqual([]);
    expect(querySearchAnalytics).not.toHaveBeenCalled();
  });

  test('errors propagate and are never cached', async () => {
    querySearchAnalytics.mockRejectedValue(new Error('quota'));
    await expect(cachedSearchAnalytics('org_1', access, { ...params })).rejects.toThrow('quota');
    expect(cachePut).not.toHaveBeenCalled();
  });
});
