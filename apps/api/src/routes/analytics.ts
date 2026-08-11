import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { ArticleRepo, GscConnectionRepo } from '@shared/db';
import { GscAuthRevokedError } from '../clients/gsc';
import { gscAccess } from '../lib/gsc-access';
import {
  aggregateTotals,
  analyticsWindows,
  articlePublishedAt,
  buildSeries,
  computeDeltas,
  daysLive,
  splitByWindow,
  trendFor,
} from '../lib/gsc-analytics';
import { cachedSearchAnalytics } from '../lib/gsc-cache';
import { matchArticleByPage } from '../lib/gsc-urls';
import { loadOwnedOrg } from '../lib/load-owned-org';
import { logger } from '../logger';
import { type AuthEnv, authMiddleware } from '../middlewares/auth';
import * as schemas from '../schemas/analytics';

/** The gated /summary body: shape stays stable, data is inert (#208). */
const GATED_SUMMARY = {
  gated: true,
  totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
  deltas: { clicks: null, impressions: null, ctr: null, position: null },
  series: [],
};

/** Published articles for matching; org article counts are small (#208). */
const PUBLISHED_LIMIT = 1000;

/**
 * Analytics page routes (#208): GSC reads behind the 48h cache, joined to our
 * articles by the URL matcher. Same error discipline as /articles/best —
 * revoked closes the gate, transient provider errors degrade gated, never 500.
 */
const analytics = new OpenAPIHono<AuthEnv>()
  .openapi(
    createRoute({
      tags: ['analytics'],
      method: 'get',
      path: '/summary',
      summary: 'Search totals, deltas, and daily series (gated until GSC is connected)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.SummaryQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AnalyticsSummaryResponse } },
          description: 'Current-window totals, prior-window deltas, daily series',
        },
        404: {
          content: { 'application/json': { schema: schemas.OrgNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id, range, scope } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);

      const access = await gscAccess(org_id);
      if (!access) return c.json(GATED_SUMMARY, 200);

      const w = analyticsWindows(range);
      try {
        let rows =
          scope === 'site'
            ? await cachedSearchAnalytics(org_id, access, {
                startDate: w.startDate,
                endDate: w.endDate,
                dimensions: ['date'],
              })
            : await cachedSearchAnalytics(org_id, access, {
                startDate: w.startDate,
                endDate: w.endDate,
                dimensions: ['date', 'page'],
                rowLimit: 25000,
              });
        if (scope === 'articles') {
          const { articles: published } = await ArticleRepo.listByOrg(org_id, {
            status: 'published',
            limit: PUBLISHED_LIMIT,
            offset: 0,
          });
          rows = rows.filter((r) => matchArticleByPage(r.keys[1] ?? '', published) !== null);
        }
        const { current, prior } = splitByWindow(rows, w.currentStartDate);
        const totals = aggregateTotals(current);
        return c.json(
          {
            gated: false,
            totals,
            deltas: computeDeltas(totals, aggregateTotals(prior)),
            series: buildSeries(current),
          },
          200,
        );
      } catch (err) {
        if (err instanceof GscAuthRevokedError) {
          await GscConnectionRepo.markRefreshFailed(org_id);
        } else {
          logger.warn('GSC read failed for /analytics/summary', { org_id, error: err as Error });
        }
        return c.json(GATED_SUMMARY, 200);
      }
    },
  )
  .openapi(
    createRoute({
      tags: ['analytics'],
      method: 'get',
      path: '/articles',
      summary: 'Per-article search metrics with trend (gated until GSC is connected)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.ArticlesAnalyticsQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AnalyticsArticlesResponse } },
          description: 'One row per published article; unmatched articles carry zero metrics',
        },
        404: {
          content: { 'application/json': { schema: schemas.OrgNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id, range } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);

      const access = await gscAccess(org_id);
      if (!access) return c.json({ gated: true, articles: [] }, 200);

      const w = analyticsWindows(range);
      const now = new Date();
      try {
        const pageQuery = { dimensions: ['page'], rowLimit: 25000 };
        const [currentRows, priorRows] = await Promise.all([
          cachedSearchAnalytics(org_id, access, {
            ...pageQuery,
            startDate: w.currentStartDate,
            endDate: w.endDate,
          }),
          cachedSearchAnalytics(org_id, access, {
            ...pageQuery,
            startDate: w.priorStartDate,
            endDate: w.priorEndDate,
          }),
        ]);
        const { articles: published } = await ArticleRepo.listByOrg(org_id, {
          status: 'published',
          limit: PUBLISHED_LIMIT,
          offset: 0,
        });
        const rows = published.map((a) => {
          // All URL variants GSC reports for this article (http/www/…) sum up.
          const mine = (rs: typeof currentRows) =>
            rs.filter((r) => matchArticleByPage(r.keys[0] ?? '', [a]) !== null);
          const current = aggregateTotals(mine(currentRows));
          const prior = aggregateTotals(mine(priorRows));
          const hasRow = mine(currentRows).length > 0;
          const publishedAt = articlePublishedAt(a);
          const days = publishedAt ? daysLive(publishedAt, now) : 0;
          return {
            article_id: a.id,
            title: a.title,
            published_at: publishedAt ? publishedAt.toISOString() : null,
            days_live: days,
            ...current,
            trend: trendFor(current.clicks, prior.clicks, days),
            data_state:
              !hasRow && days < 4
                ? ('awaiting' as const)
                : hasRow && days < 14
                  ? ('gathering' as const)
                  : ('ok' as const),
          };
        });
        return c.json({ gated: false, articles: rows }, 200);
      } catch (err) {
        if (err instanceof GscAuthRevokedError) {
          await GscConnectionRepo.markRefreshFailed(org_id);
        } else {
          logger.warn('GSC read failed for /analytics/articles', { org_id, error: err as Error });
        }
        return c.json({ gated: true, articles: [] }, 200);
      }
    },
  );

export default analytics;
