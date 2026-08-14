import { beforeEach, describe, expect, test, vi } from 'vitest';

const repos = vi.hoisted(() => ({
  OrgRepo: { findById: vi.fn() },
  KeywordRepo: {
    findById: vi.fn(),
    listByOrg: vi.fn(),
    findByOrgAndDate: vi.fn(),
    reschedulePending: vi.fn(),
    deleteUnstarted: vi.fn(),
    resetGeneration: vi.fn(),
    updateBrief: vi.fn(),
  },
  CandidateRepo: { releaseAfterUnschedule: vi.fn() },
  AdminActionRepo: { insert: vi.fn() },
  isDuplicateKeyError: vi.fn((err: unknown) => (err as { code?: number })?.code === 11000),
}));
vi.mock('@shared/db', () => repos);

const { enqueueGenerateTask } = vi.hoisted(() => ({ enqueueGenerateTask: vi.fn() }));
vi.mock('../src/clients/sqs', () => ({ enqueueGenerateTask }));

import { testClient } from 'hono/testing';
import adminApp, { type AdminAppType } from '../src/admin';
import { signAdminToken } from '../src/admin/jwt';

const client = testClient<AdminAppType>(adminApp);

const authed = async () => ({
  headers: { Authorization: `Bearer ${await signAdminToken('op@example.com')}` },
});

const paidOrg = {
  id: 'a'.repeat(24),
  user_id: 'u'.repeat(24),
  website_url: 'https://example.com',
  setup_status: 'setup_complete' as const,
  plan: 'expert' as const,
  strategy_status: 'completed' as const,
  created_at: new Date('2026-06-01T00:00:00.000Z'),
};

const keyword = {
  id: 'k'.repeat(24),
  org_id: paidOrg.id,
  candidate_id: 'c'.repeat(24),
  keyword: 'crm software',
  status: 'scheduled' as const,
  scheduled_date: '2026-08-01',
  search_volume: 900,
  difficulty: 40,
  article_id: null,
  article_type: 'comparison' as const,
  intent: 'commercial' as const,
  opportunity_score: 12,
  serp_competitors: null,
  created_at: new Date('2026-07-01T00:00:00.000Z'),
  generation_status: 'pending' as const,
  generation_attempts: 2,
  generation_error: 'provider timeout',
  generation_started_at: new Date('2026-07-20T07:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  repos.AdminActionRepo.insert.mockResolvedValue({});
  repos.isDuplicateKeyError.mockImplementation(
    (err: unknown) => (err as { code?: number })?.code === 11000,
  );
});

describe('GET /admin/v0/orgs/{org_id}/planner', () => {
  test('rows include attempts / error / started_at', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(paidOrg);
    repos.KeywordRepo.listByOrg.mockResolvedValueOnce([keyword]);

    const res = await client.admin.v0.orgs[':org_id'].planner.$get(
      { param: { org_id: paidOrg.id } },
      await authed(),
    );
    if (res.status !== 200) throw new Error('expected 200');
    const json = await res.json();
    expect(json.strategy_status).toBe('completed');
    expect(json.keywords[0]).toMatchObject({
      generation_attempts: 2,
      generation_error: 'provider timeout',
      generation_started_at: '2026-07-20T07:00:00.000Z',
    });
  });
});

describe('PATCH /admin/v0/scheduled/{keyword_id}', () => {
  const reschedule = async (keyword_id: string, scheduled_date = '2026-08-05') =>
    client.admin.v0.scheduled[':keyword_id'].$patch(
      { param: { keyword_id }, json: { scheduled_date } },
      await authed(),
    );

  test('moves an ungenerated keyword and audits once', async () => {
    repos.KeywordRepo.findById.mockResolvedValueOnce(keyword);
    repos.KeywordRepo.findByOrgAndDate.mockResolvedValueOnce(null);
    repos.KeywordRepo.reschedulePending.mockResolvedValueOnce({
      ...keyword,
      scheduled_date: '2026-08-05',
    });

    const res = await reschedule(keyword.id);
    if (res.status !== 200) throw new Error('expected 200');
    expect((await res.json()).keyword.scheduled_date).toBe('2026-08-05');
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledTimes(1);
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'keyword.reschedule', before: keyword }),
    );
  });

  test('generation started (linked article) -> 409, no audit', async () => {
    repos.KeywordRepo.findById.mockResolvedValueOnce({ ...keyword, article_id: 'art_1' });
    const res = await reschedule(keyword.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'generation_started' });
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('destination date occupied -> 409 date_occupied', async () => {
    repos.KeywordRepo.findById.mockResolvedValueOnce(keyword);
    repos.KeywordRepo.findByOrgAndDate.mockResolvedValueOnce({ id: 'other' });
    const res = await reschedule(keyword.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'date_occupied' });
  });

  test('unique-index race -> 409 date_occupied', async () => {
    repos.KeywordRepo.findById.mockResolvedValueOnce(keyword);
    repos.KeywordRepo.findByOrgAndDate.mockResolvedValueOnce(null);
    repos.KeywordRepo.reschedulePending.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: 11000 }),
    );
    const res = await reschedule(keyword.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'date_occupied' });
  });

  test('same-date repeat is an idempotent no-op: 200, no audit', async () => {
    repos.KeywordRepo.findById.mockResolvedValueOnce(keyword);
    const res = await reschedule(keyword.id, keyword.scheduled_date);
    expect(res.status).toBe(200);
    expect(repos.KeywordRepo.reschedulePending).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });
});

