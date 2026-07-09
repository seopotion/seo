# Article / Keyword Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent `keywords` and `articles` collections and swap the dashboard's mock read endpoints to real database reads, with a `db seed` CLI command so the frontend can build populated states.

**Architecture:** Two Zod entity schemas in `@shared/schemas` (single source of truth, `id` = stringified Mongo `_id`, `Date` timestamps) back two repositories in `@shared/db` that follow the existing `OrgRepo` pattern. The dashboard read handlers resolve the caller's org via `loadOwnedOrg` (org-scoped `org_id`, 404 on miss) and read through the repos, mapping entity `Date`s to ISO strings at the API boundary. A `db seed` CLI subcommand inserts a demo org + sample keywords/articles.

**Tech Stack:** TypeScript, Zod 4, official `mongodb` 7 driver, Hono `@hono/zod-openapi` 1, Vitest 4, citty (CLI).

## Global Constraints

- Use `import type` / `export type` for type-only imports (`verbatimModuleSyntax`).
- Shared packages export TS source; entity schemas are the single source of truth — API request/response schemas derive from / reuse them.
- Repositories own `_id` ↔ string `id` mapping and `parse` through Zod at the boundary; app code calls repositories, never the driver directly. Never connect/close the client in a handler.
- Timestamps are `z.date()` in entities; the API serializes `Date` → ISO string (API response schemas already use `z.string()`). `scheduled_date` is a date-only `yyyy-mm-dd` string, not a timestamp.
- Org ownership is enforced at the route layer via `loadOwnedOrg(org_id, userId)`, not inside repos.
- Biome formatting: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` on new code.
- Gates before claiming done: `npm run lint`, `npm run check:all`, `npm test`. Repo integration tests: `docker compose up -d mongo` then `npm run test:integration`.

## Preconditions

- **This plan builds on PR #28 (dashboard settings persistence) being merged to `dev`.** It assumes: (a) the `/dashboard/settings/*` endpoints are already org-scoped and persisting, (b) `MOCK_PRESETS` is already removed from `apps/api/src/mocks/dashboard.ts`, so that file's only remaining exports are `MOCK_PLANNER`, `MOCK_ARTICLES`, `MOCK_ARTICLE_DETAILS`. If #28 is not yet merged, rebase this branch onto updated `dev` first.

## File Structure

**Create**
- `packages/shared/schemas/src/keyword.ts` — `KeywordSchema`, `Keyword`, `CreateKeywordInput`.
- `packages/shared/schemas/src/article.ts` — `ArticleSchema`, `Article`, `CreateArticleInput`, `ARTICLE_STATUSES`.
- `packages/shared/db/src/repositories/keyword.repo.ts` — `KeywordRepo`.
- `packages/shared/db/src/repositories/article.repo.ts` — `ArticleRepo`.
- `packages/shared/db/tests/keyword.repo.integration.test.ts`
- `packages/shared/db/tests/article.repo.integration.test.ts`
- `apps/cli/src/lib/seed.ts` — `seedDemo`.

**Modify**
- `packages/shared/schemas/src/index.ts` — export the two new modules.
- `packages/shared/db/src/index.ts` — export `KeywordRepo`, `ArticleRepo`.
- `packages/shared/db/src/ensure-indexes.ts` — add articles + keywords indexes.
- `apps/api/src/schemas/dashboard.ts` — add `org_id` query params + import `ARTICLE_STATUSES` from `@shared/schemas`.
- `apps/api/src/routes/dashboard.ts` — swap planner/articles/counts handlers to real reads.
- `apps/api/tests/dashboard.test.ts` — rewrite planner/history tests against stateful repo mocks.
- `apps/cli/src/types.ts` — add `SeedData`.
- `apps/cli/src/commands/db.ts` — add `seed` subcommand.
- `apps/cli/src/lib/db.ts` — extend `initDb` collections list.

**Delete**
- `apps/api/src/mocks/dashboard.ts` — after its last reader moves to the DB.

---

### Task 1: Keyword + Article entity schemas

**Files:**
- Create: `packages/shared/schemas/src/keyword.ts`
- Create: `packages/shared/schemas/src/article.ts`
- Modify: `packages/shared/schemas/src/index.ts`
- Test: `packages/shared/schemas/tests/entities.test.ts` (create)

**Interfaces:**
- Produces: `KeywordSchema`, `type Keyword`, `CreateKeywordInput` (schema + type); `ArticleSchema`, `type Article`, `CreateArticleInput` (schema + type), `ARTICLE_STATUSES`.
- `Keyword = { id: string; org_id: string; keyword: string; status: 'scheduled'; scheduled_date: string; search_volume: number; difficulty: number; article_id: string | null; created_at: Date }`.
- `Article = { id: string; org_id: string; keyword_id: string; title: string; slug: string; keyword: string; meta_description: string; featured_image_url: string; content: string; difficulty: number; search_volume: number; status: 'generated' | 'published' | 'deleted'; created_at: Date; published_at: Date | null }`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/schemas/tests/entities.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { ArticleSchema, CreateArticleInput, CreateKeywordInput, KeywordSchema } from '../src';

describe('KeywordSchema', () => {
  test('parses a full keyword and accepts null article_id', () => {
    const k = KeywordSchema.parse({
      id: 'k1',
      org_id: 'o1',
      keyword: 'notion seo',
      status: 'scheduled',
      scheduled_date: '2026-07-02',
      search_volume: 170,
      difficulty: 36,
      article_id: null,
      created_at: new Date(),
    });
    expect(k.article_id).toBeNull();
  });

  test('CreateKeywordInput omits id and created_at', () => {
    expect('id' in CreateKeywordInput.shape).toBe(false);
    expect('created_at' in CreateKeywordInput.shape).toBe(false);
    expect('org_id' in CreateKeywordInput.shape).toBe(true);
  });
});

describe('ArticleSchema', () => {
  test('parses a full article with a nullable published_at', () => {
    const a = ArticleSchema.parse({
      id: 'a1',
      org_id: 'o1',
      keyword_id: 'k1',
      title: 'Best Practices',
      slug: 'best-practices',
      keyword: 'notion seo',
      meta_description: 'meta',
      featured_image_url: 'https://x/i.png',
      content: '# body',
      difficulty: 36,
      search_volume: 170,
      status: 'generated',
      created_at: new Date(),
      published_at: null,
    });
    expect(a.status).toBe('generated');
    expect(a.published_at).toBeNull();
  });

  test('CreateArticleInput omits id and created_at', () => {
    expect('id' in CreateArticleInput.shape).toBe(false);
    expect('created_at' in CreateArticleInput.shape).toBe(false);
    expect('keyword_id' in CreateArticleInput.shape).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/shared/schemas/tests/entities.test.ts`
Expected: FAIL — `KeywordSchema`/`ArticleSchema` not exported from `../src`.

- [ ] **Step 3: Create the keyword schema**

Create `packages/shared/schemas/src/keyword.ts`:

```ts
import { z } from 'zod';

/** Keyword statuses. Only `scheduled` today; the enum leaves room to grow. */
export const KEYWORD_STATUSES = ['scheduled'] as const;

