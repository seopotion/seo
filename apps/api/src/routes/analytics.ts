import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { ArticleRepo, GscConnectionRepo } from '@shared/db';
import type { Article } from '@shared/schemas';
import type { SearchAnalyticsRow } from '../clients/gsc';
import { GscAuthRevokedError } from '../clients/gsc';
import { gscAccess } from '../lib/gsc-access';
import {
  aggregateTotals,
  analyticsWindows,
  articlePublishedAt,
  buildSeries,
  computeDeltas,
  daysLive,
  gscDate,
  splitByWindow,
  trendFor,
} from '../lib/gsc-analytics';
import { cachedSearchAnalytics } from '../lib/gsc-cache';
import { finalSegment, matchArticleByPage } from '../lib/gsc-urls';
import { loadAccessibleOrg } from '../lib/load-org-for-user';
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
 * Index page-dimension rows by their final URL path segment, one `new URL()`
 * parse per row (#208 perf): avoids re-parsing every row per article.
 */
function indexBySegment(rows: SearchAnalyticsRow[]): Map<string, SearchAnalyticsRow[]> {
  const bySegment = new Map<string, SearchAnalyticsRow[]>();
  for (const r of rows) {
    const segment = finalSegment(r.keys[0] ?? '');
    if (segment === null) continue;
    const bucket = bySegment.get(segment);
    if (bucket) bucket.push(r);
    else bySegment.set(segment, [r]);
  }
  return bySegment;
}

/**
 * All rows matching any of the article's publication slugs, deduped so a row
 * shared by two publications of the SAME article is not double-counted. Two
 * different articles sharing a slug still each get the row — a known,
 * separately-tracked matching inconsistency (#208), not fixed here.
 */
function rowsForArticle(
  bySegment: Map<string, SearchAnalyticsRow[]>,
  article: Pick<Article, 'publications'>,
): SearchAnalyticsRow[] {
  const seen = new Set<SearchAnalyticsRow>();
  const rows: SearchAnalyticsRow[] = [];
  for (const p of article.publications) {
    const bucket = bySegment.get(p.slug);
    if (!bucket) continue;
    for (const r of bucket) {
      if (seen.has(r)) continue;
      seen.add(r);
      rows.push(r);
    }
  }
  return rows;
}

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
      const org = await loadAccessibleOrg(org_id, c.get('auth'));
      if (!org) return c.json({ error: 'Not found' }, 404);

      const access = await gscAccess(org_id);
      if (!access) return c.json(GATED_SUMMARY, 200);

      const w = analyticsWindows(range);
      // Doesn't depend on GSC data — read outside the try so a Mongo failure
      // here isn't misattributed as a GSC read failure (#208).
      let publishedSlugs: Set<string> | null = null;
      if (scope === 'articles') {
        const { articles: published } = await ArticleRepo.listByOrg(org_id, {
          status: 'published',
          limit: PUBLISHED_LIMIT,
          offset: 0,
        });
        publishedSlugs = new Set(published.flatMap((a) => a.publications.map((p) => p.slug)));
      }
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
        if (publishedSlugs) {
          const slugs = publishedSlugs;
          rows = rows.filter((r) => {
            const segment = finalSegment(r.keys[1] ?? '');
            return segment !== null && slugs.has(segment);
          });
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
      const org = await loadAccessibleOrg(org_id, c.get('auth'));
      if (!org) return c.json({ error: 'Not found' }, 404);

      const access = await gscAccess(org_id);
      if (!access) return c.json({ gated: true, articles: [] }, 200);

      const w = analyticsWindows(range);
      const now = new Date();
      // Doesn't depend on GSC data — read outside the try so a Mongo failure
      // here isn't misattributed as a GSC read failure (#208).
      const { articles: published } = await ArticleRepo.listByOrg(org_id, {
        status: 'published',
        limit: PUBLISHED_LIMIT,
        offset: 0,
      });
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
        // One URL parse per row (indexed once), not per article × row (#208 perf).
        const currentBySegment = indexBySegment(currentRows);
        const priorBySegment = indexBySegment(priorRows);
        const rows = published.map((a) => {
          // All URL variants GSC reports for this article (http/www/…) sum up.
          const currentMatched = rowsForArticle(currentBySegment, a);
          const priorMatched = rowsForArticle(priorBySegment, a);
          const current = aggregateTotals(currentMatched);
          const prior = aggregateTotals(priorMatched);
          const hasRow = currentMatched.length > 0;
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
  )
  .openapi(
    createRoute({
      tags: ['analytics'],
      method: 'get',
      path: '/articles/{id}/timeseries',
      summary: 'Full-lifetime daily series for one article (on-demand)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { params: schemas.ArticleParams, query: schemas.OrgQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AnalyticsTimeseriesResponse } },
          description: 'Daily series from publish date; empty while awaiting data',
        },
        404: {
          content: { 'application/json': { schema: schemas.ArticleNotFoundResponse } },
          description: 'Article not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { org_id } = c.req.valid('query');
      const article = await ArticleRepo.findById(id);
      // Missing, foreign-org, and mismatched-org all 404 — never leak existence.
      if (
        !article ||
        article.org_id !== org_id ||
        !(await loadAccessibleOrg(org_id, c.get('auth')))
      ) {
        return c.json({ error: 'Article not found' }, 404);
      }

      const publishedAt = articlePublishedAt(article);
      if (!publishedAt || article.publications.length === 0) {
        return c.json(
          { gated: false, series: [], days_live: null, data_state: 'not_published' as const },
          200,
        );
      }

      const GATED = {
        gated: true,
        series: [],
        days_live: null,
        data_state: 'awaiting' as const,
      };
      const access = await gscAccess(org_id);
      if (!access) return c.json(GATED, 200);

      const now = new Date();
      const days = daysLive(publishedAt, now);
      try {
        // The article's exact GSC URL is unknown (we match by slug) — resolve it
        // from the cached page-dimension query first (#208). 90d window: widest
        // match chance, and the /articles table at 90d shares the cache entry.
        const w = analyticsWindows('90d', now);
        const pageRows = await cachedSearchAnalytics(org_id, access, {
          startDate: w.currentStartDate,
          endDate: w.endDate,
          dimensions: ['page'],
          rowLimit: 25000,
        });
        const pageRow = pageRows.find(
          (r) => matchArticleByPage(r.keys[0] ?? '', [article]) !== null,
        );
        if (!pageRow) {
          return c.json(
            { gated: false, series: [], days_live: days, data_state: 'awaiting' as const },
            200,
          );
        }
        const pageUrl = pageRow.keys[0] ?? '';
        // Full lifetime: publish date → today. GSC's trailing-lag dip is the
        // detail view's honest shape; the summary windows are where it biases
        // deltas and gets the −3d cut (#208 pinned decisions).
        const rows = await cachedSearchAnalytics(org_id, access, {
          startDate: gscDate(publishedAt),
          endDate: gscDate(now),
          dimensions: ['date'],
          dimensionFilterGroups: [
            { filters: [{ dimension: 'page', operator: 'equals', expression: pageUrl }] },
          ],
        });
        return c.json(
          { gated: false, series: buildSeries(rows), days_live: days, data_state: 'ok' as const },
          200,
        );
      } catch (err) {
        if (err instanceof GscAuthRevokedError) {
          await GscConnectionRepo.markRefreshFailed(org_id);
        } else {
          logger.warn('GSC read failed for /analytics/timeseries', { org_id, error: err as Error });
        }
        return c.json(GATED, 200);
      }
    },
  );

export default analytics;
