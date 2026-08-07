import { handle } from 'hono/aws-lambda';
import app from './admin';

/**
 * Admin Lambda entrypoint — mirrors index.ts, but bundles the admin app only.
 * The customer Lambda contains zero admin code and vice versa (epic #150).
 */
export const handler = handle(app);