/**
 * Keyword entity — one org-scoped record per planner (calendar) opportunity.
 * `id` is the stringified Mongo `_id`. Rich classification / quality-questions
 * / provenance fields are deferred (parity-gaps G10/G11). See design/product-flow.md §2.1.
 */
export const KeywordSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  keyword: z.string(),
  status: z.enum(KEYWORD_STATUSES),
  // Date-only (yyyy-mm-dd) the article is scheduled to generate/publish.
  scheduled_date: z.string(),
  search_volume: z.number().int(),
  difficulty: z.number().int(),
  // null until article generation links an article back to the keyword.
  article_id: z.string().nullable(),
  created_at: z.date(),
});
export type Keyword = z.infer<typeof KeywordSchema>;

/** Input for creating a keyword — the server assigns `id` and `created_at`. */
export const CreateKeywordInput = KeywordSchema.omit({ id: true, created_at: true });
export type CreateKeywordInput = z.infer<typeof CreateKeywordInput>;
```

- [ ] **Step 4: Create the article schema**

Create `packages/shared/schemas/src/article.ts`:

```ts
import { z } from 'zod';

/** Article lifecycle statuses. */
export const ARTICLE_STATUSES = ['generated', 'published', 'deleted'] as const;

/**
 * Article entity. `title` is the generated SEO title (distinct from `keyword`);
 * `keyword` is denormalized so the Content History table renders without a join.
 * The AI editing layer and `publish_error` are deferred. See design/product-flow.md §2.2.
 */
export const ArticleSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  keyword_id: z.string(),
  title: z.string(),
  slug: z.string(),
  keyword: z.string(),
  meta_description: z.string(),
  featured_image_url: z.string(),
  content: z.string(),
  difficulty: z.number().int(),
  search_volume: z.number().int(),
  status: z.enum(ARTICLE_STATUSES),
  created_at: z.date(),
  published_at: z.date().nullable(),
});
export type Article = z.infer<typeof ArticleSchema>;

/** Input for creating an article — the server assigns `id` and `created_at`. */
export const CreateArticleInput = ArticleSchema.omit({ id: true, created_at: true });
export type CreateArticleInput = z.infer<typeof CreateArticleInput>;
```

- [ ] **Step 5: Export from the schemas barrel**

Modify `packages/shared/schemas/src/index.ts` — add two lines (keep alphabetical-ish with existing):

```ts
export * from './article';
export * from './keyword';
```

(Full file after edit:)

```ts
export type { SetupStatus } from '@shared/types';
export * from './article';
export * from './keyword';
export * from './org';
export * from './presets';
export * from './scan';
export * from './user';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run packages/shared/schemas/tests/entities.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/schemas/src/keyword.ts packages/shared/schemas/src/article.ts packages/shared/schemas/src/index.ts packages/shared/schemas/tests/entities.test.ts
git commit -m "feat(schemas): add Keyword and Article entity schemas"
```

---

### Task 2: KeywordRepo + indexes

**Files:**
- Create: `packages/shared/db/src/repositories/keyword.repo.ts`
- Modify: `packages/shared/db/src/index.ts`
- Modify: `packages/shared/db/src/ensure-indexes.ts`
- Test: `packages/shared/db/tests/keyword.repo.integration.test.ts` (create)

**Interfaces:**
- Consumes: `KeywordSchema`, `Keyword`, `CreateKeywordInput` (Task 1); `getDb` from `../client`.
- Produces: `KeywordRepo` with:
  - `listByOrg(orgId: string): Promise<Keyword[]>` — ordered `scheduled_date` asc.
  - `countScheduled(orgId: string): Promise<number>`.
  - `create(input: CreateKeywordInput): Promise<Keyword>`.
  - `setArticleId(id: string, articleId: string): Promise<void>` — links a generated article back to its keyword (used by seed; foreshadows the generation worker).

- [ ] **Step 1: Write the failing integration test**

Create `packages/shared/db/tests/keyword.repo.integration.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { KeywordRepo } from '../src/repositories/keyword.repo';

/**
 * Real-MongoDB round-trip. Run with `npm run test:integration` after
 * `docker compose up -d mongo`.
 */
