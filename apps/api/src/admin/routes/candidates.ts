import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { addCandidates, CandidateRepo, OrgRepo, scheduleCandidate } from '@shared/db';
import { DataForSeoError } from '@shared/providers';
import { researchKeyword } from '../../lib/keyword-research';
import { audit } from '../audit';
import { toAdminCandidateItem, toAdminScheduledKeyword } from '../dto';
import type { AdminEnv } from '../middleware';
import * as schemas from '../schemas';

/**
 * Operator keyword curation: research, candidate pool reads/writes, and
 * scheduling onto the planner. Same services and guard->409 mappings as the
 * customer `routes/keywords.ts`, minus the ownership/paid gates.
 */
const candidates = new OpenAPIHono<AdminEnv>()
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'post',
      path: '/orgs/{org_id}/research',
      summary: 'DataForSEO keyword research for the org (no paid gate)',
      security: [{ Bearer: [] }],
      request: {
        params: schemas.AdminOrgParams,
        body: {
          content: { 'application/json': { schema: schemas.AdminResearchBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminResearchResponse } },
          description: 'Seed + similar keyword metrics',
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Org not found',
        },
        502: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Keyword provider failure',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('param');
      const { seed } = c.req.valid('json');
      const org = await OrgRepo.findById(org_id);
      if (!org) return c.json({ error: 'not_found' }, 404);

      const loc = {
        locationName: org.presets?.business.country,
        languageName: org.presets?.business.language,
      };
      try {
        // Read-only provider call — not audited (epic #150).
        const result = await researchKeyword(seed, loc);
        return c.json(result, 200);
      } catch (err) {
        if (err instanceof DataForSeoError) {
          return c.json({ error: 'keyword_provider_failed' }, 502);
        }
        throw err;
      }
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'get',
      path: '/orgs/{org_id}/candidates',
      summary: 'Candidate pool incl. rejected (paginated; omit status for all)',
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminOrgParams, query: schemas.AdminCandidatesQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminCandidatesResponse } },
          description: 'Candidates with rejection_reason and SERP competitors',
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Org not found',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('param');
      const { status, limit, offset } = c.req.valid('query');
      const org = await OrgRepo.findById(org_id);
      if (!org) return c.json({ error: 'not_found' }, 404);

      const { candidates: pool, total } = await CandidateRepo.listByOrg(org.id, {
        status,
        limit,
        offset,
      });
      return c.json({ candidates: pool.map(toAdminCandidateItem), total, limit, offset }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'post',
      path: '/orgs/{org_id}/candidates',
      summary: "Add keywords to the pool (source 'manual'; provenance is the audit log)",
      security: [{ Bearer: [] }],
      request: {
        params: schemas.AdminOrgParams,
        body: {
          content: { 'application/json': { schema: schemas.AdminAddCandidatesBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminAddCandidatesResponse } },
          description: 'Candidates inserted (deduped)',
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Org not found',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('param');
      const { keywords } = c.req.valid('json');
      const org = await OrgRepo.findById(org_id);
      if (!org) return c.json({ error: 'not_found' }, 404);

      const items = keywords.map((m) => ({
        org_id: org.id,
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
      const inserted = await addCandidates(org.id, items);
      await audit(c, {
        action: 'candidate.add',
        org_id: org.id,
        payload: { keywords },
        before: null,
      });
      return c.json({ added: inserted.length, skipped: keywords.length - inserted.length }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'post',
      path: '/candidates/{candidate_id}/schedule',
      summary: 'Schedule a candidate onto an empty planner date',
      security: [{ Bearer: [] }],
      request: {
        params: schemas.AdminCandidateParams,
        body: {
          content: { 'application/json': { schema: schemas.ScheduleBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminScheduledKeywordResponse } },
          description: 'Idempotent retry: already scheduled for this date',
        },
        201: {
          content: { 'application/json': { schema: schemas.AdminScheduledKeywordResponse } },
          description: 'Planner keyword created from the candidate',
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Candidate not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description:
            'date_occupied | keyword_already_scheduled | candidate_already_scheduled | candidate_not_schedulable',
        },
      },
    }),
    async (c) => {
      const { candidate_id } = c.req.valid('param');
      const { scheduled_date } = c.req.valid('json');
      const candidate = await CandidateRepo.findById(candidate_id);
      if (!candidate) return c.json({ error: 'not_found' }, 404);

      const result = await scheduleCandidate(candidate, scheduled_date);
      if (!result.ok) return c.json({ error: result.reason }, 409);
      await audit(c, {
        action: 'candidate.schedule',
        org_id: candidate.org_id,
        entity: { type: 'candidate', id: candidate.id },
        payload: { scheduled_date },
        before: candidate,
      });
      return c.json(
        { keyword: toAdminScheduledKeyword(result.keyword) },
        result.created ? 201 : 200,
      );
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'delete',
      path: '/candidates/{candidate_id}',
      summary: 'Reject a candidate (conditional; restore is Phase 2)',
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminCandidateParams },
      responses: {
        204: { description: 'Candidate rejected and gone from the pool' },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Candidate not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'candidate_not_deletable',
        },
      },
    }),
    async (c) => {
      const { candidate_id } = c.req.valid('param');
      const candidate = await CandidateRepo.findById(candidate_id);
      if (!candidate) return c.json({ error: 'not_found' }, 404);

      const rejected = await CandidateRepo.rejectIfCandidate(candidate.id);
      // Conditional update misses when the candidate was scheduled or rejected
      // meanwhile — only a pooled `candidate` may be rejected.
      if (!rejected) return c.json({ error: 'candidate_not_deletable' }, 409);
      await audit(c, {
        action: 'candidate.reject',
        org_id: candidate.org_id,
        entity: { type: 'candidate', id: candidate.id },
        before: candidate,
      });
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'post',
      path: '/candidates/{candidate_id}/restore',
      summary: 'Un-reject a candidate back into the pool (conditional)',
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminCandidateParams },
      responses: {
        204: { description: 'Candidate restored to the pool' },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Candidate not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'candidate_not_restorable — only a rejected candidate restores',
        },
      },
    }),
    async (c) => {
      const { candidate_id } = c.req.valid('param');
      const candidate = await CandidateRepo.findById(candidate_id);
      if (!candidate) return c.json({ error: 'not_found' }, 404);

      const restored = await CandidateRepo.restoreRejected(candidate.id);
      // One-winner conditional: only a `rejected` candidate restores.
      if (!restored) return c.json({ error: 'candidate_not_restorable' }, 409);
      await audit(c, {
        action: 'candidate.restore',
        org_id: candidate.org_id,
        entity: { type: 'candidate', id: candidate.id },
        before: candidate,
      });
      return c.body(null, 204);
    },
  );

export default candidates;
