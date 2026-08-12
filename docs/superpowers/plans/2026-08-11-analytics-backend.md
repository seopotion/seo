# Analytics Page Backend Implementation Plan (#208)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three GSC read endpoints under `/dashboard/analytics`, a 48h Mongo TTL cache for GSC responses, and a tested URL→article matcher (issue #208).

**Architecture:** New pure modules in `apps/api/src/lib/` (URL matcher, window/aggregation math, cached-query wrapper), a new `gsc_analytics_cache` collection with repo in `@shared/db`, and a new `OpenAPIHono<AuthEnv>` router `apps/api/src/routes/analytics.ts` mounted at `/dashboard/analytics` so the typed client picks it up through `AppType`. Route handlers stay thin; all math lives in tested pure functions.

**Tech Stack:** TypeScript, Hono + `@hono/zod-openapi`, Zod 4, mongodb 7 driver, Vitest 4 (`vi.mock` for `@shared/db` and clients), Biome.

## Global Constraints (pinned decisions from #208 — do not re-derive)

- **Date windows:** every GSC query uses `endDate = today − 3 days` (UTC). `startDate` counts back from that end. Exception: the per-article timeseries query uses `startDate = publish date, endDate = today` (issue §4c explicitly).
- **Deltas:** percent change `(current − prior) / prior` for clicks, impressions, ctr — `null` when the prior value is 0. Position delta is the **absolute** change (`current − prior`), `null` when either half has 0 impressions. Wire shape: `deltas: { clicks: number | null, impressions: number | null, ctr: number | null, position: number | null }`.
- **Trend rule:** clicks percent change ≥ +0.10 → `'up'`, ≤ −0.10 → `'down'`, else `'flat'`; `null` when < 14 days live or prior-period clicks are 0.
- **`rowLimit: 25000` explicitly on every page-dimension query** (`['page']` and `['date','page']`).
- **`ctr` is the raw GSC 0–1 fraction everywhere on the wire.** Never multiply by 100 in the API.
- **CTR and position aggregates are impression-weighted, never row-averaged:** `ctr = Σclicks / Σimpressions`, `position = Σ(position·impressions) / Σimpressions`; both `0` when Σimpressions is 0.
- **Matching:** normalized final path segment vs `publications[].slug` (never `article.slug`); exact segment match, any publication counts (dual publications).
- **`days_live`:** whole days between the article's publish date and now, floored, UTC.
- **Cache:** collection `gsc_analytics_cache`, unique index on `key`, TTL on `created_at` with `expireAfterSeconds: 172800` (48h). Errors (incl. `GscAuthRevokedError`) are never cached.
- **Error discipline:** all three routes — Bearer + `authMiddleware`, `loadOwnedOrg` → 404, gated shape when `!isGscConnected`, `GscAuthRevokedError` → `GscConnectionRepo.markRefreshFailed` → gated, other GSC errors → `logger.warn` → gated. Never 500.
- **Repo conventions:** repos own `_id`↔`id` mapping and `parse` through Zod; Zod API schemas use `.openapi('Name')`; `import type` for type-only imports; Biome style (single quotes, 2-space, 100 cols); run `npm run lint:fix` on new code.
- **Assumptions resolved by this plan** (surface to reviewer, not re-litigated by implementers): `range` defaults to `'30d'`; `scope` defaults to `'articles'`; series contains only dates GSC returned (no zero-fill); `/articles` reads published articles via `listByOrg` with `limit: 1000`; the timeseries URL-resolution query uses the 90d current window; when several GSC URL variants match one article the rows are summed (aggregated), and the timeseries resolver takes the first matching row; timeseries `data_state` enum is `'ok' | 'awaiting' | 'not_published'` (`gathering` is a frontend concern there, derived from `days_live`); gated/error timeseries responses use `days_live: null, data_state: 'awaiting'`.

---

### Task 1: GSC client — `dimensionFilterGroups` pass-through

**Files:**
- Modify: `apps/api/src/clients/gsc.ts` (the `SearchAnalyticsParams` interface, ~line 86)
- Test: `apps/api/tests/gsc-client.test.ts` (append to the existing `querySearchAnalytics` describe)

**Interfaces:**
- Produces: `SearchAnalyticsParams` gains optional `dimensionFilterGroups?: Array<{ groupType?: string; filters: Array<{ dimension: string; operator: string; expression: string }> }>`. The POST body already `JSON.stringify(params)`s, so this is pass-through.

- [ ] **Step 1: Write the failing test** — append to `describe('querySearchAnalytics', ...)` in `apps/api/tests/gsc-client.test.ts`, mirroring the existing "POSTs the window" test's mock setup:

```typescript
test('passes dimensionFilterGroups through to the POST body', async () => {
  getAccessToken.mockResolvedValue({ token: 'at-1' });
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ rows: [] }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  await querySearchAnalytics('rt-1', 'sc-domain:clewas.com', {
    startDate: '2026-06-17',
    endDate: '2026-07-15',
    dimensions: ['date'],
    dimensionFilterGroups: [
      { filters: [{ dimension: 'page', operator: 'equals', expression: 'https://x.com/blog/a' }] },
    ],
  });

  const [, init] = fetchMock.mock.calls[0]!;
  expect(JSON.parse(init.body as string).dimensionFilterGroups).toEqual([
    { filters: [{ dimension: 'page', operator: 'equals', expression: 'https://x.com/blog/a' }] },
  ]);
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- gsc-client`. Expected: TypeScript/compile failure — `dimensionFilterGroups` is not in `SearchAnalyticsParams`.
- [ ] **Step 3: Minimal implementation** — in `apps/api/src/clients/gsc.ts` add to `SearchAnalyticsParams`:

```typescript
export interface SearchAnalyticsParams {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  rowLimit?: number;
  // Pass-through filter groups (issue #208: per-article `page equals <url>`).
  dimensionFilterGroups?: Array<{
    groupType?: string;
    filters: Array<{ dimension: string; operator: string; expression: string }>;
  }>;
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test -- gsc-client`. Expected: PASS, all existing tests still green.
- [ ] **Step 5: Commit** — `git add apps/api/src/clients/gsc.ts apps/api/tests/gsc-client.test.ts && git commit -m "feat(api): accept dimensionFilterGroups in GSC search analytics params (#208)"`

---

### Task 2: `gsc_analytics_cache` — schema, repo, indexes

**Files:**
- Modify: `packages/shared/schemas/src/gsc.ts` (append)
- Modify: `packages/shared/schemas/src/index.ts` (add exports; mirror how other schema modules are re-exported)
- Create: `packages/shared/db/src/repositories/gsc-analytics-cache.repo.ts`
- Modify: `packages/shared/db/src/index.ts` (export `GscAnalyticsCacheRepo`)
- Modify: `packages/shared/db/src/ensure-indexes.ts` (two new indexes)
- Test: `packages/shared/db/tests/gsc-analytics-cache.repo.integration.test.ts`

