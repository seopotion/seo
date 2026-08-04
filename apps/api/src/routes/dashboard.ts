import { createRoute, OpenAPIHono, type z } from '@hono/zod-openapi';
import { ArticleRepo, GscConnectionRepo, IntegrationRepo, KeywordRepo, OrgRepo } from '@shared/db';
import { domainRatingFromRank } from '@shared/providers';
import {
  type Article,
  type Integration,
  isGscConnected,
  META_DESCRIPTION_MAX,
  META_DESCRIPTION_MIN,
  META_TITLE_MAX,
} from '@shared/schemas';
import { type CommitFile, commitFiles, GithubError } from '../clients/github';
import * as gsc from '../clients/gsc';
import { getDataForSeoClient } from '../clients/providers';
import {
  editWordPressArticle,
  submitWordPressArticle,
  testWordPressIntegration,
} from '../clients/wordpress';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { loadOwnedOrg } from '../lib/load-owned-org';
import { mergePresets } from '../lib/merge-presets';
import { recordWordPressPublication } from '../lib/publications';
import { getGscTokenKey } from '../lib/secrets';
import {
  articlePath,
  manifestPath,
  type PublishedArticle,
  renderArticle,
  renderManifest,
} from '../lib/static-site';
import { logger } from '../logger';
import { type AuthEnv, authMiddleware } from '../middlewares/auth';
import * as schemas from '../schemas/dashboard';

/** Map an Article entity to the Content History list row (Date -> ISO string). */
function toArticleListItem(a: Article) {
  return {
    id: a.id,
    title: a.title,
    slug: a.slug,
    keyword: a.keyword,
    status: a.status,
    difficulty: a.difficulty,
    search_volume: a.search_volume,
    featured_image_url: a.featured_image_url,
    created_at: a.created_at.toISOString(),
    published_at: a.published_at ? a.published_at.toISOString() : null,
  };
}

/** Map an Article entity to the full article record (Date -> ISO string). */
function toArticleDetail(a: Article) {
  const staticSite = a.publications.find((p) => p.provider === 'static-site');
  return {
    id: a.id,
    keyword_id: a.keyword_id,
    keyword: a.keyword,
    title: a.title,
    meta_title: a.meta_title,
    slug: a.slug,
    meta_description: a.meta_description,
    featured_image_url: a.featured_image_url,
    content: a.content,
    status: a.status,
    ...(a.wordpress_post_id ? { wordpress_post_id: a.wordpress_post_id } : {}),
    static_site_published_at: staticSite ? staticSite.published_at.toISOString() : null,
    images_status: a.images_status,
    created_at: a.created_at.toISOString(),
    updated_at: a.updated_at ? a.updated_at.toISOString() : null,
    published_at: a.published_at ? a.published_at.toISOString() : null,
    video: a.video,
  };
}

/** Map an Integration entity to a settings-panel row (Date -> ISO string).
 * `target` is what the panel renders after "Connected to". */
function toConnectedIntegration(i: Integration) {
  return {
    id: i.id,
    provider: i.provider,
    target: i.provider === 'wordpress' ? i.site_url : `${i.repo}@${i.branch}`,
    connected_at: i.connected_at.toISOString(),
  };
}

/**
 * An already-published article as the static-site contract sees it: addressed by
 * the slug we last committed under, not by `article.slug`, which the editor can
 * have renamed since. Callers only pass articles `listPublishedTo` returned, so
 * the entry is always there.
 */
function toPublishedArticle(a: Article): PublishedArticle | null {
  const publication = a.publications.find((p) => p.provider === 'static-site');
  if (!publication) return null;
  return {
    article: a,
    slug: publication.slug,
    published_at: publication.published_at,
    updated_at: publication.updated_at,
  };
}

/**
 * GithubError -> HTTP for the publish route. A lost push race is the caller's to
 * retry (409); anything else GitHub refused is permanent for this request (422,
 * e.g. the branch became protected); a failure to reach GitHub is ours (502).
 */
