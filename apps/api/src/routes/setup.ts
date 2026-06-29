import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { OrgRepo } from '@shared/db';
import { enqueueScanTask } from '../clients/sqs';
import { type AuthEnv, authMiddleware } from '../middlewares/auth';
import * as schemas from '../schemas/setup';

/**
 * Setup/onboarding routes. Chained `.openapi()` calls so the resulting type
 * (and the OpenAPI spec) capture every endpoint. See design/product-flow.md.
 */
const setup = new OpenAPIHono<AuthEnv>()
  .openapi(
    createRoute({
      tags: ['setup'],
      method: 'post',
      path: '/start_scan',
      summary: 'Start website scan',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: {
          content: { 'application/json': { schema: schemas.StartScanBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.StartScanResponse } },
          description: 'Scan enqueued; org created in scanning state',
        },
      },
    }),
    async (c) => {
      const { website_url } = c.req.valid('json');
      const { userId } = c.get('auth');
      // Idempotent: a retry (double-click / refresh-and-resubmit) for the same
      // user + URL reuses the in-progress org instead of creating a duplicate.
      const existing = await OrgRepo.findActiveByUserAndUrl(userId, website_url);
      let org_id: string;
      if (existing) {
        await OrgRepo.updateStatus(existing.id, 'setup_scan_in_progress');
        org_id = existing.id;
      } else {
        const org = await OrgRepo.create({
          user_id: userId,
          website_url,
          setup_status: 'setup_scan_in_progress',
        });
        org_id = org.id;
      }
      await enqueueScanTask({ org_id, website_url });
      return c.json({ org_id, setup_status: 'setup_scan_in_progress' as const });
    },
  )
  .openapi(
    createRoute({
      tags: ['setup'],
      method: 'get',
      path: '/status',
      summary: 'Get setup status',
      request: { query: schemas.StatusQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.StatusResponse } },
          description: 'Current setup status for the org',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const org = await OrgRepo.findById(org_id);
      return c.json({ setup_status: org?.setup_status ?? 'setup_not_started' });
    },
  )
  .openapi(
    createRoute({
      tags: ['setup'],
      method: 'get',
      path: '/details',
      summary: 'Get generated setup presets',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.DetailsQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.DetailsResponse } },
          description: 'Generated onboarding presets for the org',
        },
        404: {
          content: { 'application/json': { schema: schemas.NotFoundResponse } },
          description: 'Org not found, or presets not generated yet',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const org = await OrgRepo.findById(org_id);
      if (!org?.presets) {
        return c.json({ error: 'Setup details not available' }, 404);
      }
      return c.json({ presets: org.presets }, 200);
    },
  );

export default setup;