**Interfaces:**
- Produces:
  - `GscAnalyticsRowSchema` / `type GscAnalyticsRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }` in `@shared/schemas` (structurally identical to the API's `SearchAnalyticsRow`).
  - `GscAnalyticsCacheRepo.get(key: string): Promise<GscAnalyticsRow[] | null>` — null on miss.
  - `GscAnalyticsCacheRepo.put(key: string, orgId: string, rows: GscAnalyticsRow[]): Promise<void>` — upsert; refreshes `created_at`.

- [ ] **Step 1: Write the failing integration test** — `packages/shared/db/tests/gsc-analytics-cache.repo.integration.test.ts`, mirroring `gsc-connection.repo.integration.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { GscAnalyticsCacheRepo } from '../src/repositories/gsc-analytics-cache.repo';

/**
 * Real-MongoDB round-trip for GscAnalyticsCacheRepo (#208). Run with
 * `npm run test:integration` after `docker compose up -d mongo`.
 */
describe('GscAnalyticsCacheRepo (integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('gsc_analytics_cache').deleteMany({});
  });

  afterAll(async () => {
    await closeDb();
  });

  const rows = [
    { keys: ['2026-08-01'], clicks: 10, impressions: 200, ctr: 0.05, position: 7.5 },
  ];

  test('get returns null on a miss', async () => {
    expect(await GscAnalyticsCacheRepo.get('missing')).toBeNull();
  });

  test('put stores rows and get returns them', async () => {
    await GscAnalyticsCacheRepo.put('key-1', 'org_a', rows);
    expect(await GscAnalyticsCacheRepo.get('key-1')).toEqual(rows);
  });

  test('put upserts — same key replaces rows, no duplicate', async () => {
    const updated = [
      { keys: ['2026-08-02'], clicks: 3, impressions: 50, ctr: 0.06, position: 4.1 },
    ];
    await GscAnalyticsCacheRepo.put('key-1', 'org_a', updated);
    expect(await GscAnalyticsCacheRepo.get('key-1')).toEqual(updated);
    const count = await (await getDb()).collection('gsc_analytics_cache').countDocuments({});
    expect(count).toBe(1);
  });

  test('an empty rows array is a valid cached value, not a miss', async () => {
    await GscAnalyticsCacheRepo.put('key-empty', 'org_a', []);
    expect(await GscAnalyticsCacheRepo.get('key-empty')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `docker compose up -d mongo`, then `npm run test:integration -- gsc-analytics-cache`. Expected: FAIL (module `gsc-analytics-cache.repo` does not exist). If Docker is unavailable in your environment, report NEEDS_CONTEXT rather than skipping.
- [ ] **Step 3: Implement schema** — append to `packages/shared/schemas/src/gsc.ts`:

```typescript
/** One Search Analytics result row, as cached (#208). Mirrors the GSC API row. */
export const GscAnalyticsRowSchema = z.object({
  keys: z.array(z.string()),
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number(),
  position: z.number(),
});
export type GscAnalyticsRow = z.infer<typeof GscAnalyticsRowSchema>;

/**
 * Cached GSC searchAnalytics response (#208). `key` is a deterministic hash of
 * site_url + the full query body; a unique index makes concurrent fills safe
 * and a TTL index on `created_at` expires entries after 48h (GSC data
 * refreshes ~daily, so 48h staleness is acceptable and cuts quota use).
 */
export const GscAnalyticsCacheSchema = z.object({
  id: z.string(),
  key: z.string(),
  org_id: z.string(),
  rows: z.array(GscAnalyticsRowSchema),
  created_at: z.date(),
});
export type GscAnalyticsCache = z.infer<typeof GscAnalyticsCacheSchema>;
```

Export from `packages/shared/schemas/src/index.ts` following its existing pattern (check the file — if it uses `export *` per module, nothing to add; if named exports, add the four names).

- [ ] **Step 4: Implement repo** — `packages/shared/db/src/repositories/gsc-analytics-cache.repo.ts`:

```typescript
import { type GscAnalyticsCache, GscAnalyticsCacheSchema, type GscAnalyticsRow } from '@shared/schemas';
import type { Document, WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('gsc_analytics_cache');

/** Map a Mongo document to a validated entity (`_id` -> string `id`). */
function toEntity(doc: WithId<Document>): GscAnalyticsCache {
  const { _id, ...rest } = doc;
  return GscAnalyticsCacheSchema.parse({ id: _id.toString(), ...rest });
}

export const GscAnalyticsCacheRepo = {
  /** Cached rows for a query key; null on a miss (an empty array is a hit). */
  async get(key: string): Promise<GscAnalyticsRow[] | null> {
    const doc = await (await collection()).findOne({ key });
    return doc ? toEntity(doc).rows : null;
  },

  /** Upsert a response. Refreshing `created_at` restarts the 48h TTL clock. */
  async put(key: string, orgId: string, rows: GscAnalyticsRow[]): Promise<void> {
    await (await collection()).updateOne(
      { key },
      { $set: { org_id: orgId, rows, created_at: new Date() } },
      { upsert: true },
    );
  },
};
```

Add `export { GscAnalyticsCacheRepo } from './repositories/gsc-analytics-cache.repo';` to `packages/shared/db/src/index.ts` (alphabetical position, after `GscConnectionRepo`... check ordering — Biome organizes imports, not exports; match the file's existing alphabetical order: it goes right after the `GscConnectionRepo` line? No — alphabetically `GscAnalyticsCacheRepo` sorts before `GscConnectionRepo`; place accordingly).

- [ ] **Step 5: Add indexes** — in `packages/shared/db/src/ensure-indexes.ts`, after the `gsc_connections` index:

```typescript
  // GSC analytics cache (#208): one row per query key; TTL expires entries 48h
  // after the last write (GSC's own data refreshes ~daily, so 48h staleness is
  // acceptable and cuts quota use drastically).
  await db.collection('gsc_analytics_cache').createIndex({ key: 1 }, { unique: true });
  await db
    .collection('gsc_analytics_cache')
    .createIndex({ created_at: 1 }, { expireAfterSeconds: 172800 });
```

- [ ] **Step 6: Run to verify it passes** — `npm run test:integration -- gsc-analytics-cache`. Expected: 4/4 PASS. Also run `npm run check` (typecheck backend + shared).
- [ ] **Step 7: Commit** — `git add -A packages/shared && git commit -m "feat(db): gsc_analytics_cache collection, repo, and TTL indexes (#208)"`

---

### Task 3: `cachedSearchAnalytics` wrapper

**Files:**
- Create: `apps/api/src/lib/gsc-cache.ts`
- Test: `apps/api/tests/gsc-cache.test.ts`

**Interfaces:**
- Consumes: `GscAnalyticsCacheRepo` (Task 2), `querySearchAnalytics` / `SearchAnalyticsParams` / `SearchAnalyticsRow` (`apps/api/src/clients/gsc.ts`).
- Produces:
  - `cacheKey(siteUrl: string, params: SearchAnalyticsParams): string` — deterministic sha256 hex.
  - `cachedSearchAnalytics(orgId: string, access: { token: string; siteUrl: string }, params: SearchAnalyticsParams): Promise<SearchAnalyticsRow[]>`

- [ ] **Step 1: Write the failing tests** — `apps/api/tests/gsc-cache.test.ts`:

```typescript
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { querySearchAnalytics } = vi.hoisted(() => ({ querySearchAnalytics: vi.fn() }));
vi.mock('../src/clients/gsc', () => ({ querySearchAnalytics }));

const { cacheGet, cachePut } = vi.hoisted(() => ({ cacheGet: vi.fn(), cachePut: vi.fn() }));
vi.mock('@shared/db', () => ({
  GscAnalyticsCacheRepo: { get: cacheGet, put: cachePut },
}));

import { cachedSearchAnalytics, cacheKey } from '../src/lib/gsc-cache';

const access = { token: 'rt-1', siteUrl: 'sc-domain:clewas.com' };
const params = {
  startDate: '2026-06-17',
  endDate: '2026-07-15',
  dimensions: ['date'],
} as const;
const rows = [{ keys: ['2026-07-01'], clicks: 5, impressions: 100, ctr: 0.05, position: 3.2 }];

beforeEach(() => {
  vi.clearAllMocks();
  cacheGet.mockResolvedValue(null);
  cachePut.mockResolvedValue(undefined);
});

describe('cacheKey', () => {
  test('is deterministic for identical inputs', () => {
    expect(cacheKey('sc-domain:x.com', { ...params })).toBe(cacheKey('sc-domain:x.com', { ...params }));
  });

  test('changes when any part of the query changes', () => {
    const base = cacheKey('sc-domain:x.com', { ...params });
    expect(cacheKey('sc-domain:y.com', { ...params })).not.toBe(base);
    expect(cacheKey('sc-domain:x.com', { ...params, endDate: '2026-07-16' })).not.toBe(base);
    expect(cacheKey('sc-domain:x.com', { ...params, dimensions: ['page'] })).not.toBe(base);
    expect(cacheKey('sc-domain:x.com', { ...params, rowLimit: 25000 })).not.toBe(base);
    expect(
      cacheKey('sc-domain:x.com', {
        ...params,
        dimensionFilterGroups: [
          { filters: [{ dimension: 'page', operator: 'equals', expression: 'https://x.com/a' }] },
        ],
      }),
    ).not.toBe(base);
  });
});

describe('cachedSearchAnalytics', () => {
  test('miss: calls GSC, stores the rows under the key, returns them', async () => {
    querySearchAnalytics.mockResolvedValue(rows);
    const result = await cachedSearchAnalytics('org_1', access, { ...params });
    expect(result).toEqual(rows);
    expect(querySearchAnalytics).toHaveBeenCalledWith(access.token, access.siteUrl, { ...params });
    expect(cachePut).toHaveBeenCalledWith(cacheKey(access.siteUrl, { ...params }), 'org_1', rows);
  });

  test('hit: returns stored rows without calling GSC', async () => {
    cacheGet.mockResolvedValue(rows);
    const result = await cachedSearchAnalytics('org_1', access, { ...params });
    expect(result).toEqual(rows);
    expect(querySearchAnalytics).not.toHaveBeenCalled();
    expect(cachePut).not.toHaveBeenCalled();
  });

  test('an empty cached array is a hit, not a refetch', async () => {
    cacheGet.mockResolvedValue([]);
    expect(await cachedSearchAnalytics('org_1', access, { ...params })).toEqual([]);
    expect(querySearchAnalytics).not.toHaveBeenCalled();
  });

  test('errors propagate and are never cached', async () => {
    querySearchAnalytics.mockRejectedValue(new Error('quota'));
    await expect(cachedSearchAnalytics('org_1', access, { ...params })).rejects.toThrow('quota');
    expect(cachePut).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- gsc-cache`. Expected: FAIL (module `../src/lib/gsc-cache` not found).
- [ ] **Step 3: Implement** — `apps/api/src/lib/gsc-cache.ts`:

```typescript
import { createHash } from 'node:crypto';
import { GscAnalyticsCacheRepo } from '@shared/db';
import {
  querySearchAnalytics,
  type SearchAnalyticsParams,
  type SearchAnalyticsRow,
} from '../clients/gsc';

/**
 * Deterministic cache key for one GSC searchAnalytics query (#208): sha256 of
 * site_url + every field of the query body, in fixed insertion order so the
 * same query always serializes to the same JSON.
 */
export function cacheKey(siteUrl: string, params: SearchAnalyticsParams): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        site_url: siteUrl,
        startDate: params.startDate,
        endDate: params.endDate,
        dimensions: params.dimensions ?? null,
        dimensionFilterGroups: params.dimensionFilterGroups ?? null,
        rowLimit: params.rowLimit ?? null,
      }),
    )
    .digest('hex');
}

/**
 * Read-through 48h cache over the GSC Search Analytics query (#208): hit →
 * stored rows; miss → live call, store, return. Errors (including
 * GscAuthRevokedError) propagate and are never cached.
 */
export async function cachedSearchAnalytics(
  orgId: string,
  access: { token: string; siteUrl: string },
  params: SearchAnalyticsParams,
): Promise<SearchAnalyticsRow[]> {
  const key = cacheKey(access.siteUrl, params);
  const hit = await GscAnalyticsCacheRepo.get(key);
  if (hit !== null) return hit;
  const rows = await querySearchAnalytics(access.token, access.siteUrl, params);
  await GscAnalyticsCacheRepo.put(key, orgId, rows);
  return rows;
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test -- gsc-cache`. Expected: 6/6 PASS.
- [ ] **Step 5: Commit** — `git add apps/api/src/lib/gsc-cache.ts apps/api/tests/gsc-cache.test.ts && git commit -m "feat(api): read-through 48h cache for GSC search analytics (#208)"`

---

### Task 4: URL normalization + article matcher; retrofit `/articles/best`

**Files:**
- Create: `apps/api/src/lib/gsc-urls.ts`
- Modify: `apps/api/src/routes/dashboard.ts` (the `/articles/best` handler, ~line 231-235)
- Test: `apps/api/tests/gsc-urls.test.ts`
- Possibly modify: `apps/api/tests/dashboard.test.ts` (only if the `/articles/best` fixtures lack `publications` entries — matched articles must carry one)

**Interfaces:**
- Consumes: `Article` type from `@shared/schemas` (type-only).
- Produces:
  - `normalizeUrl(url: string): string | null` — `host/path` with lowercased host, `www.` stripped, no protocol/query/fragment/trailing slash; `null` for unparseable input.
  - `matchArticleByPage<A extends Pick<Article, 'publications'>>(pageUrl: string, articles: A[]): A | null` — final-segment vs `publications[].slug`, exact match, any publication.

- [ ] **Step 1: Write the failing tests** — `apps/api/tests/gsc-urls.test.ts`. Use a minimal article factory so tests don't need full `Article` objects:

```typescript
import { describe, expect, test } from 'vitest';
import { matchArticleByPage, normalizeUrl } from '../src/lib/gsc-urls';

/** Minimal article shape: the matcher only reads `publications[].slug`. */
function article(id: string, ...slugs: string[]) {
  return {
    id,
    publications: slugs.map((slug) => ({
      provider: 'static-site' as const,
      ref: 'sha',
      slug,
      published_at: new Date('2026-07-01T00:00:00Z'),
      updated_at: null,
    })),
  };
}

describe('normalizeUrl', () => {
  test('lowercases the host and strips www., query, fragment, trailing slash', () => {
    expect(normalizeUrl('HTTPS://WWW.Example.COM/Blog/My-Post/?utm_source=x#top')).toBe(
      'example.com/Blog/My-Post',
    );
  });

  test('http and https normalize identically', () => {
    expect(normalizeUrl('http://example.com/a')).toBe(normalizeUrl('https://example.com/a'));
  });

  test('root URL keeps no trailing slash artifacts', () => {
    expect(normalizeUrl('https://example.com/')).toBe('example.com/');
  });

  test('unparseable input returns null', () => {
    expect(normalizeUrl('not a url')).toBeNull();
  });
});

describe('matchArticleByPage', () => {
  test('matches the final path segment against a publication slug', () => {
    const a = article('a1', 'my-post');
    expect(matchArticleByPage('https://example.com/blog/my-post', [a])).toBe(a);
  });

  test('matches through www., http, trailing slash, and utm params', () => {
    const a = article('a1', 'my-post');
    for (const url of [
      'http://www.example.com/blog/my-post/',
      'https://example.com/my-post?utm_source=news&utm_medium=email',
      'https://WWW.EXAMPLE.COM/nested/deeper/my-post/',
    ]) {
      expect(matchArticleByPage(url, [a])).toBe(a);
    }
  });

  test('exact segment match — a slug that is a substring of another does not match', () => {
    const short = article('a1', 'seo');
    const long = article('a2', 'seo-tools');
    expect(matchArticleByPage('https://example.com/blog/seo-tools', [short, long])).toBe(long);
    expect(matchArticleByPage('https://example.com/blog/seo', [short, long])).toBe(short);
  });

  test('matches on ANY publication of a dual-published article', () => {
    const dual = article('a1', 'wp-slug', 'static-slug');
    expect(matchArticleByPage('https://example.com/static-slug', [dual])).toBe(dual);
    expect(matchArticleByPage('https://example.com/wp-slug', [dual])).toBe(dual);
  });

  test('publication slug, not the (renamed) article slug, is what matches', () => {
    const renamed = { ...article('a1', 'published-slug'), slug: 'renamed-slug' };
    expect(matchArticleByPage('https://example.com/published-slug', [renamed])).toBe(renamed);
    expect(matchArticleByPage('https://example.com/renamed-slug', [renamed])).toBeNull();
  });

  test('site root and unparseable URLs match nothing', () => {
    const a = article('a1', 'my-post');
    expect(matchArticleByPage('https://example.com/', [a])).toBeNull();
    expect(matchArticleByPage('not a url', [a])).toBeNull();
  });

  test('article with no publications never matches', () => {
    expect(matchArticleByPage('https://example.com/my-post', [article('a1')])).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- gsc-urls`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** — `apps/api/src/lib/gsc-urls.ts`:

```typescript
import type { Article } from '@shared/schemas';

/**
 * Normalize a page URL for matching (#208): drop protocol, lowercase the host,
 * strip `www.`, query string (tracking params), fragment, and the trailing
 * slash. Path segment case is preserved — GSC reports canonical URLs.
 */
export function normalizeUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return host + path;
}

/** Final path segment of a URL, decoded; null for the root or unparseable input. */
function finalSegment(url: string): string | null {
  const normalized = normalizeUrl(url);
  if (normalized === null) return null;
  const segments = normalized.split('/');
  if (segments.length < 2) return null;
  const last = segments[segments.length - 1] ?? '';
  if (last === '') return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return null;
  }
}

/**
 * Match a GSC page URL to one of our articles (#208): the normalized final
 * path segment must EXACTLY equal a `publications[].slug` — the slug the
 * article was actually published under (`article.slug` can be renamed in the
 * editor afterwards). Any publication counts (dual WordPress + static-site).
 */
export function matchArticleByPage<A extends Pick<Article, 'publications'>>(
  pageUrl: string,
  articles: A[],
): A | null {
  const segment = finalSegment(pageUrl);
  if (segment === null) return null;
  return articles.find((a) => a.publications.some((p) => p.slug === segment)) ?? null;
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test -- gsc-urls`. Expected: PASS.
- [ ] **Step 5: Retrofit `/articles/best`** — in `apps/api/src/routes/dashboard.ts`, replace the substring match (~line 231-235):

```typescript
        const articles = rows.map((row) => {
          const url = row.keys[0] ?? '';
          const match = matchArticleByPage(url, published);
          return { url, clicks: Math.round(row.clicks), title: match?.title ?? null };
        });
```

with `import { matchArticleByPage } from '../lib/gsc-urls';` added to the imports. Run `npm test -- dashboard`; if a `/articles/best` fixture relied on `article.slug` substring matching, give that fixture article a `publications` entry with the slug it is served under (shape: `{ provider: 'wordpress', ref: '222', slug: '<slug>', published_at: <date>, updated_at: null }`) — do not weaken the assertion.

- [ ] **Step 6: Run the full API suite** — `npm test -- --project api` (or `npm test` if projects aren't configured; check `package.json`). Expected: all green.
- [ ] **Step 7: Commit** — `git add apps/api/src/lib/gsc-urls.ts apps/api/tests/gsc-urls.test.ts apps/api/src/routes/dashboard.ts apps/api/tests/dashboard.test.ts && git commit -m "feat(api): URL->article matcher; use it in /articles/best (#208)"`

---

### Task 5: Window math + aggregation module

**Files:**
- Create: `apps/api/src/lib/gsc-analytics.ts`
- Test: `apps/api/tests/gsc-analytics.test.ts`

**Interfaces:**
- Consumes: `SearchAnalyticsRow` type (`apps/api/src/clients/gsc.ts`), `Article` type (`@shared/schemas`) — both type-only.
- Produces (exact signatures later tasks rely on):

```typescript
export const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;
export type AnalyticsRange = keyof typeof RANGE_DAYS;
export function gscDate(d: Date): string; // yyyy-mm-dd (UTC)
export interface AnalyticsWindows {
  startDate: string;        // prior start (fetch window start)
  endDate: string;          // current end (fetch window end, today − 3d)
  currentStartDate: string; // first date of the current half
  priorStartDate: string;
  priorEndDate: string;
}
export function analyticsWindows(range: AnalyticsRange, now?: Date): AnalyticsWindows;
export interface MetricTotals { clicks: number; impressions: number; ctr: number; position: number }
export interface MetricDeltas { clicks: number | null; impressions: number | null; ctr: number | null; position: number | null }
export interface SeriesPoint extends MetricTotals { date: string }
export function aggregateTotals(rows: SearchAnalyticsRow[]): MetricTotals;
export function computeDeltas(current: MetricTotals, prior: MetricTotals): MetricDeltas;
export function splitByWindow(rows: SearchAnalyticsRow[], currentStartDate: string): { current: SearchAnalyticsRow[]; prior: SearchAnalyticsRow[] }; // keys[0] is the date
export function buildSeries(rows: SearchAnalyticsRow[]): SeriesPoint[]; // group by keys[0], ascending dates
export function daysLive(publishedAt: Date, now?: Date): number;
export function articlePublishedAt(a: Pick<Article, 'published_at' | 'publications'>): Date | null; // earliest of published_at and publications[].published_at
export type Trend = 'up' | 'down' | 'flat';
export function trendFor(currentClicks: number, priorClicks: number, days: number): Trend | null;
```

- [ ] **Step 1: Write the failing tests** — `apps/api/tests/gsc-analytics.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import {
  aggregateTotals,
  analyticsWindows,
  articlePublishedAt,
  buildSeries,
  computeDeltas,
  daysLive,
  splitByWindow,
  trendFor,
} from '../src/lib/gsc-analytics';

const row = (date: string, clicks: number, impressions: number, position: number) => ({
  keys: [date],
  clicks,
  impressions,
  ctr: impressions > 0 ? clicks / impressions : 0,
  position,
});

describe('analyticsWindows', () => {
  const now = new Date('2026-08-11T10:30:00Z');

  test('endDate is today − 3 days (GSC lag), 7d spans a 2× window', () => {
    const w = analyticsWindows('7d', now);
    expect(w.endDate).toBe('2026-08-08');
    expect(w.currentStartDate).toBe('2026-08-02'); // end − 6 days: 7-day current half
    expect(w.priorEndDate).toBe('2026-08-01');
    expect(w.priorStartDate).toBe('2026-07-26'); // 7-day prior half
    expect(w.startDate).toBe(w.priorStartDate);
  });

  test('30d and 90d halves are contiguous and equal-length', () => {
    for (const range of ['30d', '90d'] as const) {
      const w = analyticsWindows(range, now);
      const days = range === '30d' ? 30 : 90;
      const ms = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
      const DAY = 24 * 60 * 60 * 1000;
      expect(ms(w.endDate) - ms(w.currentStartDate)).toBe((days - 1) * DAY);
      expect(ms(w.priorEndDate) - ms(w.priorStartDate)).toBe((days - 1) * DAY);
      expect(ms(w.currentStartDate) - ms(w.priorEndDate)).toBe(DAY);
    }
  });
});

describe('aggregateTotals', () => {
  test('sums clicks/impressions; ctr and position are impression-weighted', () => {
    const totals = aggregateTotals([
      row('2026-08-01', 10, 100, 2), // ctr .1
      row('2026-08-02', 0, 300, 10), // ctr 0
    ]);
    expect(totals.clicks).toBe(10);
    expect(totals.impressions).toBe(400);
    expect(totals.ctr).toBeCloseTo(10 / 400); // NOT the row average (.05)
    expect(totals.position).toBeCloseTo((2 * 100 + 10 * 300) / 400); // 8, not 6
  });

  test('empty rows → all zeros', () => {
    expect(aggregateTotals([])).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
  });
});

describe('computeDeltas', () => {
  test('percent change for clicks/impressions/ctr, absolute for position', () => {
    const d = computeDeltas(
      { clicks: 120, impressions: 2000, ctr: 0.06, position: 5 },
      { clicks: 100, impressions: 1000, ctr: 0.1, position: 8 },
    );
    expect(d.clicks).toBeCloseTo(0.2);
    expect(d.impressions).toBeCloseTo(1);
    expect(d.ctr).toBeCloseTo(-0.4);
    expect(d.position).toBe(-3); // absolute, improvement is negative
  });

  test('null deltas when the prior value is 0; position null when either half has no impressions', () => {
    const d = computeDeltas(
      { clicks: 5, impressions: 100, ctr: 0.05, position: 4 },
      { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    );
    expect(d).toEqual({ clicks: null, impressions: null, ctr: null, position: null });
    const d2 = computeDeltas(
      { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      { clicks: 5, impressions: 100, ctr: 0.05, position: 4 },
    );
    expect(d2.position).toBeNull();
  });
});

describe('splitByWindow', () => {
  test('rows on/after currentStartDate are current, the rest prior', () => {
    const rows = [row('2026-08-01', 1, 10, 1), row('2026-08-02', 2, 20, 2), row('2026-07-30', 3, 30, 3)];
    const { current, prior } = splitByWindow(rows, '2026-08-02');
    expect(current.map((r) => r.keys[0])).toEqual(['2026-08-02']);
    expect(prior.map((r) => r.keys[0])).toEqual(['2026-08-01', '2026-07-30']);
  });
});

describe('buildSeries', () => {
  test('groups rows by date ascending with weighted aggregates per date', () => {
    const series = buildSeries([
      { keys: ['2026-08-02', 'https://x.com/b'], clicks: 1, impressions: 100, ctr: 0.01, position: 10 },
      { keys: ['2026-08-01', 'https://x.com/a'], clicks: 2, impressions: 100, ctr: 0.02, position: 4 },
      { keys: ['2026-08-02', 'https://x.com/a'], clicks: 3, impressions: 300, ctr: 0.01, position: 2 },
    ]);
    expect(series.map((p) => p.date)).toEqual(['2026-08-01', '2026-08-02']);
    expect(series[1]).toEqual({
      date: '2026-08-02',
      clicks: 4,
      impressions: 400,
      ctr: 4 / 400,
      position: (10 * 100 + 2 * 300) / 400,
    });
  });
});

describe('daysLive / articlePublishedAt', () => {
  test('whole days, floored, UTC', () => {
    const now = new Date('2026-08-11T00:30:00Z');
    expect(daysLive(new Date('2026-08-10T23:00:00Z'), now)).toBe(0);
    expect(daysLive(new Date('2026-08-01T00:30:00Z'), now)).toBe(10);
  });

  test('articlePublishedAt is the earliest of published_at and publication dates', () => {
    const early = new Date('2026-07-01T00:00:00Z');
    const later = new Date('2026-07-05T00:00:00Z');
    expect(
      articlePublishedAt({
        published_at: later,
        publications: [
          { provider: 'wordpress', ref: '1', slug: 's', published_at: early, updated_at: null },
        ],
      }),
    ).toEqual(early);
    expect(articlePublishedAt({ published_at: null, publications: [] })).toBeNull();
  });
});

describe('trendFor', () => {
  test('±10% boundaries are inclusive', () => {
    expect(trendFor(110, 100, 30)).toBe('up');
    expect(trendFor(90, 100, 30)).toBe('down');
    expect(trendFor(109, 100, 30)).toBe('flat');
    expect(trendFor(91, 100, 30)).toBe('flat');
  });

  test('null when under 14 days live or prior clicks are 0', () => {
    expect(trendFor(200, 100, 13)).toBeNull();
    expect(trendFor(200, 0, 30)).toBeNull();
    expect(trendFor(110, 100, 14)).toBe('up');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- gsc-analytics`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** — `apps/api/src/lib/gsc-analytics.ts`:

```typescript
import type { Article } from '@shared/schemas';
import type { SearchAnalyticsRow } from '../clients/gsc';

/** Analytics range → number of days in one window half (#208). */
export const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;
export type AnalyticsRange = keyof typeof RANGE_DAYS;

const DAY_MS = 24 * 60 * 60 * 1000;
/** GSC data lags 2–3 days; ending windows at `today` biases deltas down (#208). */
const GSC_LAG_DAYS = 3;

/** A Date as a GSC yyyy-mm-dd string (UTC). */
export function gscDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface AnalyticsWindows {
  /** Full 2× fetch window: prior start … current end. */
  startDate: string;
  endDate: string;
  /** First date of the current half — rows on/after it are "current". */
  currentStartDate: string;
  priorStartDate: string;
  priorEndDate: string;
}

/**
 * The 2× query window (#208): one GSC call over [priorStart, end] serves both
 * halves — current totals/series and the prior half the deltas compare to.
 */
export function analyticsWindows(range: AnalyticsRange, now = new Date()): AnalyticsWindows {
  const days = RANGE_DAYS[range];
  const end = new Date(now.getTime() - GSC_LAG_DAYS * DAY_MS);
  const currentStart = new Date(end.getTime() - (days - 1) * DAY_MS);
  const priorEnd = new Date(end.getTime() - days * DAY_MS);
  const priorStart = new Date(end.getTime() - (2 * days - 1) * DAY_MS);
  return {
    startDate: gscDate(priorStart),
    endDate: gscDate(end),
    currentStartDate: gscDate(currentStart),
    priorStartDate: gscDate(priorStart),
    priorEndDate: gscDate(priorEnd),
  };
}

export interface MetricTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface MetricDeltas {
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
}

export interface SeriesPoint extends MetricTotals {
  date: string;
}

/**
 * Sum clicks/impressions; ctr and position are impression-weighted — a
 * row-average would let a 10-impression page distort a 10k-impression site.
 */
export function aggregateTotals(rows: SearchAnalyticsRow[]): MetricTotals {
  let clicks = 0;
  let impressions = 0;
  let positionWeight = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    positionWeight += r.position * r.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? positionWeight / impressions : 0,
  };
}

function pct(current: number, prior: number): number | null {
  return prior === 0 ? null : (current - prior) / prior;
}

/**
 * Period-over-period deltas (#208): percent change for clicks/impressions/ctr
 * (null when the prior value is 0), ABSOLUTE change for position — the percent
 * change of a rank is meaningless. Position is null when either half has no
 * impressions (no rank exists to compare).
 */
export function computeDeltas(current: MetricTotals, prior: MetricTotals): MetricDeltas {
  return {
    clicks: pct(current.clicks, prior.clicks),
    impressions: pct(current.impressions, prior.impressions),
    ctr: pct(current.ctr, prior.ctr),
    position:
      prior.impressions === 0 || current.impressions === 0
        ? null
        : current.position - prior.position,
  };
}

/** Split date-keyed rows (keys[0] = yyyy-mm-dd) into current/prior halves. */
export function splitByWindow(
  rows: SearchAnalyticsRow[],
  currentStartDate: string,
): { current: SearchAnalyticsRow[]; prior: SearchAnalyticsRow[] } {
  const current: SearchAnalyticsRow[] = [];
  const prior: SearchAnalyticsRow[] = [];
  for (const r of rows) {
    ((r.keys[0] ?? '') >= currentStartDate ? current : prior).push(r);
  }
  return { current, prior };
}

/** Group date-keyed rows into an ascending daily series (weighted per date). */
export function buildSeries(rows: SearchAnalyticsRow[]): SeriesPoint[] {
  const byDate = new Map<string, SearchAnalyticsRow[]>();
  for (const r of rows) {
    const date = r.keys[0] ?? '';
    const bucket = byDate.get(date);
    if (bucket) bucket.push(r);
    else byDate.set(date, [r]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dateRows]) => ({ date, ...aggregateTotals(dateRows) }));
}

/** Whole days between publish and now, floored, UTC (#208). */
export function daysLive(publishedAt: Date, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - publishedAt.getTime()) / DAY_MS));
}

/** Earliest date the article went live anywhere; null when never published. */
export function articlePublishedAt(
  a: Pick<Article, 'published_at' | 'publications'>,
): Date | null {
  const dates = a.publications.map((p) => p.published_at.getTime());
  if (a.published_at) dates.push(a.published_at.getTime());
  return dates.length > 0 ? new Date(Math.min(...dates)) : null;
}

export type Trend = 'up' | 'down' | 'flat';

/**
 * Per-article trend (#208): clicks percent change ≥ +10% → up, ≤ −10% → down,
 * else flat; null when < 14 days live (too noisy) or prior clicks are 0.
 */
export function trendFor(currentClicks: number, priorClicks: number, days: number): Trend | null {
  if (days < 14 || priorClicks === 0) return null;
  const change = (currentClicks - priorClicks) / priorClicks;
  if (change >= 0.1) return 'up';
  if (change <= -0.1) return 'down';
  return 'flat';
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test -- gsc-analytics`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add apps/api/src/lib/gsc-analytics.ts apps/api/tests/gsc-analytics.test.ts && git commit -m "feat(api): analytics window math, weighted aggregation, deltas, trend (#208)"`

---

### Task 6: Analytics schemas + router with `GET /summary`; extract `gscAccess`

**Files:**
- Create: `apps/api/src/lib/gsc-access.ts` (extracted verbatim from `dashboard.ts`)
- Modify: `apps/api/src/routes/dashboard.ts` (delete local `gscAccess`, import from lib)
- Create: `apps/api/src/schemas/analytics.ts`
- Create: `apps/api/src/routes/analytics.ts`
- Modify: `apps/api/src/routes/index.ts` (mount at `/dashboard/analytics`)
- Test: `apps/api/tests/analytics.test.ts` (new file; db + gsc client mocks mirroring `apps/api/tests/dashboard.test.ts`)

**Interfaces:**
- Consumes: Tasks 1–5 exports; `loadOwnedOrg`, `authMiddleware`/`AuthEnv`, `logger`, `GscConnectionRepo`, `isGscConnected`, `decryptSecret`, `getGscTokenKey`.
- Produces:
  - `gscAccess(org_id: string): Promise<{ token: string; siteUrl: string } | null>` in `apps/api/src/lib/gsc-access.ts`.
  - Schemas: `SummaryQuery`, `AnalyticsSummaryResponse`, plus shared `AnalyticsTotals`/`AnalyticsDeltas`/`AnalyticsSeriesPoint` sub-schemas used by Tasks 7–8.
  - Router `analytics` (`OpenAPIHono<AuthEnv>`) with `/summary`, reachable as `client.api.v0.dashboard.analytics.summary.$get`.

- [ ] **Step 1: Extract `gscAccess`** — create `apps/api/src/lib/gsc-access.ts`:

```typescript
import { GscConnectionRepo } from '@shared/db';
import { isGscConnected } from '@shared/schemas';
import { decryptSecret } from './crypto';
import { getGscTokenKey } from './secrets';

/**
 * The GSC gate (#12): decrypt the org's refresh token when a healthy, finalized
 * connection exists; null keeps the caller on the gated response shape.
 */
export async function gscAccess(org_id: string): Promise<{ token: string; siteUrl: string } | null> {
  const conn = await GscConnectionRepo.findByOrgId(org_id);
  if (!isGscConnected(conn)) return null;
  return {
    token: decryptSecret(conn.refresh_token_enc, await getGscTokenKey()),
    siteUrl: conn.site_url,
  };
}
```

Delete the identical local function from `dashboard.ts` (and its now-unused imports if any become orphaned) and import `{ gscAccess } from '../lib/gsc-access'`. Run `npm test -- dashboard` — behavior unchanged, all green.

- [ ] **Step 2: Write schemas** — `apps/api/src/schemas/analytics.ts`:

```typescript
import { z } from '@hono/zod-openapi';
import { OrgQuery } from './dashboard';

/** Analytics page schemas (#208). All GSC-backed reads share the gated flag. */

export const ANALYTICS_RANGES = ['7d', '30d', '90d'] as const;

const RangeParam = z
  .enum(ANALYTICS_RANGES)
  .default('30d')
  .openapi({ param: { name: 'range', in: 'query' } });

export const SummaryQuery = OrgQuery.extend({
  range: RangeParam,
  scope: z
    .enum(['articles', 'site'])
    .default('articles')
    .openapi({ param: { name: 'scope', in: 'query' } }),
});

export const ArticlesAnalyticsQuery = OrgQuery.extend({ range: RangeParam });

// ctr is the raw GSC 0–1 fraction; the frontend formats percents (#208).
export const AnalyticsTotals = z
  .object({
    clicks: z.number(),
    impressions: z.number(),
    ctr: z.number(),
    position: z.number(),
  })
  .openapi('AnalyticsTotals');

// Percent change for clicks/impressions/ctr (null when prior is 0); ABSOLUTE
// change for position (null when either half has no impressions).
export const AnalyticsDeltas = z
  .object({
    clicks: z.number().nullable(),
    impressions: z.number().nullable(),
    ctr: z.number().nullable(),
    position: z.number().nullable(),
  })
  .openapi('AnalyticsDeltas');

export const AnalyticsSeriesPoint = z
  .object({
    date: z.string(),
    clicks: z.number(),
    impressions: z.number(),
    ctr: z.number(),
    position: z.number(),
  })
  .openapi('AnalyticsSeriesPoint');

export const AnalyticsSummaryResponse = z
  .object({
    // Gated until a healthy GSC connection exists; zeros/nulls/empty while gated.
    gated: z.boolean(),
    totals: AnalyticsTotals,
    deltas: AnalyticsDeltas,
    // Current window only, ascending dates; only dates GSC returned.
    series: z.array(AnalyticsSeriesPoint),
  })
  .openapi('AnalyticsSummaryResponse');
```

- [ ] **Step 3: Write the failing route tests** — `apps/api/tests/analytics.test.ts`. Mirror `dashboard.test.ts`'s structure: mock `../src/clients/google` (login), `../src/clients/gsc` (hoisted `querySearchAnalytics` + `GscAuthRevokedError` class), `../src/lib/secrets` (`getGscTokenKey`; also stub `getGoogleClientSecret` if imported anywhere on this path), and `@shared/db` with: `UserRepo.upsertByGoogleSub` (→ `user_1`), `OrgRepo.findById` (org_1 owned by `user_1` with a `website_url`; org_3 owned by `user_2`), `ArticleRepo.listByOrg`, `ArticleRepo.findById`, `GscConnectionRepo` (Map-backed with `findByOrgId` + `markRefreshFailed` spy), and `GscAnalyticsCacheRepo` backed by a `Map<string, rows>` (`get`/`put`) so the real `gsc-cache` lib runs against it. Encrypt the fixture refresh token with the real `encryptSecret` + the hoisted test key (copy the `gscKey` pattern from `dashboard.test.ts`). Fixture articles for org_1 (full Article shape like `dashboard.test.ts` fixtures):
  - `art_pub` — status `'published'`, `published_at: new Date('2026-06-01T00:00:00Z')`, `publications: [{ provider: 'static-site', ref: 'sha1', slug: 'landing-pages', published_at: new Date('2026-06-01T00:00:00Z'), updated_at: null }]`.
  - `art_new` — status `'published'`, `published_at: 2 days before now`, publications entry with slug `'fresh-post'`.

  Tests for `/summary` (use `vi.useFakeTimers()` + `vi.setSystemTime(new Date('2026-08-11T12:00:00Z'))` in `beforeEach`, `vi.useRealTimers()` in `afterEach`, so window assertions are deterministic):

```typescript
test('401 without a token', ...); // client.api.v0.dashboard.analytics.summary.$get({ query: { org_id: 'org_1' } })
test('404 for an org the caller does not own', ...); // org_3 → 404
test('gated shape when GSC is not connected', ...);
// → 200 { gated: true, totals: {clicks:0,impressions:0,ctr:0,position:0},
//         deltas: {clicks:null,impressions:null,ctr:null,position:null}, series: [] }

test('site scope: one date-dimension call over the 2× window, split server-side', async () => {
  // connect org_1; use range=30d (now 2026-08-11 → endDate '2026-08-08',
  // currentStartDate '2026-07-10', startDate '2026-06-10').
  // querySearchAnalytics resolves rows spanning both halves:
  // prior half:   { keys: ['2026-07-01'], clicks: 100, impressions: 1000, ctr: 0.1, position: 8 }
  // current half: { keys: ['2026-08-05'], clicks: 120, impressions: 2000, ctr: 0.06, position: 5 }
  // Assert: one querySearchAnalytics call with
  //   { startDate: '2026-06-10', endDate: '2026-08-08', dimensions: ['date'] }
  // and response: totals from the current row only, deltas vs the prior row
  // (clicks 0.2, impressions 1, ctr −0.4, position −3), series [current row].
});

test('articles scope: date+page dimensions with rowLimit 25000, only matched pages count', async () => {
  // rows: matched page https://site.com/blog/landing-pages on '2026-08-05' (clicks 7, impressions 100, position 3)
  //       unmatched page https://site.com/pricing on '2026-08-05' (clicks 50, impressions 500, position 1)
  // Assert the call body: { startDate, endDate, dimensions: ['date','page'], rowLimit: 25000 }
  // Assert totals.clicks === 7 (unmatched row excluded), series has one point with clicks 7.
});

test('a second identical request is served from the cache (one live GSC call total)', async () => {
  // call /summary twice with the same query; expect querySearchAnalytics called once.
});

test('revoked access marks the connection failed and degrades to gated', async () => {
  // querySearchAnalytics rejects with new GscAuthRevokedError('revoked');
  // expect 200 gated body and markRefreshFailed called with 'org_1'.
});

test('transient GSC errors degrade to gated without marking the connection', async () => {
  // rejects with new Error('boom'); expect 200 gated, markRefreshFailed NOT called.
});
```

Write these as real tests (the sketches above pin the fixtures and assertions — flesh out with the client/login pattern from `dashboard.test.ts`).

- [ ] **Step 4: Run to verify failure** — `npm test -- analytics`. Expected: FAIL (`analytics` route module missing / client path absent — a type error at `client.api.v0.dashboard.analytics` is the expected RED here since the route doesn't exist yet).
- [ ] **Step 5: Implement the router** — `apps/api/src/routes/analytics.ts`:

```typescript
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { ArticleRepo, GscConnectionRepo } from '@shared/db';
import { GscAuthRevokedError } from '../clients/gsc';
import { gscAccess } from '../lib/gsc-access';
import {
  aggregateTotals,
  analyticsWindows,
  buildSeries,
  computeDeltas,
  splitByWindow,
} from '../lib/gsc-analytics';
import { cachedSearchAnalytics } from '../lib/gsc-cache';
import { matchArticleByPage } from '../lib/gsc-urls';
import { loadOwnedOrg } from '../lib/load-owned-org';
import { logger } from '../logger';
import { type AuthEnv, authMiddleware } from '../middlewares/auth';
import * as schemas from '../schemas/analytics';

/** The gated /summary body: shape stays stable, data is inert (#208). */
const GATED_SUMMARY = {
  gated: true,
  totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
  deltas: { clicks: null, impressions: null, ctr: null, position: null },
  series: [],
};

/** Published articles for matching; org article counts are small (#208). */
const PUBLISHED_LIMIT = 1000;

/**
 * Analytics page routes (#208): GSC reads behind the 48h cache, joined to our
 * articles by the URL matcher. Same error discipline as /articles/best —
 * revoked closes the gate, transient provider errors degrade gated, never 500.
 */
const analytics = new OpenAPIHono<AuthEnv>().openapi(
  createRoute({
    tags: ['analytics'],
    method: 'get',
    path: '/summary',
    summary: 'Search totals, deltas, and daily series (gated until GSC is connected)',
    security: [{ Bearer: [] }],
    middleware: [authMiddleware] as const,
    request: { query: schemas.SummaryQuery },
    responses: {
      200: {
        content: { 'application/json': { schema: schemas.AnalyticsSummaryResponse } },
        description: 'Current-window totals, prior-window deltas, daily series',
      },
      404: {
        content: { 'application/json': { schema: schemas.OrgNotFoundResponse } },
        description: 'Org not found or not owned by the caller',
      },
    },
  }),
  async (c) => {
    const { org_id, range, scope } = c.req.valid('query');
    const { userId } = c.get('auth');
    const org = await loadOwnedOrg(org_id, userId);
    if (!org) return c.json({ error: 'Not found' }, 404);

    const access = await gscAccess(org_id);
    if (!access) return c.json(GATED_SUMMARY, 200);

    const w = analyticsWindows(range);
    try {
      let rows =
        scope === 'site'
          ? await cachedSearchAnalytics(org_id, access, {
              startDate: w.startDate,
              endDate: w.endDate,
              dimensions: ['date'],
            })
          : await cachedSearchAnalytics(org_id, access, {
              startDate: w.startDate,
              endDate: w.endDate,
              dimensions: ['date', 'page'],
              rowLimit: 25000,
            });
      if (scope === 'articles') {
        const { articles: published } = await ArticleRepo.listByOrg(org_id, {
          status: 'published',
          limit: PUBLISHED_LIMIT,
          offset: 0,
        });
        rows = rows.filter((r) => matchArticleByPage(r.keys[1] ?? '', published) !== null);
      }
      const { current, prior } = splitByWindow(rows, w.currentStartDate);
      const totals = aggregateTotals(current);
      return c.json(
        {
          gated: false,
          totals,
          deltas: computeDeltas(totals, aggregateTotals(prior)),
          series: buildSeries(current),
        },
        200,
      );
    } catch (err) {
      if (err instanceof GscAuthRevokedError) {
        await GscConnectionRepo.markRefreshFailed(org_id);
      } else {
        logger.warn('GSC read failed for /analytics/summary', { org_id, error: err as Error });
      }
      return c.json(GATED_SUMMARY, 200);
    }
  },
);

export default analytics;
```

Add `OrgNotFoundResponse` to the analytics schemas module via re-export: in `apps/api/src/schemas/analytics.ts` add `export { OrgNotFoundResponse } from './dashboard';`. Mount in `apps/api/src/routes/index.ts`:

```typescript
import analytics from './analytics';
// ...
  .route(`/api/${API_VERSION}/dashboard/analytics`, analytics)
```

(placed with the other `/dashboard/*` mounts, before the closing semicolon of the chain).

- [ ] **Step 6: Run to verify green** — `npm test -- analytics` then `npm test -- dashboard` (gscAccess extraction) then `npm run check` (AppType still compiles). Expected: all PASS.
- [ ] **Step 7: Commit** — `git add -A apps/api && git commit -m "feat(api): /dashboard/analytics/summary with 2x-window deltas (#208)"`

---

### Task 7: `GET /dashboard/analytics/articles`

**Files:**
- Modify: `apps/api/src/schemas/analytics.ts` (append)
- Modify: `apps/api/src/routes/analytics.ts` (chain a second `.openapi`)
- Test: `apps/api/tests/analytics.test.ts` (append a describe block)

**Interfaces:**
- Consumes: Task 6's router/mocks; `articlePublishedAt`, `daysLive`, `trendFor`, `aggregateTotals`, `analyticsWindows` (Task 5); `cachedSearchAnalytics` (Task 3); `matchArticleByPage` (Task 4).
- Produces: `client.api.v0.dashboard.analytics.articles.$get`; schemas `ArticlesAnalyticsQuery` (exists), `ArticleAnalyticsRow`, `AnalyticsArticlesResponse`.

- [ ] **Step 1: Append schemas** to `apps/api/src/schemas/analytics.ts`:

```typescript
export const ArticleAnalyticsRow = z
  .object({
    article_id: z.string(),
    title: z.string(),
    published_at: z.string().nullable(),
    days_live: z.number().int(),
    clicks: z.number(),
    impressions: z.number(),
    ctr: z.number(),
    position: z.number(),
    // Null when < 14 days live or prior-period clicks are 0 (#208).
    trend: z.enum(['up', 'down', 'flat']).nullable(),
    // awaiting: no GSC row yet and published < 4 days (GSC lags 2–3 days);
    // gathering: has data but < 14 days live; ok otherwise (zeros count as ok).
    data_state: z.enum(['ok', 'awaiting', 'gathering']),
  })
  .openapi('ArticleAnalyticsRow');

export const AnalyticsArticlesResponse = z
  .object({
    gated: z.boolean(),
    // Every published article appears; unmatched ones carry zero metrics.
    // Sorting/filtering/pagination are client-side in V1.
    articles: z.array(ArticleAnalyticsRow),
  })
  .openapi('AnalyticsArticlesResponse');
```

- [ ] **Step 2: Write the failing tests** — append `describe('GET /dashboard/analytics/articles', ...)` to `apps/api/tests/analytics.test.ts` (same fixtures/fake-time; now = `2026-08-11T12:00:00Z`, so `art_pub` (published 2026-06-01) has `days_live` 71 and `art_new` (published 2026-08-09) has 2):

```typescript
test('gated shape when GSC is not connected', ...); // { gated: true, articles: [] }
test('two page-dimension calls (current + prior windows) with rowLimit 25000', async () => {
  // range=30d → current { startDate: '2026-07-10', endDate: '2026-08-08' },
  //             prior   { startDate: '2026-06-10', endDate: '2026-07-09' }
  // assert both querySearchAnalytics bodies: dimensions ['page'], rowLimit 25000.
});
test('every published article appears; matched rows aggregate, unmatched get zeros', async () => {
  // current rows: https://site.com/blog/landing-pages (clicks 110, impressions 1000, position 4)
  //               http://www.site.com/landing-pages/ (clicks 10, impressions 100, position 6) ← variant, same article, summed
  // prior rows:   https://site.com/blog/landing-pages (clicks 100, impressions 900, position 5)
  // expect art_pub row: clicks 120, trend 'up' (120 vs 100 = +20%), data_state 'ok'
  // expect art_new row: zero metrics, trend null, data_state 'awaiting' (no row, 2 days live)
});
test('no row but ≥ 4 days live → ok with zero metrics; matched but < 14 days → gathering with null trend', async () => {
  // add fixture art_mid: published 10 days before now (days_live 10), publication slug 'mid-post'.
  // Give art_mid a current-window row (clicks 5): expect data_state 'gathering' + trend null.
  // Give art_pub (71 days live) NO rows in this test: expect data_state 'ok' with zero
  // metrics + trend null (prior clicks 0).
});
test('revoked → markRefreshFailed → gated; transient error → gated', ...);
```

- [ ] **Step 3: Run to verify failure** — `npm test -- analytics`. Expected: FAIL (route missing).
- [ ] **Step 4: Implement** — chain onto the router in `apps/api/src/routes/analytics.ts`:

```typescript
  .openapi(
    createRoute({
      tags: ['analytics'],
      method: 'get',
      path: '/articles',
      summary: 'Per-article search metrics with trend (gated until GSC is connected)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.ArticlesAnalyticsQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AnalyticsArticlesResponse } },
          description: 'One row per published article; unmatched articles carry zero metrics',
        },
        404: {
          content: { 'application/json': { schema: schemas.OrgNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id, range } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);

      const access = await gscAccess(org_id);
      if (!access) return c.json({ gated: true, articles: [] }, 200);

      const w = analyticsWindows(range);
      const now = new Date();
      try {
        const pageQuery = { dimensions: ['page'], rowLimit: 25000 } as const;
        const [currentRows, priorRows] = await Promise.all([
          cachedSearchAnalytics(org_id, access, {
            ...pageQuery,
            startDate: w.currentStartDate,
            endDate: w.endDate,
          }),
          cachedSearchAnalytics(org_id, access, {
            ...pageQuery,
            startDate: w.priorStartDate,
            endDate: w.priorEndDate,
          }),
        ]);
        const { articles: published } = await ArticleRepo.listByOrg(org_id, {
          status: 'published',
          limit: PUBLISHED_LIMIT,
          offset: 0,
        });
        const rows = published.map((a) => {
          // All URL variants GSC reports for this article (http/www/…) sum up.
          const mine = (rs: typeof currentRows) =>
            rs.filter((r) => matchArticleByPage(r.keys[0] ?? '', [a]) !== null);
          const current = aggregateTotals(mine(currentRows));
          const prior = aggregateTotals(mine(priorRows));
          const hasRow = mine(currentRows).length > 0;
          const publishedAt = articlePublishedAt(a);
          const days = publishedAt ? daysLive(publishedAt, now) : 0;
          return {
            article_id: a.id,
            title: a.title,
            published_at: publishedAt ? publishedAt.toISOString() : null,
            days_live: days,
            ...current,
            trend: trendFor(current.clicks, prior.clicks, days),
            data_state:
              !hasRow && days < 4
                ? ('awaiting' as const)
                : hasRow && days < 14
                  ? ('gathering' as const)
                  : ('ok' as const),
          };
        });
        return c.json({ gated: false, articles: rows }, 200);
      } catch (err) {
        if (err instanceof GscAuthRevokedError) {
          await GscConnectionRepo.markRefreshFailed(org_id);
        } else {
          logger.warn('GSC read failed for /analytics/articles', { org_id, error: err as Error });
        }
        return c.json({ gated: true, articles: [] }, 200);
      }
    },
  )
```

Import additions: `articlePublishedAt`, `daysLive`, `trendFor` from `../lib/gsc-analytics`. (Micro-opt note: `mine(currentRows)` is called twice — fine at these sizes; extract a local if the reviewer prefers.)

- [ ] **Step 5: Run to verify green** — `npm test -- analytics && npm run check`. Expected: PASS.
- [ ] **Step 6: Commit** — `git add -A apps/api && git commit -m "feat(api): /dashboard/analytics/articles per-article metrics (#208)"`

---

### Task 8: `GET /dashboard/analytics/articles/{id}/timeseries`

**Files:**
- Modify: `apps/api/src/schemas/analytics.ts` (append)
- Modify: `apps/api/src/routes/analytics.ts` (chain a third `.openapi`)
- Test: `apps/api/tests/analytics.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `ArticleParams` (reuse from `./dashboard` schemas — re-export it from `analytics.ts` if cleaner), `gscDate`, `analyticsWindows('90d')`, `buildSeries`, `articlePublishedAt`, `daysLive`, `cachedSearchAnalytics`, `matchArticleByPage`, `dimensionFilterGroups` (Task 1).
- Produces: `client.api.v0.dashboard.analytics.articles[':id'].timeseries.$get`; `AnalyticsTimeseriesResponse`.

- [ ] **Step 1: Append schema** to `apps/api/src/schemas/analytics.ts`:

```typescript
export const AnalyticsTimeseriesResponse = z
  .object({
    gated: z.boolean(),
    // Full-lifetime daily series (publish date → today) for the resolved URL.
    series: z.array(AnalyticsSeriesPoint),
    // Null only when the article has never been published (or while gated).
    days_live: z.number().int().nullable(),
    // not_published: no publications; awaiting: no GSC page row yet (or gated).
    // The 14-day "still gathering" gate is the frontend's, from days_live.
    data_state: z.enum(['ok', 'awaiting', 'not_published']),
  })
  .openapi('AnalyticsTimeseriesResponse');
```

- [ ] **Step 2: Write the failing tests** — append `describe('GET /dashboard/analytics/articles/:id/timeseries', ...)`:

```typescript
test('404 for a missing article and for a foreign org article', ...);
// findById → null → 404; art owned by org_3 with org_id=org_3 (foreign org) → 404;
// also art_pub with query org_id 'org_2' (mismatched org) → 404.
test('not-published shape for an article without publications', ...);
// fixture art_draft (status 'generated', publications: [])
// → 200 { gated: false, series: [], days_live: null, data_state: 'not_published' }
test('gated shape when GSC is not connected', ...);
// → 200 { gated: true, series: [], days_live: null, data_state: 'awaiting' }
test('resolves the page URL from the cached page query, then filters the date query to it', async () => {
  // 1st call (page resolution): assert body { startDate: <90d currentStart '2026-05-11'>,
  //   endDate: '2026-08-08', dimensions: ['page'], rowLimit: 25000 }
  //   → resolves [{ keys: ['https://site.com/blog/landing-pages'], ... }]
  // 2nd call: assert body { startDate: '2026-06-01' (art_pub publish date),
  //   endDate: '2026-08-11' (today, NOT −3d), dimensions: ['date'],
  //   dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'equals',
  //     expression: 'https://site.com/blog/landing-pages' }] }] }
  //   → resolves two date rows; expect 200 with the built series, days_live 71, data_state 'ok'.
});
test('published article with no matching page row yet → awaiting with empty series', ...);
// page query resolves []; expect { gated: false, series: [], days_live: 71, data_state: 'awaiting' }
// and NO second GSC call.
test('revoked → markRefreshFailed → gated-style body', ...);
// → 200 { gated: true, series: [], days_live: null, data_state: 'awaiting' }
```

- [ ] **Step 3: Run to verify failure** — `npm test -- analytics`. Expected: FAIL.
- [ ] **Step 4: Implement** — chain onto the router:

```typescript
  .openapi(
    createRoute({
      tags: ['analytics'],
      method: 'get',
      path: '/articles/{id}/timeseries',
      summary: 'Full-lifetime daily series for one article (on-demand)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { params: schemas.ArticleParams, query: schemas.OrgQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AnalyticsTimeseriesResponse } },
          description: 'Daily series from publish date; empty while awaiting data',
        },
        404: {
          content: { 'application/json': { schema: schemas.ArticleNotFoundResponse } },
          description: 'Article not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const article = await ArticleRepo.findById(id);
      // Missing, foreign-org, and mismatched-org all 404 — never leak existence.
      if (!article || article.org_id !== org_id || !(await loadOwnedOrg(org_id, userId))) {
        return c.json({ error: 'Article not found' }, 404);
      }

      const publishedAt = articlePublishedAt(article);
      if (!publishedAt || article.publications.length === 0) {
        return c.json(
          { gated: false, series: [], days_live: null, data_state: 'not_published' as const },
          200,
        );
      }

      const GATED = {
        gated: true,
        series: [],
        days_live: null,
        data_state: 'awaiting' as const,
      };
      const access = await gscAccess(org_id);
      if (!access) return c.json(GATED, 200);

      const now = new Date();
      const days = daysLive(publishedAt, now);
      try {
        // The article's exact GSC URL is unknown (we match by slug) — resolve it
        // from the cached page-dimension query first (#208). 90d window: widest
        // match chance, and the /articles table at 90d shares the cache entry.
        const w = analyticsWindows('90d', now);
        const pageRows = await cachedSearchAnalytics(org_id, access, {
          startDate: w.currentStartDate,
          endDate: w.endDate,
          dimensions: ['page'],
          rowLimit: 25000,
        });
        const pageRow = pageRows.find(
          (r) => matchArticleByPage(r.keys[0] ?? '', [article]) !== null,
        );
        if (!pageRow) {
          return c.json(
            { gated: false, series: [], days_live: days, data_state: 'awaiting' as const },
            200,
          );
        }
        const pageUrl = pageRow.keys[0] ?? '';
        // Full lifetime: publish date → today. GSC's trailing-lag dip is the
        // detail view's honest shape; the summary windows are where it biases
        // deltas and gets the −3d cut (#208 pinned decisions).
        const rows = await cachedSearchAnalytics(org_id, access, {
          startDate: gscDate(publishedAt),
          endDate: gscDate(now),
          dimensions: ['date'],
          dimensionFilterGroups: [
            { filters: [{ dimension: 'page', operator: 'equals', expression: pageUrl }] },
          ],
        });
        return c.json(
          { gated: false, series: buildSeries(rows), days_live: days, data_state: 'ok' as const },
          200,
        );
      } catch (err) {
        if (err instanceof GscAuthRevokedError) {
          await GscConnectionRepo.markRefreshFailed(org_id);
        } else {
          logger.warn('GSC read failed for /analytics/timeseries', { org_id, error: err as Error });
        }
        return c.json(GATED, 200);
      }
    },
  )
```

Schema imports: re-export `ArticleParams` and `ArticleNotFoundResponse` from `./dashboard` in `apps/api/src/schemas/analytics.ts` (`export { ArticleNotFoundResponse, ArticleParams, OrgNotFoundResponse, OrgQuery } from './dashboard';` — consolidate with Task 6's re-export line).

- [ ] **Step 5: Run to verify green** — `npm test -- analytics && npm run check`. Expected: PASS.
- [ ] **Step 6: Commit** — `git add -A apps/api && git commit -m "feat(api): per-article analytics timeseries endpoint (#208)"`

---

### Task 9: Full verification + bookkeeping

**Files:**
- Modify: `PROGRESS.md` (only if it has a dashboard/analytics gap line referencing #208 — update to one terse line; do not restate the issue)

- [ ] **Step 1:** `npm run lint:fix` then `npm run lint` — clean.
- [ ] **Step 2:** `npm run check:all` — backend, shared, AND web typecheck (the typed client must still compile).
- [ ] **Step 3:** `npm test` — full unit suite green.
- [ ] **Step 4:** `docker compose up -d mongo && npm run test:integration` — integration suite green (pre-existing failures unrelated to `gsc_analytics_cache` are report-only, not yours to fix).
- [ ] **Step 5:** Check `git diff dev -- package-lock.json` — per the repo's known macOS npm issue, the lockfile must show no accidental `@emnapi` optional-dep removals; restore from `dev` if it does (`git checkout dev -- package-lock.json`).
- [ ] **Step 6:** Update `PROGRESS.md` per its conventions if an entry covers this area; commit any changes: `git commit -am "chore: verification pass for analytics backend (#208)"` (skip if nothing changed).
