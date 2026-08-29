import type { ARTICLE_STATUSES, CandidateStatus, IMAGES_STATUSES } from '@shared/schemas';
import { ApiError, adminApi, unwrap, unwrapEmpty } from './api';
import type { PresetsPatch } from './presets';

/** The two article enums, straight from the entity schema the DTOs mirror. */
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];
export type ImagesStatus = (typeof IMAGES_STATUSES)[number];

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

// --- Presets, strategy, audit ---

/** Deep-merge PATCH: the body carries only the subtrees the operator changed. */
export async function updatePresets(orgId: string, patch: PresetsPatch) {
  return unwrap(
    await adminApi.admin.v0.orgs[':org_id'].presets.$patch({
      param: { org_id: orgId },
      json: patch,
    }),
  );
}

/**
 * Runs the 30-day strategy job. `force` resets a `completed`/`pending` status
 * before claiming — the only way to re-run one, and safe to repeat because the
 * pipeline dedupes against the existing planner and pool.
 */
export async function runStrategy(orgId: string, force = false) {
  return unwrap(
    await adminApi.admin.v0.orgs[':org_id'].strategy.$post({
      param: { org_id: orgId },
      // Omitted rather than sent as `false`: the plain run is the default and
      // the API only looks for `force === true`.
      json: force ? { force: true } : {},
    }),
  );
}

/** One page of the audit trail — the API's own default page size. */
export const AUDIT_PAGE_SIZE = 50;

export async function fetchAudit(orgId: string, offset = 0) {
  return unwrap(
    await adminApi.admin.v0.orgs[':org_id'].audit.$get({
      param: { org_id: orgId },
      query: { limit: String(AUDIT_PAGE_SIZE), offset: String(offset) },
    }),
  );
}

export type AuditAction = Awaited<ReturnType<typeof fetchAudit>>['actions'][number];

// --- Org unstick levers (phase 2) ---

/**
 * Re-enqueues the onboarding scan. The API hard-409s a `setup_complete` org —
 * the worker's `completeScan` would overwrite presets and knock a live org out
 * of its dashboard gate — so callers offer this only for stuck onboarding.
 */
export async function rerunScan(orgId: string) {
  return unwrap(await adminApi.admin.v0.orgs[':org_id'].scan.$post({ param: { org_id: orgId } }));
}

/**
 * Connects WordPress on the customer's behalf; the site URL is the org's own, so
 * the plugin token is the whole body. Verification happens server-side, and its
 * refusals arrive as `{ success: false, error_code }` rather than the admin
 * `{ error }` envelope — lifted here, since `unwrap` would only see "Forbidden".
 */
export async function connectWordPress(orgId: string, token: string) {
  const res = await adminApi.admin.v0.orgs[':org_id'].integrations.wordpress.$post({
    param: { org_id: orgId },
    json: { token },
  });
  if (res.status === 403 || res.status === 502) {
    throw new ApiError((await res.json()).error_code, res.status);
  }
  return unwrap(res);
}

export async function disconnectWordPress(orgId: string) {
  return unwrapEmpty(
    await adminApi.admin.v0.orgs[':org_id'].integrations.wordpress.$delete({
      param: { org_id: orgId },
    }),
  );
}

