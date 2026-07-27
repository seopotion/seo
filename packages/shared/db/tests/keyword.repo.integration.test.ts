import { MongoServerError } from 'mongodb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { ensureIndexes } from '../src/ensure-indexes';
import { CandidateRepo } from '../src/repositories/candidate.repo';
import { KeywordRepo } from '../src/repositories/keyword.repo';

/**
 * Real-MongoDB round-trip. Run with `npm run test:integration` after
 * `docker compose up -d mongo`.
 */
describe('KeywordRepo (integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('keywords').deleteMany({});
    await ensureIndexes(); // unique planner indexes (#99) drive the conflict tests
  });

  afterAll(async () => {
    await closeDb();
  });

  test('create + listByOrg orders by scheduled_date asc', async () => {
    await KeywordRepo.create({
      org_id: 'org_kw',
      keyword: 'later',
      status: 'scheduled',
      scheduled_date: '2026-07-05',
      search_volume: 100,
      difficulty: 10,
      article_id: null,
    });
    await KeywordRepo.create({
      org_id: 'org_kw',
      keyword: 'earlier',
      status: 'scheduled',
      scheduled_date: '2026-07-02',
      search_volume: 200,
      difficulty: 20,
      article_id: null,
    });

    const list = await KeywordRepo.listByOrg('org_kw');
    expect(list.map((k) => k.keyword)).toEqual(['earlier', 'later']);
    expect(list[0]!.id).toMatch(/^[a-f0-9]{24}$/);
    expect(list[0]!.created_at).toBeInstanceOf(Date);
  });

  test('countScheduled counts only this org', async () => {
    expect(await KeywordRepo.countScheduled('org_kw')).toBe(2);
    expect(await KeywordRepo.countScheduled('other_org')).toBe(0);
  });

  test('setArticleId links an article to the keyword', async () => {
    const k = await KeywordRepo.create({
      org_id: 'org_link',
      keyword: 'link me',
      status: 'scheduled',
      scheduled_date: '2026-07-03',
      search_volume: 50,
      difficulty: 5,
      article_id: null,
    });
    await KeywordRepo.setArticleId(k.id, 'art_123');
    const [reloaded] = await KeywordRepo.listByOrg('org_link');
    expect(reloaded!.article_id).toBe('art_123');
  });

  test('claimGeneration is atomic and single-winner; linkArticle links', async () => {
    const k = await KeywordRepo.create({
      org_id: 'org_gen',
      keyword: 'claim me',
      status: 'scheduled',
      scheduled_date: '2026-07-01',
      search_volume: 10,
      difficulty: 1,
      article_id: null,
    });

    const [a, b] = await Promise.all([
      KeywordRepo.claimGeneration(k.id),
      KeywordRepo.claimGeneration(k.id),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1); // exactly one wins

    const claimed = await KeywordRepo.findById(k.id);
    expect(claimed!.generation_status).toBe('generating');
    expect(claimed!.generation_attempts).toBe(1);

    await KeywordRepo.linkArticle(k.id, 'art_gen');
    const linked = await KeywordRepo.findById(k.id);
    expect(linked!.article_id).toBe('art_gen');
    expect(linked!.generation_status).toBe('generated');
  });

  test('failGeneration records the error and status', async () => {
    const k = await KeywordRepo.create({
      org_id: 'org_gen',
      keyword: 'fail me',
      status: 'scheduled',
      // Distinct from 'claim me': unique (org_id, scheduled_date) index (#99).
      scheduled_date: '2026-07-02',
      search_volume: 10,
      difficulty: 1,
      article_id: null,
    });
    await KeywordRepo.claimGeneration(k.id);
    await KeywordRepo.failGeneration(k.id, 'boom');
    const reloaded = await KeywordRepo.findById(k.id);
    expect(reloaded!.generation_status).toBe('failed');
    expect(reloaded!.generation_error).toBe('boom');
  });

  test('listDueForGeneration excludes future, linked, generated, and capped entries', async () => {
    const db = await getDb();
    await db.collection('keywords').deleteMany({ org_id: 'org_due' });
    const mk = (over: Record<string, unknown>) =>
      KeywordRepo.create({
        org_id: 'org_due',
        keyword: `k-${Math.random()}`,
        status: 'scheduled',
        scheduled_date: '2026-07-01',
        search_volume: 10,
        difficulty: 1,
        article_id: null,
        ...over,
      });
    // Distinct dates: keywords carry a unique (org_id, scheduled_date) index (#99).
    const due = await mk({ scheduled_date: '2026-07-01' });
    await mk({ scheduled_date: '2999-01-01' }); // future
    const linked = await mk({ scheduled_date: '2026-07-02' });
    await KeywordRepo.linkArticle(linked.id, 'x'); // linked + generated
    const capped = await mk({ scheduled_date: '2026-07-03' });
    await db.collection('keywords').updateOne(
      { _id: (await import('mongodb')).ObjectId.createFromHexString(capped.id) },
      {
        $set: { generation_attempts: 3, generation_status: 'failed' },
      },
    );

    const result = await KeywordRepo.listDueForGeneration('2026-07-08', 3);
    const ids = result.map((k) => k.id);
    expect(ids).toContain(due.id);
    expect(ids).not.toContain(linked.id);
    expect(ids).not.toContain(capped.id);
    expect(result.every((k) => k.scheduled_date <= '2026-07-08')).toBe(true);
  });

  test('createFromCandidate copies metrics/classification and links candidate_id', async () => {
    const db = await getDb();
    await db.collection('candidates').deleteMany({ org_id: 'org_sched' });
    const [cand] = await CandidateRepo.insertMany('org_sched', [
      {
        org_id: 'org_sched',
        keyword: 'Best CRM Software',
        source: 'manual',
        search_volume: 1000,
        difficulty: 32,
        cpc: 4.5,
        intent: 'commercial',
        article_type: 'comparison',
        opportunity_score: 0.9,
        serp_competitors: [
          { rank: 1, url: 'https://a.com/crm', domain: 'a.com', title: 'Best CRMs' },
        ],
      },
    ]);

    const kw = await KeywordRepo.createFromCandidate(cand!, '2026-09-01');
    expect(kw.candidate_id).toBe(cand!.id);
    expect(kw.keyword).toBe('Best CRM Software');
    expect(kw.normalized_keyword).toBe('best crm software');
    expect(kw.status).toBe('scheduled');
    expect(kw.scheduled_date).toBe('2026-09-01');
    expect(kw.search_volume).toBe(1000);
    expect(kw.difficulty).toBe(32);
    expect(kw.article_type).toBe('comparison');
    expect(kw.intent).toBe('commercial');
    expect(kw.opportunity_score).toBe(0.9);
    expect(kw.serp_competitors).toEqual([
      { rank: 1, url: 'https://a.com/crm', domain: 'a.com', title: 'Best CRMs' },
    ]);
    expect(kw.article_id).toBeNull();
    expect(kw.generation_status).toBe('pending');

    expect(await KeywordRepo.findByCandidateId('org_sched', cand!.id)).not.toBeNull();
    expect(await KeywordRepo.findByOrgAndDate('org_sched', '2026-09-01')).not.toBeNull();
    expect(await KeywordRepo.findByOrgAndDate('other_org', '2026-09-01')).toBeNull();
  });

  test('unique indexes reject occupied date / duplicate keyword / re-scheduled candidate', async () => {
    const [other] = await CandidateRepo.insertMany('org_sched', [
      {
        org_id: 'org_sched',
        keyword: 'crm pricing',
        source: 'manual',
        search_volume: 10,
        difficulty: 5,
      },
    ]);

    // Occupied date.
    const dateErr = await KeywordRepo.createFromCandidate(other!, '2026-09-01').catch((e) => e);
    expect(dateErr).toBeInstanceOf(MongoServerError);
    expect((dateErr as MongoServerError).keyPattern).toHaveProperty('scheduled_date');

    // Same candidate again on a free date: the identical keyword text trips
    // the normalized index first — still a rejection.
    const stored = await CandidateRepo.findByNormalized('org_sched', 'best crm software');
    const retryErr = await KeywordRepo.createFromCandidate(stored!, '2026-09-05').catch((e) => e);
    expect((retryErr as MongoServerError).code).toBe(11000);

    // Same candidate with different keyword text: the candidate index fires.
    const candErr = await KeywordRepo.create({
      org_id: 'org_sched',
      candidate_id: stored!.id,
      keyword: 'renamed keyword text',
      status: 'scheduled',
      scheduled_date: '2026-09-05',
      search_volume: 1,
      difficulty: 1,
      article_id: null,
    }).catch((e) => e);
    expect((candErr as MongoServerError).keyPattern).toHaveProperty('candidate_id');

    // Same normalized keyword via a different candidate row.
    await getDb().then((db) =>
      db
        .collection('candidates')
        .updateOne(
          { org_id: 'org_sched', normalized_keyword: 'crm pricing' },
          { $set: { keyword: 'Best  CRM  software', normalized_keyword: 'best crm software x' } },
        ),
    );
    const renamed = await CandidateRepo.findById(other!.id);
    const kwErr = await KeywordRepo.createFromCandidate(renamed!, '2026-09-06').catch((e) => e);
    expect((kwErr as MongoServerError).keyPattern).toHaveProperty('normalized_keyword');
  });

  test('reschedulePending moves only unlinked pending entries', async () => {
    const stored = await CandidateRepo.findByNormalized('org_sched', 'best crm software');
    const kw = await KeywordRepo.findByCandidateId('org_sched', stored!.id);

    const moved = await KeywordRepo.reschedulePending(kw!.id, '2026-09-10');
    expect(moved?.scheduled_date).toBe('2026-09-10');

    // Once generating, the conditional update no longer matches.
    await KeywordRepo.claimGeneration(kw!.id);
    expect(await KeywordRepo.reschedulePending(kw!.id, '2026-09-11')).toBeNull();
  });

  test('deleteUnstarted removes pending/failed entries but never linked ones', async () => {
    const db = await getDb();
    const mk = (kw: string, date: string) =>
      KeywordRepo.create({
        org_id: 'org_del',
        keyword: kw,
        status: 'scheduled',
        scheduled_date: date,
        search_volume: 1,
        difficulty: 1,
        article_id: null,
      });
    await db.collection('keywords').deleteMany({ org_id: 'org_del' });

    const pending = await mk('delete pending', '2026-10-01');
    expect((await KeywordRepo.deleteUnstarted(pending.id))?.id).toBe(pending.id);

    const linked = await mk('delete linked', '2026-10-02');
    await KeywordRepo.linkArticle(linked.id, 'art_x');
    expect(await KeywordRepo.deleteUnstarted(linked.id)).toBeNull();

    const generating = await mk('delete generating', '2026-10-03');
    await KeywordRepo.claimGeneration(generating.id);
    expect(await KeywordRepo.deleteUnstarted(generating.id)).toBeNull();
  });

  test('resetGeneration resets only failed, unlinked keywords (attempts back to 0)', async () => {
    const mk = (kw: string, date: string) =>
      KeywordRepo.create({
        org_id: 'org_reset',
        keyword: kw,
        status: 'scheduled',
        scheduled_date: date,
        search_volume: 1,
        difficulty: 1,
        article_id: null,
      });

    // Burn attempts to the cap, then fail — the over-cap scenario (epic #150).
    const failed = await mk('reset failed', '2026-11-01');
    for (let i = 0; i < 3; i++) {
      await KeywordRepo.claimGeneration(failed.id);
      await KeywordRepo.failGeneration(failed.id, 'boom');
    }
    expect((await KeywordRepo.findById(failed.id))!.generation_attempts).toBe(3);

    expect(await KeywordRepo.resetGeneration(failed.id)).toBe(true);
    const reset = await KeywordRepo.findById(failed.id);
    expect(reset!.generation_status).toBe('pending');
    expect(reset!.generation_attempts).toBe(0);
    expect(reset!.generation_error).toBeNull();

    // Pending (never failed) does not reset.
    const pending = await mk('reset pending', '2026-11-02');
    expect(await KeywordRepo.resetGeneration(pending.id)).toBe(false);

    // In-flight does not reset.
    const generating = await mk('reset generating', '2026-11-03');
    await KeywordRepo.claimGeneration(generating.id);
    expect(await KeywordRepo.resetGeneration(generating.id)).toBe(false);

    // Linked (article exists) does not reset even if failed.
    const linked = await mk('reset linked', '2026-11-04');
    await KeywordRepo.claimGeneration(linked.id);
    await KeywordRepo.failGeneration(linked.id, 'boom');
    await KeywordRepo.setArticleId(linked.id, 'art_x');
    expect(await KeywordRepo.resetGeneration(linked.id)).toBe(false);
  });

  test('updateBrief edits type/intent/score only while pending + unlinked', async () => {
    const kw = await KeywordRepo.create({
      org_id: 'org_brief',
      keyword: 'brief target',
      status: 'scheduled',
      scheduled_date: '2026-11-10',
      search_volume: 1,
      difficulty: 1,
      article_id: null,
    });

    const updated = await KeywordRepo.updateBrief(kw.id, {
      article_type: 'listicle',
      opportunity_score: 42,
    });
    expect(updated!.article_type).toBe('listicle');
    expect(updated!.opportunity_score).toBe(42);
    expect(updated!.intent).toBeNull(); // untouched field survives

    // Locked once generation starts.
    await KeywordRepo.claimGeneration(kw.id);
    expect(await KeywordRepo.updateBrief(kw.id, { intent: 'commercial' })).toBeNull();
  });
});
