import type { Candidate, Keyword } from '@shared/schemas';
import { MongoServerError } from 'mongodb';
import { CandidateRepo } from '../repositories/candidate.repo';
import { KeywordRepo } from '../repositories/keyword.repo';

export type ScheduleConflict =
  | 'candidate_not_schedulable'
  | 'candidate_already_scheduled'
  | 'date_occupied'
  | 'keyword_already_scheduled';

export type ScheduleResult =
  | { ok: true; created: boolean; keyword: Keyword }
  | { ok: false; reason: ScheduleConflict };

/**
 * Duplicate-key check for callers outside this package (routes must not
 * import the Mongo driver directly).
 */
export function isDuplicateKeyError(err: unknown): boolean {
  return err instanceof MongoServerError && err.code === 11000;
}

/** Which unique keyword index a duplicate-key error tripped. */
function dupKey(err: unknown): 'date' | 'keyword' | 'candidate' | null {
  if (!(err instanceof MongoServerError) || err.code !== 11000) return null;
  const kp = (err.keyPattern ?? {}) as Record<string, unknown>;
  if ('scheduled_date' in kp) return 'date';
  if ('normalized_keyword' in kp) return 'keyword';
  if ('candidate_id' in kp) return 'candidate';
  return null;
}

/**
 * Schedule a candidate onto the planner (#99). No transactions (standalone
 * Mongo has none): the conditional candidate claim plus the unique keyword
 * indexes (org/date, org/normalized_keyword, org/candidate_id) are the
 * invariants, and every failure path reconciles — release the claim on a
 * conflict, return the existing keyword on a retry — so the operation is
 * idempotent and safe under concurrency. Shared by
 * POST /keywords/candidates/{id}/schedule and the strategy worker.
 */
export async function scheduleCandidate(
  candidate: Candidate,
  scheduledDate: string,
): Promise<ScheduleResult> {
  // An unknown difficulty is fine (#304); only the search volume is required.
  if (candidate.search_volume === null || candidate.status === 'rejected') {
    return { ok: false, reason: 'candidate_not_schedulable' };
  }

  // Idempotency: an existing planner entry for this candidate wins.
  const existing = await KeywordRepo.findByCandidateId(candidate.org_id, candidate.id);
  if (existing) {
    return existing.scheduled_date === scheduledDate
      ? { ok: true, created: false, keyword: existing }
      : { ok: false, reason: 'candidate_already_scheduled' };
  }

  const claimed = await CandidateRepo.claimForScheduling(candidate.id);
  if (!claimed) {
    // Not claimable: a concurrent/prior claim, or the candidate is gone/rejected.
    const current = await CandidateRepo.findById(candidate.id);
    if (!current || current.status === 'rejected') {
      return { ok: false, reason: 'candidate_not_schedulable' };
    }
    const kw = await KeywordRepo.findByCandidateId(candidate.org_id, candidate.id);
    if (kw) {
      return kw.scheduled_date === scheduledDate
        ? { ok: true, created: false, keyword: kw }
        : { ok: false, reason: 'candidate_already_scheduled' };
    }
    // `selected` but no keyword: a prior attempt died between claim and insert.
    // Fall through and finish the job — the unique indexes arbitrate races.
  }

  try {
    const keyword = await KeywordRepo.createFromCandidate(candidate, scheduledDate);
    return { ok: true, created: true, keyword };
  } catch (err) {
    const dup = dupKey(err);
    if (dup === null) throw err;
    if (dup === 'candidate') {
      // A concurrent request won the insert for this candidate.
      const kw = await KeywordRepo.findByCandidateId(candidate.org_id, candidate.id);
      if (kw && kw.scheduled_date === scheduledDate) {
        return { ok: true, created: false, keyword: kw };
      }
      return { ok: false, reason: 'candidate_already_scheduled' };
    }
    // Same-keyword retries also surface as 'keyword' (identical normalization):
    // treat an existing entry for this candidate as the idempotent success.
    if (dup === 'keyword') {
      const kw = await KeywordRepo.findByCandidateId(candidate.org_id, candidate.id);
      if (kw) {
        return kw.scheduled_date === scheduledDate
          ? { ok: true, created: false, keyword: kw }
          : { ok: false, reason: 'candidate_already_scheduled' };
      }
    }
    await CandidateRepo.releaseAfterUnschedule(candidate.id);
    return { ok: false, reason: dup === 'date' ? 'date_occupied' : 'keyword_already_scheduled' };
  }
}