describe('DELETE /admin/v0/scheduled/{keyword_id}', () => {
  test('unschedules, releases the candidate, audits, 204', async () => {
    repos.KeywordRepo.findById.mockResolvedValueOnce(keyword);
    repos.KeywordRepo.deleteUnstarted.mockResolvedValueOnce(keyword);

    const res = await client.admin.v0.scheduled[':keyword_id'].$delete(
      { param: { keyword_id: keyword.id } },
      await authed(),
    );
    expect(res.status).toBe(204);
    expect(repos.CandidateRepo.releaseAfterUnschedule).toHaveBeenCalledWith(keyword.candidate_id);
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'keyword.unschedule', before: keyword }),
    );
  });

  test('conditional miss -> 409 generation_started, no audit', async () => {
    repos.KeywordRepo.findById.mockResolvedValueOnce(keyword);
    repos.KeywordRepo.deleteUnstarted.mockResolvedValueOnce(null);

    const res = await client.admin.v0.scheduled[':keyword_id'].$delete(
      { param: { keyword_id: keyword.id } },
      await authed(),
    );
    expect(res.status).toBe(409);
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });
});

describe('POST /admin/v0/scheduled/{keyword_id}/generate', () => {
  const generate = async (keyword_id: string) =>
    client.admin.v0.scheduled[':keyword_id'].generate.$post(
      { param: { keyword_id } },
      await authed(),
    );

  test('unpaid org -> 409 org_not_paid, nothing enqueued, no audit', async () => {
    repos.KeywordRepo.findById.mockResolvedValueOnce(keyword);
    repos.OrgRepo.findById.mockResolvedValueOnce({ ...paidOrg, plan: 'free' });

    const res = await generate(keyword.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'org_not_paid' });
    expect(enqueueGenerateTask).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test.each([
    ['article already linked', { ...keyword, article_id: 'art_1' }],
    ['status generated', { ...keyword, generation_status: 'generated' as const }],
  ])('terminal keyword (%s) -> 409 generation_terminal', async (_name, kw) => {
    repos.KeywordRepo.findById.mockResolvedValueOnce(kw);
    repos.OrgRepo.findById.mockResolvedValueOnce(paidOrg);

    const res = await generate(keyword.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'generation_terminal' });
    expect(enqueueGenerateTask).not.toHaveBeenCalled();
  });

  test('failed keyword on a paid org enqueues (retry-now) and audits', async () => {
    repos.KeywordRepo.findById.mockResolvedValueOnce({
      ...keyword,
      generation_status: 'failed' as const,
    });
    repos.OrgRepo.findById.mockResolvedValueOnce(paidOrg);

    const res = await generate(keyword.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enqueued: true });
    expect(enqueueGenerateTask).toHaveBeenCalledWith({
      org_id: paidOrg.id,
      keyword_id: keyword.id,
    });
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'keyword.generate_now' }),
    );
  });
});

describe('POST /admin/v0/scheduled/{keyword_id}/reset', () => {
  const reset = async (keyword_id: string) =>
    client.admin.v0.scheduled[':keyword_id'].reset.$post({ param: { keyword_id } }, await authed());

  test('resets a failed keyword -> 204 + audit with before snapshot', async () => {
    const failed = { ...keyword, generation_status: 'failed' as const, generation_attempts: 3 };
    repos.KeywordRepo.findById.mockResolvedValueOnce(failed);
    repos.KeywordRepo.resetGeneration.mockResolvedValueOnce(true);

    const res = await reset(keyword.id);
    expect(res.status).toBe(204);
    expect(repos.KeywordRepo.resetGeneration).toHaveBeenCalledWith(keyword.id);
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'keyword.reset_generation', before: failed }),
    );
  });

  test('conditional miss (not failed / linked) -> 409 not_resettable, no audit', async () => {
    repos.KeywordRepo.findById.mockResolvedValueOnce(keyword); // pending
    repos.KeywordRepo.resetGeneration.mockResolvedValueOnce(false);

    const res = await reset(keyword.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_resettable' });
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });
});

describe('PATCH /admin/v0/scheduled/{keyword_id}/brief', () => {
  const patchBrief = async (
    keyword_id: string,
    body: {
      article_type?: 'listicle' | null;
      intent?: 'commercial' | null;
      opportunity_score?: number | null;
    },
  ) =>
    client.admin.v0.scheduled[':keyword_id'].brief.$patch(
      { param: { keyword_id }, json: body },
      await authed(),
    );

  test('updates the brief fields and audits with the old brief as before', async () => {
    repos.KeywordRepo.findById.mockResolvedValueOnce(keyword);
    repos.KeywordRepo.updateBrief.mockResolvedValueOnce({
      ...keyword,
      article_type: 'listicle' as const,
      opportunity_score: 99,
    });

    const res = await patchBrief(keyword.id, { article_type: 'listicle', opportunity_score: 99 });
    if (res.status !== 200) throw new Error('expected 200');
    const json = await res.json();
    expect(json.keyword.article_type).toBe('listicle');
    expect(repos.KeywordRepo.updateBrief).toHaveBeenCalledWith(keyword.id, {
      article_type: 'listicle',
      opportunity_score: 99,
    });
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'keyword.update_brief',
        before: {
          article_type: keyword.article_type,
          intent: keyword.intent,
          opportunity_score: keyword.opportunity_score,
        },
      }),
    );
  });

  test('conditional miss (generation started) -> 409, no audit', async () => {
    repos.KeywordRepo.findById.mockResolvedValueOnce(keyword);
    repos.KeywordRepo.updateBrief.mockResolvedValueOnce(null);

    const res = await patchBrief(keyword.id, { intent: 'commercial' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'generation_started' });
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('empty patch -> 400 (at least one field required)', async () => {
    const res = await patchBrief(keyword.id, {});
    expect(res.status).toBe(400);
    expect(repos.KeywordRepo.findById).not.toHaveBeenCalled();
  });
});
