import { type Db, MongoClient } from 'mongodb';
import { resolveMongoUri } from './mongo-uri';

/**
 * Lambda connection reuse: create the client once at module scope and reuse it
 * across warm invocations. Never connect/close inside a handler. See
 * design/data-layer.md ("Connection Reuse").
 */
let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;
  if (!client) {
    const uri = await resolveMongoUri();
    client = new MongoClient(uri, { maxPoolSize: 5, minPoolSize: 0 });
  }
  await client.connect(); // no-op if already connected
  db = client.db(process.env.MONGO_DB ?? 'seo');
  return db;
}

/** Close the shared client. For tests/scripts — handlers must NOT call this. */
export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
