import { DataForSeoError } from '@shared/providers';
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

const { addCandidates } = vi.hoisted(() => ({ addCandidates: vi.fn() }));
vi.mock('@shared/db', () => ({ addCandidates }));

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

  test('403 for an org owned by someone else', async () => {
    loadOwnedPaidOrg.mockResolvedValueOnce({ ok: false, reason: 'not_owner' });
    const res = await testClient(app).research.$post({ json: { org_id: 'o1', seed: 'crm' } });
    expect(res.status).toBe(403);
    expect(keywordIdeas).not.toHaveBeenCalled();
  });

  test('400 for a whitespace-only seed, before any provider call', async () => {
    const res = await app.request('/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: 'o1', seed: '   ' }),
    });
    expect(res.status).toBe(400);
    expect(loadOwnedPaidOrg).not.toHaveBeenCalled();
    expect(keywordIdeas).not.toHaveBeenCalled();
  });

  test('400 for a seed above the 200-char cap', async () => {
    const res = await app.request('/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: 'o1', seed: 'x'.repeat(201) }),
    });
    expect(res.status).toBe(400);
    expect(keywordIdeas).not.toHaveBeenCalled();
  });

  test('502 when the keyword provider fails', async () => {
    loadOwnedPaidOrg.mockResolvedValueOnce(paidOrg);
    bulkKeywordDifficulty.mockRejectedValueOnce(new DataForSeoError('http_error', 'boom'));
    keywordIdeas.mockResolvedValueOnce([]);
    const res = await testClient(app).research.$post({ json: { org_id: 'o1', seed: 'crm' } });
    expect(res.status).toBe(502);
  });

  test('caps similar at 20, excludes the normalized seed, and rounds metrics', async () => {
    loadOwnedPaidOrg.mockResolvedValueOnce(paidOrg);
    bulkKeywordDifficulty.mockResolvedValueOnce([
      {
        keyword: 'crm',
        search_volume: 500.6,
        difficulty: 40.4,
        cpc: 2,
        competition: 0.5,
        trend: 0,
        intent: 'commercial',
      },
    ]);
    const idea = (i: number) => ({
      keyword: i === 0 ? '  CRM  ' : `idea ${i}`, // idea 0 is the seed, differently cased
      search_volume: 100.9,
      difficulty: 10.2,
      cpc: 1,
      competition: 0.1,
      trend: 0,
      intent: null,
    });
    keywordIdeas.mockResolvedValueOnce(Array.from({ length: 25 }, (_, i) => idea(i)));

    const res = await testClient(app).research.$post({ json: { org_id: 'o1', seed: 'crm' } });
    expect(res.status).toBe(200);
    if (res.status !== 200) throw new Error('expected 200');
    const body = await res.json();
    expect(body.seed.search_volume).toBe(501);
    expect(body.seed.difficulty).toBe(40);
    expect(body.similar).toHaveLength(20);
    expect(body.similar.map((m) => m.keyword)).not.toContain('  CRM  ');
    expect(body.similar[0]!.search_volume).toBe(101);
    expect(body.similar[0]!.difficulty).toBe(10);
  });
});

describe('POST /candidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('inserts selected keywords as manual candidates (pool only)', async () => {
    loadOwnedPaidOrg.mockResolvedValueOnce(paidOrg);
    addCandidates.mockResolvedValueOnce([{ id: 'c1' }]); // 1 of 2 inserted

    const res = await testClient(app).candidates.$post({
      json: {
        org_id: 'o1',
        keywords: [
          {
            keyword: 'best crm',
            search_volume: 300,
            difficulty: 30,
            cpc: 1,
            competition: 0.3,
            trend: 0,
            intent: 'commercial',
          },
          {
            keyword: 'crm pricing',
            search_volume: 200,
            difficulty: 20,
            cpc: 1,
            competition: 0.2,
            trend: 0,
            intent: 'commercial',
          },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: 1, skipped: 1 });
    const [orgId, items] = addCandidates.mock.calls[0]!;
    expect(orgId).toBe('o1');
    expect(items[0]).toMatchObject({ source: 'manual', status: 'candidate', keyword: 'best crm' });
  });

  test('402 for a free org, without touching the pool', async () => {
    loadOwnedPaidOrg.mockResolvedValueOnce({ ok: false, reason: 'not_paid' });
    const res = await testClient(app).candidates.$post({
      json: {
        org_id: 'o1',
        keywords: [
          {
            keyword: 'x',
            search_volume: 1,
            difficulty: 1,
            cpc: null,
            competition: null,
            trend: null,
            intent: null,
          },
        ],
      },
    });
    expect(res.status).toBe(402);
    expect(addCandidates).not.toHaveBeenCalled();
  });
});
