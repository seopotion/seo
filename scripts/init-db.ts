import { closeDb, ensureIndexes } from '@shared/db';

/**
 * One-off: create MongoDB indexes for local dev. Run with `npm run db:init`
 * after `docker compose up -d mongo`. Uses MONGO_URI (default localhost).
 */
await ensureIndexes();
await closeDb();
console.log('MongoDB indexes ensured.');
