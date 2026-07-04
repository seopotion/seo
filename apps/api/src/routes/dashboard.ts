import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { KeywordRepo, OrgRepo } from '@shared/db';
import { loadOwnedOrg } from '../lib/load-owned-org';
import { mergePresets } from '../lib/merge-presets';
import { type AuthEnv, authMiddleware } from '../middlewares/auth';
import { MOCK_ARTICLE_DETAILS, MOCK_ARTICLES } from '../mocks/dashboard';
import * as schemas from '../schemas/dashboard';

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
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.ArticleCountResponse } },
          description: 'Published article count (0 for a fresh org)',
        },
      },
    }),
    (c) => c.json({ count: 0 }),
  )
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/articles/planned',
      summary: 'Count of planned articles',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.ArticleCountResponse } },
          description: 'Planned article count (0 for a fresh org)',
        },
      },
    }),
    (c) => c.json({ count: 0 }),
  )
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/integrations/connected',
      summary: 'Connected publishing integrations',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.ConnectedIntegrationsResponse } },
          description: 'Connected integrations (empty for a fresh org)',
        },
      },
    }),
    (c) => c.json({ integrations: [] }),
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
          description: 'Article history rows (mock sample data)',
        },
      },
    }),
    (c) => {
      const { status, limit, offset } = c.req.valid('query');
      const filtered = status ? MOCK_ARTICLES.filter((a) => a.status === status) : MOCK_ARTICLES;
      return c.json({ articles: filtered.slice(offset, offset + limit), total: filtered.length });
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
    (c) => {
      const { id } = c.req.valid('param');
      const article = MOCK_ARTICLE_DETAILS[id];
      if (!article) {
        return c.json({ error: 'Article not found' }, 404);
      }
      return c.json(article, 200);
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
