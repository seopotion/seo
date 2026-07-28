import { ApiError, adminApi, unwrap } from './api';

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
