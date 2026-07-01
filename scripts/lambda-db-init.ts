import { closeDb, ensureIndexes } from '@shared/db';

/**
 * CloudFormation custom-resource handler: ensures MongoDB indexes at deploy
 * time. Wired in infra/lib/api-stack.ts via a Provider-backed CustomResource.
 *
 * Runs on Create/Update; no-ops on Delete (we don't drop indexes on teardown).
 * The module-scoped Mongo client is closed after each invocation so the
 * connection isn't held open across the custom-resource lifecycle.
 */
export async function handler(event: { RequestType: string }): Promise<void> {
  if (event.RequestType === 'Delete') return;
  try {
    await ensureIndexes();
  } finally {
    await closeDb();
  }
}
