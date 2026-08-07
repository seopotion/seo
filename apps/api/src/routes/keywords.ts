import type { z } from '@hono/zod-openapi';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import {
  addCandidates,
  CandidateRepo,
  isDuplicateKeyError,
  KeywordRepo,
  scheduleCandidate,
} from '@shared/db';
import { DataForSeoError } from '@shared/providers';
import { type Candidate, isPaid, type Keyword } from '@shared/schemas';
import { researchKeyword } from '../lib/keyword-research';
import { loadOwnedOrg } from '../lib/load-owned-org';
import { loadOwnedPaidOrg, type OwnedPaidResult } from '../lib/load-owned-paid-org';
import { type AuthEnv, authMiddleware } from '../middlewares/auth';
import * as schemas from '../schemas/keywords';

/** Map a loadOwnedPaidOrg failure to its HTTP status. */
function gateStatus(reason: Exclude<OwnedPaidResult, { ok: true }>['reason']): 404 | 403 | 402 {
  return reason === 'not_found' ? 404 : reason === 'not_owner' ? 403 : 402;
}

/** Map a Candidate entity to the pool-read row (#99). */
function toCandidateItem(c: Candidate): z.infer<typeof schemas.CandidateItem> {
  return {
    id: c.id,
    keyword: c.keyword,
    search_volume: c.search_volume,
    difficulty: c.difficulty,
    cpc: c.cpc,
    competition: c.competition,
    trend: c.trend,
    intent: c.intent,
    article_type: c.article_type,
    relevance_score: c.relevance_score,
    opportunity_score: c.opportunity_score,
    source: c.source,
    status: c.status,
    schedulable: c.search_volume !== null && c.difficulty !== null && c.status === 'candidate',
    created_at: c.created_at.toISOString(),
  };
}

