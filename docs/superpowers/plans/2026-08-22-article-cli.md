# Article Pipeline CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `articles` command group to the seo-dev CLI (list / show / generate-next / publish, with `--wait`) plus a checked-in agent skill, so the article pipeline can be triggered and inspected on demand instead of waiting for the daily 07:00 UTC cron.

**Architecture:** New `apps/cli/src/lib/articles.ts` (logic, `Result<T>` contract) + `apps/cli/src/commands/articles.ts` (citty wrappers). Reads/writes Mongo via `@shared/db` repos and enqueues `GenerateTask`/`PublishTask` messages directly to SQS via env-var queue URLs — the deployed staging worker Lambdas do the actual generation/publishing. Spec: `docs/superpowers/specs/2026-08-22-article-cli-design.md`.

**Tech Stack:** TypeScript 6, citty, zod 4 (`@shared/schemas`), `@aws-sdk/client-sqs`, Vitest 4.

## Global Constraints

- Work on the current branch (`claude/article-publishing-cli-e96bae`) in this worktree; commit after every task; do not push until the final task passes all checks.
- `verbatimModuleSyntax` is on: use `import type` for type-only imports.
- Biome formatting: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` before each commit.
- Every lib function returns `Result<T>` (`apps/cli/src/types.ts`); commands translate to output + `EXIT` codes. Never `console.log` — all output goes through the emitter.
- Lib functions call `closeDb()` in `finally` (CLI process, not Lambda).
- Tests must never touch real Mongo or SQS: `vi.mock('@shared/db')` and `vi.mock('@aws-sdk/client-sqs')` (the root `.env` points `MONGO_URI` at **staging** — a test that connects for real writes to a live database).
- Also `vi.mock('@shared/generation', () => ({ MAX_GENERATION_ATTEMPTS: 3 }))` in tests — the real package index pulls the whole generation graph.
- Run a task's test file with `npm test -- articles` (name filter). Final gate: `npm run lint`, `npm run check:all`, `npm test` all green.
- The commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Shared plumbing — `resolveOrgId` extraction, new types, workspace dep

`resolveOrgId` currently lives un-exported inside `apps/cli/src/lib/db.ts`, whose import graph drags in `@shared/keywords`, `@shared/strategy`, and the snapshot machinery — far too heavy for `lib/articles.ts` to import. Move it verbatim to a new focused module. Also add every type the later tasks share, and the `@shared/generation` workspace dep (for `MAX_GENERATION_ATTEMPTS`).

**Files:**
- Create: `apps/cli/src/lib/target.ts`
- Modify: `apps/cli/src/lib/db.ts` (remove the local `resolveOrgId`, import it instead)
- Modify: `apps/cli/src/types.ts` (append new interfaces)
- Modify: `apps/cli/package.json` (add dep)

**Interfaces:**
- Consumes: `UserRepo.findByEmail(email)`, `OrgRepo.findByUserId(id)` from `@shared/db`; `Result`/`ok`/`fail` from `../types`.
- Produces: `resolveOrgId(org?: string, user?: string): Promise<Result<string>>` exported from `lib/target.ts`; types `ArticleAttemptView`, `ArticlePublicationView`, `ArticleListRow`, `ArticlesListData`, `ArticleShowData`, `WaitOutcome`, `WaitReport`, `GenerateNextData`, `PublishArticleData` exported from `types.ts`. Later tasks import all of these by exactly these names.

- [ ] **Step 1: Create `apps/cli/src/lib/target.ts`**

Move the function from `lib/db.ts:98-122` verbatim (only the JSDoc sentence about "db subcommand" widens to "org-scoped subcommand"):

```typescript
/**
 * Resolve the target org from exactly one of `org` (id, taken as-is) or `user`
 * (email -> their single org). Shared by every org-scoped subcommand so they
 * accept the same flags and fail with the same codes.
 */
import { OrgRepo, UserRepo } from '@shared/db';
import { fail, ok, type Result } from '../types';

export async function resolveOrgId(org?: string, user?: string): Promise<Result<string>> {
  if ((org && user) || (!org && !user)) {
    return fail('BAD_TARGET', 'Provide exactly one of --org or --user.');
  }
  if (!user) return ok(org as string);

  const found = await UserRepo.findByEmail(user);
  if (!found) return fail('USER_NOT_FOUND', `No user with email "${user}".`);
  const orgs = await OrgRepo.findByUserId(found.id);
  if (orgs.length > 1) {
    return fail(
      'AMBIGUOUS_ORG',
      `User "${user}" owns ${orgs.length} orgs: ${orgs.map((o) => o.id).join(', ')}.`,
      'Re-run with --org <id>.',
    );
  }
  const [only] = orgs;
  if (!only) return fail('ORG_NOT_FOUND', `User "${user}" owns no org.`);
  return ok(only.id);
}
```

- [ ] **Step 2: Update `apps/cli/src/lib/db.ts`**

Delete the local `resolveOrgId` function (lines 98–122, including its JSDoc) and add to the local imports:

```typescript
import { resolveOrgId } from './target';
```

Nothing else in `db.ts` changes — all existing call sites keep working.

- [ ] **Step 3: Append the new types to `apps/cli/src/types.ts`**

```typescript
/** Publishing error as `articles show` renders it (dates ISO-stringified). */
export interface PublishingErrorView {
  code: string;
  kind: string;
  message: string;
  at: string;
}

export interface ArticleAttemptView {
  provider: string;
  status: string;
  attempt_count: number;
  requested_at: string;
  last_attempt_at: string | null;
  last_error: PublishingErrorView | null;
}

export interface ArticlePublicationView {
  provider: string;
  ref: string;
  slug: string;
  remote_url: string | null;
  published_at: string;
  updated_at: string | null;
}

/** One row of `articles list` — enough to spot where the pipeline is stuck. */
export interface ArticleListRow {
  id: string;
  title: string;
  status: string;
  images_status: string;
  created_at: string;
  attempts: { provider: string; status: string }[];
  published_to: string[];
}

export interface ArticlesListData {
  org_id: string;
  /** Total articles in the org; `articles` holds at most `--limit` of them. */
  total: number;
  articles: ArticleListRow[];
}

/** `articles show` — the full pipeline picture for one article. */
export interface ArticleShowData {
  id: string;
  org_id: string;
  title: string;
  slug: string;
  keyword: string;
  status: string;
  images_status: string;
  created_at: string;
  published_at: string | null;
  updated_at: string | null;
  preflight_error: PublishingErrorView | null;
  attempts: ArticleAttemptView[];
  publications: ArticlePublicationView[];
  /** The linked planner keyword; null when it was deleted out from under the article. */
  planner: {
    keyword_id: string;
    scheduled_date: string;
    generation_status: string;
    generation_attempts: number;
    generation_error: string | null;
  } | null;
}

/**
 * `--wait` observation for one pipeline target. `done` = reached a terminal
 * state before the timeout; `ok` = that terminal state is success (published,
 * or images complete when no publishing is expected).
 */
export interface WaitOutcome {
  /** The planner keyword being generated; null for `articles publish` targets. */
  keyword_id: string | null;
  /** Null until generation has created the article. */
  article_id: string | null;
  generation_status: string | null;
  images_status: string | null;
  /** Preflight error code, when the images worker's publish handoff refused. */
  preflight_error: string | null;
  attempts: { provider: string; status: string; error: string | null }[];
  done: boolean;
  ok: boolean;
}

export interface WaitReport {
  timed_out: boolean;
  elapsed_ms: number;
  outcomes: WaitOutcome[];
}

export interface GenerateNextData {
  org_id: string;
  enqueued: {
    keyword_id: string;
    keyword: string;
    scheduled_date: string;
    generation_status: string;
    generation_attempts: number;
  }[];
  /** Null unless --wait was passed. */
  wait: WaitReport | null;
}

export interface PublishArticleData {
  article_id: string;
  org_id: string;
  providers: { provider: string; action: 'enqueued' | 'skipped_published' }[];
  /** Null unless --wait was passed (or nothing was enqueued). */
  wait: WaitReport | null;
}
```

- [ ] **Step 4: Add the workspace dep to `apps/cli/package.json`**

In `dependencies`, alphabetically after `@shared/db`:

```json
    "@shared/generation": "*",
