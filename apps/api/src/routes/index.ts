import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { API_VERSION } from '../config';
import core from './core';
import setup from './setup';

const app = new OpenAPIHono();

app.use('*', cors());

app.get('/health', (c) => c.text('OK'));

/**
 * Mount versioned routers. `routes` (not `app`) is what we take `typeof` of,
 * so the exported AppType reflects every mounted endpoint for the RPC client.
 */
const routes = app
  .route(`/api/${API_VERSION}/core`, core)
  .route(`/api/${API_VERSION}/setup`, setup);

app.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

app.doc(`/api/${API_VERSION}/openapi.json`, {
  openapi: '3.0.0',
  info: { version: '0.1.0', title: 'SEO Dev API' },
});

app.get(`/api/${API_VERSION}/ui`, swaggerUI({ url: `/api/${API_VERSION}/openapi.json` }));

export default app;
export type AppType = typeof routes;
