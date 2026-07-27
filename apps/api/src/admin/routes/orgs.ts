import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import {
  AdminActionRepo,
  ArticleRepo,
  GscConnectionRepo,
  KeywordRepo,
  OrgRepo,
  SubscriptionRepo,
  UserRepo,
} from '@shared/db';
import { isPaid } from '@shared/schemas';
import { enqueueScanTask, enqueueStrategyTask } from '../../clients/sqs';
import { testWordPressIntegration } from '../../clients/wordpress';
import { mergePresets } from '../../lib/merge-presets';
import { audit } from '../audit';
import {
  toAdminAuditAction,
  toAdminGsc,
  toAdminOrg,
  toAdminOrgSummary,
  toAdminSubscription,
} from '../dto';
import type { AdminEnv } from '../middleware';
import * as schemas from '../schemas';

/**
 * Org search, workspace detail, and plan override. Handlers are thin:
 * load -> guard -> repo/service call -> audit() -> DTO. No ownership checks —
 * the operator acts on any org; auth is the router-global admin middleware.
 */
const orgs = new OpenAPIHono<AdminEnv>()
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'get',
      path: '/orgs',
      summary: 'Search orgs by id, owner email, or website_url substring',
      security: [{ Bearer: [] }],
      request: { query: schemas.AdminOrgSearchQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminOrgSearchResponse } },
          description: 'Matching orgs (capped)',
        },
        401: { description: 'Missing or invalid admin token' },
      },
    }),
    async (c) => {
      const { query } = c.req.valid('query');
      // Email lookups resolve through the owner; everything else (id, URL
      // substring) is OrgRepo.search's job.
      if (query.includes('@')) {
        const user = await UserRepo.findByEmail(query.trim());
        const found = user ? await OrgRepo.findByUserId(user.id) : [];
        return c.json({ orgs: found.map(toAdminOrgSummary) }, 200);
      }
      const found = await OrgRepo.search(query);
      return c.json({ orgs: found.map(toAdminOrgSummary) }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'get',
      path: '/orgs/{org_id}',
      summary: 'Full org workspace detail (secret-redacted)',
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminOrgParams },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminOrgDetailResponse } },
          description: 'Org + owner + subscriptions + GSC health + counts',
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

      const [owner, latest, active, gsc, scheduled, generated, published] = await Promise.all([
        UserRepo.findById(org.user_id),
        SubscriptionRepo.findLatestByOrg(org.id),
        SubscriptionRepo.listActiveByOrg(org.id),
        GscConnectionRepo.findByOrgId(org.id),
        KeywordRepo.countScheduled(org.id),
        ArticleRepo.countByStatus(org.id, 'generated'),
        ArticleRepo.countByStatus(org.id, 'published'),
      ]);

      return c.json(
        {
          org: toAdminOrg(org),
          owner: owner ? { id: owner.id, email: owner.email, name: owner.name } : null,
          subscriptions: {
            latest: latest ? toAdminSubscription(latest) : null,
            active: active.map(toAdminSubscription),
          },
          gsc: gsc ? toAdminGsc(gsc) : null,
          counts: {
            scheduled_keywords: scheduled,
            articles_generated: generated,
            articles_published: published,
          },
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'post',
      path: '/orgs/{org_id}/plan',
      summary: 'Override the entitlement plan (set-plan semantics + strategy kick)',
      security: [{ Bearer: [] }],
      request: {
        params: schemas.AdminOrgParams,
        body: {
          content: { 'application/json': { schema: schemas.AdminSetPlanBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminSetPlanResponse } },
          description: 'Plan set (and strategy kicked when eligible)',
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
      const { plan } = c.req.valid('json');
      const org = await OrgRepo.findById(org_id);
      if (!org) return c.json({ error: 'not_found' }, 404);

      await OrgRepo.setPlan(org.id, plan);

      // Strategy kick — the exact finalize/webhook/CLI sequence (a deliberate
      // third copy of lib/billing/apply-event.ts's activation case): flipping
      // the plan alone leaves an onboarded org permanently dormant.
      // claimStrategy keeps it to exactly one job; on enqueue failure revert
      // the claim so a retry can reclaim.
      let strategy_kicked = false;
      if (
        org.setup_status === 'setup_complete' &&
        org.presets &&
        isPaid({ ...org, plan }) &&
        (await OrgRepo.claimStrategy(org.id))
      ) {
        try {
          await enqueueStrategyTask({ org_id: org.id });
          strategy_kicked = true;
        } catch (err) {
          await OrgRepo.setStrategyStatus(org.id, 'failed');
          throw err;
        }
      }

      await audit(c, { action: 'org.set_plan', org_id: org.id, payload: { plan }, before: org });
      return c.json({ plan, strategy_kicked }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'get',
      path: '/orgs/{org_id}/audit',
      summary: "The org's admin actions, newest first (paginated)",
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminOrgParams, query: schemas.AdminAuditQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminAuditResponse } },
          description: 'Audit rows with actor, payload, and before snapshots',
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
      const { limit, offset } = c.req.valid('query');
      const org = await OrgRepo.findById(org_id);
      if (!org) return c.json({ error: 'not_found' }, 404);

      const { actions, total } = await AdminActionRepo.listByOrg(org.id, { limit, offset });
      return c.json({ actions: actions.map(toAdminAuditAction), total }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'patch',
      path: '/orgs/{org_id}/presets',
      summary: 'Deep-merge edit over the full SetupPresets (any setup status)',
      security: [{ Bearer: [] }],
      request: {
        params: schemas.AdminOrgParams,
        body: {
          content: { 'application/json': { schema: schemas.AdminPresetsPatchBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminPresetsResponse } },
          description: 'Merged presets (persisted)',
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Org not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Org has no presets yet (scan has not produced them)',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('param');
      const patch = c.req.valid('json');
      const org = await OrgRepo.findById(org_id);
      if (!org) return c.json({ error: 'not_found' }, 404);
      // Unlike the customer flow there is no setup-status gate — any status is
      // editable — but there must be something to merge over.
      if (!org.presets) return c.json({ error: 'no_presets' }, 409);

      const merged = mergePresets(org.presets, patch);
      await OrgRepo.updatePresets(org.id, merged);
      await audit(c, {
        action: 'org.update_presets',
        org_id: org.id,
        payload: patch,
        before: org.presets,
      });
      return c.json({ presets: merged }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'post',
      path: '/orgs/{org_id}/strategy',
      summary: 'Run the 30-day strategy job ({ force: true } re-runs a completed one)',
      security: [{ Bearer: [] }],
      request: {
        params: schemas.AdminOrgParams,
        body: {
          content: { 'application/json': { schema: schemas.AdminStrategyRunBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminStrategyRunResponse } },
          description: 'Strategy job claimed and enqueued',
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Org not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Not claimable — the job is pending or completed (pass force to re-run)',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('param');
      const force = c.req.valid('json').force === true;
      const org = await OrgRepo.findById(org_id);
      if (!org) return c.json({ error: 'not_found' }, 404);

      // Force-rerun (design §0.3): claimStrategy only claims from none|failed
      // and the worker skips completed strategies, so a completed job needs an
      // explicit status reset first. Safe to repeat — the pipeline dedupes
      // against existing planner keywords and pool candidates.
      if (force) await OrgRepo.setStrategyStatus(org.id, 'failed');
      if (!(await OrgRepo.claimStrategy(org.id))) {
        return c.json({ error: 'strategy_not_claimable' }, 409);
      }
      try {
        await enqueueStrategyTask({ org_id: org.id });
      } catch (err) {
        // Revert the claim so a retry can reclaim (same as the plan route).
        await OrgRepo.setStrategyStatus(org.id, 'failed');
        throw err;
      }
      await audit(c, {
        action: force ? 'org.strategy_force_rerun' : 'org.strategy_run',
        org_id: org.id,
        payload: { force },
        before: org,
      });
      return c.json({ strategy_status: 'pending' as const }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'post',
      path: '/orgs/{org_id}/scan',
      summary: 'Re-enqueue the onboarding scan (stuck onboarding only)',
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminOrgParams },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminEnqueuedResponse } },
          description: 'Scan task re-enqueued',
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Org not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description:
            "setup_complete — the worker's completeScan would overwrite presets and knock a live org out of the dashboard gate",
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('param');
      const org = await OrgRepo.findById(org_id);
      if (!org) return c.json({ error: 'not_found' }, 404);
      // Hard guard (design §7): rescanning a live org is a different (deferred)
      // feature that must merge, not overwrite.
      if (org.setup_status === 'setup_complete') {
        return c.json({ error: 'setup_complete' }, 409);
      }

      await enqueueScanTask({ org_id: org.id, website_url: org.website_url });
      await audit(c, { action: 'org.scan_rerun', org_id: org.id, before: org });
      return c.json({ enqueued: true as const }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'post',
      path: '/orgs/{org_id}/integrations/wordpress',
      summary: 'Connect WordPress on behalf of the customer (verify-then-save)',
      security: [{ Bearer: [] }],
      request: {
        params: schemas.AdminOrgParams,
        body: {
          content: { 'application/json': { schema: schemas.AdminWordPressConnectBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminWordPressConnectResponse } },
          description: 'WordPress integration verified and saved',
        },
        401: { description: 'Missing or invalid admin token' },
        403: {
          content: { 'application/json': { schema: schemas.AdminWordPressConnectErrorResponse } },
          description: 'WordPress integration key rejected or not configured',
        },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Org not found',
        },
        502: {
          content: { 'application/json': { schema: schemas.AdminWordPressConnectErrorResponse } },
          description: 'WordPress plugin or network failure',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('param');
      const { token } = c.req.valid('json');
      const org = await OrgRepo.findById(org_id);
      if (!org) return c.json({ error: 'not_found' }, 404);

      // Same verify-then-save as the customer route in routes/dashboard.ts.
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

      await OrgRepo.saveWordPressConnection(org.id, token, new Date());
      await audit(c, {
        action: 'org.wordpress_connect',
        org_id: org.id,
        // The plugin key is a secret — audit rows are readable via GET /audit.
        payload: { token: '[redacted]' },
        before: {
          connected: Boolean(org.wordpress_token),
          connected_at: org.wordpress_connected_at ?? null,
        },
      });
      return c.json({ success: true as const }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'delete',
      path: '/orgs/{org_id}/integrations/wordpress',
      summary: 'Disconnect WordPress',
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminOrgParams },
      responses: {
        204: { description: 'Connection removed' },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Org not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'wordpress_not_connected',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('param');
      const org = await OrgRepo.findById(org_id);
      if (!org) return c.json({ error: 'not_found' }, 404);
      if (!org.wordpress_token) return c.json({ error: 'wordpress_not_connected' }, 409);

      await OrgRepo.clearWordPressConnection(org.id);
      await audit(c, {
        action: 'org.wordpress_disconnect',
        org_id: org.id,
        before: { connected: true, connected_at: org.wordpress_connected_at ?? null },
      });
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'delete',
      path: '/orgs/{org_id}/gsc',
      summary: 'Disconnect Google Search Console (customer must re-consent)',
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminOrgParams },
      responses: {
        204: { description: 'Connection removed; the customer reconnects via OAuth' },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Org not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'gsc_not_connected',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('param');
      const org = await OrgRepo.findById(org_id);
      if (!org) return c.json({ error: 'not_found' }, 404);
      // Nothing can repair a consent server-side — OAuth consent is the
      // customer's; disconnect is the correct lever (design §6).
      const conn = await GscConnectionRepo.findByOrgId(org.id);
      if (!conn) return c.json({ error: 'gsc_not_connected' }, 409);

      await GscConnectionRepo.deleteByOrgId(org.id);
      await audit(c, {
        action: 'org.gsc_disconnect',
        org_id: org.id,
        // Health fields only — refresh_token_enc is never returned by
        // anything, and audit rows are readable via GET /audit.
        before: {
          google_email: conn.google_email,
          site_url: conn.site_url,
          connected_at: conn.connected_at,
          last_refresh_failed_at: conn.last_refresh_failed_at,
        },
      });
      return c.body(null, 204);
    },
  );

export default orgs;
