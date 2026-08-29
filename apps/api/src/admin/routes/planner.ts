import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { launchGeneration } from '@shared/articles';
import { CandidateRepo, isDuplicateKeyError, KeywordRepo, OrgRepo } from '@shared/db';
import { isPaid } from '@shared/schemas';
import { audit } from '../audit';
import { toAdminScheduledKeyword } from '../dto';
import type { AdminEnv } from '../middleware';
import * as schemas from '../schemas';

/**
 * Operator planner: full read (incl. generation attempts/errors/timing) plus
 * reschedule / unschedule / generate-now. Same repo guards and 409 codes as
 * the customer `routes/keywords.ts`, minus ownership/paid gates — except
 * generate-now, which adds the `org_not_paid` guard (the worker fails
 * generation for unpaid orgs and burns one of the 3 attempts).
 */
const planner = new OpenAPIHono<AdminEnv>()
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'get',
      path: '/orgs/{org_id}/planner',
      summary: 'Scheduled keywords incl. generation attempts / errors / timing',
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminOrgParams },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminPlannerResponse } },
          description: 'Planner rows for the org',
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
      const org = await OrgRepo.findById(org_id);
      if (!org) return c.json({ error: 'not_found' }, 404);

      const keywords = await KeywordRepo.listByOrg(org.id);
      return c.json(
        {
          strategy_status: org.strategy_status ?? 'none',
          keywords: keywords.map(toAdminScheduledKeyword),
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'patch',
      path: '/scheduled/{keyword_id}',
      summary: 'Reschedule an ungenerated planner keyword',
      security: [{ Bearer: [] }],
      request: {
        params: schemas.AdminKeywordParams,
        body: {
          content: { 'application/json': { schema: schemas.ScheduleBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminScheduledKeywordResponse } },
          description: 'Keyword moved (or already on the requested date)',
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Keyword not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'date_occupied | generation_started',
        },
      },
    }),
    async (c) => {
      const { keyword_id } = c.req.valid('param');
      const { scheduled_date } = c.req.valid('json');
      const keyword = await KeywordRepo.findById(keyword_id);
      if (!keyword) return c.json({ error: 'not_found' }, 404);

      if (keyword.article_id !== null || keyword.generation_status !== 'pending') {
        return c.json({ error: 'generation_started' }, 409);
      }
      // Idempotent no-op: repeating the current date returns the unchanged
      // keyword (and writes no audit row — nothing mutated).
      if (keyword.scheduled_date === scheduled_date) {
        return c.json({ keyword: toAdminScheduledKeyword(keyword) }, 200);
      }
      const occupant = await KeywordRepo.findByOrgAndDate(keyword.org_id, scheduled_date);
      if (occupant) return c.json({ error: 'date_occupied' }, 409);

      try {
        const moved = await KeywordRepo.reschedulePending(keyword.id, scheduled_date);
        // Conditional update misses only when generation started meanwhile.
        if (!moved) return c.json({ error: 'generation_started' }, 409);
        await audit(c, {
          action: 'keyword.reschedule',
          org_id: keyword.org_id,
          entity: { type: 'keyword', id: keyword.id },
          payload: { scheduled_date },
          before: keyword,
        });
        return c.json({ keyword: toAdminScheduledKeyword(moved) }, 200);
      } catch (err) {
        // Unique (org_id, scheduled_date) race: someone claimed the date first.
        if (isDuplicateKeyError(err)) return c.json({ error: 'date_occupied' }, 409);
        throw err;
      }
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'delete',
      path: '/scheduled/{keyword_id}',
      summary: 'Unschedule an ungenerated keyword; its candidate returns to the pool',
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminKeywordParams },
      responses: {
        204: { description: 'Keyword removed; linked candidate released back to the pool' },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Keyword not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'generation_started',
        },
      },
    }),
    async (c) => {
      const { keyword_id } = c.req.valid('param');
      const keyword = await KeywordRepo.findById(keyword_id);
      if (!keyword) return c.json({ error: 'not_found' }, 404);

      const deleted = await KeywordRepo.deleteUnstarted(keyword.id);
      // Articles are never deleted here: the conditional delete refuses
      // linked/generating/generated entries.
      if (!deleted) return c.json({ error: 'generation_started' }, 409);
      if (deleted.candidate_id) {
        await CandidateRepo.releaseAfterUnschedule(deleted.candidate_id);
      }
      await audit(c, {
        action: 'keyword.unschedule',
        org_id: keyword.org_id,
        entity: { type: 'keyword', id: keyword.id },
        before: keyword,
      });
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'post',
      path: '/scheduled/{keyword_id}/generate',
      summary: 'Generate/retry the article now (skips the 07:00 UTC scheduler)',
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminKeywordParams },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminGenerateNowResponse } },
          description: "Task enqueued; the worker's atomic claim dedupes",
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Keyword or its org not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'org_not_paid | generation_terminal',
        },
      },
    }),
    async (c) => {
      const { keyword_id } = c.req.valid('param');
      const keyword = await KeywordRepo.findById(keyword_id);
      if (!keyword) return c.json({ error: 'not_found' }, 404);
      const org = await OrgRepo.findById(keyword.org_id);
      if (!org) return c.json({ error: 'not_found' }, 404);

      // The worker fails generation for unpaid orgs and burns an attempt, so
      // enqueueing is strictly a mistake — set the plan first (epic #150).
      if (!isPaid(org)) return c.json({ error: 'org_not_paid' }, 409);
      if (keyword.article_id !== null || keyword.generation_status === 'generated') {
        return c.json({ error: 'generation_terminal' }, 409);
      }

      // Claim-lost (already in flight) intentionally still reports enqueued:
      // same silent dedupe the SQS worker's claim used to provide. Launch
      // errors (missing presets etc.) propagate -> 500, surfaced to admin.
      await launchGeneration(org.id, keyword.id);
      await audit(c, {
        action: 'keyword.generate_now',
        org_id: org.id,
        entity: { type: 'keyword', id: keyword.id },
        before: keyword,
      });
      return c.json({ enqueued: true as const }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'post',
      path: '/scheduled/{keyword_id}/reset',
      summary: 'Reset a failed keyword to pending with zero attempts (over-cap lever)',
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminKeywordParams },
      responses: {
        204: { description: 'Keyword reset; the daily scheduler (or generate-now) can retry it' },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Keyword not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'not_resettable — only failed, unlinked keywords reset',
        },
      },
    }),
    async (c) => {
      const { keyword_id } = c.req.valid('param');
      const keyword = await KeywordRepo.findById(keyword_id);
      if (!keyword) return c.json({ error: 'not_found' }, 404);

      const reset = await KeywordRepo.resetGeneration(keyword.id);
      if (!reset) return c.json({ error: 'not_resettable' }, 409);
      await audit(c, {
        action: 'keyword.reset_generation',
        org_id: keyword.org_id,
        entity: { type: 'keyword', id: keyword.id },
        before: keyword,
      });
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'patch',
      path: '/scheduled/{keyword_id}/brief',
      summary: 'Edit the planner brief (type / intent / score) while ungenerated',
      security: [{ Bearer: [] }],
      request: {
        params: schemas.AdminKeywordParams,
        body: {
          content: { 'application/json': { schema: schemas.AdminBriefPatchBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminScheduledKeywordResponse } },
          description: 'The updated planner row',
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Keyword not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'generation_started — the brief feeds generation, so it locks once started',
        },
      },
    }),
    async (c) => {
      const { keyword_id } = c.req.valid('param');
      const fields = c.req.valid('json');
      const keyword = await KeywordRepo.findById(keyword_id);
      if (!keyword) return c.json({ error: 'not_found' }, 404);

      const updated = await KeywordRepo.updateBrief(keyword.id, fields);
      // Conditional update misses once generation started or an article linked.
      if (!updated) return c.json({ error: 'generation_started' }, 409);
      await audit(c, {
        action: 'keyword.update_brief',
        org_id: keyword.org_id,
        entity: { type: 'keyword', id: keyword.id },
        payload: fields,
        before: {
          article_type: keyword.article_type,
          intent: keyword.intent,
          opportunity_score: keyword.opportunity_score,
        },
      });
      return c.json({ keyword: toAdminScheduledKeyword(updated) }, 200);
    },
  );

export default planner;
