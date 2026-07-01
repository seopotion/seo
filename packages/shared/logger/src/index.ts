import { Logger } from '@aws-lambda-powertools/logger';

/**
 * Structured logger factory (AWS Lambda Powertools). One instance per service —
 * pass a distinct `serviceName` so logs are attributable. Emits JSON to
 * CloudWatch in Lambda and is enriched with request context via
 * `logger.addContext(context)` in each handler. Log level is controlled by the
 * `POWERTOOLS_LOG_LEVEL` env var (default INFO).
 */
export function createLogger(serviceName: string): Logger {
  return new Logger({ serviceName });
}

export { Logger };
