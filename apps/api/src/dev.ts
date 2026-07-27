import { serve } from '@hono/node-server';
import adminApp from './admin';
import app from './routes';

/**
 * Local dev server — serves the same Hono `app` over plain HTTP via Node.
 * Production uses the Lambda adapter in `index.ts`; only the outer adapter
 * differs. Run with `npm run dev -w api`.
 */
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});

// Admin app on its own port — locally the split mirrors the deployed shape
// (separate Lambda + HTTP API; see admin-index.ts).
const adminPort = Number(process.env.ADMIN_PORT ?? 8788);

serve({ fetch: adminApp.fetch, port: adminPort }, (info) => {
  console.log(`Admin API listening on http://localhost:${info.port}`);
});
