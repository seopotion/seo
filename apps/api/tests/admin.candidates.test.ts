import { beforeEach, describe, expect, test, vi } from 'vitest';

const repos = vi.hoisted(() => ({
  OrgRepo: { findById: vi.fn() },
  CandidateRepo: {
    findById: vi.fn(),
    listByOrg: vi.fn(),
    rejectIfCandidate: vi.fn(),
    restoreRejected: vi.fn(),
  },
  AdminActionRepo: { insert: vi.fn() },
  PromoCodeRepo: {
    create: vi.fn(),
    findByCode: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    deactivate: vi.fn(),
  },
  PromoRedemptionRepo: { countConfirmed: vi.fn(), listByCode: vi.fn() },
  addCandidates: vi.fn(),
  scheduleCandidate: vi.fn(),
}));
vi.mock('@shared/db', () => repos);

const provider = vi.hoisted(() => ({
  bulkKeywordDifficulty: vi.fn(),
  keywordIdeas: vi.fn(),
}));
vi.mock('../src/clients/providers', () => ({ getDataForSeoClient: () => provider }));

import { DataForSeoError } from '@shared/providers';
import { testClient } from 'hono/testing';
import adminApp, { type AdminAppType } from '../src/admin';
import { signAdminToken } from '../src/admin/jwt';

const client = testClient<AdminAppType>(adminApp);

const authed = async () => ({
  headers: { Authorization: `Bearer ${await signAdminToken('op@example.com')}` },
});

// A FREE org — admin research and curation must not be paid-gated.
const org = {
  id: 'a'.repeat(24),
  user_id: 'u'.repeat(24),
  website_url: 'https://example.com',
  setup_status: 'setup_complete' as const,
  plan: 'free' as const,
  strategy_status: 'none' as const,
  presets: { business: { name: 'X', language: 'en', country: 'US', description: 'd' } },
  created_at: new Date('2026-06-01T00:00:00.000Z'),
};

const rejectedCandidate = {
  id: 'c'.repeat(24),
  org_id: org.id,
  keyword: 'crm software',
  normalized_keyword: 'crm software',
  source: 'keyword_ideas' as const,
  source_context: null,
  search_volume: 900,
  difficulty: 40,
  cpc: null,
  competition: null,
  trend: null,
  intent: 'commercial' as const,
  serp_competitors: [{ rank: 1, url: 'https://big.com/x', domain: 'big.com', title: 'Big' }],
  relevance_score: 0.4,
  opportunity_score: 12,
  article_type: 'comparison' as const,
  rejection_reason: 'serp_authority' as const,
  status: 'rejected' as const,
  created_at: new Date('2026-07-01T00:00:00.000Z'),
  updated_at: new Date('2026-07-01T00:00:00.000Z'),
};

const metric = {
  keyword: 'crm tips',
  search_volume: 100,
  difficulty: 10,
  cpc: null,
  competition: null,
  trend: null,
  intent: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  repos.AdminActionRepo.insert.mockResolvedValue({});
});

describe('POST /admin/v0/orgs/{org_id}/research', () => {
  test('works on a free org (no paid gate) and is not audited', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    provider.bulkKeywordDifficulty.mockResolvedValueOnce([{ ...metric, search_volume: 100.6 }]);
    provider.keywordIdeas.mockResolvedValueOnce([
      { ...metric, keyword: 'crm tips' }, // equals seed -> deduped out
      { ...metric, keyword: 'crm guide', difficulty: 9.4 },
    ]);

    const res = await client.admin.v0.orgs[':org_id'].research.$post(
      { param: { org_id: org.id }, json: { seed: 'crm tips' } },
      await authed(),
    );
    if (res.status !== 200) throw new Error('expected 200');
    const json = await res.json();
    expect(json.seed.search_volume).toBe(101); // normMetric rounds
    expect(json.similar).toHaveLength(1);
    expect(json.similar[0]?.difficulty).toBe(9);
    // Provider location comes from the org presets.
    expect(provider.keywordIdeas).toHaveBeenCalledWith(
      expect.objectContaining({ locationName: 'US', languageName: 'en' }),
    );
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('provider failure -> 502 keyword_provider_failed', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    provider.bulkKeywordDifficulty.mockRejectedValueOnce(new DataForSeoError('auth', 'down'));
    provider.keywordIdeas.mockResolvedValueOnce([]);

    const res = await client.admin.v0.orgs[':org_id'].research.$post(
      { param: { org_id: org.id }, json: { seed: 'crm' } },
      await authed(),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'keyword_provider_failed' });
  });
});

describe('GET /admin/v0/orgs/{org_id}/candidates', () => {
  test('omitted status returns the whole pool, rows carry operator-only fields', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    repos.CandidateRepo.listByOrg.mockResolvedValueOnce({
      candidates: [rejectedCandidate],
      total: 1,
    });

    const res = await client.admin.v0.orgs[':org_id'].candidates.$get(
      { param: { org_id: org.id }, query: {} },
      await authed(),
    );
    if (res.status !== 200) throw new Error('expected 200');
    const json = await res.json();
    expect(repos.CandidateRepo.listByOrg).toHaveBeenCalledWith(org.id, {
      status: undefined,
      limit: 50,
      offset: 0,
    });
    expect(json.candidates[0]).toMatchObject({
      status: 'rejected',
      rejection_reason: 'serp_authority',
      relevance_score: 0.4,
    });
    expect(json.candidates[0]?.serp_competitors?.[0]?.domain).toBe('big.com');
  });
});

