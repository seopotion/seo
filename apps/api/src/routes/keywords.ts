import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { addCandidates } from '@shared/db';
import { DataForSeoError } from '@shared/providers';
import { getDataForSeoClient } from '../clients/providers';
import { loadOwnedPaidOrg, type OwnedPaidResult } from '../lib/load-owned-paid-org';
import { type AuthEnv, authMiddleware } from '../middlewares/auth';
import * as schemas from '../schemas/keywords';

const RESEARCH_LIMIT = 20;

/** Map a loadOwnedPaidOrg failure to its HTTP status. */
function gateStatus(reason: Exclude<OwnedPaidResult, { ok: true }>['reason']): 404 | 403 | 402 {
  return reason === 'not_found' ? 404 : reason === 'not_owner' ? 403 : 402;
}

/**
 * Keyword-research routes. Chained `.openapi()` calls so the resulting type
 * (and the OpenAPI spec) capture every endpoint. See design/product-flow.md.
 */
const keywords = new OpenAPIHono<AuthEnv>()
  .openapi(
    createRoute({
      tags: ['keywords'],
      method: 'post',
      path: '/research',
      summary: 'Manual keyword research (paid)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: { content: { 'application/json': { schema: schemas.ResearchBody } }, required: true },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.ResearchResponse } },
          description: 'Seed + similar keyword metrics',
        },
        402: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description: 'Active paid entitlement required',
        },
        403: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description: 'Not owned by the caller',
        },
        404: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description: 'Org not found',
        },
        502: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description: 'Keyword provider failure',
        },
      },
    }),
    async (c) => {
      const { org_id, seed } = c.req.valid('json');
      const { userId } = c.get('auth');
      const gate = await loadOwnedPaidOrg(org_id, userId);
      if (!gate.ok) return c.json({ error: gate.reason }, gateStatus(gate.reason));

      const loc = {
        locationName: gate.org.presets?.business.country,
        languageName: gate.org.presets?.business.language,
      };
      const df = getDataForSeoClient();
      try {
        const [seedMetrics, ideas] = await Promise.all([
          df.bulkKeywordDifficulty({ keywords: [seed], ...loc }),
          df.keywordIdeas({ keywords: [seed], limit: RESEARCH_LIMIT, ...loc }),
        ]);
        const seedMetric = seedMetrics[0] ?? {
          keyword: seed,
          search_volume: null,
          difficulty: null,
          cpc: null,
          competition: null,
          trend: null,
          intent: null,
        };
        const norm = seed.trim().toLowerCase();
        const similar = ideas
          .filter((m) => m.keyword.trim().toLowerCase() !== norm)
          .slice(0, RESEARCH_LIMIT);
        return c.json({ seed: seedMetric, similar }, 200);
      } catch (err) {
        if (err instanceof DataForSeoError)
          return c.json({ error: 'keyword provider failed' }, 502);
        throw err;
      }
    },
  )
  .openapi(
    createRoute({
      tags: ['keywords'],
      method: 'post',
      path: '/candidates',
      summary: 'Add selected keywords to the candidate pool (paid)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: { content: { 'application/json': { schema: schemas.SelectBody } }, required: true },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.SelectResponse } },
          description: 'Candidates inserted (deduped)',
        },
        402: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description: 'Active paid entitlement required',
        },
        403: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description: 'Not owned by the caller',
        },
        404: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description: 'Org not found',
        },
      },
    }),
    async (c) => {
      const { org_id, keywords } = c.req.valid('json');
      const { userId } = c.get('auth');
      const gate = await loadOwnedPaidOrg(org_id, userId);
      if (!gate.ok) return c.json({ error: gate.reason }, gateStatus(gate.reason));

      const items = keywords.map((m) => ({
        org_id,
        keyword: m.keyword,
        source: 'manual' as const,
        status: 'candidate' as const,
        search_volume: m.search_volume,
        difficulty: m.difficulty,
        cpc: m.cpc,
        competition: m.competition,
        trend: m.trend,
        intent: m.intent,
      }));
      const inserted = await addCandidates(org_id, items);
      return c.json({ added: inserted.length, skipped: keywords.length - inserted.length }, 200);
    },
  );

export default keywords;
