# Data Layer — Zod + Official MongoDB Driver (no Mongoose)

**Decision:** Use the official `mongodb` Node driver directly, with **Zod as the single source of truth** for entity shapes. No Mongoose. Chosen for lean Lambda bundles and one schema feeding both the API layer (Hono OpenAPI) and the database layer.

## Why no Mongoose

- **Lambda cold starts**: the `mongodb` driver is lighter than Mongoose's dependency tree; every KB inlined by esbuild adds to cold-start time.
- **Single source of truth**: we already need Zod for the Hono typed-client/OpenAPI design. Defining schemas a second time in Mongoose would create drift.
- **Simple-enough model**: orgs, users, setup presets, articles, subscriptions — mostly self-contained documents, not a deep relational graph that needs `populate`.

What we give up (and re-implement in the repository layer): lifecycle hooks/middleware, `populate`, automatic index creation, and automatic type casting. Those become explicit code — see below.

## Layering

```
@shared/schemas   Zod entity schemas + inferred types (source of truth)
      │
@shared/db        MongoClient singleton + per-collection repositories
      │
apps/api, apps/worker   call repositories; never touch the driver directly
```

API request/response schemas (in `apps/api/src/schemas/`, annotated with `.openapi()`) are **derived from** the entity schemas where possible (`.pick()`, `.omit()`, `.extend()`), so the wire contract and the stored shape stay aligned without being identical (e.g. the API exposes `id: string`, never the raw `_id`).

## Connection Reuse (the critical Lambda pattern)

Create the client **once at module scope** and reuse it across warm invocations. Never connect/disconnect inside the handler — that reconnects on every request and exhausts connections under load.

```typescript
// packages/shared/db/src/client.ts
import { MongoClient, type Db } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;
  client ??= new MongoClient(process.env.MONGO_URI!, {
    maxPoolSize: 5,           // keep small — many concurrent Lambdas each hold a pool
    minPoolSize: 0,
  });
  await client.connect();     // no-op if already connected
  db = client.db(process.env.MONGO_DB ?? 'seo');
  return db;
}
```

The driver's connection promise is cached, so concurrent calls in the same warm container share one connect. Do **not** call `client.close()` in handlers; let the container lifecycle own it.

## Schemas: `_id` / ObjectId / Date handling

Store `_id` as a real `ObjectId`; expose a string `id` to the app. Keep two shapes per entity: the **document** (what's in Mongo) and the **entity** (what app code uses). Repositories map between them.

```typescript
// packages/shared/schemas/src/org.ts
import { z } from 'zod';

// What app code and the API use (id is a string)
export const OrgSchema = z.object({
  id: z.string(),
  name: z.string(),
  website_url: z.string().url(),
  setup_status: z.enum([
    'setup_not_started',
    'setup_scan_in_progress',
    'setup_scan_failed', // scan exhausted its SQS deliveries (#244); retry re-arms
    'setup_scan_completed',
    'setup_complete',
  ]),
  created_at: z.date(),
});
export type Org = z.infer<typeof OrgSchema>;

// Input for creation (server assigns id/created_at)
export const CreateOrgInput = OrgSchema.omit({ id: true, created_at: true });
export type CreateOrgInput = z.infer<typeof CreateOrgInput>;
```

`Date` is stored natively by the driver (BSON date) — no conversion needed. Only `_id` ↔ `id` needs mapping.

## Repository Pattern

One module per collection. Repositories own ObjectId mapping and validation; they return parsed entities so the rest of the app gets typed, validated data.

```typescript
// packages/shared/db/src/repositories/org.repo.ts
import { ObjectId, type WithId, type Document } from 'mongodb';
import { OrgSchema, type Org, type CreateOrgInput } from '@shared/schemas';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('orgs');

function toEntity(doc: WithId<Document>): Org {
  const { _id, ...rest } = doc;
  return OrgSchema.parse({ id: _id.toString(), ...rest });
}

export const OrgRepo = {
  async findById(id: string): Promise<Org | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await (await collection()).findOne({ _id: new ObjectId(id) });
    return doc ? toEntity(doc) : null;
  },

  async create(input: CreateOrgInput): Promise<Org> {
    const data = CreateOrgInput.parse(input);          // validate on write
    const now = new Date();
    const res = await (await collection()).insertOne({ ...data, created_at: now });
    return toEntity({ _id: res.insertedId, ...data, created_at: now });
  },
};
```

**Validation strategy:** always `parse` on **write** (reject bad input before it hits the DB). On **read**, `parse` too while the schema is young — it catches drift cheaply; if a hot path shows it in profiling, downgrade that path to a typed cast (`as Org`). Don't optimize before measuring.

## Indexes (no Mongoose auto-index)

The driver does not create indexes for you. Define them once and run via an **idempotent setup step at deploy time** — a small script or a CDK-invoked one-off Lambda — never lazily per request.

```typescript
// packages/shared/db/src/ensure-indexes.ts
export async function ensureIndexes() {
  const db = await getDb();
  await db.collection('orgs').createIndex({ website_url: 1 });
  await db.collection('articles').createIndex({ org_id: 1, created_at: -1 });
  // createIndex is idempotent — safe to run on every deploy
}
```

## Typed Collections (optional)

The driver accepts a document generic: `db.collection<OrgDoc>('orgs')` gives typed `findOne`/`insertOne`. Useful, but Zod `parse` at the repository boundary is the real guarantee — the generic is a compile-time convenience, not runtime validation.

## Testing

Repositories are mocked at the module boundary in route tests (`vi.mock('@shared/db', ...)`), exactly like dkn-harbor mocks `@shared/models`. For repository unit tests, run against a real MongoDB via `docker-compose` (or `mongodb-memory-server`) and assert round-trips through `parse`.