```

Then run `npm install` at the repo root so the workspace symlink exists.

- [ ] **Step 5: Verify nothing broke**

Run: `npm test -- db` then `npm run check:all`
Expected: existing db tests PASS (they mock `@shared/db`, and `target.ts` reads from the same mock); typecheck green.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/lib/target.ts apps/cli/src/lib/db.ts apps/cli/src/types.ts apps/cli/package.json package-lock.json
git commit -m "refactor(cli): extract resolveOrgId, add articles types + @shared/generation dep"
```

---

### Task 2: `listArticles` + `showArticle` (read-only lib)

**Files:**
- Create: `apps/cli/src/lib/articles.ts`
- Create: `apps/cli/tests/articles.test.ts`

**Interfaces:**
- Consumes: `resolveOrgId` from `./target` (Task 1); `ArticleRepo.listByOrg(orgId, { limit, offset })` → `{ articles: Article[]; total: number }`, `ArticleRepo.findById(id)` → `Article | null`, `KeywordRepo.findById(id)` → `Keyword | null`, `closeDb` from `@shared/db`; the Task 1 types.
- Produces: `listArticles(opts: { org?: string; user?: string; limit: number }): Promise<Result<ArticlesListData>>` and `showArticle(articleId: string): Promise<Result<ArticleShowData>>`, plus module-internal helpers `iso`, `errorView`, `toShowData` reused by Task 5.

- [ ] **Step 1: Write the failing tests**

Create `apps/cli/tests/articles.test.ts`:

```typescript
import { beforeEach, describe, expect, test, vi } from 'vitest';

const repos = vi.hoisted(() => ({
  articleListByOrg: vi.fn(async () => ({ articles: [] as unknown[], total: 0 })),
  articleFindById: vi.fn(async (): Promise<unknown> => null),
  initAttempt: vi.fn(async () => true),
  resetAttempt: vi.fn(async () => true),
  clearPreflight: vi.fn(async () => {}),
  keywordListByOrg: vi.fn(async () => [] as unknown[]),
  keywordFindById: vi.fn(async (): Promise<unknown> => null),
  orgFindById: vi.fn(async (): Promise<unknown> => null),
  orgFindByUserId: vi.fn(async () => [] as unknown[]),
  userFindByEmail: vi.fn(async (): Promise<unknown> => null),
  integrationsList: vi.fn(async () => [] as unknown[]),
  closeDb: vi.fn(async () => {}),
}));
vi.mock('@shared/db', () => ({
  ArticleRepo: {
    listByOrg: repos.articleListByOrg,
    findById: repos.articleFindById,
    initializeAutoPublishAttempt: repos.initAttempt,
    resetAutoPublishAttempt: repos.resetAttempt,
    clearAutoPublishPreflightError: repos.clearPreflight,
  },
  KeywordRepo: { listByOrg: repos.keywordListByOrg, findById: repos.keywordFindById },
  OrgRepo: { findById: repos.orgFindById, findByUserId: repos.orgFindByUserId },
  UserRepo: { findByEmail: repos.userFindByEmail },
  IntegrationRepo: { listByOrgId: repos.integrationsList },
  closeDb: repos.closeDb,
}));

const sqs = vi.hoisted(() => ({
  send: vi.fn(async (_cmd: { input: Record<string, unknown> }) => ({})),
}));
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: class {
    send = sqs.send;
    destroy() {}
  },
  SendMessageCommand: class {
    constructor(readonly input: unknown) {}
  },
  GetQueueAttributesCommand: class {
    constructor(readonly input: unknown) {}
  },
}));

// The real index pulls the whole generation pipeline into the graph.
vi.mock('@shared/generation', () => ({ MAX_GENERATION_ATTEMPTS: 3 }));

import { listArticles, showArticle } from '../src/lib/articles';

const attempt = (over: Record<string, unknown> = {}) => ({
  provider: 'wordpress',
  status: 'failed',
  attempt_count: 3,
  requested_at: new Date('2026-08-20T07:00:00Z'),
  last_attempt_at: new Date('2026-08-20T07:05:00Z'),
  lease_expires_at: null,
  last_error: {
    code: 'plugin_upgrade_required',
    kind: 'permanent',
    message: 'upgrade the plugin',
    at: new Date('2026-08-20T07:05:00Z'),
  },
  ...over,
});

const article = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  org_id: 'o1',
  keyword_id: 'k1',
  title: 'Widget Guide',
  slug: 'widget-guide',
  keyword: 'widgets',
  status: 'generated',
  images_status: 'complete',
  created_at: new Date('2026-08-20T06:00:00Z'),
  published_at: null,
  updated_at: null,
  publications: [] as unknown[],
  auto_publish: { preflight_error: null, attempts: [] as unknown[] },
  ...over,
});

const keyword = (over: Record<string, unknown> = {}) => ({
  id: 'k1',
  org_id: 'o1',
  keyword: 'widgets',
  scheduled_date: '2026-08-23',
  article_id: null,
  generation_status: 'pending',
  generation_attempts: 0,
  generation_error: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GENERATION_QUEUE_URL = 'https://sqs.test/generation';
  process.env.PUBLISH_QUEUE_URL = 'https://sqs.test/publish';
});

describe('listArticles', () => {
  test('maps articles to rows with attempt and publication summaries', async () => {
    repos.articleListByOrg.mockResolvedValueOnce({
      total: 1,
      articles: [
        article({
          auto_publish: { preflight_error: null, attempts: [attempt()] },
          publications: [
            {
              provider: 'static-site',
              ref: 'sha1',
              slug: 'widget-guide',
              published_at: new Date('2026-08-20T08:00:00Z'),
              updated_at: null,
              remote_url: null,
            },
          ],
        }),
      ],
    });
    const result = await listArticles({ org: 'o1', limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.org_id).toBe('o1');
    expect(result.data.total).toBe(1);
    expect(result.data.articles[0]).toMatchObject({
      id: 'a1',
      status: 'generated',
      images_status: 'complete',
      attempts: [{ provider: 'wordpress', status: 'failed' }],
      published_to: ['static-site'],
    });
    expect(repos.closeDb).toHaveBeenCalled();
  });

  test('fails BAD_TARGET when neither --org nor --user is given', async () => {
    const result = await listArticles({ limit: 50 });
    expect(result).toMatchObject({ ok: false, error: { code: 'BAD_TARGET' } });
  });
});

describe('showArticle', () => {
  test('returns the full detail with ISO dates and the planner keyword', async () => {
    repos.articleFindById.mockResolvedValueOnce(
      article({ auto_publish: { preflight_error: null, attempts: [attempt()] } }),
    );
    repos.keywordFindById.mockResolvedValueOnce(
      keyword({ article_id: 'a1', generation_status: 'generated' }),
    );
    const result = await showArticle('a1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.created_at).toBe('2026-08-20T06:00:00.000Z');
    expect(result.data.attempts[0]).toMatchObject({
      provider: 'wordpress',
      status: 'failed',
      last_error: { code: 'plugin_upgrade_required', at: '2026-08-20T07:05:00.000Z' },
    });
    expect(result.data.planner).toMatchObject({
      keyword_id: 'k1',
      generation_status: 'generated',
    });
  });

  test('tolerates a deleted planner keyword (planner: null)', async () => {
    repos.articleFindById.mockResolvedValueOnce(article());
    repos.keywordFindById.mockResolvedValueOnce(null);
    const result = await showArticle('a1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.planner).toBeNull();
  });

  test('fails ARTICLE_NOT_FOUND for an unknown id', async () => {
    repos.articleFindById.mockResolvedValueOnce(null);
    const result = await showArticle('nope');
    expect(result).toMatchObject({ ok: false, error: { code: 'ARTICLE_NOT_FOUND' } });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- articles`
Expected: FAIL — `Cannot find module '../src/lib/articles'` (or equivalent).

- [ ] **Step 3: Create `apps/cli/src/lib/articles.ts`**