describe('POST /admin/v0/orgs/{org_id}/candidates', () => {
  test("adds with source 'manual' and writes one audit row", async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    repos.addCandidates.mockResolvedValueOnce([{ id: 'new_1' }]);

    const res = await client.admin.v0.orgs[':org_id'].candidates.$post(
      { param: { org_id: org.id }, json: { keywords: [metric, { ...metric, keyword: 'dup' }] } },
      await authed(),
    );
    if (res.status !== 200) throw new Error('expected 200');
    expect(await res.json()).toEqual({ added: 1, skipped: 1 });
    expect(repos.addCandidates).toHaveBeenCalledWith(org.id, [
      expect.objectContaining({ keyword: 'crm tips', source: 'manual', status: 'candidate' }),
      expect.objectContaining({ keyword: 'dup', source: 'manual' }),
    ]);
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledTimes(1);
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'candidate.add', org_id: org.id, before: null }),
    );
  });
});

describe('POST /admin/v0/candidates/{candidate_id}/schedule', () => {
  const schedule = async (candidate_id: string) =>
    client.admin.v0.candidates[':candidate_id'].schedule.$post(
      { param: { candidate_id }, json: { scheduled_date: '2026-08-01' } },
      await authed(),
    );

  test('created -> 201 with the admin planner row + audit', async () => {
    repos.CandidateRepo.findById.mockResolvedValueOnce(rejectedCandidate);
    repos.scheduleCandidate.mockResolvedValueOnce({
      ok: true,
      created: true,
      keyword: {
        id: 'k'.repeat(24),
        candidate_id: rejectedCandidate.id,
        keyword: rejectedCandidate.keyword,
        status: 'scheduled',
        scheduled_date: '2026-08-01',
        search_volume: 900,
        difficulty: 40,
        article_type: 'comparison',
        intent: 'commercial',
        opportunity_score: 12,
        generation_status: 'pending',
        generation_error: null,
        article_id: null,
        generation_attempts: 0,
        generation_started_at: null,
      },
    });

    const res = await schedule(rejectedCandidate.id);
    if (res.status !== 201) throw new Error('expected 201');
    const json = await res.json();
    expect(json.keyword.generation_attempts).toBe(0);
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'candidate.schedule',
        entity: { type: 'candidate', id: rejectedCandidate.id },
        before: rejectedCandidate,
      }),
    );
  });

  test('conflict -> mapped 409, no audit', async () => {
    repos.CandidateRepo.findById.mockResolvedValueOnce(rejectedCandidate);
    repos.scheduleCandidate.mockResolvedValueOnce({ ok: false, reason: 'date_occupied' });

    const res = await schedule(rejectedCandidate.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'date_occupied' });
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('unknown candidate -> 404', async () => {
    repos.CandidateRepo.findById.mockResolvedValueOnce(null);
    const res = await schedule('f'.repeat(24));
    expect(res.status).toBe(404);
  });
});

describe('DELETE /admin/v0/candidates/{candidate_id}', () => {
  test('conditional reject -> 204 + audit with before snapshot', async () => {
    repos.CandidateRepo.findById.mockResolvedValueOnce({
      ...rejectedCandidate,
      status: 'candidate',
    });
    repos.CandidateRepo.rejectIfCandidate.mockResolvedValueOnce(true);

    const res = await client.admin.v0.candidates[':candidate_id'].$delete(
      { param: { candidate_id: rejectedCandidate.id } },
      await authed(),
    );
    expect(res.status).toBe(204);
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'candidate.reject' }),
    );
  });

  test('conditional miss -> 409 candidate_not_deletable, no audit', async () => {
    repos.CandidateRepo.findById.mockResolvedValueOnce(rejectedCandidate);
    repos.CandidateRepo.rejectIfCandidate.mockResolvedValueOnce(false);

    const res = await client.admin.v0.candidates[':candidate_id'].$delete(
      { param: { candidate_id: rejectedCandidate.id } },
      await authed(),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'candidate_not_deletable' });
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });
});

describe('POST /admin/v0/candidates/{candidate_id}/restore', () => {
  const restore = async (candidate_id: string) =>
    client.admin.v0.candidates[':candidate_id'].restore.$post(
      { param: { candidate_id } },
      await authed(),
    );

  test('restores a rejected candidate -> 204 + audit with before snapshot', async () => {
    repos.CandidateRepo.findById.mockResolvedValueOnce(rejectedCandidate);
    repos.CandidateRepo.restoreRejected.mockResolvedValueOnce(true);

    const res = await restore(rejectedCandidate.id);
    expect(res.status).toBe(204);
    expect(repos.CandidateRepo.restoreRejected).toHaveBeenCalledWith(rejectedCandidate.id);
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'candidate.restore', before: rejectedCandidate }),
    );
  });

  test('conditional miss (not rejected) -> 409 candidate_not_restorable, no audit', async () => {
    repos.CandidateRepo.findById.mockResolvedValueOnce({
      ...rejectedCandidate,
      status: 'candidate',
    });
    repos.CandidateRepo.restoreRejected.mockResolvedValueOnce(false);

    const res = await restore(rejectedCandidate.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'candidate_not_restorable' });
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });
});
