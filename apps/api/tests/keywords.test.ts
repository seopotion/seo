import { DataForSeoError } from '@shared/providers';
import type { Context, Next } from 'hono';
import { testClient } from 'hono/testing';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AuthEnv } from '../src/middlewares/auth';

const { loadOwnedPaidOrg } = vi.hoisted(() => ({ loadOwnedPaidOrg: vi.fn() }));
vi.mock('../src/lib/load-owned-paid-org', () => ({ loadOwnedPaidOrg }));

const { keywordIdeas, bulkKeywordDifficulty } = vi.hoisted(() => ({
  keywordIdeas: vi.fn(),
  bulkKeywordDifficulty: vi.fn(),
}));
vi.mock('../src/clients/providers', () => ({
  getDataForSeoClient: () => ({ keywordIdeas, bulkKeywordDifficulty }),
}));

const { addCandidates, scheduleCandidate, CandidateRepo, KeywordRepo, isDuplicateKeyError } =
  vi.hoisted(() => ({
    addCandidates: vi.fn(),
    scheduleCandidate: vi.fn(),
    CandidateRepo: {
      findById: vi.fn(),
      listByOrg: vi.fn(),
      rejectIfCandidate: vi.fn(),
      releaseAfterUnschedule: vi.fn(),
    },
    KeywordRepo: {
      findById: vi.fn(),
      findByOrgAndDate: vi.fn(),
      reschedulePending: vi.fn(),
      deleteUnstarted: vi.fn(),
    },
    isDuplicateKeyError: vi.fn(() => false),
  }));
vi.mock('@shared/db', () => ({
  addCandidates,
  scheduleCandidate,
  CandidateRepo,
  KeywordRepo,
  isDuplicateKeyError,
}));

const { loadOwnedOrg } = vi.hoisted(() => ({ loadOwnedOrg: vi.fn() }));
vi.mock('../src/lib/load-owned-org', () => ({ loadOwnedOrg }));

