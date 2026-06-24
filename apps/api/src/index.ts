import { handle } from 'hono/aws-lambda';
import app from './routes';

/**
 * Lambda entrypoint. CDK `NodejsFunction` bundles this file with esbuild at
 * synth time (Style A). The same `app` runs locally via a Node server adapter.
 */
export const handler = handle(app);