/** Map a Keyword entity to the scheduled-keyword response shape (#99). */
function toScheduledKeyword(k: Keyword): z.infer<typeof schemas.ScheduledKeyword> {
  return {
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
  };
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
        400: { description: 'Validation failed (empty/whitespace or oversized seed)' },
        401: { description: 'Missing or invalid bearer token' },
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
      try {
        const { seed: seedMetric, similar } = await researchKeyword(seed, loc);
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
        400: { description: 'Validation failed (empty keywords list or malformed metrics)' },
        401: { description: 'Missing or invalid bearer token' },
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
  )
  .openapi(
    createRoute({
      tags: ['keywords'],
      method: 'get',
      path: '/candidates',
      summary: 'Read the candidate pool (read-only, no paid entitlement required)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.CandidatesQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.CandidatesResponse } },
          description: 'Paginated candidates for the org, opportunity-ranked',
        },
        400: { description: 'Validation failed (status/limit/offset)' },
        401: { description: 'Missing or invalid bearer token' },
        404: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id, status, limit, offset } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'not_found' }, 404);

      const { candidates, total } = await CandidateRepo.listByOrg(org_id, {
        status,
        limit,
        offset,
      });
      return c.json({ candidates: candidates.map(toCandidateItem), total, limit, offset }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['keywords'],
      method: 'post',
      path: '/candidates/{candidate_id}/schedule',
      summary: 'Schedule a candidate onto an empty planner date (paid)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        params: schemas.ScheduleParams,
        body: { content: { 'application/json': { schema: schemas.ScheduleBody } }, required: true },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.ScheduledKeywordResponse } },
          description: 'Idempotent retry: the candidate was already scheduled for this date',
        },
        201: {
          content: { 'application/json': { schema: schemas.ScheduledKeywordResponse } },
          description: 'Planner keyword created from the candidate',
        },
        400: { description: 'Invalid scheduled_date' },
        401: { description: 'Missing or invalid bearer token' },
        402: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description: 'Active paid entitlement required',
        },
        404: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description: 'Candidate/org not found or not owned by the caller',
        },
        409: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description:
            'date_occupied | keyword_already_scheduled | candidate_already_scheduled | candidate_not_schedulable',
        },
      },
    }),
    async (c) => {
      const { candidate_id } = c.req.valid('param');
      const { scheduled_date } = c.req.valid('json');
      const { userId } = c.get('auth');

      // Org is derived from the candidate; a missing candidate and one in an
      // unowned org both 404 so existence never leaks across accounts.
      const candidate = await CandidateRepo.findById(candidate_id);
      const org = candidate && (await loadOwnedOrg(candidate.org_id, userId));
      if (!candidate || !org) return c.json({ error: 'not_found' }, 404);
      if (!isPaid(org)) return c.json({ error: 'not_paid' }, 402);

      // No provider calls here — scheduling only moves stored data.
      const result = await scheduleCandidate(candidate, scheduled_date);
      if (!result.ok) return c.json({ error: result.reason }, 409);
      return c.json({ keyword: toScheduledKeyword(result.keyword) }, result.created ? 201 : 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['keywords'],
      method: 'patch',
      path: '/scheduled/{keyword_id}',
      summary: 'Reschedule an ungenerated planner keyword (paid)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        params: schemas.ScheduledKeywordParams,
        body: { content: { 'application/json': { schema: schemas.ScheduleBody } }, required: true },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.ScheduledKeywordResponse } },
          description: 'Keyword moved (or already on the requested date)',
        },
        400: { description: 'Invalid scheduled_date' },
        401: { description: 'Missing or invalid bearer token' },
        402: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description: 'Active paid entitlement required',
        },
        404: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description: 'Keyword/org not found or not owned by the caller',
        },
        409: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description: 'date_occupied | generation_started',
        },
      },
    }),
    async (c) => {
      const { keyword_id } = c.req.valid('param');
      const { scheduled_date } = c.req.valid('json');
      const { userId } = c.get('auth');

      const keyword = await KeywordRepo.findById(keyword_id);
      const org = keyword && (await loadOwnedOrg(keyword.org_id, userId));
      if (!keyword || !org) return c.json({ error: 'not_found' }, 404);
      if (!isPaid(org)) return c.json({ error: 'not_paid' }, 402);

      if (keyword.article_id !== null || keyword.generation_status !== 'pending') {
        return c.json({ error: 'generation_started' }, 409);
      }
      // Idempotent: repeating the current date returns the unchanged keyword.
      if (keyword.scheduled_date === scheduled_date) {
        return c.json({ keyword: toScheduledKeyword(keyword) }, 200);
      }
      const occupant = await KeywordRepo.findByOrgAndDate(keyword.org_id, scheduled_date);
      if (occupant) return c.json({ error: 'date_occupied' }, 409);

      try {
        const moved = await KeywordRepo.reschedulePending(keyword_id, scheduled_date);
        // Conditional update misses only when generation started meanwhile.
        if (!moved) return c.json({ error: 'generation_started' }, 409);
        return c.json({ keyword: toScheduledKeyword(moved) }, 200);
      } catch (err) {
        // Unique (org_id, scheduled_date) race: someone claimed the date first.
        if (isDuplicateKeyError(err)) return c.json({ error: 'date_occupied' }, 409);
        throw err;
      }
    },
  )
  .openapi(
    createRoute({
      tags: ['keywords'],
      method: 'delete',
      path: '/scheduled/{keyword_id}',
      summary: 'Remove an ungenerated planner keyword; its candidate returns to the pool (paid)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { params: schemas.ScheduledKeywordParams },
      responses: {
        204: { description: 'Keyword removed; linked candidate released back to the pool' },
        401: { description: 'Missing or invalid bearer token' },
        402: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description: 'Active paid entitlement required',
        },
        404: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description: 'Keyword/org not found or not owned by the caller',
        },
        409: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description: 'generation_started',
        },
      },
    }),
    async (c) => {
      const { keyword_id } = c.req.valid('param');
      const { userId } = c.get('auth');

      const keyword = await KeywordRepo.findById(keyword_id);
      const org = keyword && (await loadOwnedOrg(keyword.org_id, userId));
      if (!keyword || !org) return c.json({ error: 'not_found' }, 404);
      if (!isPaid(org)) return c.json({ error: 'not_paid' }, 402);

      const deleted = await KeywordRepo.deleteUnstarted(keyword_id);
      // Articles are never deleted here: the conditional delete refuses
      // linked/generating/generated entries.
      if (!deleted) return c.json({ error: 'generation_started' }, 409);
      if (deleted.candidate_id) {
        await CandidateRepo.releaseAfterUnschedule(deleted.candidate_id);
      }
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      tags: ['keywords'],
      method: 'delete',
      path: '/candidates/{candidate_id}',
      summary: 'Reject a candidate, removing it from the pool (paid)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { params: schemas.CandidateParams },
      responses: {
        204: { description: 'Candidate rejected and gone from the pool' },
        401: { description: 'Missing or invalid bearer token' },
        402: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description: 'Active paid entitlement required',
        },
        404: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description: 'Candidate/org not found or not owned by the caller',
        },
        409: {
          content: { 'application/json': { schema: schemas.ErrorResponse } },
          description: 'candidate_not_deletable',
        },
      },
    }),
    async (c) => {
      const { candidate_id } = c.req.valid('param');
      const { userId } = c.get('auth');

      // Org is derived from the candidate; a missing candidate and one in an
      // unowned org both 404 so existence never leaks across accounts.
      const candidate = await CandidateRepo.findById(candidate_id);
      const org = candidate && (await loadOwnedOrg(candidate.org_id, userId));
      if (!candidate || !org) return c.json({ error: 'not_found' }, 404);
      if (!isPaid(org)) return c.json({ error: 'not_paid' }, 402);

      const rejected = await CandidateRepo.rejectIfCandidate(candidate_id);
      // Conditional update misses when the candidate was scheduled or rejected
      // meanwhile — only a pooled `candidate` may be deleted.
      if (!rejected) return c.json({ error: 'candidate_not_deletable' }, 409);
      return c.body(null, 204);
    },
  );

export default keywords;