// authMiddleware sets c.var.auth from the JWT; stub it to a fixed user.
vi.mock('../src/middlewares/auth', async (orig) => {
  const actual = await orig<typeof import('../src/middlewares/auth')>();
  return {
    ...actual,
    authMiddleware: async (c: Context<AuthEnv>, next: Next) => {
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
    bulkKeywordDifficulty.mockRejectedValueOnce(new DataForSeoError('provider', 'boom'));
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

// --- #99 candidate pool + scheduling routes ---

const ownedFreeOrg = { id: 'o1', user_id: 'u1', plan: 'free' };
const ownedPaidOrg = { id: 'o1', user_id: 'u1', plan: 'paid' };

const candidate = {
  id: 'c1',
  org_id: 'o1',
  keyword: 'best crm software',
  normalized_keyword: 'best crm software',
  source: 'manual',
  source_context: null,
  search_volume: 1000,
  difficulty: 32,
  cpc: 4.5,
  competition: 0.7,
  trend: 4,
  intent: 'commercial',
  serp_competitors: null,
  relevance_score: null,
  opportunity_score: null,
  article_type: null,
  rejection_reason: null,
  status: 'candidate',
  created_at: new Date('2026-07-15T10:00:00.000Z'),
  updated_at: new Date('2026-07-15T10:00:00.000Z'),
};

const scheduledKeyword = {
  id: 'k1',
  org_id: 'o1',
  candidate_id: 'c1',
  keyword: 'best crm software',
  normalized_keyword: 'best crm software',
  status: 'scheduled',
  scheduled_date: '2026-07-20',
  search_volume: 1000,
  difficulty: 32,
  article_id: null,
  article_type: null,
  intent: 'commercial',
  opportunity_score: null,
  serp_competitors: null,
  created_at: new Date(),
  generation_status: 'pending',
  generation_attempts: 0,
  generation_error: null,
  generation_started_at: null,
};

describe('GET /candidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns the mapped pool with schedulable flags and pagination echo', async () => {
    loadOwnedOrg.mockResolvedValueOnce(ownedFreeOrg); // read needs no paid plan
    CandidateRepo.listByOrg.mockResolvedValueOnce({
      candidates: [candidate, { ...candidate, id: 'c2', search_volume: null }],
      total: 2,
    });

    const res = await testClient(app).candidates.$get({
      query: { org_id: 'o1', limit: '10', offset: '0' },
    });
    expect(res.status).toBe(200);
    if (res.status !== 200) throw new Error('expected 200');
    const body = await res.json();
    expect(CandidateRepo.listByOrg).toHaveBeenCalledWith('o1', {
      status: 'candidate', // default filter
      limit: 10,
      offset: 0,
    });
    expect(body.total).toBe(2);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
    expect(body.candidates[0]).toMatchObject({
      id: 'c1',
      schedulable: true,
      created_at: '2026-07-15T10:00:00.000Z',
    });
    expect(body.candidates[1]!.schedulable).toBe(false); // missing metrics
  });

  test('empty pool returns [] and total 0', async () => {
    loadOwnedOrg.mockResolvedValueOnce(ownedFreeOrg);
    CandidateRepo.listByOrg.mockResolvedValueOnce({ candidates: [], total: 0 });
    const res = await testClient(app).candidates.$get({ query: { org_id: 'o1' } });
    expect(res.status).toBe(200);
    if (res.status !== 200) throw new Error('expected 200');
    expect(await res.json()).toMatchObject({ candidates: [], total: 0, limit: 50, offset: 0 });
  });

  test('404 for an org the caller does not own', async () => {
    loadOwnedOrg.mockResolvedValueOnce(null);
    const res = await testClient(app).candidates.$get({ query: { org_id: 'other' } });
    expect(res.status).toBe(404);
    expect(CandidateRepo.listByOrg).not.toHaveBeenCalled();
  });

  test('400 for an out-of-range limit', async () => {
    const res = await app.request('/candidates?org_id=o1&limit=1000');
    expect(res.status).toBe(400);
  });
});

describe('POST /candidates/{candidate_id}/schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const schedule = (candidateId = 'c1', date = '2026-07-20') =>
    testClient(app).candidates[':candidate_id'].schedule.$post({
      param: { candidate_id: candidateId },
      json: { scheduled_date: date },
    });

  test('201 on first-time scheduling with the copied fields', async () => {
    CandidateRepo.findById.mockResolvedValueOnce(candidate);
    loadOwnedOrg.mockResolvedValueOnce(ownedPaidOrg);
    scheduleCandidate.mockResolvedValueOnce({ ok: true, created: true, keyword: scheduledKeyword });

    const res = await schedule();
    expect(res.status).toBe(201);
    if (res.status !== 201) throw new Error('expected 201');
    const body = await res.json();
    expect(body.keyword).toMatchObject({
      id: 'k1',
      candidate_id: 'c1',
      keyword: 'best crm software',
      scheduled_date: '2026-07-20',
      generation_status: 'pending',
      article_id: null,
    });
    expect(scheduleCandidate).toHaveBeenCalledWith(candidate, '2026-07-20');
  });

  test('200 on an idempotent retry for the same date', async () => {
    CandidateRepo.findById.mockResolvedValueOnce(candidate);
    loadOwnedOrg.mockResolvedValueOnce(ownedPaidOrg);
    scheduleCandidate.mockResolvedValueOnce({
      ok: true,
      created: false,
      keyword: scheduledKeyword,
    });
    const res = await schedule();
    expect(res.status).toBe(200);
  });

  test.each([
    'date_occupied',
    'keyword_already_scheduled',
    'candidate_already_scheduled',
    'candidate_not_schedulable',
  ] as const)('409 %s conflict', async (reason) => {
    CandidateRepo.findById.mockResolvedValueOnce(candidate);
    loadOwnedOrg.mockResolvedValueOnce(ownedPaidOrg);
    scheduleCandidate.mockResolvedValueOnce({ ok: false, reason });
    const res = await schedule();
    expect(res.status).toBe(409);
    if (res.status !== 409) throw new Error('expected 409');
    expect(await res.json()).toEqual({ error: reason });
  });

  test('402 for a free org, without touching the scheduler', async () => {
    CandidateRepo.findById.mockResolvedValueOnce(candidate);
    loadOwnedOrg.mockResolvedValueOnce(ownedFreeOrg);
    const res = await schedule();
    expect(res.status).toBe(402);
    if (res.status !== 402) throw new Error('expected 402');
    expect(await res.json()).toEqual({ error: 'not_paid' });
    expect(scheduleCandidate).not.toHaveBeenCalled();
  });

  test('404 for a missing candidate or unowned org', async () => {
    CandidateRepo.findById.mockResolvedValueOnce(null);
    expect((await schedule('nope')).status).toBe(404);

    CandidateRepo.findById.mockResolvedValueOnce(candidate);
    loadOwnedOrg.mockResolvedValueOnce(null);
    expect((await schedule()).status).toBe(404);
    expect(scheduleCandidate).not.toHaveBeenCalled();
  });

  test('400 for malformed or impossible dates', async () => {
    for (const bad of ['20260720', '2026-7-20', '2026-02-30']) {
      const res = await app.request('/candidates/c1/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_date: bad }),
      });
      expect(res.status).toBe(400);
    }
    expect(CandidateRepo.findById).not.toHaveBeenCalled();
  });
});