describe('KeywordRepo (integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('keywords').deleteMany({});
  });

  afterAll(async () => {
    await closeDb();
  });

  test('create + listByOrg orders by scheduled_date asc', async () => {
    await KeywordRepo.create({
      org_id: 'org_kw',
      keyword: 'later',
      status: 'scheduled',
      scheduled_date: '2026-07-05',
      search_volume: 100,
      difficulty: 10,
      article_id: null,
    });
    await KeywordRepo.create({
      org_id: 'org_kw',
      keyword: 'earlier',
      status: 'scheduled',
      scheduled_date: '2026-07-02',
      search_volume: 200,
      difficulty: 20,
      article_id: null,
    });

    const list = await KeywordRepo.listByOrg('org_kw');
    expect(list.map((k) => k.keyword)).toEqual(['earlier', 'later']);
    expect(list[0].id).toMatch(/^[a-f0-9]{24}$/);
    expect(list[0].created_at).toBeInstanceOf(Date);
  });

  test('countScheduled counts only this org', async () => {
    expect(await KeywordRepo.countScheduled('org_kw')).toBe(2);
    expect(await KeywordRepo.countScheduled('other_org')).toBe(0);
  });

  test('setArticleId links an article to the keyword', async () => {
    const k = await KeywordRepo.create({
      org_id: 'org_link',
      keyword: 'link me',
      status: 'scheduled',
      scheduled_date: '2026-07-03',
      search_volume: 50,
      difficulty: 5,
      article_id: null,
    });
    await KeywordRepo.setArticleId(k.id, 'art_123');
    const [reloaded] = await KeywordRepo.listByOrg('org_link');
    expect(reloaded.article_id).toBe('art_123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose up -d mongo && npx vitest run -c vitest.integration.config.ts packages/shared/db/tests/keyword.repo.integration.test.ts`
(If the exact integration config path differs, use `npm run test:integration -- keyword.repo`.)
Expected: FAIL — `KeywordRepo` not found.

- [ ] **Step 3: Implement KeywordRepo**

Create `packages/shared/db/src/repositories/keyword.repo.ts`:

```ts
import {
  type CreateKeywordInput,
  CreateKeywordInput as CreateKeywordInputSchema,
  type Keyword,
  KeywordSchema,
} from '@shared/schemas';
import { type Document, ObjectId, type WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('keywords');

/** Map a Mongo document to a validated entity (`_id` -> string `id`). */
function toEntity(doc: WithId<Document>): Keyword {
  const { _id, ...rest } = doc;
  return KeywordSchema.parse({ id: _id.toString(), ...rest });
}

export const KeywordRepo = {
  async listByOrg(orgId: string): Promise<Keyword[]> {
    const docs = await (await collection())
      .find({ org_id: orgId })
      .sort({ scheduled_date: 1 })
      .toArray();
    return docs.map(toEntity);
  },

  async countScheduled(orgId: string): Promise<number> {
    return (await collection()).countDocuments({ org_id: orgId, status: 'scheduled' });
  },

  async create(input: CreateKeywordInput): Promise<Keyword> {
    const data = CreateKeywordInputSchema.parse(input); // validate on write
    const created_at = new Date();
    const res = await (await collection()).insertOne({ ...data, created_at });
    return toEntity({ _id: res.insertedId, ...data, created_at });
  },

  /** Link a generated article back to its keyword (article_id null -> set). */
  async setArticleId(id: string, articleId: string): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { article_id: articleId } },
    );
  },
};
```

- [ ] **Step 4: Export and add the index**

Modify `packages/shared/db/src/index.ts` — add:

```ts
export { KeywordRepo } from './repositories/keyword.repo';
```

Modify `packages/shared/db/src/ensure-indexes.ts` — replace the commented `articles` placeholder line with the keywords index (the articles indexes land in Task 3). Add before the closing brace:

```ts
  await db.collection('keywords').createIndex({ org_id: 1, scheduled_date: 1 });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:integration -- keyword.repo`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/db/src/repositories/keyword.repo.ts packages/shared/db/src/index.ts packages/shared/db/src/ensure-indexes.ts packages/shared/db/tests/keyword.repo.integration.test.ts
git commit -m "feat(db): add KeywordRepo + keywords index"
```

---

### Task 3: ArticleRepo + indexes

**Files:**
- Create: `packages/shared/db/src/repositories/article.repo.ts`
- Modify: `packages/shared/db/src/index.ts`
- Modify: `packages/shared/db/src/ensure-indexes.ts`
- Test: `packages/shared/db/tests/article.repo.integration.test.ts` (create)

**Interfaces:**
- Consumes: `ArticleSchema`, `Article`, `CreateArticleInput` (Task 1); `getDb`.
- Produces: `ArticleRepo` with:
  - `listByOrg(orgId: string, opts: { status?: Article['status']; limit: number; offset: number }): Promise<{ articles: Article[]; total: number }>` — ordered `created_at` desc; `total` is the filtered count.
  - `findById(id: string): Promise<Article | null>`.
  - `countByStatus(orgId: string, status: Article['status']): Promise<number>`.
  - `create(input: CreateArticleInput): Promise<Article>`.

- [ ] **Step 1: Write the failing integration test**

Create `packages/shared/db/tests/article.repo.integration.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { CreateArticleInput } from '@shared/schemas';
import { closeDb, getDb } from '../src/client';
import { ArticleRepo } from '../src/repositories/article.repo';

const base = (over: Partial<CreateArticleInput>): CreateArticleInput => ({
  org_id: 'org_art',
  keyword_id: 'k1',
  title: 'T',
  slug: 's',
  keyword: 'kw',
  meta_description: 'm',
  featured_image_url: 'https://x/i.png',
  content: '# body',
  difficulty: 10,
  search_volume: 20,
  status: 'generated',
  published_at: null,
  ...over,
});

describe('ArticleRepo (integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('articles').deleteMany({});
    await ArticleRepo.create(base({ slug: 'a', status: 'generated' }));
    await ArticleRepo.create(base({ slug: 'b', status: 'published', published_at: new Date() }));
  });

  afterAll(async () => {
    await closeDb();
  });

  test('listByOrg returns filtered rows + total', async () => {
    const all = await ArticleRepo.listByOrg('org_art', { limit: 20, offset: 0 });
    expect(all.total).toBe(2);
    expect(all.articles).toHaveLength(2);

    const published = await ArticleRepo.listByOrg('org_art', {
      status: 'published',
      limit: 20,
      offset: 0,
    });
    expect(published.total).toBe(1);
    expect(published.articles[0].status).toBe('published');
  });

  test('countByStatus counts per status', async () => {
    expect(await ArticleRepo.countByStatus('org_art', 'published')).toBe(1);
    expect(await ArticleRepo.countByStatus('org_art', 'generated')).toBe(1);
  });

  test('findById round-trips, returns null for unknown/invalid id', async () => {
    const { articles } = await ArticleRepo.listByOrg('org_art', { limit: 1, offset: 0 });
    const found = await ArticleRepo.findById(articles[0].id);
    expect(found?.id).toBe(articles[0].id);
    expect(await ArticleRepo.findById('not-an-objectid')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- article.repo`
Expected: FAIL — `ArticleRepo` not found.

- [ ] **Step 3: Implement ArticleRepo**

Create `packages/shared/db/src/repositories/article.repo.ts`:

```ts
import {
  type Article,
  ArticleSchema,
  type CreateArticleInput,
  CreateArticleInput as CreateArticleInputSchema,
} from '@shared/schemas';
import { type Document, ObjectId, type WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('articles');

/** Map a Mongo document to a validated entity (`_id` -> string `id`). */
function toEntity(doc: WithId<Document>): Article {
  const { _id, ...rest } = doc;
  return ArticleSchema.parse({ id: _id.toString(), ...rest });
}

export const ArticleRepo = {
  async listByOrg(
    orgId: string,
    opts: { status?: Article['status']; limit: number; offset: number },
  ): Promise<{ articles: Article[]; total: number }> {
    const filter: Document = { org_id: orgId };
    if (opts.status) filter.status = opts.status;
    const col = await collection();
    const total = await col.countDocuments(filter);
    const docs = await col
      .find(filter)
      .sort({ created_at: -1 })
      .skip(opts.offset)
      .limit(opts.limit)
      .toArray();
    return { articles: docs.map(toEntity), total };
  },

  async findById(id: string): Promise<Article | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await (await collection()).findOne({ _id: new ObjectId(id) });
    return doc ? toEntity(doc) : null;
  },

  async countByStatus(orgId: string, status: Article['status']): Promise<number> {
    return (await collection()).countDocuments({ org_id: orgId, status });
  },

  async create(input: CreateArticleInput): Promise<Article> {
    const data = CreateArticleInputSchema.parse(input); // validate on write
    const created_at = new Date();
    const res = await (await collection()).insertOne({ ...data, created_at });
    return toEntity({ _id: res.insertedId, ...data, created_at });
  },
};
```

- [ ] **Step 4: Export and add the indexes**

Modify `packages/shared/db/src/index.ts` — add:

```ts
export { ArticleRepo } from './repositories/article.repo';
```

Modify `packages/shared/db/src/ensure-indexes.ts` — add the two articles indexes (next to the keywords one):

```ts
  await db.collection('articles').createIndex({ org_id: 1, created_at: -1 });
  await db.collection('articles').createIndex({ org_id: 1, status: 1 });
```

Full `ensureIndexes` body after Tasks 2+3:

```ts
export async function ensureIndexes(): Promise<void> {
  const db = await getDb();
  await db.collection('users').createIndex({ google_sub: 1 }, { unique: true });
  await db.collection('orgs').createIndex({ user_id: 1, website_url: 1 });
  await db.collection('orgs').createIndex({ website_url: 1 });
  await db.collection('keywords').createIndex({ org_id: 1, scheduled_date: 1 });
  await db.collection('articles').createIndex({ org_id: 1, created_at: -1 });
  await db.collection('articles').createIndex({ org_id: 1, status: 1 });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:integration -- article.repo`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/db/src/repositories/article.repo.ts packages/shared/db/src/index.ts packages/shared/db/src/ensure-indexes.ts packages/shared/db/tests/article.repo.integration.test.ts
git commit -m "feat(db): add ArticleRepo + articles indexes"
```

---

### Task 4: Planner endpoint → real read

**Files:**
- Modify: `apps/api/src/schemas/dashboard.ts`
- Modify: `apps/api/src/routes/dashboard.ts`
- Modify: `apps/api/tests/dashboard.test.ts`

**Interfaces:**
- Consumes: `KeywordRepo.listByOrg` (Task 2), `loadOwnedOrg` (`apps/api/src/lib/load-owned-org.ts`), `PlannerResponse` (existing).
- Produces: `GET /dashboard/planner?org_id=…` reading real keywords; new `OrgQuery` and `OrgNotFoundResponse` schemas reused by Task 5.

- [ ] **Step 1: Add the shared org-scoped query + 404 schemas**

Modify `apps/api/src/schemas/dashboard.ts` — add near the top (after the imports):

```ts
// Org-scoped read: the caller passes org_id; the handler checks ownership.
export const OrgQuery = z.object({
  org_id: z
    .string()
    .openapi({ param: { name: 'org_id', in: 'query' }, example: '6650f1a2b3c4d5e6f7a8b9c0' }),
});

export const OrgNotFoundResponse = z
  .object({ error: z.string().openapi({ example: 'Not found' }) })
  .openapi('DashboardOrgNotFoundResponse');
```

- [ ] **Step 2: Rewrite the dashboard test mock + planner tests (failing)**

Replace the top-of-file `vi.mock('@shared/db', …)` block in `apps/api/tests/dashboard.test.ts` with a stateful mock exposing the repos this and Task 5 need. (This block is auto-hoisted above imports.)

```ts
vi.mock('@shared/db', () => {
  // org_1 (owned by user_1) has data; org_2 (also user_1) is empty.
  const now = new Date('2026-07-02T08:00:00.000Z');
  const keywords = [
    { id: 'kw_1', org_id: 'org_1', keyword: 'landing pages', status: 'scheduled', scheduled_date: '2026-07-02', search_volume: 170, difficulty: 36, article_id: 'art_1', created_at: now },
    { id: 'kw_2', org_id: 'org_1', keyword: 'notion builder', status: 'scheduled', scheduled_date: '2026-07-03', search_volume: 2400, difficulty: 48, article_id: null, created_at: now },
  ];
  const articles = [
    { id: 'art_1', org_id: 'org_1', keyword_id: 'kw_1', title: 'Landing Pages', slug: 'landing-pages', keyword: 'landing pages', meta_description: 'm', featured_image_url: 'https://x/1.png', content: '# a', difficulty: 36, search_volume: 170, status: 'generated', created_at: now, published_at: null },
    { id: 'art_2', org_id: 'org_1', keyword_id: 'kw_2', title: 'Notion Builder', slug: 'notion-builder', keyword: 'notion builder', meta_description: 'm', featured_image_url: 'https://x/2.png', content: '# b', difficulty: 48, search_volume: 2400, status: 'published', created_at: now, published_at: now },
  ];
  const orgs = new Map<string, Record<string, unknown>>([
    ['org_1', { id: 'org_1', user_id: 'user_1', website_url: 'https://clewas.com', setup_status: 'setup_complete', created_at: now }],
    ['org_2', { id: 'org_2', user_id: 'user_1', website_url: 'https://empty.com', setup_status: 'setup_complete', created_at: now }],
  ]);
  return {
    UserRepo: {
      upsertByGoogleSub: vi.fn(async (input: { google_sub: string; email: string }) => ({
        id: 'user_1',
        google_sub: input.google_sub,
        email: input.email,
        created_at: now,
      })),
    },
    OrgRepo: {
      findById: vi.fn(async (id: string) => orgs.get(id) ?? null),
    },
    KeywordRepo: {
      listByOrg: vi.fn(async (orgId: string) =>
        keywords.filter((k) => k.org_id === orgId).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)),
      ),
      countScheduled: vi.fn(async (orgId: string) =>
        keywords.filter((k) => k.org_id === orgId && k.status === 'scheduled').length,
      ),
    },
    ArticleRepo: {
      listByOrg: vi.fn(async (orgId: string, opts: { status?: string; limit: number; offset: number }) => {
        let rows = articles.filter((a) => a.org_id === orgId);
        if (opts.status) rows = rows.filter((a) => a.status === opts.status);
        return { articles: rows.slice(opts.offset, opts.offset + opts.limit), total: rows.length };
      }),
      findById: vi.fn(async (id: string) => articles.find((a) => a.id === id) ?? null),
      countByStatus: vi.fn(async (orgId: string, status: string) =>
        articles.filter((a) => a.org_id === orgId && a.status === status).length,
      ),
    },
  };
});
```

Then in the `describe('dashboard planner / history / settings routes …')` block, replace the existing planner test with:

```ts
  test('GET /planner returns real scheduled keywords for the org', async () => {
    const opts = await auth();
    const res = await client.api.v0.dashboard.planner.$get({ query: { org_id: 'org_1' } }, opts);
    expect(res.status).toBe(200);
    if (res.status === 200) {
      const { keywords } = await res.json();
      expect(keywords.map((k) => k.keyword)).toEqual(['landing pages', 'notion builder']);
      expect(keywords[0].article_id).toBe('art_1');
      expect(keywords[1].article_id).toBeNull();
    }
  });

  test('GET /planner is empty for an org with no keywords', async () => {
    const opts = await auth();
    const res = await client.api.v0.dashboard.planner.$get({ query: { org_id: 'org_2' } }, opts);
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).keywords).toHaveLength(0);
  });

  test('GET /planner 404s for an org the caller does not own', async () => {
    const opts = await auth();
    const res = await client.api.v0.dashboard.planner.$get({ query: { org_id: 'nope' } }, opts);
    expect(res.status).toBe(404);
  });
```

> Note: the existing `articles` / `articles/:id` tests in this block still reference mock ids `art_1` (present above) — they are rewritten in Task 5. Between Tasks 4 and 5 those specific tests may fail; that is expected and resolved in Task 5.

- [ ] **Step 3: Run planner tests to verify they fail**

Run: `npx vitest run apps/api/tests/dashboard.test.ts -t planner`
Expected: FAIL — planner handler ignores `org_id`, returns `MOCK_PLANNER` (wrong keywords), and never 404s.

- [ ] **Step 4: Implement the real planner handler**

Modify `apps/api/src/routes/dashboard.ts`. Add imports at the top:

```ts
import { KeywordRepo } from '@shared/db';
import { loadOwnedOrg } from '../lib/load-owned-org';
```

Remove `MOCK_PLANNER` from the `../mocks/dashboard` import (leave `MOCK_ARTICLES`, `MOCK_ARTICLE_DETAILS` — Task 5 removes those).

Replace the `/planner` route block with:

```ts
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/planner',
      summary: 'Scheduled keywords for the content planner calendar',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.OrgQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.PlannerResponse } },
          description: 'Scheduled keywords for the org',
        },
        404: {
          content: { 'application/json': { schema: schemas.OrgNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);
      const keywords = await KeywordRepo.listByOrg(org_id);
      return c.json(
        {
          keywords: keywords.map((k) => ({
            id: k.id,
            keyword: k.keyword,
            status: k.status,
            scheduled_date: k.scheduled_date,
            search_volume: k.search_volume,
            difficulty: k.difficulty,
            article_id: k.article_id,
          })),
        },
        200,
      );
    },
  )
```

- [ ] **Step 5: Run planner tests to verify they pass**

Run: `npx vitest run apps/api/tests/dashboard.test.ts -t planner`
Expected: PASS (3 planner tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/schemas/dashboard.ts apps/api/src/routes/dashboard.ts apps/api/tests/dashboard.test.ts
git commit -m "feat(api): planner endpoint reads real keywords"
```

---

### Task 5: Articles list/detail/counts → real reads + delete mocks

**Files:**
- Modify: `apps/api/src/schemas/dashboard.ts`
- Modify: `apps/api/src/routes/dashboard.ts`
- Modify: `apps/api/tests/dashboard.test.ts`
- Delete: `apps/api/src/mocks/dashboard.ts`

**Interfaces:**
- Consumes: `ArticleRepo.listByOrg / findById / countByStatus` (Task 3), `KeywordRepo.countScheduled` (Task 2), `loadOwnedOrg`, `OrgQuery` / `OrgNotFoundResponse` (Task 4).
- Produces: real reads for `GET /dashboard/articles`, `/articles/:id`, `/articles/published`, `/articles/planned`.

- [ ] **Step 1: Single-source ARTICLE_STATUSES + add org_id to the articles query**

Modify `apps/api/src/schemas/dashboard.ts`:

Replace the local statuses declaration:

```ts
const ARTICLE_STATUSES = ['generated', 'published', 'deleted'] as const;
```

with an import from the entity schema (add to the existing `@shared/schemas` import line):

```ts
import { ARTICLE_STATUSES, SetupPresetsSchema } from '@shared/schemas';
```

Add `org_id` to `ArticlesQuery` (as the first property):

```ts
export const ArticlesQuery = z.object({
  org_id: z
    .string()
    .openapi({ param: { name: 'org_id', in: 'query' }, example: '6650f1a2b3c4d5e6f7a8b9c0' }),
  status: z
    .enum(ARTICLE_STATUSES)
    .optional()
    .openapi({ param: { name: 'status', in: 'query' }, example: 'published' }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .openapi({ param: { name: 'limit', in: 'query' }, example: 20 }),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .openapi({ param: { name: 'offset', in: 'query' }, example: 0 }),
});
```

- [ ] **Step 2: Rewrite the articles/counts tests (failing)**

In `apps/api/tests/dashboard.test.ts`:

Replace the **Home count** tests (`GET /articles/published` and `GET /articles/planned`) — they now require `org_id` and return real counts:

```ts
  test('GET /articles/published returns the real published count', async () => {
    const token = await login();
    const res = await client.api.v0.dashboard.articles.published.$get(
      { query: { org_id: 'org_1' } },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).count).toBe(1);
  });

  test('GET /articles/planned returns the real scheduled-keyword count', async () => {
    const token = await login();
    const res = await client.api.v0.dashboard.articles.planned.$get(
      { query: { org_id: 'org_1' } },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).count).toBe(2);
  });
```

Replace the `GET /articles returns rows + total…` and `GET /articles/:id…` tests:

```ts
  test('GET /articles returns real rows + total, filterable by status', async () => {
    const opts = await auth();
    const all = await client.api.v0.dashboard.articles.$get({ query: { org_id: 'org_1' } }, opts);
    expect(all.status).toBe(200);
    if (all.status === 200) {
      const allBody = await all.json();
      expect(allBody.total).toBe(2);
      expect(allBody.articles).toHaveLength(2);
    }

    const published = await client.api.v0.dashboard.articles.$get(
      { query: { org_id: 'org_1', status: 'published' } },
      opts,
    );
    if (published.status === 200) {
      const body = await published.json();
      expect(body.total).toBe(1);
      expect(body.articles.every((a) => a.status === 'published')).toBe(true);
      // Date serialized to ISO string at the boundary.
      expect(typeof body.articles[0].created_at).toBe('string');
    }
  });

  test('GET /articles/:id returns the article, 404 for unknown id or unowned org', async () => {
    const opts = await auth();
    const ok = await client.api.v0.dashboard.articles[':id'].$get(
      { param: { id: 'art_1' }, query: { org_id: 'org_1' } },
      opts,
    );
    expect(ok.status).toBe(200);
    if (ok.status === 200) {
      const body = await ok.json();
      expect(body.id).toBe('art_1');
      expect(body.keyword_id).toBe('kw_1');
    }

    const missing = await client.api.v0.dashboard.articles[':id'].$get(
      { param: { id: 'nope' }, query: { org_id: 'org_1' } },
      opts,
    );
    expect(missing.status).toBe(404);
  });
```

Update the `static /articles/best still resolves…` test — `best` is unchanged (no org_id), so it stays as-is.

- [ ] **Step 3: Run articles tests to verify they fail**

Run: `npx vitest run apps/api/tests/dashboard.test.ts -t articles`
Expected: FAIL — handlers use mock fixtures / ignore `org_id` / counts return 0.

- [ ] **Step 4: Implement the real article handlers**

Modify `apps/api/src/routes/dashboard.ts`. Update imports: add `ArticleRepo` to the `@shared/db` import and remove the entire `../mocks/dashboard` import line:

```ts
import { ArticleRepo, KeywordRepo } from '@shared/db';
```

Replace the `/articles/published` handler:

```ts
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);
      const count = await ArticleRepo.countByStatus(org_id, 'published');
      return c.json({ count }, 200);
    },
```

and add `request: { query: schemas.OrgQuery }` + a `404` response (with `schemas.OrgNotFoundResponse`) to its `createRoute`. Do the same for `/articles/planned`, but its handler body is:

```ts
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);
      const count = await KeywordRepo.countScheduled(org_id);
      return c.json({ count }, 200);
    },
```

Replace the `/articles` (list) handler:

```ts
    async (c) => {
      const { org_id, status, limit, offset } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);
      const { articles, total } = await ArticleRepo.listByOrg(org_id, { status, limit, offset });
      return c.json(
        {
          articles: articles.map((a) => ({
            id: a.id,
            title: a.title,
            slug: a.slug,
            keyword: a.keyword,
            status: a.status,
            difficulty: a.difficulty,
            search_volume: a.search_volume,
            featured_image_url: a.featured_image_url,
            created_at: a.created_at.toISOString(),
            published_at: a.published_at ? a.published_at.toISOString() : null,
          })),
          total,
        },
        200,
      );
    },
```

Add the `404` response to the `/articles` list `createRoute` (`schemas.OrgNotFoundResponse`). The `query: schemas.ArticlesQuery` is already declared and now carries `org_id`.

Replace the `/articles/{id}` handler and give its `createRoute` a `request: { params: schemas.ArticleParams, query: schemas.OrgQuery }`:

```ts
    async (c) => {
      const { id } = c.req.valid('param');
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Article not found' }, 404);
      const a = await ArticleRepo.findById(id);
      if (!a || a.org_id !== org_id) return c.json({ error: 'Article not found' }, 404);
      return c.json(
        {
          id: a.id,
          keyword_id: a.keyword_id,
          title: a.title,
          slug: a.slug,
          meta_description: a.meta_description,
          featured_image_url: a.featured_image_url,
          content: a.content,
          status: a.status,
          created_at: a.created_at.toISOString(),
          published_at: a.published_at ? a.published_at.toISOString() : null,
        },
        200,
      );
    },
```

- [ ] **Step 5: Delete the now-unused mock module**

```bash
git rm apps/api/src/mocks/dashboard.ts
```

Confirm no remaining importers:

Run: `grep -rn "mocks/dashboard" apps/api/src`
Expected: no output.

- [ ] **Step 6: Run the full dashboard test file + gates**

Run: `npx vitest run apps/api/tests/dashboard.test.ts`
Expected: PASS (all planner/articles/counts/settings tests).

Run: `npm run lint && npm run check:all && npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/schemas/dashboard.ts apps/api/src/routes/dashboard.ts apps/api/tests/dashboard.test.ts
git commit -m "feat(api): articles list/detail/counts read real data; drop dashboard mocks"
```

---

### Task 6: `db seed` CLI command

**Files:**
- Modify: `apps/cli/src/types.ts`
- Create: `apps/cli/src/lib/seed.ts`
- Modify: `apps/cli/src/commands/db.ts`
- Modify: `apps/cli/src/lib/db.ts`
- Test: `apps/cli/tests/seed.test.ts` (create)

**Interfaces:**
- Consumes: `OrgRepo` (`create`, `updatePresets`), `KeywordRepo` (`create`, `setArticleId`), `ArticleRepo` (`create`), `closeDb` from `@shared/db`; `Result`/`ok`/`fail` from `../types`.
- Produces: `seedDemo(userId: string): Promise<Result<SeedData>>`; `SeedData = { org_id: string; keywords: number; articles: number }`; a `db seed --user <id>` subcommand.

- [ ] **Step 1: Add the SeedData type**

Modify `apps/cli/src/types.ts` — add after `DbInitData`:

```ts
export interface SeedData {
  org_id: string;
  keywords: number;
  articles: number;
}
```

- [ ] **Step 2: Write the failing seed test**

Create `apps/cli/tests/seed.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';

const created = { orgs: [] as unknown[], keywords: [] as unknown[], articles: [] as unknown[] };

vi.mock('@shared/db', () => ({
  closeDb: vi.fn(async () => {}),
  OrgRepo: {
    create: vi.fn(async (input: Record<string, unknown>) => {
      created.orgs.push(input);
      return { id: 'org_seed', ...input };
    }),
    updatePresets: vi.fn(async () => {}),
  },
  KeywordRepo: {
    create: vi.fn(async (input: Record<string, unknown>) => {
      created.keywords.push(input);
      return { id: `kw_${created.keywords.length}`, ...input };
    }),
    setArticleId: vi.fn(async () => {}),
  },
  ArticleRepo: {
    create: vi.fn(async (input: Record<string, unknown>) => {
      created.articles.push(input);
      return { id: `art_${created.articles.length}`, ...input };
    }),
  },
}));

import { seedDemo } from '../src/lib/seed';

describe('seedDemo', () => {
  test('creates a demo org with keywords and articles', async () => {
    const result = await seedDemo('user_1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.org_id).toBe('org_seed');
      expect(result.data.keywords).toBeGreaterThanOrEqual(5);
      expect(result.data.articles).toBe(2);
    }
    // One article is published, one generated.
    expect(created.articles).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run apps/cli/tests/seed.test.ts`
Expected: FAIL — `../src/lib/seed` not found.

- [ ] **Step 4: Implement seedDemo**

Create `apps/cli/src/lib/seed.ts`:

```ts
/**
 * Seed a demo org + sample keywords/articles into the configured Mongo, so the
 * frontend can build populated planner/history states before the generation
 * worker exists. Reuses the sample content that used to live in the API mocks.
 */
import { ArticleRepo, closeDb, KeywordRepo, OrgRepo } from '@shared/db';
import { fail, ok, type Result, type SeedData } from '../types';

const DEMO_PRESETS = {
  business: {
    name: 'Clewas',
    language: 'English',
    country: 'Global (English)',
    description: 'Clewas turns Notion pages into fast, SEO-friendly public websites.',
  },
  audience: {
    target: 'Content creators and bloggers using Notion',
    competitors: ['super.so', 'potion.so', 'simple.ink'],
  },
  blog: {
    sitemap_url: 'https://www.clewas.com/sitemap.xml',
    main_blog_url: 'https://www.clewas.com/blog',
    best_articles: ['https://www.clewas.com/blog/notion-seo-guide'],
  },
  article_preferences: {
    content_seo: {
      article_style: 'Informative',
      internal_links: true,
      llm_instructions: 'Write in a practical, example-driven tone.',
    },
    engagement: { image_style: 'Sketch' },
  },
};

export async function seedDemo(userId: string): Promise<Result<SeedData>> {
  try {
    const org = await OrgRepo.create({
      user_id: userId,
      website_url: 'https://clewas.com',
      setup_status: 'setup_complete',
      name: 'Clewas',
    });
    await OrgRepo.updatePresets(org.id, DEMO_PRESETS);

    // One generated + one published article; consistent keyword <-> article links.
    const generated = await ArticleRepo.create({
      org_id: org.id,
      keyword_id: 'pending',
      title: '10 Landing Page Design Best Practices for Notion Sites',
      slug: 'landing-page-design-best-practices',
      keyword: 'landing page design best practices',
      meta_description: 'Master landing page design for your Notion site with 10 best practices.',
      featured_image_url: 'https://cdnimg.co/mock/landing-page.png',
      content: '# Landing Pages\n\nTen practices that move the needle.',
      difficulty: 36,
      search_volume: 170,
      status: 'generated',
      published_at: null,
    });
    const published = await ArticleRepo.create({
      org_id: org.id,
      keyword_id: 'pending',
      title: 'How to Build a Notion Website: A Complete Guide',
      slug: 'how-to-build-a-notion-website',
      keyword: 'notion website builder',
      meta_description: 'Learn how to build and publish a website with Notion.',
      featured_image_url: 'https://cdnimg.co/mock/notion-website.png',
      content: '# How to Build a Notion Website\n\nA complete guide.',
      difficulty: 48,
      search_volume: 2400,
      status: 'published',
      published_at: new Date(),
    });

    const kwSpecs = [
      { keyword: 'landing page design best practices', scheduled_date: '2026-07-02', search_volume: 170, difficulty: 36, article_id: generated.id },
      { keyword: 'notion website builder', scheduled_date: '2026-07-03', search_volume: 2400, difficulty: 48, article_id: published.id },
      { keyword: 'how to add custom domain to notion', scheduled_date: '2026-07-04', search_volume: 880, difficulty: 22, article_id: null },
      { keyword: 'best notion templates for startups', scheduled_date: '2026-07-05', search_volume: 1300, difficulty: 41, article_id: null },
      { keyword: 'seo for notion sites', scheduled_date: '2026-07-06', search_volume: 320, difficulty: 18, article_id: null },
    ];
    const keywords = [];
    for (const spec of kwSpecs) {
      keywords.push(
        await KeywordRepo.create({ org_id: org.id, status: 'scheduled', ...spec }),
      );
    }
    // Back-link the two generated/published articles to their source keywords.
    await KeywordRepo.setArticleId(keywords[0].id, generated.id);
    await KeywordRepo.setArticleId(keywords[1].id, published.id);

    return ok({ org_id: org.id, keywords: keywords.length, articles: 2 });
  } catch (e) {
    return fail(
      'DB_SEED_FAILED',
      (e as Error).message,
      'Is MongoDB running? Try `docker compose up -d mongo`.',
    );
  } finally {
    await closeDb();
  }
}
```

> Note: articles are created with `keyword_id: 'pending'` because keyword ids are server-assigned after the articles. The reverse link (`keyword.article_id`) is set via `setArticleId`. Repointing `article.keyword_id` at the real keyword ids is unnecessary for the baseline reads (nothing reads `article.keyword_id` back to a keyword yet); the generation worker will own both directions later.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run apps/cli/tests/seed.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire the subcommand + extend initDb's collections list**

Modify `apps/cli/src/lib/db.ts` — update the reported collections list:

```ts
    return ok({ collections: ['users', 'orgs', 'keywords', 'articles'] });
```

Modify `apps/cli/src/commands/db.ts` — add a `seed` subcommand alongside `init` (inside `subCommands`):

```ts
    seed: defineCommand({
      meta: { name: 'seed', description: 'Insert a demo org + sample keywords/articles' },
      args: {
        user: { type: 'string', description: 'User id to own the demo org', required: true },
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const { seedDemo } = await import('../lib/seed');
          emitter.step('db:seed', 'start');
          const result = await seedDemo(args.user as string);
          emitter.step('db:seed', result.ok ? 'done' : 'fail');
          emitter.result(result);
          process.exit(result.ok ? EXIT.SUCCESS : EXIT.OP_FAILED);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
```

- [ ] **Step 7: Verify the command wires up + gates**

Run: `npm run cli -- db --help`
Expected: lists both `init` and `seed`.

Run: `npm run lint && npm run check:all && npm test`
Expected: all green.

- [ ] **Step 8: (Manual, optional) end-to-end seed against local Mongo**

Run: `docker compose up -d mongo && npm run db:init && npm run cli -- db seed --user demo_user`
Expected: JSON/text result with `org_id`, `keywords: 5`, `articles: 2`. Then `GET /dashboard/planner?org_id=<org_id>` (with a JWT for `demo_user`) returns the 5 keywords.

- [ ] **Step 9: Commit**

```bash
git add apps/cli/src/types.ts apps/cli/src/lib/seed.ts apps/cli/src/commands/db.ts apps/cli/src/lib/db.ts apps/cli/tests/seed.test.ts
git commit -m "feat(cli): add db seed command for demo keywords/articles"
```

---

### Task 7: Update PROGRESS.md

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Reflect the landed work**

Update the two relevant bullets:
- Under **Shared packages**, extend the `@shared/db` line to mention `KeywordRepo` and `ArticleRepo`, and the `@shared/schemas` line to mention `KeywordSchema` / `ArticleSchema`.
- Under **Dashboard**, update the "Dashboard API skeletons" bullet: planner + articles list/detail + published/planned counts now read **real** data (org-scoped by `org_id`); mocks removed; remaining mock reads are `articles/best` (GSC-gated, #12) and `integrations/connected` (#7).
- Under **Local development**, add a line for `db seed` on the CLI.

- [ ] **Step 2: Commit**

```bash
git add PROGRESS.md
git commit -m "docs: mark article/keyword data model + real reads done"
```

---

## Self-Review

**Spec coverage:**
- Entities (`KeywordSchema`/`ArticleSchema`) → Task 1. ✓
- Repositories (`KeywordRepo`/`ArticleRepo`) → Tasks 2, 3. ✓ (added `KeywordRepo.setArticleId` beyond the spec's list — needed for the linked seed pair and the future generation worker; noted here as a deliberate small addition.)
- Indexes → Tasks 2, 3. ✓
- Wire read endpoints (planner, list, detail, published, planned) → Tasks 4, 5. ✓
- Boundary `Date` → ISO mapping → Task 5 handlers (and planner passes `scheduled_date` through). ✓
- API schemas re-derived / single-sourced (`ARTICLE_STATUSES` imported from `@shared/schemas`) → Task 5 Step 1. ✓
- Contract change (`org_id` query) → Tasks 4, 5 (schemas + tests). ✓
- Seam cleanup (delete mocks) → Task 5 Step 5. ✓
- `db seed` CLI → Task 6. ✓
- Testing: repo unit/integration + endpoint + seed smoke → Tasks 2, 3, 4, 5, 6. ✓
- Deferred items untouched (generation/publish workers, keyword mutations, `publish_error`, AI editor, G10/G11). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. The seed's `keyword_id: 'pending'` is an intentional documented value, not a placeholder gap.

**Type consistency:** `KeywordRepo`/`ArticleRepo` method names and signatures in the Interfaces blocks match their implementations and call sites (`listByOrg`, `countScheduled`, `countByStatus`, `findById`, `create`, `setArticleId`). `ARTICLE_STATUSES` is defined once (Task 1) and imported in Task 5. `OrgQuery` / `OrgNotFoundResponse` defined in Task 4, reused in Task 5. `SeedData` defined in Task 6 Step 1, used by `seedDemo`.