```typescript
/**
 * Article pipeline operations (spec: docs/superpowers/specs/
 * 2026-08-22-article-cli-design.md). Inspection reads Mongo; generate-next and
 * publish enqueue SQS tasks that the deployed workers consume — the CLI never
 * generates or publishes in-process, so a run exercises the deployed pipeline.
 */
import { ArticleRepo, closeDb, KeywordRepo } from '@shared/db';
import type { Article, PublishingError } from '@shared/schemas';
import {
  type ArticleShowData,
  type ArticlesListData,
  fail,
  ok,
  type PublishingErrorView,
  type Result,
} from '../types';
import { resolveOrgId } from './target';

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function errorView(error: PublishingError | null): PublishingErrorView | null {
  if (!error) return null;
  return { code: error.code, kind: error.kind, message: error.message, at: error.at.toISOString() };
}

export async function listArticles(opts: {
  org?: string;
  user?: string;
  limit: number;
}): Promise<Result<ArticlesListData>> {
  try {
    const resolved = await resolveOrgId(opts.org, opts.user);
    if (!resolved.ok) return resolved;
    const { articles, total } = await ArticleRepo.listByOrg(resolved.data, {
      limit: opts.limit,
      offset: 0,
    });
    return ok({
      org_id: resolved.data,
      total,
      articles: articles.map((a) => ({
        id: a.id,
        title: a.title,
        status: a.status,
        images_status: a.images_status,
        created_at: a.created_at.toISOString(),
        attempts: a.auto_publish.attempts.map((entry) => ({
          provider: entry.provider,
          status: entry.status,
        })),
        published_to: a.publications.map((p) => p.provider),
      })),
    });
  } finally {
    await closeDb();
  }
}

/** The `articles show` projection — also the per-poll read behind `--wait`. */
async function toShowData(article: Article): Promise<ArticleShowData> {
  const planner = await KeywordRepo.findById(article.keyword_id);
  return {
    id: article.id,
    org_id: article.org_id,
    title: article.title,
    slug: article.slug,
    keyword: article.keyword,
    status: article.status,
    images_status: article.images_status,
    created_at: article.created_at.toISOString(),
    published_at: iso(article.published_at),
    updated_at: iso(article.updated_at),
    preflight_error: errorView(article.auto_publish.preflight_error),
    attempts: article.auto_publish.attempts.map((entry) => ({
      provider: entry.provider,
      status: entry.status,
      attempt_count: entry.attempt_count,
      requested_at: entry.requested_at.toISOString(),
      last_attempt_at: iso(entry.last_attempt_at),
      last_error: errorView(entry.last_error),
    })),
    publications: article.publications.map((p) => ({
      provider: p.provider,
      ref: p.ref,
      slug: p.slug,
      remote_url: p.remote_url,
      published_at: p.published_at.toISOString(),
      updated_at: iso(p.updated_at),
    })),
    planner: planner
      ? {
          keyword_id: planner.id,
          scheduled_date: planner.scheduled_date,
          generation_status: planner.generation_status,
          generation_attempts: planner.generation_attempts,
          generation_error: planner.generation_error,
        }
      : null,
  };
}

export async function showArticle(articleId: string): Promise<Result<ArticleShowData>> {
  try {
    const article = await ArticleRepo.findById(articleId);
    if (!article) return fail('ARTICLE_NOT_FOUND', `No article with id "${articleId}".`);
    return ok(await toShowData(article));
  } finally {
    await closeDb();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- articles`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add apps/cli/src/lib/articles.ts apps/cli/tests/articles.test.ts