describe('DELETE /candidates/{candidate_id}', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const del = (candidateId = 'c1') =>
    testClient(app).candidates[':candidate_id'].$delete({ param: { candidate_id: candidateId } });

  test('204 rejects a pooled candidate', async () => {
    CandidateRepo.findById.mockResolvedValueOnce(candidate);
    loadOwnedOrg.mockResolvedValueOnce(ownedPaidOrg);
    CandidateRepo.rejectIfCandidate.mockResolvedValueOnce(true);

    const res = await del();
    expect(res.status).toBe(204);
    expect(CandidateRepo.rejectIfCandidate).toHaveBeenCalledWith('c1');
  });

  test('409 candidate_not_deletable when the conditional update refuses', async () => {
    CandidateRepo.findById.mockResolvedValueOnce({ ...candidate, status: 'selected' });
    loadOwnedOrg.mockResolvedValueOnce(ownedPaidOrg);
    CandidateRepo.rejectIfCandidate.mockResolvedValueOnce(false);

    const res = await del();
    expect(res.status).toBe(409);
    if (res.status !== 409) throw new Error('expected 409');
    expect(await res.json()).toEqual({ error: 'candidate_not_deletable' });
  });

  test('402 for a free org, without touching the pool', async () => {
    CandidateRepo.findById.mockResolvedValueOnce(candidate);
    loadOwnedOrg.mockResolvedValueOnce(ownedFreeOrg);
    const res = await del();
    expect(res.status).toBe(402);
    if (res.status !== 402) throw new Error('expected 402');
    expect(await res.json()).toEqual({ error: 'not_paid' });
    expect(CandidateRepo.rejectIfCandidate).not.toHaveBeenCalled();
  });

  test('404 for a missing candidate or unowned org', async () => {
    CandidateRepo.findById.mockResolvedValueOnce(null);
    expect((await del('nope')).status).toBe(404);

    CandidateRepo.findById.mockResolvedValueOnce(candidate);
    loadOwnedOrg.mockResolvedValueOnce(null);
    expect((await del()).status).toBe(404);
    expect(CandidateRepo.rejectIfCandidate).not.toHaveBeenCalled();
  });
});