/** Forces a clean re-onboard: only the customer can re-grant OAuth consent. */
export async function disconnectGsc(orgId: string) {
  return unwrapEmpty(
    await adminApi.admin.v0.orgs[':org_id'].gsc.$delete({ param: { org_id: orgId } }),
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

/** Un-reject: a conditional `rejected → candidate` update, so a 409 means the
 * row already moved on and the pool needs a refresh. */
export async function restoreCandidate(candidateId: string) {
  return unwrapEmpty(
    await adminApi.admin.v0.candidates[':candidate_id'].restore.$post({
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

/**
 * The over-cap lever: back to `pending` with zero attempts, so the daily run
 * stops ignoring a keyword that burned its 3 attempts. Conditional on
 * `failed` + unlinked, hence the 409.
 */
export async function resetGeneration(keywordId: string) {
  return unwrapEmpty(
    await adminApi.admin.v0.scheduled[':keyword_id'].reset.$post({
      param: { keyword_id: keywordId },
    }),
  );
}

/** Exactly the PATCH body: the three brief fields, `null` clearing one. */
export type BriefPatch = Pick<ScheduledKeyword, 'article_type' | 'intent' | 'opportunity_score'>;

/** The brief steers generation, so the API locks it once generation started. */
export async function updateBrief(keywordId: string, patch: BriefPatch) {
  return unwrap(
    await adminApi.admin.v0.scheduled[':keyword_id'].brief.$patch({
      param: { keyword_id: keywordId },
      json: patch,
    }),
  );
}

// --- Articles ---

/** One page of the article list — the API's own default page size. */
export const ARTICLES_PAGE_SIZE = 20;

export async function fetchArticles(orgId: string, status: ArticleStatus | null, offset = 0) {
  return unwrap(
    await adminApi.admin.v0.orgs[':org_id'].articles.$get({
      param: { org_id: orgId },
      query: {
        status: status ?? undefined,
        limit: String(ARTICLES_PAGE_SIZE),
        offset: String(offset),
      },
    }),
  );
}

export type ArticleListItem = Awaited<ReturnType<typeof fetchArticles>>['articles'][number];

export async function fetchArticle(articleId: string) {
  const res = await adminApi.admin.v0.articles[':article_id'].$get({
    param: { article_id: articleId },
  });
  // Narrowed before `unwrap`, like `fetchOrg` — the page renders its own
  // "article not found" state off the 404.
  if (res.status === 404) throw new ApiError('not_found', 404);
  return unwrap(res);
}

/** The full article record — inferred from the client, so route changes land here. */
export type ArticleDetail = Awaited<ReturnType<typeof fetchArticle>>;

/** Exactly the PATCH body: the five fields the editor owns. */
export type ArticleDraft = Pick<
  ArticleDetail,
  'title' | 'slug' | 'meta_title' | 'meta_description' | 'content'
>;

/**
 * A save refused by the field rules. The 400 body carries a message per
 * offending field, which `unwrap` would flatten to the bare `validation_failed`
 * code — the editor wants the per-field detail, so this carries it through.
 */
export class ArticleValidationError extends ApiError {
  constructor(readonly fields: Record<string, string>) {
    super('validation_failed', 400);
    this.name = 'ArticleValidationError';
  }
}

export async function updateArticle(articleId: string, draft: ArticleDraft) {
  const res = await adminApi.admin.v0.articles[':article_id'].$patch({
    param: { article_id: articleId },
    json: draft,
  });
  if (res.status === 400) throw new ArticleValidationError((await res.json()).fields);
  return unwrap(res);
}

/** Creates the post on the customer's live WordPress site. */
export async function publishToWordPress(articleId: string) {
  return unwrap(
    await adminApi.admin.v0.articles[':article_id'].wordpress.$post({
      param: { article_id: articleId },
    }),
  );
}

/** Overwrites the already-published post with the saved article. */
export async function updateWordPressPost(articleId: string) {
  return unwrap(
    await adminApi.admin.v0.articles[':article_id'].wordpress.$put({
      param: { article_id: articleId },
    }),
  );
}

/**
 * Re-enqueues the image task — the lever for `images_status: 'failed'`, which
 * blocks WordPress publish. The worker's set-if-absent slots make replay
 * idempotent, so there is no guard to trip and no 409 to handle.
 */
export async function retryImages(articleId: string) {
  return unwrap(
    await adminApi.admin.v0.articles[':article_id'].images.$post({
      param: { article_id: articleId },
    }),
  );
}

// --- Promo codes ---

/** Codes, newest first, each carrying its confirmed-redemption count. */
export async function fetchPromoCodes() {
  return unwrap(await adminApi.admin.v0['promo-codes'].$get());
}

export type PromoCode = Awaited<ReturnType<typeof fetchPromoCodes>>['promo_codes'][number];

/** Exactly the create body: `code` blank means server-generated. */
export type PromoCodeInput = {
  code?: string;
  name: string;
  percent: number;
  duration: PromoCode['duration'];
  duration_in_months?: number;
  max_redemptions?: number;
  expires_at?: string;
  affiliate?: string;
};

export async function createPromoCode(input: PromoCodeInput) {
  return unwrap(await adminApi.admin.v0['promo-codes'].$post({ json: input }));
}

export async function deactivatePromoCode(promoCodeId: string) {
  return unwrap(
    await adminApi.admin.v0['promo-codes'][':promo_code_id'].deactivate.$post({
      param: { promo_code_id: promoCodeId },
    }),
  );
}

/** The affiliate attribution report for one code — newest redemption first. */
export async function fetchPromoRedemptions(promoCodeId: string) {
  return unwrap(
    await adminApi.admin.v0['promo-codes'][':promo_code_id'].redemptions.$get({
      param: { promo_code_id: promoCodeId },
    }),
  );
}

export type PromoRedemption = Awaited<
  ReturnType<typeof fetchPromoRedemptions>
>['redemptions'][number];
