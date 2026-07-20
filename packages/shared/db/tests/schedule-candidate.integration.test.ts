import type { Candidate } from '@shared/schemas';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { ensureIndexes } from '../src/ensure-indexes';
import { CandidateRepo } from '../src/repositories/candidate.repo';
import { KeywordRepo } from '../src/repositories/keyword.repo';
import { scheduleCandidate } from '../src/services/schedule-candidate';

const ORG = 'org_schedule_service';

async function seedCandidate(
  keyword: string,
  over: Partial<Parameters<typeof CandidateRepo.insertMany>[1][number]> = {},
): Promise<Candidate> {
  const [cand] = await CandidateRepo.insertMany(ORG, [
    {
      org_id: ORG,
      keyword,
      source: 'manual',
      search_volume: 100,
      difficulty: 20,
      intent: 'commercial',
      article_type: 'comparison',
      opportunity_score: 0.5,
      ...over,
    },
  ]);
  return cand!;
}

describe('scheduleCandidate (integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('keywords').deleteMany({ org_id: ORG });
    await db.collection('candidates').deleteMany({ org_id: ORG });
    await ensureIndexes();
  });

  afterAll(async () => {
    const db = await getDb();
    await db.collection('keywords').deleteMany({ org_id: ORG });
    await db.collection('candidates').deleteMany({ org_id: ORG });
    await closeDb();
  });

  test('happy path: creates the keyword, copies fields, selects the candidate', async () => {
    const cand = await seedCandidate('alpha keyword');
    const res = await scheduleCandidate(cand, '2026-11-01');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.created).toBe(true);
    expect(res.keyword.candidate_id).toBe(cand.id);
    expect(res.keyword.scheduled_date).toBe('2026-11-01');
    expect(res.keyword.search_volume).toBe(100);
    expect(res.keyword.article_type).toBe('comparison');
    expect(res.keyword.generation_status).toBe('pending');
    expect((await CandidateRepo.findById(cand.id))!.status).toBe('selected');
  });

  test('idempotent retry (same candidate + date) returns the existing keyword', async () => {
    const cand = (await CandidateRepo.findByNormalized(ORG, 'alpha keyword'))!;
    const res = await scheduleCandidate(cand, '2026-11-01');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.created).toBe(false);
    expect(await KeywordRepo.findByCandidateId(ORG, cand.id).then((k) => k?.id)).toBe(
      res.keyword.id,
    );
  });

  test('same candidate on a different date conflicts', async () => {
    const cand = (await CandidateRepo.findByNormalized(ORG, 'alpha keyword'))!;
    const res = await scheduleCandidate(cand, '2026-11-02');
    expect(res).toEqual({ ok: false, reason: 'candidate_already_scheduled' });
  });

  test('occupied date conflicts and releases the claimed candidate', async () => {
    const cand = await seedCandidate('beta keyword');
    const res = await scheduleCandidate(cand, '2026-11-01'); // alpha's date
    expect(res).toEqual({ ok: false, reason: 'date_occupied' });
    expect((await CandidateRepo.findById(cand.id))!.status).toBe('candidate'); // released
  });

  test('duplicate normalized keyword via another candidate conflicts and releases', async () => {
    const cand = await seedCandidate('gamma keyword');
    // Rename so its normalized_keyword collides with the scheduled alpha entry.
    const db = await getDb();
    await db
      .collection('candidates')
      .updateOne(
        { org_id: ORG, normalized_keyword: 'gamma keyword' },
        { $set: { keyword: 'Alpha  Keyword', normalized_keyword: 'alpha keyword 2' } },
      );
    const renamed = (await CandidateRepo.findById(cand.id))!;
    const res = await scheduleCandidate(renamed, '2026-11-03');
    expect(res).toEqual({ ok: false, reason: 'keyword_already_scheduled' });
    expect((await CandidateRepo.findById(cand.id))!.status).toBe('candidate');
  });

  test('missing metrics or rejected status are not schedulable', async () => {
    const noMetrics = await seedCandidate('no metrics kw', { search_volume: null });
    expect(await scheduleCandidate(noMetrics, '2026-11-04')).toEqual({
      ok: false,
      reason: 'candidate_not_schedulable',
    });

    const rejected = await seedCandidate('rejected kw');
    await CandidateRepo.setStatus(rejected.id, 'rejected');
    const reloaded = (await CandidateRepo.findById(rejected.id))!;
    expect(await scheduleCandidate(reloaded, '2026-11-04')).toEqual({
      ok: false,
      reason: 'candidate_not_schedulable',
    });
  });

  test('concurrent: two candidates racing for one date -> exactly one wins', async () => {
    const c1 = await seedCandidate('race date one');
    const c2 = await seedCandidate('race date two');
    const [r1, r2] = await Promise.all([
      scheduleCandidate(c1, '2026-11-10'),
      scheduleCandidate(c2, '2026-11-10'),
    ]);
    const wins = [r1, r2].filter((r) => r.ok);
    const losses = [r1, r2].filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toEqual([{ ok: false, reason: 'date_occupied' }]);
    // The loser's candidate returned to the pool.
    const loser = losses[0] === r1 ? c1 : c2;
    expect((await CandidateRepo.findById(loser.id))!.status).toBe('candidate');
  });

  test('concurrent: one candidate racing for two dates -> exactly one keyword', async () => {
    const cand = await seedCandidate('race self');
    const [r1, r2] = await Promise.all([
      scheduleCandidate(cand, '2026-11-11'),
      scheduleCandidate(cand, '2026-11-12'),
    ]);
    expect([r1, r2].filter((r) => r.ok && r.created)).toHaveLength(1);
    const db = await getDb();
    expect(
      await db.collection('keywords').countDocuments({ org_id: ORG, candidate_id: cand.id }),
    ).toBe(1);
  });

  test('reconciles a partial state: selected candidate without a keyword', async () => {
    const cand = await seedCandidate('partial state kw');
    // Simulate a crash between claim and insert.
    await CandidateRepo.claimForScheduling(cand.id);
    const res = await scheduleCandidate((await CandidateRepo.findById(cand.id))!, '2026-11-20');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.created).toBe(true);
    expect(res.keyword.scheduled_date).toBe('2026-11-20');
  });
});