describe('PATCH /scheduled/{keyword_id}', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const patch = (date: string) =>
    testClient(app).scheduled[':keyword_id'].$patch({
      param: { keyword_id: 'k1' },
      json: { scheduled_date: date },
    });

  test('200 moves a pending keyword to a free date', async () => {
    KeywordRepo.findById.mockResolvedValueOnce(scheduledKeyword);
    loadOwnedOrg.mockResolvedValueOnce(ownedPaidOrg);
    KeywordRepo.findByOrgAndDate.mockResolvedValueOnce(null);
    KeywordRepo.reschedulePending.mockResolvedValueOnce({
      ...scheduledKeyword,
      scheduled_date: '2026-07-24',
    });

    const res = await patch('2026-07-24');
    expect(res.status).toBe(200);
    if (res.status !== 200) throw new Error('expected 200');
    expect((await res.json()).keyword.scheduled_date).toBe('2026-07-24');
    expect(KeywordRepo.reschedulePending).toHaveBeenCalledWith('k1', '2026-07-24');
  });

  test('200 idempotent when the keyword is already on that date', async () => {
    KeywordRepo.findById.mockResolvedValueOnce(scheduledKeyword);
    loadOwnedOrg.mockResolvedValueOnce(ownedPaidOrg);
    const res = await patch('2026-07-20');
    expect(res.status).toBe(200);
    expect(KeywordRepo.reschedulePending).not.toHaveBeenCalled();
  });

  test('409 date_occupied when another keyword owns the date', async () => {
    KeywordRepo.findById.mockResolvedValueOnce(scheduledKeyword);
    loadOwnedOrg.mockResolvedValueOnce(ownedPaidOrg);
    KeywordRepo.findByOrgAndDate.mockResolvedValueOnce({ ...scheduledKeyword, id: 'k2' });
    const res = await patch('2026-07-24');
    expect(res.status).toBe(409);
    if (res.status !== 409) throw new Error('expected 409');
    expect(await res.json()).toEqual({ error: 'date_occupied' });
  });

  test('409 generation_started for linked or non-pending keywords', async () => {
    KeywordRepo.findById.mockResolvedValueOnce({ ...scheduledKeyword, article_id: 'a1' });
    loadOwnedOrg.mockResolvedValueOnce(ownedPaidOrg);
    expect((await patch('2026-07-24')).status).toBe(409);

    KeywordRepo.findById.mockResolvedValueOnce({
      ...scheduledKeyword,
      generation_status: 'generating',
    });
    loadOwnedOrg.mockResolvedValueOnce(ownedPaidOrg);
    const res = await patch('2026-07-24');
    expect(res.status).toBe(409);
    if (res.status !== 409) throw new Error('expected 409');
    expect(await res.json()).toEqual({ error: 'generation_started' });
    expect(KeywordRepo.reschedulePending).not.toHaveBeenCalled();
  });

  test('402 free org / 404 unowned', async () => {
    KeywordRepo.findById.mockResolvedValueOnce(scheduledKeyword);
    loadOwnedOrg.mockResolvedValueOnce(ownedFreeOrg);
    expect((await patch('2026-07-24')).status).toBe(402);

    KeywordRepo.findById.mockResolvedValueOnce(scheduledKeyword);
    loadOwnedOrg.mockResolvedValueOnce(null);
    expect((await patch('2026-07-24')).status).toBe(404);
  });
});

describe('DELETE /scheduled/{keyword_id}', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const del = () =>
    testClient(app).scheduled[':keyword_id'].$delete({ param: { keyword_id: 'k1' } });

  test('204 deletes and returns the candidate to the pool', async () => {
    KeywordRepo.findById.mockResolvedValueOnce(scheduledKeyword);
    loadOwnedOrg.mockResolvedValueOnce(ownedPaidOrg);
    KeywordRepo.deleteUnstarted.mockResolvedValueOnce(scheduledKeyword);

    const res = await del();
    expect(res.status).toBe(204);
    expect(CandidateRepo.releaseAfterUnschedule).toHaveBeenCalledWith('c1');
  });

  test('204 without a candidate release for legacy entries (no candidate_id)', async () => {
    KeywordRepo.findById.mockResolvedValueOnce({ ...scheduledKeyword, candidate_id: null });
    loadOwnedOrg.mockResolvedValueOnce(ownedPaidOrg);
    KeywordRepo.deleteUnstarted.mockResolvedValueOnce({ ...scheduledKeyword, candidate_id: null });
    expect((await del()).status).toBe(204);
    expect(CandidateRepo.releaseAfterUnschedule).not.toHaveBeenCalled();
  });

  test('409 generation_started when the conditional delete refuses', async () => {
    KeywordRepo.findById.mockResolvedValueOnce({
      ...scheduledKeyword,
      generation_status: 'generating',
    });
    loadOwnedOrg.mockResolvedValueOnce(ownedPaidOrg);
    KeywordRepo.deleteUnstarted.mockResolvedValueOnce(null);
    const res = await del();
    expect(res.status).toBe(409);
    if (res.status !== 409) throw new Error('expected 409');
    expect(await res.json()).toEqual({ error: 'generation_started' });
    expect(CandidateRepo.releaseAfterUnschedule).not.toHaveBeenCalled();
  });

  test('402 free org / 404 unowned', async () => {
    KeywordRepo.findById.mockResolvedValueOnce(scheduledKeyword);
    loadOwnedOrg.mockResolvedValueOnce(ownedFreeOrg);
    expect((await del()).status).toBe(402);

    KeywordRepo.findById.mockResolvedValueOnce(null);
    expect((await del()).status).toBe(404);
    expect(KeywordRepo.deleteUnstarted).not.toHaveBeenCalled();
  });
});
