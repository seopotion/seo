import {
  type Candidate,
  type CreateCandidateInput,
  CreateCandidateInput as CreateCandidateInputSchema,
  normalizeKeyword,
} from '@shared/schemas';
import { CandidateRepo } from '../repositories/candidate.repo';
import { KeywordRepo } from '../repositories/keyword.repo';

export async function persistStrategyCandidates(
  orgId: string,
  items: CreateCandidateInput[],
): Promise<Candidate[]> {
  const seen = new Set<string>();
  const prepared = items
    .map((item) => {
      const data = CreateCandidateInputSchema.parse({ ...item, org_id: orgId });
      return { data, normalized_keyword: normalizeKeyword(data.keyword) };
    })
    .filter(({ normalized_keyword }) => {
      if (seen.has(normalized_keyword)) return false;
      seen.add(normalized_keyword);
      return true;
    });
  const excludeNormalized = await KeywordRepo.scheduledNormalizedSet(orgId);
  const eligible = prepared.filter(
    ({ normalized_keyword }) => !excludeNormalized.has(normalized_keyword),
  );

  const persisted = await CandidateRepo.persistStrategyMany(
    orgId,
    eligible.map(({ data }) => data),
  );
  const byNormalized = new Map(
    persisted.map((candidate) => [candidate.normalized_keyword, candidate]),
  );
  return eligible.map(({ normalized_keyword }) => {
    const candidate = byNormalized.get(normalized_keyword);
    if (!candidate) {
      throw new Error(`strategy candidate persistence lost ${normalized_keyword}`);
    }
    return candidate;
  });
}