function publishFailure(err: unknown): {
  status: 409 | 422 | 502;
  body: { error: string; code: string };
} {
  if (err instanceof GithubError) {
    if (err.code === 'ref_conflict') {
      return {
        status: 409,
        body: { error: 'The branch moved while publishing — try again', code: err.code },
      };
    }
    return {
      status: err.code === 'github_request_failed' ? 502 : 422,
      body: { error: err.message, code: err.code },
    };
  }
  return { status: 502, body: { error: 'GitHub request failed', code: 'github_request_failed' } };
}

/**
 * Editor save rules (#74). Mirrors the modal's client-side checks — including
 * trimming, so `"   "` fails on both sides rather than only one. Returns the
 * offending fields; an empty object means valid.
 */
function validateArticleUpdate(
  body: z.infer<typeof schemas.ArticleUpdateBody>,
): Record<string, string> {
  const fields: Record<string, string> = {};

  if (!body.title.trim()) fields.title = 'Title is required';
  if (!body.slug.trim()) fields.slug = 'Slug is required';
  if (!body.content.trim()) fields.content = 'Content is required';

  if (!body.meta_title.trim()) fields.meta_title = 'Meta title is required';
  else if (body.meta_title.length > META_TITLE_MAX)
    fields.meta_title = `Meta title must be ${META_TITLE_MAX} characters or fewer`;

  if (!body.meta_description.trim()) fields.meta_description = 'Meta description is required';
  else if (
    body.meta_description.length < META_DESCRIPTION_MIN ||
    body.meta_description.length > META_DESCRIPTION_MAX
  )
    fields.meta_description = `Meta description must be between ${META_DESCRIPTION_MIN} and ${META_DESCRIPTION_MAX} characters`;

  return fields;
}

/** Search Analytics window: the trailing 28 days, as yyyy-mm-dd bounds. */
function analyticsWindow(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 28 * 24 * 60 * 60 * 1000);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

/**
 * The GSC gate (#12): decrypt the org's refresh token when a healthy, finalized
 * connection exists; null keeps the caller on the gated response shape.
 */
async function gscAccess(org_id: string): Promise<{ token: string; siteUrl: string } | null> {
  const conn = await GscConnectionRepo.findByOrgId(org_id);
  if (!isGscConnected(conn)) return null;
  return {
    token: decryptSecret(conn.refresh_token_enc, await getGscTokenKey()),
    siteUrl: conn.site_url,
  };
}

/** Domain ratings refresh at most weekly — older values re-fetch inline on read (#12). */
const DOMAIN_RATING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Dashboard Home routes (design/product-flow.md, Dashboard §1). All require a
 * Bearer JWT — the dashboard is gated behind a completed setup. Responses are
 * mock/empty for now: a fresh org has nothing published or planned, no
 * integrations connected, and performance blocks stay gated until Google
 * Search Console is wired up. Swap the handler bodies for real reads later.
 */
