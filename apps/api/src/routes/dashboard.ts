import { createRoute, OpenAPIHono, type z } from '@hono/zod-openapi';
import { ArticleRepo, GscConnectionRepo, IntegrationRepo, KeywordRepo, OrgRepo } from '@shared/db';
import { domainRatingFromRank } from '@shared/providers';
import {
  type Article,
  type Integration,
  isPaid,
  META_DESCRIPTION_MAX,
  META_DESCRIPTION_MIN,
  META_TITLE_MAX,
  PublishTask,
} from '@shared/schemas';
import * as gsc from '../clients/gsc';
import { getDataForSeoClient } from '../clients/providers';
import { enqueuePublishTask } from '../clients/sqs';
import { testWordPressIntegration } from '../clients/wordpress';
import { encryptSecret } from '../lib/crypto';
import { gscAccess } from '../lib/gsc-access';
import { matchArticleByPage } from '../lib/gsc-urls';
import { loadOwnedOrg } from '../lib/load-owned-org';
import { mergePresets } from '../lib/merge-presets';
import { recordWordPressPublication } from '../lib/publications';
import {
  publishStaticSiteArticle,
  publishWordPressArticle,
  updateWordPressArticle,
} from '../lib/publishers';
import { PublishingFailure, publishingFailure } from '../lib/publishing-errors';
import { getGscTokenKey } from '../lib/secrets';
import { logger } from '../logger';
import { type AuthEnv, authMiddleware } from '../middlewares/auth';
import * as schemas from '../schemas/dashboard';

/** Map an Article entity to the Content History list row (Date -> ISO string). */
function toPublishingState(a: Article) {
  const autoPublish = a.auto_publish ?? { preflight_error: null, attempts: [] };
  const mapError = (error: (typeof a.auto_publish)['preflight_error']) =>
    error
      ? { code: error.code, kind: error.kind, message: error.message, at: error.at.toISOString() }
      : null;
  return {
    publications: (a.publications ?? []).map((publication) => ({
      provider: publication.provider,
      ref: publication.ref,
      slug: publication.slug,
      remote_url: publication.remote_url ?? null,
      published_at: publication.published_at.toISOString(),
      updated_at: publication.updated_at?.toISOString() ?? null,
    })),
    auto_publish_error: mapError(autoPublish.preflight_error),
    auto_publish_attempts: autoPublish.attempts.map((attempt) => ({
      provider: attempt.provider,
      status: attempt.status,
      attempt_count: attempt.attempt_count,
      requested_at: attempt.requested_at.toISOString(),
      last_attempt_at: attempt.last_attempt_at?.toISOString() ?? null,
      last_error: mapError(attempt.last_error),
    })),
  };
}

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
    ...toPublishingState(a),
  };
}

