import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { API_VERSION } from '../config';
import { requestLogger } from '../middlewares/logger';
import { type AdminEnv, adminAuthMiddleware } from './middleware';
import articles from './routes/articles';
import candidates from './routes/candidates';
import login from './routes/login';
import orgs from './routes/orgs';
import planner from './routes/planner';
import promoCodes from './routes/promo-codes';

/**
 * Admin operator app (epic #150) — served by its own Lambda (admin-index.ts),
 * never mounted into the customer app.
 *
 * Fail-closed wiring (deliberate deviation from the customer app's per-route
 * middleware convention, for this one app): everything registered BEFORE the
 * `.use('*', adminAuthMiddleware)` line is public (health, login, OpenAPI —
 * route shapes only, no data); every router mounted AFTER it is protected,
 * including any added later with no middleware declaration of its own.
 */
const app = new OpenAPIHono<AdminEnv>();

app.use('*', cors());
app.use('*', requestLogger);

app.get('/health', (c) => c.text('OK'));

app.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

app.doc(`/admin/${API_VERSION}/openapi.json`, {
  openapi: '3.0.0',
  info: { version: '0.1.0', title: 'SEO Admin API' },
});

app.get(`/admin/${API_VERSION}/ui`, swaggerUI({ url: `/admin/${API_VERSION}/openapi.json` }));

/**
 * `routes` (not `app`) is what we take `typeof` of, so the exported
 * AdminAppType reflects every mounted endpoint for the RPC client — same
 * chained pattern as routes/index.ts.
 */
const routes = app
  .route(`/admin/${API_VERSION}`, login)
  .use('*', adminAuthMiddleware)
  .route(`/admin/${API_VERSION}`, orgs)
  .route(`/admin/${API_VERSION}`, candidates)
  .route(`/admin/${API_VERSION}`, planner)
  .route(`/admin/${API_VERSION}`, articles)
  .route(`/admin/${API_VERSION}`, promoCodes);

export default app;
export type AdminAppType = typeof routes;
