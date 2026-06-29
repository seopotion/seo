import type { LambdaContext } from 'hono/aws-lambda';
import { createMiddleware } from 'hono/factory';
import { logger } from '../logger';

/**
 * Request logger — enriches the structured logger with the Lambda context
 * (request id, cold start) when running on Lambda, then emits one line per
 * request with method/path/status/duration. `c.env.lambdaContext` is wired by
 * `hono/aws-lambda` and is absent under the local Node server, so we guard it.
 */
export const requestLogger = createMiddleware(async (c, next) => {
  const lambdaContext = (c.env as { lambdaContext?: LambdaContext } | undefined)?.lambdaContext;
  if (lambdaContext) logger.addContext(lambdaContext as never);

  const start = Date.now();
  await next();
  logger.info('request', {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - start,
  });
});