/** Map an Article entity to the full article record (Date -> ISO string). */
function toArticleDetail(a: Article) {
  const publications = a.publications ?? [];
  const staticSite = publications.find((p) => p.provider === 'static-site');
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
    ...toPublishingState(a),
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
    last_error: i.last_error && { code: i.last_error.code, at: i.last_error.at.toISOString() },
  };
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
          const match = matchArticleByPage(url, published);
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
      method: 'post',
      path: '/articles/{id}/auto-publish/retry',
      summary: 'Retry failed automatic publishing attempts',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { params: schemas.ArticleParams },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AutoPublishRetryResponse } },
          description: 'Connected unpublished destinations were queued idempotently',
        },
        404: {
          content: { 'application/json': { schema: schemas.ArticleNotFoundResponse } },
          description: 'Article not found or not owned by the caller',
        },
        409: {
          content: { 'application/json': { schema: schemas.AutoPublishRetryErrorResponse } },
          description: 'Article is not ready, automatic publishing is off, or none are connected',
        },
        422: {
          content: { 'application/json': { schema: schemas.AutoPublishRetryErrorResponse } },
          description: 'Automatic publishing requires a paid plan',
        },
        502: {
          content: { 'application/json': { schema: schemas.AutoPublishRetryErrorResponse } },
          description: 'The publish task could not be enqueued',
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { userId } = c.get('auth');
      const article = await ArticleRepo.findById(id);
      const org = article ? await loadOwnedOrg(article.org_id, userId) : null;
      if (!article || !org) return c.json({ error: 'Article not found' }, 404);
      if (article.images_status !== 'complete') {
        return c.json({ error: 'Article images are not complete', code: 'images_incomplete' }, 409);
      }
      if (!org.presets?.article_preferences.publishing.auto_publish) {
        return c.json(
          { error: 'Automatic publishing is disabled', code: 'auto_publish_disabled' },
          409,
        );
      }
      if (!isPaid(org)) {
        return c.json(
          { error: 'Automatic publishing requires a paid plan', code: 'subscription_required' },
          422,
        );
      }

      let integrations = await IntegrationRepo.listByOrgId(org.id);
      if (
        !integrations.some((integration) => integration.provider === 'wordpress') &&
        org.wordpress_token &&
        org.wordpress_connected_at
      ) {
        const tokenEnc = encryptSecret(org.wordpress_token, await getGscTokenKey());
        await IntegrationRepo.connectWordPress(org.id, org.website_url, tokenEnc);
        const wordpress = await IntegrationRepo.findByOrgAndProvider(org.id, 'wordpress');
        if (wordpress) integrations = [...integrations, wordpress];
      }

      const publishedProviders = new Set(
        (article.publications ?? []).map((publication) => publication.provider),
      );
      const providers = [
        ...new Set(
          integrations
            .map((integration) => integration.provider)
            .filter((provider) => !publishedProviders.has(provider)),
        ),
      ];
      if (providers.length === 0) {
        if (integrations.length > 0) {
          await ArticleRepo.clearAutoPublishPreflightError(article.id);
          return c.json({ queued: [] }, 200);
        }
        const failure = publishingFailure(
          'not_connected',
          'permanent',
          'Connect an unpublished destination before retrying automatic publishing.',
          409,
        );
        await ArticleRepo.recordAutoPublishPreflightError(article.id, failure.error);
        return c.json({ error: failure.message, code: failure.error.code }, 409);
      }

      await ArticleRepo.clearAutoPublishPreflightError(article.id);
      const requestedAt = new Date();
      try {
        for (const provider of providers) {
          const attempt = article.auto_publish?.attempts.find(
            (entry) => entry.provider === provider,
          );
          if (attempt?.status === 'published') continue;
          if (attempt?.status === 'failed' || attempt?.status === 'cancelled') {
            await ArticleRepo.resetAutoPublishAttempt(article.id, provider, requestedAt);
          } else if (!attempt) {
            await ArticleRepo.initializeAutoPublishAttempt(article.id, provider, requestedAt);
          }
          await enqueuePublishTask(
            PublishTask.parse({ org_id: org.id, article_id: article.id, provider }),
          );
        }
      } catch {
        return c.json(
          { error: 'The publish task could not be queued', code: 'queue_send_failed' },
          502,
        );
      }
      return c.json({ queued: providers }, 200);
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
          last_error: null,
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
        const published = await publishWordPressArticle({
          article,
          websiteUrl: org.website_url,
          token: org.wordpress_token,
          automatic: false,
        });
        const persisted = await ArticleRepo.setWordPressPostId(article.id, published.post_id);
        if (!persisted) {
          return c.json({ error: 'WordPress post created but its ID could not be saved' }, 500);
        }
        await recordWordPressPublication(article, {
          post_id: published.post_id,
          slug: published.slug,
          remote_url: published.remote_url || null,
          published_at: published.published_at,
        });
        return c.json(published.response, 200);
      } catch (err) {
        if (!(err instanceof PublishingFailure)) {
          return c.json({ error: 'WordPress request failed' }, 502);
        }
        if (err.httpStatus === 400) return c.json({ error: err.message }, 400);
        if (err.httpStatus === 403) return c.json({ error: err.message }, 403);
        if (err.httpStatus === 404) return c.json({ error: err.message }, 404);
        if (err.httpStatus === 409) return c.json({ error: err.message }, 409);
        if (err.httpStatus === 500) return c.json({ error: err.message }, 500);
        return c.json({ error: err.message }, 502);
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
        const published = await updateWordPressArticle({
          article,
          websiteUrl: org.website_url,
          token: org.wordpress_token,
          postId: article.wordpress_post_id,
        });
        await recordWordPressPublication(article, {
          post_id: published.post_id,
          slug: published.slug,
          remote_url: published.remote_url || null,
          published_at: published.published_at,
        });
        return c.json(published.response, 200);
      } catch (err) {
        if (!(err instanceof PublishingFailure)) {
          return c.json({ error: 'WordPress request failed' }, 502);
        }
        if (err.httpStatus === 400) return c.json({ error: err.message }, 400);
        if (err.httpStatus === 403) return c.json({ error: err.message }, 403);
        if (err.httpStatus === 404) return c.json({ error: err.message }, 404);
        if (err.httpStatus === 409) return c.json({ error: err.message }, 409);
        if (err.httpStatus === 500) return c.json({ error: err.message }, 500);
        return c.json({ error: err.message }, 502);
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

      let published: Awaited<ReturnType<typeof publishStaticSiteArticle>>;
      try {
        published = await publishStaticSiteArticle({ article, integration });
      } catch (err) {
        if (!(err instanceof PublishingFailure)) {
          return c.json({ error: 'GitHub request failed', code: 'github_request_failed' }, 502);
        }
        const body = { error: err.message, code: err.error.code };
        if (err.httpStatus === 409) return c.json(body, 409);
        if (err.httpStatus === 422) {
          await IntegrationRepo.setError(org.id, 'static-site', err.error.code).catch(() => {});
          return c.json(body, 422);
        }
        if (err.httpStatus === 500) return c.json(body, 500);
        return c.json(body, 502);
      }

      // The commit proves the connection works again. Guarded so the common
      // path (nothing was ever wrong) does not pay for an extra write.
      if (integration.last_error) {
        await IntegrationRepo.setError(org.id, 'static-site', null).catch(() => {});
      }

      return c.json(
        {
          commit_sha: published.ref,
          commit_url: published.remote_url,
          path: published.path,
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
