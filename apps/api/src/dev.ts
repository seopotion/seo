import { serve } from '@hono/node-server';
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
