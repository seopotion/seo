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
      const org = await OrgRepo.create({
        user_id: userId,
        website_url,
        setup_status: 'setup_scan_in_progress',
      });
      await enqueueScanTask({ org_id: org.id, website_url });
      return c.json({ org_id: org.id, setup_status: org.setup_status });
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
  );

export default setup;