git commit -m "feat(cli): articles list/show lib"
```

---

### Task 3: SQS preflight + `generateNext`

**Files:**
- Modify: `apps/cli/src/lib/articles.ts`
- Modify: `apps/cli/tests/articles.test.ts`

**Interfaces:**
- Consumes: `KeywordRepo.listByOrg(orgId)` → `Keyword[]` sorted by `scheduled_date` asc; `GenerateTask` (zod) from `@shared/schemas`; `MAX_GENERATION_ATTEMPTS` from `@shared/generation`; `SQSClient`, `SendMessageCommand`, `GetQueueAttributesCommand`.
- Produces: `generateNext(opts: { org?: string; user?: string; count: number; wait: boolean; timeoutMs: number }): Promise<Result<GenerateNextData>>`; module-internal `preflightQueue(queueUrl: string): Promise<Result<SQSClient>>` reused by Task 4. In this task `wait: true` returns `wait: null` (Task 5 fills it in).

- [ ] **Step 1: Add the failing tests**

Append to `apps/cli/tests/articles.test.ts` (and add `generateNext` to the lib import):

```typescript
describe('generateNext', () => {
  const pending = (id: string, date: string, over: Record<string, unknown> = {}) =>
    keyword({ id, scheduled_date: date, ...over });

  test('enqueues the next N eligible keywords, oldest scheduled_date first', async () => {
    repos.keywordListByOrg.mockResolvedValueOnce([
      pending('k1', '2026-08-23', { article_id: 'a0', generation_status: 'generated' }),
      pending('k2', '2026-08-24'),
      pending('k3', '2026-08-25', { generation_status: 'failed', generation_attempts: 3 }),
      pending('k4', '2026-08-26'),
    ]);
    const result = await generateNext({ org: 'o1', count: 2, wait: false, timeoutMs: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // k1 is generated, k3 is out of attempts — k2 and k4 are the next two.
    expect(result.data.enqueued.map((e) => e.keyword_id)).toEqual(['k2', 'k4']);
    // 1 preflight probe + 2 sends.
    expect(sqs.send).toHaveBeenCalledTimes(3);
    const bodies = sqs.send.mock.calls
      .slice(1)
      .map((call) => JSON.parse((call[0] as { input: { MessageBody: string } }).input.MessageBody));
    expect(bodies).toEqual([
      { org_id: 'o1', keyword_id: 'k2' },
      { org_id: 'o1', keyword_id: 'k4' },
    ]);
  });

  test('retries a failed keyword with attempts left', async () => {
    repos.keywordListByOrg.mockResolvedValueOnce([
      pending('k1', '2026-08-20', { generation_status: 'failed', generation_attempts: 1 }),
    ]);
    const result = await generateNext({ org: 'o1', count: 1, wait: false, timeoutMs: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.enqueued.map((e) => e.keyword_id)).toEqual(['k1']);
  });

  test('fails NO_KEYWORDS_DUE when nothing is eligible', async () => {
    repos.keywordListByOrg.mockResolvedValueOnce([
      pending('k1', '2026-08-20', { article_id: 'a1', generation_status: 'generated' }),
    ]);
    const result = await generateNext({ org: 'o1', count: 1, wait: false, timeoutMs: 0 });
    expect(result).toMatchObject({ ok: false, error: { code: 'NO_KEYWORDS_DUE' } });
  });

  test('fails QUEUE_URL_MISSING without GENERATION_QUEUE_URL, before touching Mongo', async () => {
    delete process.env.GENERATION_QUEUE_URL;
    const result = await generateNext({ org: 'o1', count: 1, wait: false, timeoutMs: 0 });
    expect(result).toMatchObject({ ok: false, error: { code: 'QUEUE_URL_MISSING' } });
    expect(repos.keywordListByOrg).not.toHaveBeenCalled();
  });

  test('maps expired credentials to AWS_NOT_AUTHENTICATED, before touching Mongo', async () => {
    sqs.send.mockRejectedValueOnce(
      Object.assign(new Error('The security token included in the request is expired'), {
        name: 'ExpiredTokenException',
      }),
    );
    const result = await generateNext({ org: 'o1', count: 1, wait: false, timeoutMs: 0 });
    expect(result).toMatchObject({ ok: false, error: { code: 'AWS_NOT_AUTHENTICATED' } });
    expect(repos.keywordListByOrg).not.toHaveBeenCalled();
  });

  test('maps other probe failures to SQS_UNAVAILABLE', async () => {
    sqs.send.mockRejectedValueOnce(
      Object.assign(new Error('queue does not exist'), { name: 'QueueDoesNotExist' }),
    );
    const result = await generateNext({ org: 'o1', count: 1, wait: false, timeoutMs: 0 });
    expect(result).toMatchObject({ ok: false, error: { code: 'SQS_UNAVAILABLE' } });
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test -- articles`
Expected: the six new tests FAIL (`generateNext` is not exported); the Task 2 tests still PASS.

- [ ] **Step 3: Implement in `apps/cli/src/lib/articles.ts`**

Extend the imports:

```typescript
import { GetQueueAttributesCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { GenerateTask } from '@shared/schemas';
import { MAX_GENERATION_ATTEMPTS } from '@shared/generation';
import type { GenerateNextData } from '../types';
```

(Fold these into the existing import statements per Biome's organize-imports; `Article`, `PublishingError` stay type-only.)

Add:

```typescript
/**
 * Error names the AWS SDK surfaces when credentials are missing, expired, or
 * rejected — the "you are not logged in" family, as opposed to a bad queue URL.
 */
const CREDENTIAL_ERRORS = new Set([
  'CredentialsProviderError',
  'ExpiredToken',
  'ExpiredTokenException',
  'InvalidClientTokenId',
  'UnrecognizedClientException',
  'AccessDenied',
  'AccessDeniedException',
]);

/**
 * AWS auth preflight: probe the target queue BEFORE any Mongo write, so an
 * expired SSO session can't strand half-done state. Returns the client on
 * success — reuse it for the actual sends and destroy() it in `finally`.
 */
async function preflightQueue(queueUrl: string): Promise<Result<SQSClient>> {
  const endpoint = process.env.SQS_ENDPOINT;
  const client = new SQSClient(
    endpoint
      ? {
          endpoint,
          region: 'elasticmq',
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        }
      : {},
  );
  try {
    await client.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }),
    );
    return ok(client);
  } catch (e) {
    client.destroy();
    const error = e as Error;
    if (CREDENTIAL_ERRORS.has(error.name)) {
      return fail(
        'AWS_NOT_AUTHENTICATED',
        `AWS rejected the queue probe: ${error.message}`,
        'Log in with the AWS CLI (e.g. `aws sso login`) or check AWS_PROFILE, then re-run.',
      );
    }
    return fail(
      'SQS_UNAVAILABLE',
      `Queue probe failed for ${queueUrl}: ${error.message}`,
      'Check the queue URL and your network/VPN.',
    );
  }
}

export async function generateNext(opts: {
  org?: string;
  user?: string;
  count: number;
  wait: boolean;
  timeoutMs: number;
}): Promise<Result<GenerateNextData>> {
  const queueUrl = process.env.GENERATION_QUEUE_URL;
  if (!queueUrl) {
    return fail(
      'QUEUE_URL_MISSING',
      'GENERATION_QUEUE_URL is not set.',
      'Point it at the staging generation queue (aws sqs list-queues), or at ElasticMQ with SQS_ENDPOINT for local dev.',
    );
  }
  const probe = await preflightQueue(queueUrl);
  if (!probe.ok) return probe;
  const client = probe.data;

  try {
    const resolved = await resolveOrgId(opts.org, opts.user);
    if (!resolved.ok) return resolved;
    const orgId = resolved.data;

    // Same eligibility as the scheduler's listDueForGeneration, minus the date
    // cap (the worker never checks scheduled_date — only the scheduler does) and
    // scoped to one org. listByOrg sorts by scheduled_date asc, so "next" is
    // simply the head of the filtered list.
    const keywords = await KeywordRepo.listByOrg(orgId);
    const eligible = keywords.filter(
      (k) =>
        k.article_id === null &&
        (k.generation_status === 'pending' || k.generation_status === 'failed') &&
        k.generation_attempts < MAX_GENERATION_ATTEMPTS,
    );
    if (eligible.length === 0) {
      return fail(
        'NO_KEYWORDS_DUE',
        `Org "${orgId}" has no ungenerated planner keywords with attempts left.`,
        'Inspect the planner with `db strategy-audit`, or build one with `db strategy-run`.',
      );
    }

    const targets = eligible.slice(0, opts.count);
    for (const target of targets) {
      await client.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(
            GenerateTask.parse({ org_id: orgId, keyword_id: target.id }),
          ),
        }),
      );
    }

    return ok({
      org_id: orgId,
      enqueued: targets.map((k) => ({
        keyword_id: k.id,
        keyword: k.keyword,
        scheduled_date: k.scheduled_date,
        generation_status: k.generation_status,
        generation_attempts: k.generation_attempts,
      })),
      wait: null,
    });
  } finally {
    client.destroy();
    await closeDb();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- articles`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add apps/cli/src/lib/articles.ts apps/cli/tests/articles.test.ts
git commit -m "feat(cli): articles generate-next with AWS auth preflight"
```

---

### Task 4: `publishArticle`

Mirrors the API's retry route (`apps/api/src/routes/dashboard.ts`, `POST /articles/{id}/auto-publish/retry`) with two deliberate differences: the worker's silent gates become fail-fast error codes, and the legacy org→Integration WordPress migration is skipped (it needs `apps/api`'s crypto; orgs still on the legacy mirror get `NOT_CONNECTED`, and any dashboard publish migrates them).

**Files:**
- Modify: `apps/cli/src/lib/articles.ts`
- Modify: `apps/cli/tests/articles.test.ts`

**Interfaces:**
- Consumes: `preflightQueue` (Task 3); `OrgRepo.findById`, `IntegrationRepo.listByOrgId`, `ArticleRepo.{clearAutoPublishPreflightError,resetAutoPublishAttempt,initializeAutoPublishAttempt}` from `@shared/db`; `PublishTask`, `isPaid`, `INTEGRATION_PROVIDERS`, type `IntegrationProvider` from `@shared/schemas`.
- Produces: `publishArticle(opts: { articleId: string; provider?: string; wait: boolean; timeoutMs: number }): Promise<Result<PublishArticleData>>`. In this task `wait: true` returns `wait: null` (Task 5 fills it in).

- [ ] **Step 1: Add the failing tests**

Append to `apps/cli/tests/articles.test.ts` (add `publishArticle` to the lib import). Add fixtures near the others:

```typescript
const paidOrg = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  plan: 'paid',
  website_url: 'https://example.com',
  presets: { article_preferences: { publishing: { auto_publish: true } } },
  ...over,
});

const integration = (provider: string) => ({ org_id: 'o1', provider });
```

```typescript
describe('publishArticle', () => {
  beforeEach(() => {
    repos.articleFindById.mockResolvedValue(article());
    repos.orgFindById.mockResolvedValue(paidOrg());
    repos.integrationsList.mockResolvedValue([integration('wordpress'), integration('static-site')]);
  });

  test('resets/initializes attempts and enqueues one task per connected provider', async () => {
    repos.articleFindById.mockResolvedValue(
      article({
        auto_publish: { preflight_error: null, attempts: [attempt({ status: 'failed' })] },
      }),
    );
    const result = await publishArticle({ articleId: 'a1', wait: false, timeoutMs: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.providers).toEqual([
      { provider: 'wordpress', action: 'enqueued' },
      { provider: 'static-site', action: 'enqueued' },
    ]);
    // failed wordpress attempt is reset; static-site has none and is initialized.
    expect(repos.resetAttempt).toHaveBeenCalledWith('a1', 'wordpress', expect.any(Date));
    expect(repos.initAttempt).toHaveBeenCalledWith('a1', 'static-site', expect.any(Date));
    expect(repos.clearPreflight).toHaveBeenCalledWith('a1');
    const bodies = sqs.send.mock.calls
      .slice(1)
      .map((call) => JSON.parse((call[0] as { input: { MessageBody: string } }).input.MessageBody));
    expect(bodies).toEqual([
      { org_id: 'o1', article_id: 'a1', provider: 'wordpress' },
      { org_id: 'o1', article_id: 'a1', provider: 'static-site' },
    ]);
  });

  test('skips providers already published', async () => {
    repos.articleFindById.mockResolvedValue(
      article({
        publications: [
          {
            provider: 'wordpress',
            ref: '12',
            slug: 'widget-guide',
            published_at: new Date('2026-08-20T08:00:00Z'),
            updated_at: null,
            remote_url: null,
          },
        ],
      }),
    );
    const result = await publishArticle({ articleId: 'a1', wait: false, timeoutMs: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.providers).toEqual([
      { provider: 'wordpress', action: 'skipped_published' },
      { provider: 'static-site', action: 'enqueued' },
    ]);
  });

  test('--provider restricts to one connected provider', async () => {
    const result = await publishArticle({
      articleId: 'a1',
      provider: 'static-site',
      wait: false,
      timeoutMs: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.providers).toEqual([{ provider: 'static-site', action: 'enqueued' }]);
  });

  test('fails BAD_ARGS on an unknown provider', async () => {
    const result = await publishArticle({
      articleId: 'a1',
      provider: 'medium',
      wait: false,
      timeoutMs: 0,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'BAD_ARGS' } });
  });

  test.each([
    ['IMAGES_INCOMPLETE', () => repos.articleFindById.mockResolvedValue(article({ images_status: 'pending' }))],
    ['AUTO_PUBLISH_DISABLED', () =>
      repos.orgFindById.mockResolvedValue(
        paidOrg({ presets: { article_preferences: { publishing: { auto_publish: false } } } }),
      )],
    ['ORG_NOT_PAID', () => repos.orgFindById.mockResolvedValue(paidOrg({ plan: 'free' }))],
    ['NOT_CONNECTED', () => repos.integrationsList.mockResolvedValue([])],
  ] as const)('fails fast with %s', async (code, arrange) => {
    arrange();
    const result = await publishArticle({ articleId: 'a1', wait: false, timeoutMs: 0 });
    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(repos.initAttempt).not.toHaveBeenCalled();
    // Only the preflight probe — no publish task was enqueued.
    expect(sqs.send).toHaveBeenCalledTimes(1);
  });

  test('fails NOT_CONNECTED when --provider names an unconnected one', async () => {
    repos.integrationsList.mockResolvedValue([integration('static-site')]);
    const result = await publishArticle({
      articleId: 'a1',
      provider: 'wordpress',
      wait: false,
      timeoutMs: 0,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
  });
});
```

Note: `repos.articleFindById.mockResolvedValue(...)` (not `Once`) in this describe's `beforeEach` — the top-level `beforeEach` runs `vi.clearAllMocks()` first, so these defaults are re-armed per test.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test -- articles`
Expected: new tests FAIL (`publishArticle` not exported); prior tests PASS.

- [ ] **Step 3: Implement in `apps/cli/src/lib/articles.ts`**

Extend imports: `IntegrationRepo`, `OrgRepo` from `@shared/db`; `INTEGRATION_PROVIDERS`, `isPaid`, `PublishTask` and `type IntegrationProvider` from `@shared/schemas`; `type PublishArticleData` from `../types`.

```typescript
export async function publishArticle(opts: {
  articleId: string;
  provider?: string;
  wait: boolean;
  timeoutMs: number;
}): Promise<Result<PublishArticleData>> {
  if (opts.provider && !(INTEGRATION_PROVIDERS as readonly string[]).includes(opts.provider)) {
    return fail(
      'BAD_ARGS',
      `Unknown provider "${opts.provider}".`,
      `Use one of: ${INTEGRATION_PROVIDERS.join(', ')}.`,
    );
  }
  const queueUrl = process.env.PUBLISH_QUEUE_URL;
  if (!queueUrl) {
    return fail(
      'QUEUE_URL_MISSING',
      'PUBLISH_QUEUE_URL is not set.',
      'Point it at the staging publish queue (aws sqs list-queues), or at ElasticMQ with SQS_ENDPOINT for local dev.',
    );
  }
  const probe = await preflightQueue(queueUrl);
  if (!probe.ok) return probe;
  const client = probe.data;

  try {
    const article = await ArticleRepo.findById(opts.articleId);
    if (!article) return fail('ARTICLE_NOT_FOUND', `No article with id "${opts.articleId}".`);
    const org = await OrgRepo.findById(article.org_id);
    if (!org) return fail('ORG_NOT_FOUND', `No org with id "${article.org_id}".`);

    // The publish worker checks all of these and silently drops the task when
    // they fail — surface them as errors BEFORE enqueueing instead.
    if (article.images_status !== 'complete') {
      return fail(
        'IMAGES_INCOMPLETE',
        `images_status is "${article.images_status}" — the publish worker refuses articles without complete images.`,
        'Check `articles show`; a failed image run can be replayed with `db reset-images --enqueue`.',
      );
    }
    if (!org.presets?.article_preferences.publishing.auto_publish) {
      return fail(
        'AUTO_PUBLISH_DISABLED',
        'The org preset article_preferences.publishing.auto_publish is off.',
        'Enable automatic publishing in the dashboard settings for this org.',
      );
    }
    if (!isPaid(org)) {
      return fail(
        'ORG_NOT_PAID',
        `Org "${org.id}" is on plan "${org.plan}" — publishing requires a paid plan.`,
        `npm run cli -- db set-plan --org ${org.id} --plan paid`,
      );
    }

    // Presence of an Integration row = connected (same as the retry route). The
    // route's lazy org→Integration WordPress migration is NOT replicated here:
    // it needs apps/api's crypto. Legacy-mirror orgs read as NOT_CONNECTED; any
    // dashboard publish migrates them.
    const integrations = await IntegrationRepo.listByOrgId(org.id);
    const connected = integrations.map((i) => i.provider);
    if (opts.provider && !connected.includes(opts.provider as IntegrationProvider)) {
      return fail(
        'NOT_CONNECTED',
        `No "${opts.provider}" integration is connected for org "${org.id}".`,
        `Connected: ${connected.length ? connected.join(', ') : '(none)'}.`,
      );
    }
    const requested = opts.provider ? [opts.provider as IntegrationProvider] : [...new Set(connected)];
    if (requested.length === 0) {
      return fail(
        'NOT_CONNECTED',
        `Org "${org.id}" has no publishing integration connected.`,
        'Connect WordPress or a static site in the dashboard first.',
      );
    }

    await ArticleRepo.clearAutoPublishPreflightError(article.id);
    const requestedAt = new Date();
    const publishedTo = new Set(article.publications.map((p) => p.provider));
    const providers: PublishArticleData['providers'] = [];
    for (const provider of requested) {
      const attempt = article.auto_publish.attempts.find((entry) => entry.provider === provider);
      if (publishedTo.has(provider) || attempt?.status === 'published') {
        providers.push({ provider, action: 'skipped_published' });
        continue;
      }
      if (attempt?.status === 'failed' || attempt?.status === 'cancelled') {
        await ArticleRepo.resetAutoPublishAttempt(article.id, provider, requestedAt);
      } else if (!attempt) {
        await ArticleRepo.initializeAutoPublishAttempt(article.id, provider, requestedAt);
      }
      await client.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(
            PublishTask.parse({ org_id: org.id, article_id: article.id, provider }),
          ),
        }),
      );
      providers.push({ provider, action: 'enqueued' });
    }

    return ok({ article_id: article.id, org_id: org.id, providers, wait: null });
  } finally {
    client.destroy();
    await closeDb();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- articles`
Expected: PASS (22 tests).

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add apps/cli/src/lib/articles.ts apps/cli/tests/articles.test.ts
git commit -m "feat(cli): articles publish with fail-fast worker-gate checks"
```

---

### Task 5: `--wait` polling

Poll Mongo every 5s until every target reaches a terminal state or the timeout elapses. Never claim success on timeout: the command layer (Task 6) maps `timed_out` / any `!ok` outcome to `EXIT.OP_FAILED`.

**Files:**
- Modify: `apps/cli/src/lib/articles.ts`
- Modify: `apps/cli/tests/articles.test.ts`

**Interfaces:**
- Consumes: `KeywordRepo.findById`, `ArticleRepo.findById`, `OrgRepo.findById`, `IntegrationRepo.listByOrgId`; `MAX_GENERATION_ATTEMPTS`; `isPaid`.
- Produces: `generateNext`/`publishArticle` now fill `wait: WaitReport` when `opts.wait` is true. Internal: `pollUntil`, `generationOutcome`, `publishOutcome`, `expectedProviders`, exported const `POLL_MS = 5_000`.

Terminal rules (from the spec):
- **generate-next** target (a keyword): *failure* when generation is exhausted (`generation_status === 'failed'` with `generation_attempts >= MAX_GENERATION_ATTEMPTS`), or the article exists with `images_status === 'failed'`, or `auto_publish.preflight_error` is set. *Success* when the article exists with `images_status === 'complete'` and — only if publishing is expected (auto_publish preset on, org paid, ≥1 integration, computed once at wait start) — every expected provider's attempt is terminal, all `published`. A provider entry in `publications[]` counts as published.
- **publish** target (article + the providers actually enqueued): terminal when each enqueued provider is in `publications[]` or its attempt status is `published`/`failed`/`cancelled`; ok when all are published.

- [ ] **Step 1: Add the failing tests**

Append to `apps/cli/tests/articles.test.ts`:

```typescript
describe('--wait', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('generate-next --wait polls until the article is published', async () => {
    repos.keywordListByOrg.mockResolvedValueOnce([keyword()]);
    // Wait-start expectation lookup: org is paid + auto_publish on + wordpress connected.
    repos.orgFindById.mockResolvedValue(paidOrg());
    repos.integrationsList.mockResolvedValue([integration('wordpress')]);
    // Poll 1: still generating. Poll 2: article linked and published.
    repos.keywordFindById
      .mockResolvedValueOnce(keyword({ generation_status: 'generating' }))
      .mockResolvedValue(keyword({ article_id: 'a1', generation_status: 'generated' }));
    repos.articleFindById.mockResolvedValue(
      article({
        status: 'published',
        auto_publish: {
          preflight_error: null,
          attempts: [attempt({ status: 'published', last_error: null })],
        },
      }),
    );

    const promise = generateNext({ org: 'o1', count: 1, wait: true, timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.wait).toMatchObject({
      timed_out: false,
      outcomes: [{ keyword_id: 'k1', article_id: 'a1', done: true, ok: true }],
    });
  });

  test('generate-next --wait reports failure when generation exhausts attempts', async () => {
    repos.keywordListByOrg.mockResolvedValueOnce([keyword()]);
    repos.orgFindById.mockResolvedValue(paidOrg());
    repos.integrationsList.mockResolvedValue([]);
    repos.keywordFindById.mockResolvedValue(
      keyword({ generation_status: 'failed', generation_attempts: 3, generation_error: 'boom' }),
    );

    const result = await generateNext({ org: 'o1', count: 1, wait: true, timeoutMs: 60_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.wait).toMatchObject({
      timed_out: false,
      outcomes: [{ done: true, ok: false, generation_status: 'failed' }],
    });
  });

  test('generate-next --wait times out with the last observed state', async () => {
    repos.keywordListByOrg.mockResolvedValueOnce([keyword()]);
    repos.orgFindById.mockResolvedValue(paidOrg());
    repos.integrationsList.mockResolvedValue([]);
    repos.keywordFindById.mockResolvedValue(keyword({ generation_status: 'generating' }));

    const promise = generateNext({ org: 'o1', count: 1, wait: true, timeoutMs: 12_000 });
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await promise;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.wait).toMatchObject({
      timed_out: true,
      outcomes: [{ done: false, generation_status: 'generating' }],
    });
  });

  test('publish --wait resolves when the enqueued provider publishes', async () => {
    repos.articleFindById
      .mockResolvedValueOnce(article()) // initial load
      .mockResolvedValueOnce(
        article({ auto_publish: { preflight_error: null, attempts: [attempt({ status: 'publishing', last_error: null })] } }),
      ) // poll 1
      .mockResolvedValue(
        article({
          status: 'published',
          publications: [
            {
              provider: 'wordpress',
              ref: '12',
              slug: 'widget-guide',
              published_at: new Date('2026-08-22T09:00:00Z'),
              updated_at: null,
              remote_url: 'https://example.com/widget-guide',
            },
          ],
        }),
      );
    repos.orgFindById.mockResolvedValue(paidOrg());
    repos.integrationsList.mockResolvedValue([integration('wordpress')]);

    const promise = publishArticle({ articleId: 'a1', wait: true, timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.wait).toMatchObject({
      timed_out: false,
      outcomes: [{ article_id: 'a1', done: true, ok: true }],
    });
  });

  test('publish --wait reports a failed attempt with its error code', async () => {
    repos.articleFindById
      .mockResolvedValueOnce(article())
      .mockResolvedValue(
        article({ auto_publish: { preflight_error: null, attempts: [attempt({ status: 'failed' })] } }),
      );
    repos.orgFindById.mockResolvedValue(paidOrg());
    repos.integrationsList.mockResolvedValue([integration('wordpress')]);

    const result = await publishArticle({ articleId: 'a1', wait: true, timeoutMs: 60_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.wait).toMatchObject({
      timed_out: false,
      outcomes: [
        {
          done: true,
          ok: false,
          attempts: [{ provider: 'wordpress', status: 'failed', error: 'plugin_upgrade_required' }],
        },
      ],
    });
  });
});
```

Add `afterEach` to the vitest import line.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test -- articles`
Expected: the five `--wait` tests FAIL (`wait` comes back `null`); everything else PASS.

- [ ] **Step 3: Implement in `apps/cli/src/lib/articles.ts`**

Extend imports: `type Keyword` from `@shared/schemas`, `type WaitOutcome`, `type WaitReport` from `../types`.

```typescript
export const POLL_MS = 5_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function pollUntil(
  observe: () => Promise<WaitOutcome[]>,
  timeoutMs: number,
): Promise<WaitReport> {
  const startedAt = Date.now();
  for (;;) {
    const outcomes = await observe();
    if (outcomes.every((o) => o.done)) {
      return { timed_out: false, elapsed_ms: Date.now() - startedAt, outcomes };
    }
    if (Date.now() - startedAt + POLL_MS > timeoutMs) {
      return { timed_out: true, elapsed_ms: Date.now() - startedAt, outcomes };
    }
    await sleep(POLL_MS);
  }
}

/**
 * The providers auto-publish will actually run for, computed ONCE at wait
 * start: with the preset off, an unpaid org, or nothing connected, the images
 * worker never hands off to publishing, and success is images completing.
 */
async function expectedProviders(orgId: string): Promise<IntegrationProvider[]> {
  const org = await OrgRepo.findById(orgId);
  if (!org?.presets?.article_preferences.publishing.auto_publish || !isPaid(org)) return [];
  return [...new Set((await IntegrationRepo.listByOrgId(orgId)).map((i) => i.provider))];
}

function attemptViews(article: Article): WaitOutcome['attempts'] {
  return article.auto_publish.attempts.map((entry) => ({
    provider: entry.provider,
    status: entry.status,
    error: entry.last_error?.code ?? null,
  }));
}

/** Terminal check for one provider: published (either record) / failed / cancelled. */
function providerState(article: Article, provider: IntegrationProvider) {
  const published =
    article.publications.some((p) => p.provider === provider) ||
    article.auto_publish.attempts.some(
      (entry) => entry.provider === provider && entry.status === 'published',
    );
  const attempt = article.auto_publish.attempts.find((entry) => entry.provider === provider);
  const terminal =
    published || attempt?.status === 'failed' || attempt?.status === 'cancelled';
  return { published, terminal };
}

async function generationOutcome(
  keywordId: string,
  providers: IntegrationProvider[],
): Promise<WaitOutcome> {
  const current = await KeywordRepo.findById(keywordId);
  const articleId = current?.article_id ?? null;
  const article = articleId ? await ArticleRepo.findById(articleId) : null;
  const base: WaitOutcome = {
    keyword_id: keywordId,
    article_id: articleId,
    generation_status: current?.generation_status ?? null,
    images_status: article?.images_status ?? null,
    preflight_error: article?.auto_publish.preflight_error?.code ?? null,
    attempts: article ? attemptViews(article) : [],
    done: false,
    ok: false,
  };

  const exhausted =
    current?.generation_status === 'failed' &&
    current.generation_attempts >= MAX_GENERATION_ATTEMPTS;
  if (exhausted || (!current && !article)) return { ...base, done: true, ok: false };
  if (!article) return base;

  if (article.images_status === 'failed' || base.preflight_error) {
    return { ...base, done: true, ok: false };
  }
  if (article.images_status !== 'complete') return base;
  if (providers.length === 0) return { ...base, done: true, ok: true };

  const states = providers.map((provider) => providerState(article, provider));
  if (!states.every((s) => s.terminal)) return base;
  return { ...base, done: true, ok: states.every((s) => s.published) };
}

async function publishOutcome(
  articleId: string,
  providers: IntegrationProvider[],
): Promise<WaitOutcome> {
  const article = await ArticleRepo.findById(articleId);
  if (!article) {
    return {
      keyword_id: null,
      article_id: articleId,
      generation_status: null,
      images_status: null,
      preflight_error: null,
      attempts: [],
      done: true,
      ok: false,
    };
  }
  const states = providers.map((provider) => providerState(article, provider));
  const done = states.every((s) => s.terminal);
  return {
    keyword_id: null,
    article_id: articleId,
    generation_status: null,
    images_status: article.images_status,
    preflight_error: article.auto_publish.preflight_error?.code ?? null,
    attempts: attemptViews(article),
    done,
    ok: done && states.every((s) => s.published),
  };
}
```

Wire into `generateNext` — replace the final `return ok({...})` block with:

```typescript
    let wait: WaitReport | null = null;
    if (opts.wait) {
      const providers = await expectedProviders(orgId);
      wait = await pollUntil(
        () => Promise.all(targets.map((t) => generationOutcome(t.id, providers))),
        opts.timeoutMs,
      );
    }

    return ok({
      org_id: orgId,
      enqueued: targets.map((k) => ({
        keyword_id: k.id,
        keyword: k.keyword,
        scheduled_date: k.scheduled_date,
        generation_status: k.generation_status,
        generation_attempts: k.generation_attempts,
      })),
      wait,
    });
```

Wire into `publishArticle` — replace its final `return ok({...})` with:

```typescript
    const enqueuedProviders = providers
      .filter((p) => p.action === 'enqueued')
      .map((p) => p.provider as IntegrationProvider);
    let wait: WaitReport | null = null;
    if (opts.wait && enqueuedProviders.length > 0) {
      wait = await pollUntil(
        () => publishOutcome(article.id, enqueuedProviders).then((o) => [o]),
        opts.timeoutMs,
      );
    }
    return ok({ article_id: article.id, org_id: org.id, providers, wait });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- articles`
Expected: PASS (27 tests). If a fake-timer test hangs, the poll loop isn't reaching `sleep` — check the timeout arithmetic (`elapsed + POLL_MS > timeoutMs` must eventually be true).

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add apps/cli/src/lib/articles.ts apps/cli/tests/articles.test.ts
git commit -m "feat(cli): --wait polling for generate-next and publish"
```

---

### Task 6: Command group + registration + smoke test

**Files:**
- Create: `apps/cli/src/commands/articles.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/tests/cli-smoke.test.ts`

**Interfaces:**
- Consumes: the four Task 2–5 lib functions; `createEmitter`, `outputOption`, `verboseOption`, `emitInternal`; `EXIT`, `Result`, `WaitReport` types.
- Produces: `articlesCommand` (citty command) registered as the `articles` subcommand of the CLI root.

Exit-code contract (spec § Agent ergonomics): errors map `AWS_NOT_AUTHENTICATED`/`SQS_UNAVAILABLE` → `INFRA_DOWN` (2), everything else → `USER_ERROR` (1); an ok result whose `wait` timed out or contains a failed outcome → `OP_FAILED` (3); otherwise `SUCCESS` (0). Internal throws → `INTERNAL` (4) via `emitInternal`.

- [ ] **Step 1: Extend the smoke test (failing first)**

In `apps/cli/tests/cli-smoke.test.ts`, extend the existing `--help` assertion and add a subcommand check:

```typescript
  test('--help exits 0 and lists all command groups', () => {
    const { status, out } = run(['--help']);
    expect(status).toBe(0);
    expect(out).toContain('infra');
    expect(out).toContain('db');
    expect(out).toContain('articles');
  });

  test('articles --help lists the four subcommands', () => {
    const { status, out } = run(['articles', '--help']);
    expect(status).toBe(0);
    for (const sub of ['list', 'show', 'generate-next', 'publish']) {
      expect(out).toContain(sub);
    }
  });
```

(Replace the old `--help` test's title/body with the first block.)

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- cli-smoke`
Expected: FAIL — `articles` not in help output.

- [ ] **Step 3: Create `apps/cli/src/commands/articles.ts`**

```typescript
/**
 * `articles` command group — on-demand article pipeline operations (spec:
 * docs/superpowers/specs/2026-08-22-article-cli-design.md). Reads/writes
 * whatever MONGO_URI targets; generate-next/publish enqueue to whatever
 * GENERATION_QUEUE_URL / PUBLISH_QUEUE_URL target, and the deployed workers
 * there do the actual work.
 */
import { defineCommand } from 'citty';
import {
  EXIT,
  type ExitCode,
  type OutputMode,
  type Result,
  type WaitReport,
} from '../types';
import { createEmitter } from '../utils/emitter';
import { emitInternal, outputOption, verboseOption } from './shared';

const EXIT_BY_CODE: Record<string, ExitCode> = {
  AWS_NOT_AUTHENTICATED: EXIT.INFRA_DOWN,
  SQS_UNAVAILABLE: EXIT.INFRA_DOWN,
};

/**
 * A timed-out or failed `--wait` exits OP_FAILED even though the enqueue
 * itself succeeded — never claim success the pipeline didn't earn.
 */
function exitFor(result: Result<{ wait?: WaitReport | null }>): ExitCode {
  if (!result.ok) return EXIT_BY_CODE[result.error.code] ?? EXIT.USER_ERROR;
  const wait = result.data.wait;
  if (wait && (wait.timed_out || wait.outcomes.some((o) => !o.ok))) return EXIT.OP_FAILED;
  return EXIT.SUCCESS;
}

const targetArgs = {
  org: { type: 'string' as const, description: 'Org id (or use --user)' },
  user: { type: 'string' as const, description: 'User email owning the org (or use --org)' },
};

const waitArgs = (defaultTimeout: string) => ({
  wait: {
    type: 'boolean' as const,
    description: 'Poll until the pipeline reaches a terminal state',
    default: false,
  },
  timeout: {
    type: 'string' as const,
    description: `--wait timeout in seconds (default ${defaultTimeout})`,
    default: defaultTimeout,
  },
});

function parsePositiveInt(raw: string): number | null {
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export const articlesCommand = defineCommand({
  meta: {
    name: 'articles',
    description: 'Article pipeline: inspect state, trigger generation, (re)publish',
  },
  subCommands: {
    list: defineCommand({
      meta: { name: 'list', description: "One row per article with the org's pipeline state" },
      args: {
        ...targetArgs,
        limit: { type: 'string' as const, description: 'Max rows (default 50)', default: '50' },
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const limit = parsePositiveInt(args.limit as string);
          if (limit === null) {
            emitter.result({
              ok: false,
              error: { code: 'BAD_ARGS', message: '--limit must be a positive integer.' },
            });
            return process.exit(EXIT.USER_ERROR);
          }
          const { listArticles } = await import('../lib/articles');
          emitter.step('articles:list', 'start');
          const result = await listArticles({
            org: args.org as string | undefined,
            user: args.user as string | undefined,
            limit,
          });
          emitter.step('articles:list', result.ok ? 'done' : 'fail');
          emitter.result(result);
          process.exit(result.ok ? EXIT.SUCCESS : EXIT.USER_ERROR);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
    show: defineCommand({
      meta: { name: 'show', description: 'Full pipeline detail for one article (pollable)' },
      args: {
        id: { type: 'positional' as const, description: 'Article id', required: true },
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const { showArticle } = await import('../lib/articles');
          emitter.step('articles:show', 'start');
          const result = await showArticle(args.id as string);
          emitter.step('articles:show', result.ok ? 'done' : 'fail');
          emitter.result(result);
          process.exit(result.ok ? EXIT.SUCCESS : EXIT.USER_ERROR);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
    'generate-next': defineCommand({
      meta: {
        name: 'generate-next',
        description:
          "Enqueue generation for the org's next ungenerated planner keyword(s) — the deployed pipeline (generate → images → publish) runs now instead of at the daily cron",
      },
      args: {
        ...targetArgs,
        count: { type: 'string' as const, description: 'Keywords to enqueue (default 1)', default: '1' },
        ...waitArgs('900'),
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const count = parsePositiveInt(args.count as string);
          const timeout = parsePositiveInt(args.timeout as string);
          if (count === null || timeout === null) {
            emitter.result({
              ok: false,
              error: {
                code: 'BAD_ARGS',
                message: '--count and --timeout must be positive integers.',
              },
            });
            return process.exit(EXIT.USER_ERROR);
          }
          const { generateNext } = await import('../lib/articles');
          emitter.warn(
            'Enqueues REAL generation work (LLM + image credits) to whatever GENERATION_QUEUE_URL targets, for the org in whatever MONGO_URI targets.',
          );
          emitter.step('articles:generate-next', 'start');
          const result = await generateNext({
            org: args.org as string | undefined,
            user: args.user as string | undefined,
            count,
            wait: args.wait as boolean,
            timeoutMs: timeout * 1000,
          });
          emitter.step('articles:generate-next', result.ok ? 'done' : 'fail');
          if (result.ok && result.data.wait?.timed_out) {
            emitter.warn(
              `--wait timed out after ${timeout}s — the pipeline may still be running; poll with \`articles show\`.`,
            );
          }
          emitter.result(result);
          process.exit(exitFor(result));
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
    publish: defineCommand({
      meta: {
        name: 'publish',
        description:
          'Reset failed auto-publish attempts and enqueue publishing for an existing article (worker gates are checked up front)',
      },
      args: {
        id: { type: 'positional' as const, description: 'Article id', required: true },
        provider: {
          type: 'string' as const,
          description: 'Only this provider: wordpress or static-site (default: all connected)',
        },
        ...waitArgs('360'),
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const timeout = parsePositiveInt(args.timeout as string);
          if (timeout === null) {
            emitter.result({
              ok: false,
              error: { code: 'BAD_ARGS', message: '--timeout must be a positive integer.' },
            });
            return process.exit(EXIT.USER_ERROR);
          }
          const { publishArticle } = await import('../lib/articles');
          emitter.warn(
            'Publishes to the LIVE destination connected for this org (WordPress site / GitHub repo), via whatever PUBLISH_QUEUE_URL and MONGO_URI target.',
          );
          emitter.step('articles:publish', 'start');
          const result = await publishArticle({
            articleId: args.id as string,
            provider: args.provider as string | undefined,
            wait: args.wait as boolean,
            timeoutMs: timeout * 1000,
          });
          emitter.step('articles:publish', result.ok ? 'done' : 'fail');
          if (result.ok && result.data.wait?.timed_out) {
            emitter.warn(
              `--wait timed out after ${timeout}s — the publish worker may still hold the task; poll with \`articles show\`.`,
            );
          }
          emitter.result(result);
          process.exit(exitFor(result));
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
  },
});
```

- [ ] **Step 4: Register in `apps/cli/src/index.ts`**

```typescript
import { articlesCommand } from './commands/articles';
```

…and in `subCommands`:

```typescript
  subCommands: {
    infra: infraCommand,
    db: dbCommand,
    articles: articlesCommand,
  },
```

Also update the root `meta.description` to `'seo-dev CLI — infra checks, database management, and article pipeline ops'`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- cli-smoke` then `npm test -- articles`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
npm run lint:fix
git add apps/cli/src/commands/articles.ts apps/cli/src/index.ts apps/cli/tests/cli-smoke.test.ts
git commit -m "feat(cli): register articles command group"
```

---

### Task 7: Agent skill + final verification

**Files:**
- Create: `.claude/skills/article-pipeline/SKILL.md` (at the **repo root**, not inside the worktree's `.claude/worktrees` path — from this worktree that is simply `.claude/skills/article-pipeline/SKILL.md`)

**Interfaces:**
- Consumes: the finished CLI (Tasks 1–6). Command names, flags, and error codes in the skill MUST match the implementation exactly — re-check against `apps/cli/src/commands/articles.ts` before committing.
- Produces: the repo's first checked-in project skill.

- [ ] **Step 1: Write `.claude/skills/article-pipeline/SKILL.md`**

```markdown
---
name: article-pipeline
description: Use when testing or debugging article generation/publishing on staging (or against local ElasticMQ) — trigger the pipeline now instead of waiting for the daily 07:00 UTC cron, inspect where an article is stuck, or (re)publish an article, all via the seo-dev CLI.
---

# Article pipeline via the seo-dev CLI

The only automatic trigger for generate → images → publish is the daily
07:00 UTC EventBridge cron. The `articles` CLI group triggers and inspects
that pipeline on demand. The CLI only reads/writes Mongo and enqueues SQS
tasks — the **deployed workers** for the targeted environment do the real
work, so a run exercises the deployed code.

## Setup

1. **Check AWS login first**: `aws sts get-caller-identity`. If it fails,
   `aws sso login` (or fix `AWS_PROFILE`). The CLI also preflights this and
   fails with `AWS_NOT_AUTHENTICATED` before writing anything.
2. Env vars:
   - `MONGO_URI` — comes from the root `.env`. **It usually points at the
     staging database — writes are live.**
   - `GENERATION_QUEUE_URL` / `PUBLISH_QUEUE_URL` — the target env's queue
     URLs; find them with `aws sqs list-queues`. For local dev set
     `SQS_ENDPOINT=http://localhost:9324` and the ElasticMQ queue URLs
     instead.
3. As an agent, always use JSON output, and always through
   `npm run --silent cli` — plain `npm run` prints a banner to stdout that
   corrupts the JSON payload:

   ```bash
   npm run --silent cli -- articles list --user someone@example.com --output json
   ```

## Commands

| Command | What it does |
| --- | --- |
| `articles list --org <id>\|--user <email> [--limit N]` | One row per article: status, images_status, attempt states, published providers |
| `articles show <article-id>` | Full detail: publications, attempt errors, preflight error, planner keyword. Pollable |
| `articles generate-next --org\|--user [--count N] [--wait] [--timeout <sec>]` | Enqueue the next ungenerated planner keyword(s) — runs the whole pipeline now |
| `articles publish <article-id> [--provider wordpress\|static-site] [--wait] [--timeout <sec>]` | Reset failed attempts and enqueue publishing for an existing article |

Typical loop: `generate-next --wait` → read the wait report → `show <id>`
for detail → `publish <id>` if you changed something and want to republish.

`--wait` polls Mongo every 5s and exits 3 (`OP_FAILED`) on timeout or a
terminal failure — the payload always carries the last observed state.
Exit codes: 0 ok, 1 user error (incl. unmet gates), 2 infra/auth down,
3 pipeline failed or timed out, 4 internal.

## Error codes and remediation

| Code | Meaning / fix |
| --- | --- |
| `AWS_NOT_AUTHENTICATED` | AWS creds missing/expired — `aws sso login` |
| `SQS_UNAVAILABLE` | Bad queue URL or network — check the URL / VPN |
| `QUEUE_URL_MISSING` | Set `GENERATION_QUEUE_URL` / `PUBLISH_QUEUE_URL` |
| `NO_KEYWORDS_DUE` | Planner has nothing ungenerated — `db strategy-audit` / `db strategy-run` |
| `IMAGES_INCOMPLETE` | Images not done — `articles show`, maybe `db reset-images --enqueue` |
| `AUTO_PUBLISH_DISABLED` | Org preset off — enable auto-publish in dashboard settings |
| `ORG_NOT_PAID` | `npm run cli -- db set-plan --org <id> --plan paid` |
| `NOT_CONNECTED` | No integration row for the provider — connect it in the dashboard |

The publish worker re-checks all of these gates and **silently drops**
tasks that fail them — which is why the CLI checks first. If an enqueued
task seems to vanish, check `articles show` for the attempt state and
`last_error`.

## Caveats

- Generation spends real LLM + image credits; publish pushes to the org's
  LIVE connected destination (WordPress site / GitHub repo).
- The local `FAL_KEY` is invalid — image steps only work via the deployed
  staging workers, not any local worker.
- An org still on the legacy WordPress token (no `integrations` row) reads
  as `NOT_CONNECTED` here; publishing once from the dashboard migrates it.
```

- [ ] **Step 2: Full verification gate**

Run, from the repo root:

```bash
npm run lint
npm run check:all
npm test
```

Expected: all green. Fix anything that isn't before proceeding.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/article-pipeline/SKILL.md
git commit -m "docs: add article-pipeline agent skill

Part of the article publishing CLI work — see
docs/superpowers/specs/2026-08-22-article-cli-design.md."
```

- [ ] **Step 4: Manual staging verification (operator step — report, don't fake)**

If staging queue URLs + AWS creds are available in the environment, run
`npm run --silent cli -- articles list --user <staging-test-user> --output json`
and report the result. If they are not available, say so explicitly in the
final report — do NOT claim staging verification happened.

---

## Post-plan notes for the executor

- PROGRESS.md: only add a line if a tracked issue exists for this work; the PR body carries the detail (repo convention: one line + `[#N]`, never restated detail).
- PR: open into `dev` per CLAUDE.md branch workflow, body summarizing the four commands, the AWS preflight, the exit-code contract, and the new skill; reference the spec and plan docs.
```
