/**
 * Database management. initDb wraps ensureIndexes() (the `db:init` script's
 * logic) behind the Result contract.
 */
import { closeDb, ensureIndexes } from '@shared/db';
import { type DbInitData, fail, ok, type Result } from '../types';

export async function initDb(): Promise<Result<DbInitData>> {
  try {
    await ensureIndexes();
    return ok({ collections: ['users', 'orgs'] });
  } catch (e) {
    return fail(
      'DB_INIT_FAILED',
      (e as Error).message,
      'Is MongoDB running? Try `docker compose up -d mongo`.',
    );
  } finally {
    await closeDb();
  }
}