const dashboard = new OpenAPIHono<AuthEnv>()
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/articles/best',
      summary: 'Best-performing pages by Search Console clicks (gated until GSC is connected)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.OrgQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.BestArticlesResponse } },
          description: 'Top pages by clicks (28 days); empty + gated without a GSC connection',
        },
        404: {
          content: { 'application/json': { schema: schemas.OrgNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);

      const access = await gscAccess(org_id);
      if (!access) return c.json({ articles: [], gated: true }, 200);

      try {
        const rows = await gsc.querySearchAnalytics(access.token, access.siteUrl, {
          ...analyticsWindow(),
          dimensions: ['page'],
          rowLimit: 10,
        });
        const { articles: published } = await ArticleRepo.listByOrg(org_id, {
          status: 'published',
          limit: 100,
          offset: 0,
        });
        const articles = rows.map((row) => {
          const url = row.keys[0] ?? '';
          const match = published.find((a: Article) => url.includes(`/${a.slug}`));
          return { url, clicks: Math.round(row.clicks), title: match?.title ?? null };
        });
        return c.json({ articles, gated: false }, 200);
      } catch (err) {
        // Revoked access closes the gate until reconnect; transient provider
        // errors also degrade to the gated shape rather than a 500.
        if (err instanceof gsc.GscAuthRevokedError) {
          await GscConnectionRepo.markRefreshFailed(org_id);
        } else {
          logger.warn('GSC read failed for /articles/best', { org_id, error: err as Error });
        }
        return c.json({ articles: [], gated: true }, 200);
      }
    },
  )
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/search-performance',
      summary: '28-day Search Console totals (gated until GSC is connected)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.OrgQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.SearchPerformanceResponse } },
          description: 'Clicks/impressions/CTR/position totals; nulls while gated',
        },
        404: {
          content: { 'application/json': { schema: schemas.OrgNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);

      const gatedBody = {
        gated: true,
        clicks: null,
        impressions: null,
        ctr: null,
        position: null,
      };
      const access = await gscAccess(org_id);
      if (!access) return c.json(gatedBody, 200);

      try {
        const rows = await gsc.querySearchAnalytics(
          access.token,
          access.siteUrl,
          analyticsWindow(),
        );
        const row = rows[0];
        return c.json(
          {
            gated: false,
            clicks: row?.clicks ?? 0,
            impressions: row?.impressions ?? 0,
            ctr: row?.ctr ?? 0,
            position: row?.position ?? 0,
          },
          200,
        );
      } catch (err) {
        if (err instanceof gsc.GscAuthRevokedError) {
          await GscConnectionRepo.markRefreshFailed(org_id);
        } else {
          logger.warn('GSC read failed for /search-performance', { org_id, error: err as Error });
        }
        return c.json(gatedBody, 200);
      }
    },
  )
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/articles/published',
      summary: 'Count of published articles',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.OrgQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.ArticleCountResponse } },
          description: 'Published article count for the org',
        },
        404: {
          content: { 'application/json': { schema: schemas.OrgNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);
      const count = await ArticleRepo.countByStatus(org_id, 'published');
      return c.json({ count }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/articles/planned',
      summary: 'Count of planned articles (scheduled keywords awaiting generation)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.OrgQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.ArticleCountResponse } },
          description: 'Planned article count for the org',
        },
        404: {
          content: { 'application/json': { schema: schemas.OrgNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);
      const count = await KeywordRepo.countScheduled(org_id);
      return c.json({ count }, 200);
    },
  )
  // The rest of /dashboard/integrations lives here; the GitHub App install flow
  // and the static-site connect are their own router (routes/integrations.ts),
  // the same split gsc.ts makes for the Google OAuth dance.
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'post',
      path: '/integrations/wordpress',
      summary: 'Connect the SEO Potion WordPress plugin',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: {
          content: { 'application/json': { schema: schemas.WordPressConnectionBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.WordPressConnectionResponse } },
          description: 'WordPress integration connected',
        },
        403: {
          content: { 'application/json': { schema: schemas.WordPressConnectionErrorResponse } },
          description: 'WordPress integration key rejected or not configured',
        },
        404: {
          content: { 'application/json': { schema: schemas.OrgNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
        502: {
          content: { 'application/json': { schema: schemas.WordPressConnectionErrorResponse } },
          description: 'WordPress plugin or network failure',
        },
      },
    }),
    async (c) => {
      const { org_id, token } = c.req.valid('json');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);

      try {
        const result = await testWordPressIntegration(org.website_url, token);
        if (!result.success) {
          if (
            result.error_code === 'invalid_integration_key' ||
            result.error_code === 'integration_not_configured'
          ) {
            return c.json(result, 403);
          }
          return c.json(result, 502);
        }
      } catch {
        return c.json({ success: false as const, error_code: 'wordpress_request_failed' }, 502);
      }

      // #7: the integrations collection is the new home for the connection;
      // the org fields below stay as a deprecated plaintext mirror for one
      // release, because the publish paths and the admin levers still read
      // them. Encrypt first — an env that cannot encrypt a publishing secret is
      // misconfigured, and failing here beats silently storing plaintext only.
      const tokenEnc = encryptSecret(token, await getGscTokenKey());
      const saved = await OrgRepo.saveWordPressConnection(org.id, token, new Date());
      if (!saved) return c.json({ error: 'Not found' }, 404);
      await IntegrationRepo.connectWordPress(org.id, org.website_url, tokenEnc);
      return c.json({ success: true as const }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/integrations/connected',
      summary: 'Connected publishing integrations',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.OrgQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.ConnectedIntegrationsResponse } },
          description: 'Connected integrations (empty for a fresh org)',
        },
        404: {
          content: { 'application/json': { schema: schemas.OrgNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);
      const rows = (await IntegrationRepo.listByOrgId(org.id)).map(toConnectedIntegration);
      // The admin connect lever writes only the org mirror — the admin Lambda
      // is granted none of the customer secrets, so it cannot encrypt a token.
      // Synthesize the row for an operator-made connection until the mirror is
      // dropped (design/integrations-model.md § Migration).
      if (
        !rows.some((r) => r.provider === 'wordpress') &&
        org.wordpress_token &&
        org.wordpress_connected_at
      ) {
        rows.push({
          id: 'wordpress',
          provider: 'wordpress',
          target: org.website_url,
          connected_at: org.wordpress_connected_at.toISOString(),
        });
      }
      return c.json({ integrations: rows }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'delete',
      path: '/integrations/{provider}',
      summary: 'Disconnect a publishing integration',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { params: schemas.IntegrationProviderParams, query: schemas.OrgQuery },
      responses: {
        204: { description: 'Disconnected (idempotent — also 204 when not connected)' },
        404: {
          content: { 'application/json': { schema: schemas.OrgNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { provider } = c.req.valid('param');
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);

      await IntegrationRepo.deleteByOrgAndProvider(org.id, provider);
      // Clear the deprecated mirror too, else the fallback above would resurrect
      // a connection the user just removed.
      if (provider === 'wordpress') await OrgRepo.clearWordPressConnection(org.id);
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/domain-rating',
      summary: 'Latest Domain Rating for the org (re-fetched when older than 7 days)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.OrgQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.DomainRatingResponse } },
          description: 'Domain rating; null when never rated and the provider is unavailable',
        },
        404: {
          content: { 'application/json': { schema: schemas.OrgNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);

      const current = org.domain_rating ?? null;
      if (current && Date.now() - current.checked_at.getTime() < DOMAIN_RATING_MAX_AGE_MS) {
        return c.json({ rating: current.value }, 200);
      }

      // Stale or missing: re-fetch inline, falling back to the stored value
      // (or null) when the provider is down — the badge degrades, never errors.
      try {
        const domain = new URL(org.website_url).hostname.replace(/^www\./, '');
        const df = await getDataForSeoClient();
        const { rank } = await df.backlinksSummary(domain);
        const rating = domainRatingFromRank(rank);
        if (rating === null) return c.json({ rating: current?.value ?? null }, 200);
        await OrgRepo.updateDomainRating(org_id, rating);
        return c.json({ rating }, 200);
      } catch {
        return c.json({ rating: current?.value ?? null }, 200);
      }
    },
  )
  // --- Content Planner (§2.1) ---
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/planner',
      summary: 'Scheduled keywords for the content planner calendar',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.OrgQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.PlannerResponse } },
          description: 'Scheduled keywords for the org',
        },
        404: {
          content: { 'application/json': { schema: schemas.OrgNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);
      const keywords = await KeywordRepo.listByOrg(org_id);
      return c.json(
        {
          strategy_status: org.strategy_status ?? 'none',
          keywords: keywords.map((k) => ({
            id: k.id,
            candidate_id: k.candidate_id,
            keyword: k.keyword,
            status: k.status,
            scheduled_date: k.scheduled_date,
            search_volume: k.search_volume,
            difficulty: k.difficulty,
            article_type: k.article_type,
            intent: k.intent,
            opportunity_score: k.opportunity_score,
            generation_status: k.generation_status,
            generation_error: k.generation_error,
            article_id: k.article_id,
          })),
        },
        200,
      );
    },
  )
  // --- Content History (§2.2, read-only) ---
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/articles',
      summary: 'List generated/published articles (paginated, status-filterable)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.ArticlesQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.ArticlesResponse } },
          description: 'Article history rows for the org',
        },
        404: {
          content: { 'application/json': { schema: schemas.OrgNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id, status, limit, offset } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);
      const { articles, total } = await ArticleRepo.listByOrg(org_id, { status, limit, offset });
      return c.json({ articles: articles.map(toArticleListItem), total }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/articles/{id}',
      summary: 'Get a single generated article (title/meta/slug/body)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { params: schemas.ArticleParams },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.ArticleDetailResponse } },
          description: 'Full article record',
        },
        404: {
          content: { 'application/json': { schema: schemas.ArticleNotFoundResponse } },
          description: 'No article with that id',
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { userId } = c.get('auth');
      const article = await ArticleRepo.findById(id);
      // A missing article and one owned by another user both 404 — never leak
      // existence across accounts (same rule as loadOwnedOrg).
      if (!article || !(await loadOwnedOrg(article.org_id, userId))) {
        return c.json({ error: 'Article not found' }, 404);
      }
      return c.json(toArticleDetail(article), 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'post',
      path: '/articles/{id}/wordpress',
      summary: 'Create an article through the connected SEO Potion WordPress plugin',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { params: schemas.ArticleParams },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.WordPressArticleResponse } },
          description: 'Inherited WordPress plugin response',
        },
        400: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'WordPress plugin rejected the payload',
        },
        403: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'WordPress plugin rejected the site secret',
        },
        404: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'Article not found or not owned by the caller',
        },
        409: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'Article is not ready or the WordPress connection is missing',
        },
        500: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'WordPress plugin failed to create the post',
        },
        502: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'WordPress plugin response or network failure',
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { userId } = c.get('auth');
      const article = await ArticleRepo.findById(id);
      const org = article ? await loadOwnedOrg(article.org_id, userId) : null;
      if (!article || !org) return c.json({ error: 'Article not found' }, 404);
      if (!org.wordpress_token || !org.wordpress_connected_at) {
        return c.json({ error: 'WordPress is not connected' }, 409);
      }
      // Dup-guard: a sequential retry must not create and remap a second post.
      if (article.wordpress_post_id) {
        return c.json({ error: 'Article is already published to WordPress' }, 409);
      }
      if (article.images_status !== 'complete') {
        return c.json({ error: 'Article images are not complete' }, 409);
      }

      try {
        const result = await submitWordPressArticle(org.website_url, org.wordpress_token, article);
        if (result.status === 200) {
          const persisted = await ArticleRepo.setWordPressPostId(article.id, result.body.post_id);
          if (!persisted) {
            return c.json({ error: 'WordPress post created but its ID could not be saved' }, 500);
          }
          await recordWordPressPublication(article, result.body.post_id);
          return c.json(result.body, 200);
        }
        if (result.status === 400) return c.json(result.body, 400);
        if (result.status === 403) return c.json(result.body, 403);
        if (result.status === 404) return c.json(result.body, 404);
        if (result.status === 409) return c.json(result.body, 409);
        return c.json(result.body, 500);
      } catch {
        return c.json({ error: 'WordPress request failed' }, 502);
      }
    },
  )
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'put',
      path: '/articles/{id}/wordpress',
      summary: 'Update an article through the connected SEO Potion WordPress plugin',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { params: schemas.ArticleParams },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.WordPressArticleResponse } },
          description: 'Inherited WordPress plugin response, including warnings',
        },
        400: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'WordPress plugin rejected the payload',
        },
        403: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'WordPress plugin rejected the site secret',
        },
        404: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'Article or WordPress post was not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'Stored WordPress ID or connection is missing, or the slug conflicts',
        },
        500: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'WordPress plugin failed to update the post',
        },
        502: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'WordPress plugin response or network failure',
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { userId } = c.get('auth');
      const article = await ArticleRepo.findById(id);
      const org = article ? await loadOwnedOrg(article.org_id, userId) : null;
      if (!article || !org) return c.json({ error: 'Article not found' }, 404);
      if (!org.wordpress_token || !org.wordpress_connected_at) {
        return c.json({ error: 'WordPress is not connected' }, 409);
      }
      if (!article.wordpress_post_id) {
        return c.json({ error: 'Article has not been submitted to WordPress' }, 409);
      }
      if (article.images_status !== 'complete') {
        return c.json({ error: 'Article images are not complete' }, 409);
      }

      try {
        const result = await editWordPressArticle(
          org.website_url,
          org.wordpress_token,
          article.wordpress_post_id,
          article,
        );
        if (result.status === 200) {
          await recordWordPressPublication(article, article.wordpress_post_id);
          return c.json(result.body, 200);
        }
        if (result.status === 400) return c.json(result.body, 400);
        if (result.status === 403) return c.json(result.body, 403);
        if (result.status === 404) return c.json(result.body, 404);
        if (result.status === 409) return c.json(result.body, 409);
        return c.json(result.body, 500);
      } catch {
        return c.json({ error: 'WordPress request failed' }, 502);
      }
    },
  )
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'post',
      path: '/articles/{id}/publish',
      summary: 'Publish an article to the connected static site, as one git commit',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { params: schemas.ArticleParams },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.StaticSitePublishResponse } },
          description: 'Committed; the client’s build takes it from here',
        },
        404: {
          content: { 'application/json': { schema: schemas.ArticleNotFoundResponse } },
          description: 'Article not found or not owned by the caller',
        },
        409: {
          content: { 'application/json': { schema: schemas.StaticSitePublishErrorResponse } },
          description: 'Not connected, images incomplete, slug taken, or the branch moved',
        },
        422: {
          content: { 'application/json': { schema: schemas.StaticSitePublishErrorResponse } },
          description: 'GitHub refused the commit',
        },
        500: {
          content: { 'application/json': { schema: schemas.StaticSitePublishErrorResponse } },
          description: 'Committed, but the publish state could not be saved',
        },
        502: {
          content: { 'application/json': { schema: schemas.StaticSitePublishErrorResponse } },
          description: 'GitHub request failed',
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { userId } = c.get('auth');
      const article = await ArticleRepo.findById(id);
      const org = article ? await loadOwnedOrg(article.org_id, userId) : null;
      if (!article || !org) return c.json({ error: 'Article not found' }, 404);

      const integration = await IntegrationRepo.findByOrgAndProvider(org.id, 'static-site');
      if (integration?.provider !== 'static-site') {
        return c.json({ error: 'No static site is connected', code: 'not_connected' }, 409);
      }
      // Same gate as WordPress, and it matters more here: an article published
      // mid-generation commits <img> tags pointing at objects that do not exist
      // yet — the diff looks fine and the page breaks in the browser.
      if (article.images_status !== 'complete') {
        return c.json({ error: 'Article images are not complete', code: 'images_incomplete' }, 409);
      }

      const { content_path } = integration;
      const live = (await ArticleRepo.listPublishedTo(org.id, 'static-site'))
        .filter((a) => a.id !== article.id)
        .map(toPublishedArticle)
        .filter((e) => e !== null);

      // Every file is addressed by slug and there is no unique index on
      // `articles.slug`, so without this the second article to claim a slug
      // silently overwrites the first one's file
      // (design/static-site-integration.md § Publish semantics).
      if (live.some((e) => e.slug === article.slug)) {
        return c.json(
          {
            error: `Another article is already published at "${article.slug}"`,
            code: 'slug_conflict',
          },
          409,
        );
      }

      // One timestamp for the commit and for the publish state it records, so
      // rebuilding this manifest from the database reproduces it byte for byte.
      const now = new Date();
      const previous = article.publications.find((p) => p.provider === 'static-site');
      const entry: PublishedArticle = {
        article,
        slug: article.slug,
        published_at: previous?.published_at ?? now,
        updated_at: previous ? now : null,
      };

      const files: CommitFile[] = [
        { path: articlePath(content_path, article.slug), content: renderArticle(entry) },
        {
          path: manifestPath(content_path),
          content: renderManifest([...live, entry], content_path, now),
        },
      ];
      // A slug renamed since the last publish would otherwise leave the old file
      // behind as a live duplicate-content page. Deleting it rides in this same
      // commit, so the repo is never briefly serving both.
      if (previous && previous.slug !== article.slug) {
        files.push({ path: articlePath(content_path, previous.slug), content: null });
      }

      let commitSha: string;
      try {
        commitSha = await commitFiles({
          installationId: integration.installation_id,
          repo: integration.repo,
          branch: integration.branch,
          message: `seopotion: ${previous ? 'update' : 'publish'} "${article.title}"`,
          files,
        });
      } catch (err) {
        const fail = publishFailure(err);
        if (fail.status === 409) return c.json(fail.body, 409);
        if (fail.status === 422) return c.json(fail.body, 422);
        return c.json(fail.body, 502);
      }

      const persisted = await ArticleRepo.recordPublication(
        article.id,
        { provider: 'static-site', ref: commitSha, slug: article.slug },
        now,
      );
      if (!persisted) {
        // The commit landed. Not recording it drops the article out of the next
        // manifest rebuild, so say so rather than reporting success.
        return c.json(
          { error: 'Committed, but the publish state could not be saved', code: 'record_failed' },
          500,
        );
      }

      return c.json(
        {
          commit_sha: commitSha,
          commit_url: `https://github.com/${integration.repo}/commit/${commitSha}`,
          path: articlePath(content_path, article.slug),
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'patch',
      path: '/articles/{id}',
      summary: 'Save editor changes to a generated article',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        params: schemas.ArticleParams,
        body: { content: { 'application/json': { schema: schemas.ArticleUpdateBody } } },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.ArticleDetailResponse } },
          description: 'The updated article record',
        },
        400: {
          content: { 'application/json': { schema: schemas.ArticleValidationErrorResponse } },
          description: 'One or more fields failed validation',
        },
        404: {
          content: { 'application/json': { schema: schemas.ArticleNotFoundResponse } },
          description: 'No article with that id',
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const { userId } = c.get('auth');
      const article = await ArticleRepo.findById(id);
      // A missing article and one owned by another user both 404 — never leak
      // existence across accounts (same rule as loadOwnedOrg).
      if (!article || !(await loadOwnedOrg(article.org_id, userId))) {
        return c.json({ error: 'Article not found' }, 404);
      }

      const fields = validateArticleUpdate(body);
      if (Object.keys(fields).length > 0) {
        return c.json({ error: 'Validation failed', fields }, 400);
      }

      const updated = await ArticleRepo.updateContent(id, body);
      if (!updated) return c.json({ error: 'Article not found' }, 404);
      return c.json(toArticleDetail(updated), 200);
    },
  )
  // --- Articles Settings (§2.3) ---
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/settings/articles',
      summary: 'Current article preferences (content/SEO + engagement)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.SettingsQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.ArticlesSettingsResponse } },
          description: 'Article preferences for the org',
        },
        404: {
          content: { 'application/json': { schema: schemas.SettingsNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org?.presets) {
        return c.json({ error: 'Settings not available' }, 404);
      }
      return c.json({ article_preferences: org.presets.article_preferences }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'patch',
      path: '/settings/articles',
      summary: 'Edit article preferences (deep-merge partial)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: {
          content: { 'application/json': { schema: schemas.ArticlesSettingsPatchBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.ArticlesSettingsResponse } },
          description: 'Updated article preferences (persisted)',
        },
        404: {
          content: { 'application/json': { schema: schemas.SettingsNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id, ...patch } = c.req.valid('json');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org?.presets) {
        return c.json({ error: 'Settings not available' }, 404);
      }
      const merged = mergePresets(org.presets, { article_preferences: patch });
      await OrgRepo.updatePresets(org_id, merged);
      return c.json({ article_preferences: merged.article_preferences }, 200);
    },
  )
  // --- General Settings (§2.6) ---
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/settings/general',
      summary: 'Current business + audience/competitors settings',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.SettingsQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.GeneralSettingsResponse } },
          description: 'Business + audience settings for the org',
        },
        404: {
          content: { 'application/json': { schema: schemas.SettingsNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org?.presets) {
        return c.json({ error: 'Settings not available' }, 404);
      }
      return c.json({ business: org.presets.business, audience: org.presets.audience }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'patch',
      path: '/settings/general',
      summary: 'Edit business + audience/competitors settings (deep-merge partial)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: {
          content: { 'application/json': { schema: schemas.GeneralSettingsPatchBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.GeneralSettingsResponse } },
          description: 'Updated business + audience settings (persisted)',
        },
        404: {
          content: { 'application/json': { schema: schemas.SettingsNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id, ...patch } = c.req.valid('json');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org?.presets) {
        return c.json({ error: 'Settings not available' }, 404);
      }
      const merged = mergePresets(org.presets, patch);
      await OrgRepo.updatePresets(org_id, merged);
      return c.json({ business: merged.business, audience: merged.audience }, 200);
    },
  );

export default dashboard;
