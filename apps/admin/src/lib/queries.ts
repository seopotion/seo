import type { CandidateStatus } from '@shared/schemas';
import { ApiError, adminApi, unwrap, unwrapEmpty } from './api';

/**
 * Admin API calls used by the org workspace. Each returns plain data or throws
 * an `ApiError` carrying the API's error code, so components only ever deal
 * with React Query's `data` / `error`.
 */

export async function searchOrgs(query: string) {
  return unwrap(await adminApi.admin.v0.orgs.$get({ query: { query } }));
}

export type OrgSummary = Awaited<ReturnType<typeof searchOrgs>>['orgs'][number];

export async function fetchOrg(orgId: string) {
  const res = await adminApi.admin.v0.orgs[':org_id'].$get({ param: { org_id: orgId } });
  // Narrowed before `unwrap` so the success payload is the only shape callers
  // see; the workspace renders its own "not found" state off this code.
  if (res.status === 404) throw new ApiError('not_found', 404);
  return unwrap(res);
}

/** The full org-detail DTO — inferred from the client, so route changes land here. */
export type OrgDetail = Awaited<ReturnType<typeof fetchOrg>>;
export type Plan = OrgDetail['org']['plan'];

export async function setPlan(orgId: string, plan: Plan) {
  return unwrap(
    await adminApi.admin.v0.orgs[':org_id'].plan.$post({
      param: { org_id: orgId },
      json: { plan },
    }),
  );
}

// --- Candidate pool ---

/** One page of the pool. The API paginates; 50 rows is its own default too. */
export const POOL_PAGE_SIZE = 50;

export async function fetchCandidates(orgId: string, status: CandidateStatus | null, offset = 0) {
  return unwrap(
    await adminApi.admin.v0.orgs[':org_id'].candidates.$get({
      param: { org_id: orgId },
      // An omitted status means the whole pool incl. rejected — hono's client
      // drops `undefined` query values rather than sending "undefined".
      query: {
        status: status ?? undefined,
        limit: String(POOL_PAGE_SIZE),
        offset: String(offset),
      },
    }),
  );
}

export type CandidatePage = Awaited<ReturnType<typeof fetchCandidates>>;
export type CandidateItem = CandidatePage['candidates'][number];

export async function researchKeywords(orgId: string, seed: string) {
  return unwrap(
    await adminApi.admin.v0.orgs[':org_id'].research.$post({
      param: { org_id: orgId },
      json: { seed },
    }),
  );
}

/** A researched keyword with its metrics — exactly what add-to-pool sends back. */
export type KeywordMetric = Awaited<ReturnType<typeof researchKeywords>>['seed'];

export async function addCandidates(orgId: string, keywords: KeywordMetric[]) {
  return unwrap(
    await adminApi.admin.v0.orgs[':org_id'].candidates.$post({
      param: { org_id: orgId },
      json: { keywords },
    }),
  );
}

export async function scheduleCandidate(candidateId: string, scheduledDate: string) {
  return unwrap(
    await adminApi.admin.v0.candidates[':candidate_id'].schedule.$post({
      param: { candidate_id: candidateId },
      json: { scheduled_date: scheduledDate },
    }),
  );
}

export async function rejectCandidate(candidateId: string) {
  return unwrapEmpty(
    await adminApi.admin.v0.candidates[':candidate_id'].$delete({
      param: { candidate_id: candidateId },
    }),
  );
}

// --- Planner ---

/** Already sorted by `scheduled_date` ascending server-side (KeywordRepo.listByOrg). */
export async function fetchPlanner(orgId: string) {
  return unwrap(await adminApi.admin.v0.orgs[':org_id'].planner.$get({ param: { org_id: orgId } }));
}

export type ScheduledKeyword = Awaited<ReturnType<typeof fetchPlanner>>['keywords'][number];

export async function rescheduleKeyword(keywordId: string, scheduledDate: string) {
  return unwrap(
    await adminApi.admin.v0.scheduled[':keyword_id'].$patch({
      param: { keyword_id: keywordId },
      json: { scheduled_date: scheduledDate },
    }),
  );
}

export async function unscheduleKeyword(keywordId: string) {
  return unwrapEmpty(
    await adminApi.admin.v0.scheduled[':keyword_id'].$delete({ param: { keyword_id: keywordId } }),
  );
}

export async function generateNow(keywordId: string) {
  return unwrap(
    await adminApi.admin.v0.scheduled[':keyword_id'].generate.$post({
      param: { keyword_id: keywordId },
    }),
  );
}
