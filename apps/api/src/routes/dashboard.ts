import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { ArticleRepo, KeywordRepo, OrgRepo } from '@shared/db';
import type { Article } from '@shared/schemas';
import {
  editWordPressArticle,
  submitWordPressArticle,
  testWordPressIntegration,
} from '../clients/wordpress';
import { loadOwnedOrg } from '../lib/load-owned-org';
import { mergePresets } from '../lib/merge-presets';
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
  return {
    id: a.id,
    keyword_id: a.keyword_id,
    title: a.title,
    slug: a.slug,
    meta_description: a.meta_description,
    featured_image_url: a.featured_image_url,
    content: a.content,
    status: a.status,
    ...(a.wordpress_post_id ? { wordpress_post_id: a.wordpress_post_id } : {}),
    created_at: a.created_at.toISOString(),
    published_at: a.published_at ? a.published_at.toISOString() : null,
  };
}

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
      summary: 'Best-performing articles (gated until Google Search Console is connected)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.BestArticlesResponse } },
          description: 'Best articles; empty + gated until live Google data is connected',
        },
      },
    }),
    (c) => c.json({ articles: [], gated: true }),
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

      const saved = await OrgRepo.saveWordPressConnection(org.id, token, new Date());
      if (!saved) return c.json({ error: 'Not found' }, 404);
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
      if (!org.wordpress_token || !org.wordpress_connected_at) {
        return c.json({ integrations: [] }, 200);
      }
      return c.json(
        {
          integrations: [
            {
              id: 'wordpress',
              provider: 'wordpress' as const,
              connected_at: org.wordpress_connected_at.toISOString(),
            },
          ],
        },
        200,
      );
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
            keyword: k.keyword,
            status: k.status,
            scheduled_date: k.scheduled_date,
            search_volume: k.search_volume,
            difficulty: k.difficulty,
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
          description: 'Full article record (mock sample data)',
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
        if (result.status === 200) return c.json(result.body, 200);
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
