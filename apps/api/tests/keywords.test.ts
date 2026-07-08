import { testClient } from 'hono/testing';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { loadOwnedPaidOrg } = vi.hoisted(() => ({ loadOwnedPaidOrg: vi.fn() }));
vi.mock('../src/lib/load-owned-paid-org', () => ({ loadOwnedPaidOrg }));

const { keywordIdeas, bulkKeywordDifficulty } = vi.hoisted(() => ({
  keywordIdeas: vi.fn(),
  bulkKeywordDifficulty: vi.fn(),
}));
vi.mock('../src/clients/providers', () => ({
  getDataForSeoClient: () => ({ keywordIdeas, bulkKeywordDifficulty }),
}));

// authMiddleware sets c.var.auth from the JWT; stub it to a fixed user.
vi.mock('../src/middlewares/auth', async (orig) => {
  const actual = await orig<typeof import('../src/middlewares/auth')>();
  return {
    ...actual,
    authMiddleware: async (c: any, next: any) => {
      c.set('auth', { userId: 'u1', email: 'u1@example.com' });
      await next();
    },
  };
});

import app from '../src/routes/keywords';

const paidOrg = {
  ok: true,
  org: {
    id: 'o1',
    user_id: 'u1',
    plan: 'paid',
    presets: { business: { language: 'English', country: 'Global (English)' } },
  },
};

describe('POST /research', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns seed metrics + bounded similar', async () => {
    loadOwnedPaidOrg.mockResolvedValueOnce(paidOrg);
    bulkKeywordDifficulty.mockResolvedValueOnce([
      {
        keyword: 'crm',
        search_volume: 500,
        difficulty: 40,
        cpc: 2,
        competition: 0.5,
        trend: 0,
        intent: 'commercial',
      },
    ]);
    keywordIdeas.mockResolvedValueOnce([
      {
        keyword: 'best crm',
        search_volume: 300,
        difficulty: 30,
        cpc: 1,
        competition: 0.3,
        trend: 0,
        intent: 'commercial',
      },
    ]);

    const client = testClient(app);
    const res = await client.research.$post({ json: { org_id: 'o1', seed: 'crm' } });
    expect(res.status).toBe(200);
    if (res.status !== 200) throw new Error('expected 200');
    const body = await res.json();
    expect(body.seed.keyword).toBe('crm');
    expect(body.similar).toHaveLength(1);
  });

  test('402 for a free org', async () => {
    loadOwnedPaidOrg.mockResolvedValueOnce({ ok: false, reason: 'not_paid' });
    const res = await testClient(app).research.$post({ json: { org_id: 'o1', seed: 'crm' } });
    expect(res.status).toBe(402);
    expect(keywordIdeas).not.toHaveBeenCalled();
  });
});
