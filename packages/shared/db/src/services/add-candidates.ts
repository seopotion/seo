import type { Candidate, CreateCandidateInput } from '@shared/schemas';
import { CandidateRepo } from '../repositories/candidate.repo';
import { KeywordRepo } from '../repositories/keyword.repo';

/**
 * Persist candidates into the pool, deduping against both existing candidates
 * (handled by CandidateRepo) and keywords already scheduled on the planner.
 * Shared by manual/API candidate-pool callers.
 */
export async function addCandidates(
  orgId: string,
  items: CreateCandidateInput[],
): Promise<Candidate[]> {
  const excludeNormalized = await KeywordRepo.scheduledNormalizedSet(orgId);
  return CandidateRepo.insertMany(orgId, items, { excludeNormalized });
}
