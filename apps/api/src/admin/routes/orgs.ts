import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import {
  ArticleRepo,
  GscConnectionRepo,
  KeywordRepo,
  OrgRepo,
  SubscriptionRepo,
  UserRepo,
} from '@shared/db';
import { isPaid } from '@shared/schemas';
import { enqueueStrategyTask } from '../../clients/sqs';
import { audit } from '../audit';
import { toAdminGsc, toAdminOrg, toAdminOrgSummary, toAdminSubscription } from '../dto';
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
  );

export default orgs;
