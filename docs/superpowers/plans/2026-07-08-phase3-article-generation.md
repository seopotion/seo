# Phase 3 — Article Generation (#55) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each due, paid-org planner entry into exactly one validated `generated` article, idempotently, via a daily scheduler that fans out to an SQS generation worker.

**Architecture:** A daily EventBridge rule triggers a scheduler Lambda that finds due `keywords` (`scheduled_date ≤ today`, `article_id` null, non-terminal) and enqueues one `GenerateTask` per keyword to a new SQS generation queue. A generation worker consumes one at a time: it atomically claims the keyword, runs a pure `@shared/generation` pipeline (outline → article → humanization → deterministic + LLM validation), persists a `generated` article, and atomically links `keyword.article_id`. Failures are recorded on the keyword; retries are bounded by SQS `maxReceiveCount` (same day) and a persisted attempt cap (across days).

**Tech Stack:** TypeScript (bundler resolution, `verbatimModuleSyntax`), Zod 4, mongodb 7 driver, Hono/OpenAPI (unchanged here), Vitest 4, AWS CDK (`NodejsFunction`, SQS, EventBridge), OpenRouter LLM client from `@shared/providers`.

## Global Constraints

- `import type` for type-only imports; `export type` when re-exporting types (verbatimModuleSyntax).
- Shared packages export TS source: `exports: { ".": "./src/index.ts" }`; internal deps use `"*"`.
- Biome formatting: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` on new code.
- Repositories own `_id ↔ string id` mapping and `parse` through Zod at the boundary; app code never touches the driver directly.
- `hono/jwt` unaffected. Provider secrets are consumed by the **worker only**, never the API/frontend.
- New Zod entity fields must be optional/defaulted so pre-existing Mongo docs still `.parse()`.
- Gates that must stay green: `npm run lint`, `npm run check:all`, `npm test`; integration via `npm run test:integration` (needs `docker compose up -d mongo`).
- `MAX_GENERATION_ATTEMPTS = 3`; daily cron `0 7 * * *` UTC; deterministic thresholds: word-count floor `800`, `meta_title ≤ 60`, `meta_description` `120–160`, min H2 `2`.

---

## File Structure

**`@shared/schemas`** (modify)
- `src/keyword.ts` — add generation-lifecycle fields + `GENERATION_STATUSES`.
- `src/article.ts` — add `meta_title`.
- `src/scan.ts` — add `GenerateTask` (this file already holds the SQS task contracts).

**`@shared/db`** (modify)
- `src/repositories/keyword.repo.ts` — add `findById`, `claimGeneration`, `failGeneration`, `linkArticle`, `listDueForGeneration`.
- `src/ensure-indexes.ts` — add `keywords` index for the due query.

**`@shared/generation`** (new package — pure, testable; mirrors `@shared/keywords`)
- `package.json`, `src/index.ts`
- `src/config.ts` — thresholds + `MAX_GENERATION_ATTEMPTS` + `HUMANIZE`.
- `src/types.ts` — `GenerationContext`, `Outline`, `GeneratedArticle`, `ValidationFailure`.
- `src/json.ts` — `parseJsonObject` (fence-tolerant JSON parse).
- `src/context.ts` — `buildContext(org, keyword)`.
- `src/outline.ts` — `OutlineSchema`, `buildOutlinePrompt`, `parseOutline`.
- `src/article.ts` — `buildArticlePrompt`.
- `src/humanize.ts` — `buildHumanizePrompt`.
- `src/semantic.ts` — `SemanticResultSchema`, `buildSemanticCheckPrompt`, `parseSemanticResult`.
- `src/validate.ts` — `countWords`, `validateArticle`.
- `src/generate.ts` — `generateArticle` orchestrator.

**`apps/worker`** (modify + new)
- `src/providers.ts` — add `getGenerationClients()`.
- `src/queue.ts` — new; `enqueueGenerateTask()`.
- `src/generation.ts` — new; SQS generation worker handler.
- `src/generation-scheduler.ts` — new; `runScheduler()` + EventBridge `handler`.
- `src/run-scheduler.ts` — new; local one-shot runner.
- `src/dev.ts` — add generation-queue polling.
- `package.json` — add `@shared/generation` dep + `scheduler:local` script.

**`infra`** (modify)
- `lib/api-stack.ts` — generation queue + DLQ, generation worker Lambda, scheduler Lambda, EventBridge rule.

**Local dev config** (modify)
- `elasticmq.conf` — add `generation-queue`.
- `.env.example` — add `GENERATION_QUEUE_URL`.

**Docs** (modify at the end)
- `PROGRESS.md` — flip the #55 line.

---

## Task 1: Schema changes (keyword lifecycle, article meta_title, GenerateTask)

**Files:**
- Modify: `packages/shared/schemas/src/keyword.ts`
- Modify: `packages/shared/schemas/src/article.ts`
- Modify: `packages/shared/schemas/src/scan.ts`
- Test: `packages/shared/schemas/tests/keyword.test.ts` (extend)
- Create test: `packages/shared/schemas/tests/generation-schema.test.ts`

**Interfaces:**
- Produces: `GENERATION_STATUSES` (`readonly ['pending','generating','generated','failed']`); `Keyword` gains `generation_status`, `generation_attempts: number`, `generation_error: string | null`, `generation_started_at: Date | null`. `Article` gains `meta_title: string`. `GenerateTask = { org_id: string; keyword_id: string }` (Zod schema + type) exported from `@shared/schemas`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/schemas/tests/generation-schema.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { GenerateTask, KeywordSchema } from '../src';

describe('generation schema additions', () => {
  test('KeywordSchema defaults generation fields for pre-existing docs', () => {
    const k = KeywordSchema.parse({
      id: 'k1',
      org_id: 'o1',
      keyword: 'seo tips',
      status: 'scheduled',
      scheduled_date: '2026-07-08',
      search_volume: 100,
      difficulty: 10,
      article_id: null,
      created_at: new Date(),
    });
    expect(k.generation_status).toBe('pending');
    expect(k.generation_attempts).toBe(0);
    expect(k.generation_error).toBeNull();
    expect(k.generation_started_at).toBeNull();
  });

  test('GenerateTask parses the queue contract', () => {
    expect(GenerateTask.parse({ org_id: 'o1', keyword_id: 'k1' })).toEqual({
      org_id: 'o1',
      keyword_id: 'k1',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- generation-schema`
Expected: FAIL — `generation_status` undefined / `GenerateTask` is not exported.

- [ ] **Step 3: Implement schema changes**

In `packages/shared/schemas/src/keyword.ts`, add the status list under the existing `KEYWORD_STATUSES` line:

```ts
/** Generation lifecycle for a scheduled keyword (#55). */
export const GENERATION_STATUSES = ['pending', 'generating', 'generated', 'failed'] as const;
```

Then add these fields to `KeywordSchema` immediately after the `created_at: z.date(),` line — i.e. inside the object, before the closing `});`:

```ts
  // Generation lifecycle (#55). Defaulted so pre-#55 planner docs still parse.
  generation_status: z.enum(GENERATION_STATUSES).default('pending'),
  generation_attempts: z.number().int().default(0),
  generation_error: z.string().nullable().default(null),
  generation_started_at: z.date().nullable().default(null),
```

`CreateKeywordInput` already omits only `id`/`normalized_keyword`/`created_at` and uses `z.input`, so the new defaulted fields stay optional for existing callers (the strategy worker) — no change needed there.

In `packages/shared/schemas/src/article.ts`, add `meta_title` to `ArticleSchema` right after the `title: z.string(),` line:

```ts
  // SERP <title>, distinct from `title` (the H1). Added by generation (#55).
  meta_title: z.string(),
```

In `packages/shared/schemas/src/scan.ts`, add at the end of the file:

```ts
/**
 * Generate task message — the contract on the SQS generation queue between the
 * scheduler (producer, apps/worker/src/generation-scheduler.ts) and the
 * generation worker (consumer, apps/worker/src/generation.ts). See #55.
 */
export const GenerateTask = z.object({
  org_id: z.string(),
  keyword_id: z.string(),
});
export type GenerateTask = z.infer<typeof GenerateTask>;
```

- [ ] **Step 4: Update the article repo integration test helper**

In `packages/shared/db/tests/article.repo.integration.test.ts`, add `meta_title` to the `base()` helper object (right after `title: 'T',`):

```ts
  meta_title: 'T meta',
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- generation-schema keyword`
Expected: PASS. Then `npm run check` — Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/schemas/src/keyword.ts packages/shared/schemas/src/article.ts \
  packages/shared/schemas/src/scan.ts packages/shared/schemas/tests/ \
  packages/shared/db/tests/article.repo.integration.test.ts
git commit -m "[schemas] Keyword generation lifecycle + Article meta_title + GenerateTask (#55)"
```

---

## Task 2: KeywordRepo generation methods + due index

**Files:**
- Modify: `packages/shared/db/src/repositories/keyword.repo.ts`
- Modify: `packages/shared/db/src/ensure-indexes.ts`
- Test: `packages/shared/db/tests/keyword.repo.integration.test.ts` (extend)

**Interfaces:**
- Consumes: `Keyword`, `KeywordSchema` (Task 1), `ObjectId` from `mongodb`.
- Produces on `KeywordRepo`:
  - `findById(id: string): Promise<Keyword | null>`
  - `claimGeneration(id: string): Promise<boolean>` — atomic claim; increments `generation_attempts`.
  - `failGeneration(id: string, error: string): Promise<void>`
  - `linkArticle(id: string, articleId: string): Promise<void>` — sets `article_id` + `generation_status: 'generated'`.
  - `listDueForGeneration(today: string, maxAttempts: number): Promise<Keyword[]>`

- [ ] **Step 1: Write the failing integration test**

Append to `packages/shared/db/tests/keyword.repo.integration.test.ts` (inside the existing `describe`):

```ts
  test('claimGeneration is atomic and single-winner; linkArticle links', async () => {
    const k = await KeywordRepo.create({
      org_id: 'org_gen',
      keyword: 'claim me',
      status: 'scheduled',
      scheduled_date: '2026-07-01',
      search_volume: 10,
      difficulty: 1,
      article_id: null,
    });

    const [a, b] = await Promise.all([
      KeywordRepo.claimGeneration(k.id),
      KeywordRepo.claimGeneration(k.id),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1); // exactly one wins

    const claimed = await KeywordRepo.findById(k.id);
    expect(claimed!.generation_status).toBe('generating');
    expect(claimed!.generation_attempts).toBe(1);

    await KeywordRepo.linkArticle(k.id, 'art_gen');
    const linked = await KeywordRepo.findById(k.id);
    expect(linked!.article_id).toBe('art_gen');
    expect(linked!.generation_status).toBe('generated');
  });

  test('failGeneration records the error and status', async () => {
    const k = await KeywordRepo.create({
      org_id: 'org_gen',
      keyword: 'fail me',
      status: 'scheduled',
      scheduled_date: '2026-07-01',
      search_volume: 10,
      difficulty: 1,
      article_id: null,
    });
    await KeywordRepo.claimGeneration(k.id);
    await KeywordRepo.failGeneration(k.id, 'boom');
    const reloaded = await KeywordRepo.findById(k.id);
    expect(reloaded!.generation_status).toBe('failed');
    expect(reloaded!.generation_error).toBe('boom');
  });

  test('listDueForGeneration excludes future, linked, generated, and capped entries', async () => {
    const db = await getDb();
    await db.collection('keywords').deleteMany({ org_id: 'org_due' });
    const mk = (over: Record<string, unknown>) =>
      KeywordRepo.create({
        org_id: 'org_due',
        keyword: `k-${Math.random()}`,
        status: 'scheduled',
        scheduled_date: '2026-07-01',
        search_volume: 10,
        difficulty: 1,
        article_id: null,
        ...over,
      });
    const due = await mk({ scheduled_date: '2026-07-01' });
    await mk({ scheduled_date: '2999-01-01' }); // future
    const linked = await mk({});
    await KeywordRepo.linkArticle(linked.id, 'x'); // linked + generated
    const capped = await mk({});
    await db
      .collection('keywords')
      .updateOne({ _id: (await import('mongodb')).ObjectId.createFromHexString(capped.id) }, {
        $set: { generation_attempts: 3, generation_status: 'failed' },
      });

    const result = await KeywordRepo.listDueForGeneration('2026-07-08', 3);
    const ids = result.map((k) => k.id);
    expect(ids).toContain(due.id);
    expect(ids).not.toContain(linked.id);
    expect(ids).not.toContain(capped.id);
    expect(result.every((k) => k.scheduled_date <= '2026-07-08')).toBe(true);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker compose up -d mongo && npm run test:integration -- keyword.repo`
Expected: FAIL — `claimGeneration`/`findById`/`listDueForGeneration` not functions.

- [ ] **Step 3: Implement the repo methods**

In `packages/shared/db/src/repositories/keyword.repo.ts`, add these methods to the `KeywordRepo` object (after `setArticleId`, before `scheduledNormalizedSet`):

```ts
  async findById(id: string): Promise<Keyword | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await (await collection()).findOne({ _id: new ObjectId(id) });
    return doc ? toEntity(doc) : null;
  },

  /**
   * Atomically claim a keyword for generation. Succeeds only when it is
   * unlinked and not already terminal/in-flight (a 'generating' claim older
   * than 15min is treated as stale and reclaimable). Mirrors OrgRepo.claimStrategy.
   */
  async claimGeneration(id: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
    const res = await (await collection()).updateOne(
      {
        _id: new ObjectId(id),
        article_id: null,
        $or: [
          { generation_status: { $in: ['pending', 'failed'] } },
          { generation_status: { $exists: false } },
          { generation_status: 'generating', generation_started_at: { $lt: staleBefore } },
        ],
      },
      {
        $set: { generation_status: 'generating', generation_started_at: new Date() },
        $inc: { generation_attempts: 1 },
      },
    );
    return res.modifiedCount === 1;
  },

  /** Record a generation failure (retryable until the attempt cap / DLQ). */
  async failGeneration(id: string, error: string): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { generation_status: 'failed', generation_error: error } },
    );
  },

  /** Atomically link the generated article and mark the keyword done. */
  async linkArticle(id: string, articleId: string): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { article_id: articleId, generation_status: 'generated', generation_error: null } },
    );
  },

  /**
   * Due entries across all orgs for the daily scheduler: scheduled on/before
   * `today` (yyyy-mm-dd), not yet linked, not generated, under the attempt cap.
   */
  async listDueForGeneration(today: string, maxAttempts: number): Promise<Keyword[]> {
    const docs = await (await collection())
      .find({
        scheduled_date: { $lte: today },
        article_id: null,
        generation_status: { $ne: 'generated' },
        $or: [
          { generation_attempts: { $lt: maxAttempts } },
          { generation_attempts: { $exists: false } },
        ],
      })
      .toArray();
    return docs.map(toEntity);
  },
```

In `packages/shared/db/src/ensure-indexes.ts`, add after the existing keywords index line:

```ts
  // Scheduler due-query: scheduled_date range + unlinked filter (#55).
  await db.collection('keywords').createIndex({ scheduled_date: 1, article_id: 1 });
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:integration -- keyword.repo`
Expected: PASS (all keyword repo tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/db/src/repositories/keyword.repo.ts \
  packages/shared/db/src/ensure-indexes.ts \
  packages/shared/db/tests/keyword.repo.integration.test.ts
git commit -m "[db] KeywordRepo generation claim/link/fail/listDue + due index (#55)"
```

---

## Task 3: `@shared/generation` package scaffold (config, types, json util)

**Files:**
- Create: `packages/shared/generation/package.json`
- Create: `packages/shared/generation/src/index.ts`
- Create: `packages/shared/generation/src/config.ts`
- Create: `packages/shared/generation/src/types.ts`
- Create: `packages/shared/generation/src/json.ts`
- Test: `packages/shared/generation/tests/json.test.ts`

**Interfaces:**
- Produces: package `@shared/generation`; `config.ts` exports `WORD_COUNT_FLOOR=800`, `META_TITLE_MAX=60`, `META_DESCRIPTION_MIN=120`, `META_DESCRIPTION_MAX=160`, `MIN_H2=2`, `MAX_GENERATION_ATTEMPTS=3`, `HUMANIZE=true`. `types.ts` exports `GenerationContext`, `Outline`, `GeneratedArticle`, `ValidationFailure`. `json.ts` exports `parseJsonObject(text: string): unknown`.

- [ ] **Step 1: Create the package manifest**

`packages/shared/generation/package.json`:

```json
{
  "name": "@shared/generation",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "sideEffects": false,
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@shared/providers": "*",
    "@shared/schemas": "*",
    "zod": "^4.4.3"
  }
}
```

- [ ] **Step 2: Create config and types**

`packages/shared/generation/src/config.ts`:

```ts
/** Generation policy constants (#55). Tunable in one place. */
export const WORD_COUNT_FLOOR = 800;
export const META_TITLE_MAX = 60;
export const META_DESCRIPTION_MIN = 120;
export const META_DESCRIPTION_MAX = 160;
export const MIN_H2 = 2;

/** Max generation attempts before a keyword is terminal (scheduler drops it). */
export const MAX_GENERATION_ATTEMPTS = 3;

/** Whether to run the humanization/readability pass. */
export const HUMANIZE = true;
```

`packages/shared/generation/src/types.ts`:

```ts
export interface GenerationContext {
  businessName: string;
  businessDescription: string;
  language: string;
  country: string;
  audience: string;
  competitors: string[];
  articleStyle: string;
  internalLinks: boolean;
  llmInstructions: string;
  keyword: string;
  articleType: string | null;
  intent: string | null;
  serpCompetitors: string[];
}

export interface Outline {
  h1: string;
  meta_title: string;
  meta_description: string;
  slug: string;
  sections: { heading: string; intent: string }[];
  faqs: { question: string; answer: string }[];
  internal_link_opportunities: string[];
  cta: string;
}

export interface GeneratedArticle {
  title: string;
  meta_title: string;
  meta_description: string;
  slug: string;
  content: string;
  usage: { totalTokens: number; costUsd: number | null };
}

export interface ValidationFailure {
  code: string;
  message: string;
}
```

- [ ] **Step 3: Write the failing json util test**

`packages/shared/generation/tests/json.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { parseJsonObject } from '../src/json';

describe('parseJsonObject', () => {
  test('parses raw JSON', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });
  test('strips a ```json fence', () => {
    expect(parseJsonObject('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });
  test('strips a bare ``` fence', () => {
    expect(parseJsonObject('```\n{"a":3}\n```')).toEqual({ a: 3 });
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm test -- json`
Expected: FAIL — cannot find `../src/json`.

- [ ] **Step 5: Implement json util + index**

`packages/shared/generation/src/json.ts`:

```ts
/** Parse a JSON object from LLM text, tolerating an optional ``` fence wrapper. */
export function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1]! : text);
}
```

`packages/shared/generation/src/index.ts`:

```ts
export { HUMANIZE, MAX_GENERATION_ATTEMPTS } from './config';
export { parseJsonObject } from './json';
export type * from './types';
```

- [ ] **Step 6: Install workspace + run tests**

Run: `npm install` (registers the new workspace), then `npm test -- json`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/generation package-lock.json package.json
git commit -m "[generation] Scaffold @shared/generation (config, types, json util) (#55)"
```

---

## Task 4: Outline schema, prompt, and parse

**Files:**
- Create: `packages/shared/generation/src/outline.ts`
- Modify: `packages/shared/generation/src/index.ts`
- Test: `packages/shared/generation/tests/outline.test.ts`

**Interfaces:**
- Consumes: `GenerationContext`, `Outline` (Task 3); `parseJsonObject` (Task 3); `LlmMessage` from `@shared/providers`.
- Produces: `OutlineSchema` (Zod), `buildOutlinePrompt(ctx: GenerationContext): LlmMessage[]`, `parseOutline(text: string): Outline`.

- [ ] **Step 1: Write the failing test**

`packages/shared/generation/tests/outline.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { buildOutlinePrompt, parseOutline } from '../src/outline';
import type { GenerationContext } from '../src/types';

const ctx: GenerationContext = {
  businessName: 'Acme',
  businessDescription: 'We sell widgets',
  language: 'English',
  country: 'US',
  audience: 'makers',
  competitors: ['rival.com'],
  articleStyle: 'practical',
  internalLinks: true,
  llmInstructions: 'be concise',
  keyword: 'best widgets',
  articleType: 'listicle',
  intent: 'commercial',
  serpCompetitors: ['a.com'],
};

describe('outline', () => {
  test('buildOutlinePrompt includes keyword, language, and JSON instruction', () => {
    const msgs = buildOutlinePrompt(ctx);
    expect(msgs[0]!.role).toBe('system');
    const joined = msgs.map((m) => m.content).join('\n');
    expect(joined).toContain('best widgets');
    expect(joined).toContain('English');
    expect(joined.toLowerCase()).toContain('json');
  });

  test('parseOutline parses fenced JSON and applies defaults', () => {
    const out = parseOutline(
      '```json\n{"h1":"Best Widgets Ranked","meta_title":"t","meta_description":"d","slug":"best-widgets","sections":[{"heading":"H","intent":"i"}]}\n```',
    );
    expect(out.h1).toBe('Best Widgets Ranked');
    expect(out.faqs).toEqual([]);
    expect(out.internal_link_opportunities).toEqual([]);
  });

  test('parseOutline rejects an outline with no sections', () => {
    expect(() => parseOutline('{"h1":"x","meta_title":"t","meta_description":"d","slug":"s","sections":[]}')).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- outline`
Expected: FAIL — cannot find `../src/outline`.

- [ ] **Step 3: Implement outline.ts**

```ts
import type { LlmMessage } from '@shared/providers';
import { z } from 'zod';
import { parseJsonObject } from './json';
import type { GenerationContext, Outline } from './types';

export const OutlineSchema = z.object({
  h1: z.string(),
  meta_title: z.string(),
  meta_description: z.string(),
  slug: z.string(),
  sections: z.array(z.object({ heading: z.string(), intent: z.string() })).min(1),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })).default([]),
  internal_link_opportunities: z.array(z.string()).default([]),
  cta: z.string().default(''),
});

export function buildOutlinePrompt(ctx: GenerationContext): LlmMessage[] {
  const system = [
    'You are an expert SEO content strategist.',
    'Produce a JSON outline for one blog article that can rank for the target keyword.',
    'Respond with ONLY a JSON object of this shape:',
    '{ "h1": string, "meta_title": string, "meta_description": string, "slug": string,',
    '  "sections": [{ "heading": string, "intent": string }],',
    '  "faqs": [{ "question": string, "answer": string }],',
    '  "internal_link_opportunities": string[], "cta": string }',
    'Rules: h1 must NOT be identical to the keyword; meta_title <= 60 chars;',
    'meta_description between 120 and 160 chars; slug is kebab-case; at least 3 sections.',
  ].join('\n');

  const user = [
    `Business: ${ctx.businessName} — ${ctx.businessDescription}`,
    `Audience: ${ctx.audience}`,
    `Language: ${ctx.language} (${ctx.country})`,
    `Target keyword: ${ctx.keyword}`,
    ctx.articleType ? `Article type: ${ctx.articleType}` : '',
    ctx.intent ? `Search intent: ${ctx.intent}` : '',
    ctx.competitors.length
      ? `Competitors to differentiate from (never promote them): ${ctx.competitors.join(', ')}`
      : '',
    ctx.llmInstructions ? `Extra instructions: ${ctx.llmInstructions}` : '',
    `Write all text in ${ctx.language}.`,
  ]
    .filter(Boolean)
    .join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function parseOutline(text: string): Outline {
  return OutlineSchema.parse(parseJsonObject(text));
}
```

Add to `packages/shared/generation/src/index.ts`:

```ts
export { buildOutlinePrompt, OutlineSchema, parseOutline } from './outline';
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- outline` — Expected: PASS. Then `npm run check` — Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/generation/src/outline.ts packages/shared/generation/src/index.ts \
  packages/shared/generation/tests/outline.test.ts
git commit -m "[generation] Outline schema, prompt, and parse (#55)"
```

---

## Task 5: Article + humanization prompt builders

**Files:**
- Create: `packages/shared/generation/src/article.ts`
- Create: `packages/shared/generation/src/humanize.ts`
- Modify: `packages/shared/generation/src/index.ts`
- Test: `packages/shared/generation/tests/prompts.test.ts`

**Interfaces:**
- Consumes: `GenerationContext`, `Outline`; `LlmMessage`.
- Produces: `buildArticlePrompt(ctx: GenerationContext, outline: Outline): LlmMessage[]`, `buildHumanizePrompt(ctx: GenerationContext, markdown: string): LlmMessage[]`.

- [ ] **Step 1: Write the failing test**

`packages/shared/generation/tests/prompts.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { buildArticlePrompt } from '../src/article';
import { buildHumanizePrompt } from '../src/humanize';
import type { GenerationContext, Outline } from '../src/types';

const ctx: GenerationContext = {
  businessName: 'Acme',
  businessDescription: 'widgets',
  language: 'Spanish',
  country: 'ES',
  audience: 'makers',
  competitors: ['rival.com'],
  articleStyle: 'practical',
  internalLinks: true,
  llmInstructions: '',
  keyword: 'mejores widgets',
  articleType: 'listicle',
  intent: 'commercial',
  serpCompetitors: [],
};

const outline: Outline = {
  h1: 'Los Mejores Widgets',
  meta_title: 't',
  meta_description: 'd',
  slug: 's',
  sections: [{ heading: 'Intro', intent: 'i' }],
  faqs: [{ question: '¿Que?', answer: 'a' }],
  internal_link_opportunities: ['guia de widgets'],
  cta: 'Compra ya',
};

describe('article + humanize prompts', () => {
  test('buildArticlePrompt carries language, keyword, headings, markdown instruction', () => {
    const joined = buildArticlePrompt(ctx, outline).map((m) => m.content).join('\n');
    expect(joined).toContain('Spanish');
    expect(joined).toContain('mejores widgets');
    expect(joined).toContain('Intro');
    expect(joined.toLowerCase()).toContain('markdown');
  });

  test('buildHumanizePrompt passes the markdown as the user message', () => {
    const msgs = buildHumanizePrompt(ctx, '# Title\n\nbody');
    expect(msgs.at(-1)!.role).toBe('user');
    expect(msgs.at(-1)!.content).toContain('# Title');
    expect(msgs[0]!.content).toContain('Spanish');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- prompts`
Expected: FAIL — cannot find `../src/article`.

- [ ] **Step 3: Implement article.ts**

```ts
import type { LlmMessage } from '@shared/providers';
import type { GenerationContext, Outline } from './types';

export function buildArticlePrompt(ctx: GenerationContext, outline: Outline): LlmMessage[] {
  const system = [
    'You are an expert long-form SEO writer.',
    'Write a complete, publish-ready blog article in GitHub-flavored Markdown.',
    'Start with a single H1 (# ...), then H2 (## ...) sections following the outline.',
    'Include an engaging introduction before the first H2 and a concluding section.',
    'Use the target keyword naturally; never keyword-stuff.',
    'Do not invent unverifiable facts about the business. Never promote competitors.',
    `Write the entire article in ${ctx.language}.`,
    ctx.internalLinks && outline.internal_link_opportunities.length
      ? 'Where natural, weave in the suggested internal-link topics as descriptive anchor text.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const user = [
    `Target keyword: ${ctx.keyword}`,
    `H1: ${outline.h1}`,
    `Sections: ${outline.sections.map((s) => s.heading).join(' | ')}`,
    outline.faqs.length ? `FAQs to answer: ${outline.faqs.map((f) => f.question).join(' | ')}` : '',
    outline.internal_link_opportunities.length
      ? `Internal-link topics: ${outline.internal_link_opportunities.join(' | ')}`
      : '',
    outline.cta ? `Call to action: ${outline.cta}` : '',
    ctx.articleStyle ? `Style: ${ctx.articleStyle}` : '',
    ctx.llmInstructions ? `Extra instructions: ${ctx.llmInstructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
```

- [ ] **Step 4: Implement humanize.ts**

```ts
import type { LlmMessage } from '@shared/providers';
import type { GenerationContext } from './types';

export function buildHumanizePrompt(ctx: GenerationContext, markdown: string): LlmMessage[] {
  const system = [
    'You are an editor improving readability and natural human tone.',
    'Rewrite the article to read naturally and engagingly while preserving meaning,',
    'the Markdown structure (same headings, same order), all facts, and keyword usage.',
    'Return ONLY the revised Markdown, with no commentary.',
    `Keep it written in ${ctx.language}.`,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: markdown },
  ];
}
```

Add to `packages/shared/generation/src/index.ts`:

```ts
export { buildArticlePrompt } from './article';
export { buildHumanizePrompt } from './humanize';
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- prompts` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/generation/src/article.ts packages/shared/generation/src/humanize.ts \
  packages/shared/generation/src/index.ts packages/shared/generation/tests/prompts.test.ts
git commit -m "[generation] Article + humanization prompt builders (#55)"
```

---

## Task 6: Deterministic validation

**Files:**
- Create: `packages/shared/generation/src/validate.ts`
- Modify: `packages/shared/generation/src/index.ts`
- Test: `packages/shared/generation/tests/validate.test.ts`

**Interfaces:**
- Consumes: config constants (Task 3); `GenerationContext`, `ValidationFailure`; `normalizeKeyword` from `@shared/schemas`.
- Produces: `countWords(md: string): number`; `validateArticle(article: { title: string; meta_title: string; meta_description: string; content: string }, ctx: GenerationContext): ValidationFailure[]`.

- [ ] **Step 1: Write the failing test**

`packages/shared/generation/tests/validate.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import type { GenerationContext } from '../src/types';
import { countWords, validateArticle } from '../src/validate';

const ctx = { keyword: 'best widgets' } as GenerationContext;

const goodBody = `# Best Widgets For Makers\n\n${'An intro paragraph with plenty of words. '.repeat(20)}\n\n## Section One\n\n${'Unique body content number one here. '.repeat(30)}\n\n## Section Two\n\n${'Distinct body content number two here. '.repeat(30)}\n`;

const goodArticle = {
  title: 'Best Widgets For Makers',
  meta_title: 'Best Widgets For Makers in 2026',
  meta_description: 'A'.repeat(140),
  content: goodBody,
};

describe('validateArticle', () => {
  test('a well-formed article has no failures', () => {
    expect(validateArticle(goodArticle, ctx)).toEqual([]);
  });

  test('title identical to keyword fails', () => {
    const codes = validateArticle({ ...goodArticle, title: 'Best Widgets' }, {
      ...ctx,
      keyword: 'best widgets',
    }).map((f) => f.code);
    expect(codes).toContain('title_equals_keyword');
  });

  test('short article fails word_count', () => {
    const codes = validateArticle(
      { ...goodArticle, content: '# Title\n\nintro\n\n## A\n\nshort\n\n## B\n\nalso' },
      ctx,
    ).map((f) => f.code);
    expect(codes).toContain('word_count');
  });

  test('meta length and heading structure fail', () => {
    const codes = validateArticle(
      {
        title: 'X',
        meta_title: 'y'.repeat(70),
        meta_description: 'too short',
        content: `## Only H2\n\n${'body '.repeat(200)}`,
      },
      ctx,
    ).map((f) => f.code);
    expect(codes).toContain('meta_title_length');
    expect(codes).toContain('meta_description_length');
    expect(codes).toContain('h1_count');
    expect(codes).toContain('h2_count');
  });

  test('empty and duplicate sections fail', () => {
    const dup = `# T\n\n${'intro '.repeat(20)}\n\n## A\n\nsame body text repeated exactly here now\n\n## B\n\nsame body text repeated exactly here now\n`;
    const codes = validateArticle({ ...goodArticle, content: dup }, ctx).map((f) => f.code);
    expect(codes).toContain('duplicate_section');
  });

  test('countWords ignores markdown punctuation', () => {
    expect(countWords('# Hello **world**')).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- validate`
Expected: FAIL — cannot find `../src/validate`.

- [ ] **Step 3: Implement validate.ts**

```ts
import { normalizeKeyword } from '@shared/schemas';
import {
  META_DESCRIPTION_MAX,
  META_DESCRIPTION_MIN,
  META_TITLE_MAX,
  MIN_H2,
  WORD_COUNT_FLOOR,
} from './config';
import type { GenerationContext, ValidationFailure } from './types';

export function countWords(md: string): number {
  return md
    .replace(/[#>*_`~\-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Text before the first H2 (the introduction). */
function introText(lines: string[]): string {
  const firstH2 = lines.findIndex((l) => /^##\s+/.test(l));
  const body = (firstH2 === -1 ? lines : lines.slice(0, firstH2)).filter((l) => !/^#\s+/.test(l));
  return body.join('\n').trim();
}

/** Body text of each H2 section (excludes the heading line). */
function sectionBodies(lines: string[]): string[] {
  const bodies: string[] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (current) bodies.push(current.join('\n').trim());
      current = [];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) bodies.push(current.join('\n').trim());
  return bodies;
}

export function validateArticle(
  article: { title: string; meta_title: string; meta_description: string; content: string },
  ctx: GenerationContext,
): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const lines = article.content.split('\n');
  const h1Count = lines.filter((l) => /^#\s+/.test(l)).length;
  const h2Count = lines.filter((l) => /^##\s+/.test(l)).length;

  if (countWords(article.content) < WORD_COUNT_FLOOR)
    failures.push({ code: 'word_count', message: `below ${WORD_COUNT_FLOOR} words` });
  if (normalizeKeyword(article.title) === normalizeKeyword(ctx.keyword))
    failures.push({ code: 'title_equals_keyword', message: 'title is identical to the keyword' });
  if (article.meta_title.length > META_TITLE_MAX)
    failures.push({ code: 'meta_title_length', message: `meta_title > ${META_TITLE_MAX} chars` });
  if (
    article.meta_description.length < META_DESCRIPTION_MIN ||
    article.meta_description.length > META_DESCRIPTION_MAX
  )
    failures.push({
      code: 'meta_description_length',
      message: `meta_description not ${META_DESCRIPTION_MIN}-${META_DESCRIPTION_MAX} chars`,
    });
  if (h1Count !== 1) failures.push({ code: 'h1_count', message: `expected 1 H1, found ${h1Count}` });
  if (h2Count < MIN_H2) failures.push({ code: 'h2_count', message: `fewer than ${MIN_H2} H2 sections` });
  if (introText(lines).length === 0)
    failures.push({ code: 'empty_intro', message: 'missing introduction' });

  const bodies = sectionBodies(lines);
  if (bodies.some((b) => b.length === 0))
    failures.push({ code: 'empty_section', message: 'a section has an empty body' });
  if (new Set(bodies).size !== bodies.length)
    failures.push({ code: 'duplicate_section', message: 'two sections share identical bodies' });

  return failures;
}
```

Add to `packages/shared/generation/src/index.ts`:

```ts
export { countWords, validateArticle } from './validate';
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- validate` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/generation/src/validate.ts packages/shared/generation/src/index.ts \
  packages/shared/generation/tests/validate.test.ts
git commit -m "[generation] Deterministic article validation (#55)"
```

---

## Task 7: LLM semantic check

**Files:**
- Create: `packages/shared/generation/src/semantic.ts`
- Modify: `packages/shared/generation/src/index.ts`
- Test: `packages/shared/generation/tests/semantic.test.ts`

**Interfaces:**
- Consumes: `GenerationContext`; `parseJsonObject`; `LlmMessage`.
- Produces: `SemanticResultSchema` (Zod), `buildSemanticCheckPrompt(ctx: GenerationContext, markdown: string): LlmMessage[]`, `parseSemanticResult(text: string): { pass: boolean; reasons: string[] }`.

- [ ] **Step 1: Write the failing test**

`packages/shared/generation/tests/semantic.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { buildSemanticCheckPrompt, parseSemanticResult } from '../src/semantic';
import type { GenerationContext } from '../src/types';

const ctx = {
  businessName: 'Acme',
  competitors: ['rival.com'],
  keyword: 'best widgets',
  language: 'English',
} as GenerationContext;

describe('semantic check', () => {
  test('prompt names competitors, keyword, language, and the JSON contract', () => {
    const joined = buildSemanticCheckPrompt(ctx, '# Article\n\nbody').map((m) => m.content).join('\n');
    expect(joined).toContain('rival.com');
    expect(joined).toContain('best widgets');
    expect(joined).toContain('English');
    expect(joined).toContain('pass');
  });

  test('parseSemanticResult parses pass/fail with defaulted reasons', () => {
    expect(parseSemanticResult('{"pass":true}')).toEqual({ pass: true, reasons: [] });
    expect(parseSemanticResult('```json\n{"pass":false,"reasons":["promotes rival"]}\n```')).toEqual({
      pass: false,
      reasons: ['promotes rival'],
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- semantic`
Expected: FAIL — cannot find `../src/semantic`.

- [ ] **Step 3: Implement semantic.ts**

```ts
import type { LlmMessage } from '@shared/providers';
import { z } from 'zod';
import { parseJsonObject } from './json';
import type { GenerationContext } from './types';

export const SemanticResultSchema = z.object({
  pass: z.boolean(),
  reasons: z.array(z.string()).default([]),
});

export function buildSemanticCheckPrompt(
  ctx: GenerationContext,
  markdown: string,
): LlmMessage[] {
  const system = [
    'You are a strict content compliance reviewer. Respond with ONLY JSON:',
    '{ "pass": boolean, "reasons": string[] }',
    'Set pass=false if ANY of these are true:',
    '- the article makes unsupported or unverifiable claims about the business;',
    '- it promotes, recommends, or links to a competitor;',
    '- the target keyword is stuffed unnaturally or is entirely absent;',
    `- the article is not written in ${ctx.language}.`,
    'Put one short sentence per problem in reasons. If none, pass=true and reasons=[].',
  ].join('\n');

  const user = [
    `Business: ${ctx.businessName}`,
    ctx.competitors.length ? `Competitors: ${ctx.competitors.join(', ')}` : 'Competitors: (none)',
    `Target keyword: ${ctx.keyword}`,
    `Required language: ${ctx.language}`,
    '--- ARTICLE ---',
    markdown,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function parseSemanticResult(text: string): { pass: boolean; reasons: string[] } {
  return SemanticResultSchema.parse(parseJsonObject(text));
}
```

Add to `packages/shared/generation/src/index.ts`:

```ts
export { buildSemanticCheckPrompt, parseSemanticResult, SemanticResultSchema } from './semantic';
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- semantic` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/generation/src/semantic.ts packages/shared/generation/src/index.ts \
  packages/shared/generation/tests/semantic.test.ts
git commit -m "[generation] LLM semantic compliance check (#55)"
```

---

## Task 8: `generateArticle` orchestrator + `buildContext`

**Files:**
- Create: `packages/shared/generation/src/context.ts`
- Create: `packages/shared/generation/src/generate.ts`
- Modify: `packages/shared/generation/src/index.ts`
- Test: `packages/shared/generation/tests/generate.test.ts`

**Interfaces:**
- Consumes: all Task 4–7 builders/parsers; `HUMANIZE` (Task 3); `LlmClient` from `@shared/providers`; `Org`, `Keyword` from `@shared/schemas`.
- Produces:
  - `buildContext(org: Org, keyword: Keyword): GenerationContext`
  - `generateArticle(params: { ctx: GenerationContext; llm: LlmClient }): Promise<{ ok: true; article: GeneratedArticle } | { ok: false; failures: ValidationFailure[] }>` — throws `ProviderError` (from `llm.complete`) on provider failure; returns `{ ok: false }` on validation failure.

- [ ] **Step 1: Write the failing test**

`packages/shared/generation/tests/generate.test.ts`:

```ts
import type { LlmClient, LlmMessage } from '@shared/providers';
import { describe, expect, test, vi } from 'vitest';
import { generateArticle } from '../src/generate';
import type { GenerationContext } from '../src/types';

const ctx: GenerationContext = {
  businessName: 'Acme',
  businessDescription: 'widgets',
  language: 'English',
  country: 'US',
  audience: 'makers',
  competitors: [],
  articleStyle: 'practical',
  internalLinks: false,
  llmInstructions: '',
  keyword: 'best widgets',
  articleType: 'listicle',
  intent: 'commercial',
  serpCompetitors: [],
};

const outlineJson = JSON.stringify({
  h1: 'Best Widgets For Makers',
  meta_title: 'Best Widgets For Makers 2026',
  meta_description: 'x'.repeat(140),
  slug: 'best-widgets',
  sections: [
    { heading: 'One', intent: 'i' },
    { heading: 'Two', intent: 'i' },
  ],
});

const articleMd = `# Best Widgets For Makers\n\n${'Intro paragraph words here. '.repeat(20)}\n\n## One\n\n${'Body one content unique. '.repeat(30)}\n\n## Two\n\n${'Body two content unique. '.repeat(30)}\n`;

/** Returns an LlmClient whose complete() replies in call order. */
function mockLlm(replies: string[]): LlmClient {
  let i = 0;
  return {
    complete: vi.fn(async (_p: { messages: LlmMessage[] }) => ({
      text: replies[i++]!,
      model: 'test',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0.01 },
    })),
  };
}

describe('generateArticle', () => {
  test('happy path returns a valid article and summed usage', async () => {
    // order: outline, article, humanize, semantic
    const llm = mockLlm([outlineJson, articleMd, articleMd, '{"pass":true,"reasons":[]}']);
    const result = await generateArticle({ ctx, llm });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.article.title).toBe('Best Widgets For Makers');
      expect(result.article.meta_title).toBe('Best Widgets For Makers 2026');
      expect(result.article.usage.totalTokens).toBe(8); // 4 calls x 2
      expect(result.article.usage.costUsd).toBeCloseTo(0.04);
    }
  });

  test('semantic failure returns ok:false with a semantic failure', async () => {
    const llm = mockLlm([outlineJson, articleMd, articleMd, '{"pass":false,"reasons":["promotes rival"]}']);
    const result = await generateArticle({ ctx, llm });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.map((f) => f.code)).toContain('semantic');
  });

  test('deterministic failure (short article) returns ok:false', async () => {
    const shortMd = '# T\n\nintro\n\n## A\n\nshort\n\n## B\n\nalso';
    const llm = mockLlm([outlineJson, shortMd, shortMd, '{"pass":true}']);
    const result = await generateArticle({ ctx, llm });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.map((f) => f.code)).toContain('word_count');
  });

  test('provider error bubbles up', async () => {
    const llm: LlmClient = { complete: vi.fn(async () => { throw new Error('rate limited'); }) };
    await expect(generateArticle({ ctx, llm })).rejects.toThrow('rate limited');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- generate`
Expected: FAIL — cannot find `../src/generate`.

- [ ] **Step 3: Implement context.ts**

```ts
import type { Keyword, Org } from '@shared/schemas';
import type { GenerationContext } from './types';

/** Derive the generation context from the org, its presets, and the keyword brief. */
export function buildContext(org: Org, keyword: Keyword): GenerationContext {
  const p = org.presets;
  if (!p) throw new Error('org has no presets');
  return {
    businessName: p.business.name,
    businessDescription: p.business.description,
    language: p.business.language,
    country: p.business.country,
    audience: p.audience.target,
    competitors: p.audience.competitors,
    articleStyle: p.article_preferences.content_seo.article_style,
    internalLinks: p.article_preferences.content_seo.internal_links,
    llmInstructions: p.article_preferences.content_seo.llm_instructions,
    keyword: keyword.keyword,
    articleType: keyword.article_type ?? null,
    intent: keyword.intent ?? null,
    serpCompetitors: keyword.serp_competitors ?? [],
  };
}
```

- [ ] **Step 4: Implement generate.ts**

```ts
import type { LlmClient, LlmUsage } from '@shared/providers';
import { buildArticlePrompt } from './article';
import { HUMANIZE } from './config';
import { buildHumanizePrompt } from './humanize';
import { buildOutlinePrompt, parseOutline } from './outline';
import { buildSemanticCheckPrompt, parseSemanticResult } from './semantic';
import type { GeneratedArticle, GenerationContext, ValidationFailure } from './types';
import { validateArticle } from './validate';

type Result =
  | { ok: true; article: GeneratedArticle }
  | { ok: false; failures: ValidationFailure[] };

/**
 * Run the full generation pipeline for one keyword: outline -> article ->
 * (optional) humanize -> deterministic + LLM validation. Throws on provider
 * errors (bubbled from llm.complete); returns { ok:false } on validation failure.
 */
export async function generateArticle(params: {
  ctx: GenerationContext;
  llm: LlmClient;
}): Promise<Result> {
  const { ctx, llm } = params;
  let totalTokens = 0;
  let costUsd: number | null = 0;
  const track = (u: LlmUsage) => {
    totalTokens += u.totalTokens;
    costUsd = costUsd === null || u.costUsd === null ? null : costUsd + u.costUsd;
  };

  const outlineRes = await llm.complete({ messages: buildOutlinePrompt(ctx), responseFormat: 'json' });
  track(outlineRes.usage);
  const outline = parseOutline(outlineRes.text);

  const articleRes = await llm.complete({ messages: buildArticlePrompt(ctx, outline) });
  track(articleRes.usage);
  let content = articleRes.text;

  if (HUMANIZE) {
    const humanRes = await llm.complete({ messages: buildHumanizePrompt(ctx, content) });
    track(humanRes.usage);
    content = humanRes.text;
  }

  const failures = validateArticle(
    {
      title: outline.h1,
      meta_title: outline.meta_title,
      meta_description: outline.meta_description,
      content,
    },
    ctx,
  );

  const semRes = await llm.complete({
    messages: buildSemanticCheckPrompt(ctx, content),
    responseFormat: 'json',
  });
  track(semRes.usage);
  const semantic = parseSemanticResult(semRes.text);
  if (!semantic.pass)
    failures.push({ code: 'semantic', message: semantic.reasons.join('; ') || 'semantic check failed' });

  if (failures.length) return { ok: false, failures };

  return {
    ok: true,
    article: {
      title: outline.h1,
      meta_title: outline.meta_title,
      meta_description: outline.meta_description,
      slug: outline.slug,
      content,
      usage: { totalTokens, costUsd },
    },
  };
}
```

Add to `packages/shared/generation/src/index.ts`:

```ts
export { buildContext } from './context';
export { generateArticle } from './generate';
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- generate` — Expected: PASS. Then `npm run check` — Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/generation/src/context.ts packages/shared/generation/src/generate.ts \
  packages/shared/generation/src/index.ts packages/shared/generation/tests/generate.test.ts
git commit -m "[generation] generateArticle orchestrator + buildContext (#55)"
```

---

## Task 9: Worker generation clients + queue producer

**Files:**
- Modify: `apps/worker/src/providers.ts`
- Create: `apps/worker/src/queue.ts`
- Modify: `apps/worker/package.json`

**Interfaces:**
- Consumes: `createOpenRouterClient` from `@shared/providers`; `GenerateTask` from `@shared/schemas`.
- Produces: `getGenerationClients(): { llm: LlmClient }`; `enqueueGenerateTask(task: GenerateTask): Promise<void>`.

- [ ] **Step 1: Add the `@shared/generation` dependency**

In `apps/worker/package.json`, add to `dependencies` (keep alphabetical among `@shared/*`):

```json
    "@shared/generation": "*",
```

Then run `npm install` to link it.

- [ ] **Step 2: Add `getGenerationClients` to providers.ts**

Append to `apps/worker/src/providers.ts`:

```ts
/** Build the LLM client the generation worker needs, from env (#55). */
export function getGenerationClients() {
  return {
    llm: createOpenRouterClient({ apiKey: process.env.OPENROUTER_API_KEY ?? '' }),
  };
}
```

(`createOpenRouterClient` is already imported at the top of the file.)

- [ ] **Step 3: Create the queue producer**

`apps/worker/src/queue.ts`:

```ts
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { GenerateTask } from '@shared/schemas';

// SQS_ENDPOINT points at local ElasticMQ in dev; unset in AWS (SDK uses the role).
const endpoint = process.env.SQS_ENDPOINT;
const sqs = new SQSClient(
  endpoint
    ? {
        endpoint,
        region: 'elasticmq',
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }
    : {},
);

/** Enqueue one article-generation task for the generation worker (#55). */
export async function enqueueGenerateTask(task: GenerateTask): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.GENERATION_QUEUE_URL,
      MessageBody: JSON.stringify(task),
    }),
  );
}
```

- [ ] **Step 4: Verify types compile**

Run: `npm run check`
Expected: no type errors. (No dedicated test — these are thin env/SDK wrappers exercised via Tasks 10–11.)

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/providers.ts apps/worker/src/queue.ts apps/worker/package.json package-lock.json
git commit -m "[worker] Generation LLM client + GenerateTask queue producer (#55)"
```

---

## Task 10: Generation worker handler

**Files:**
- Create: `apps/worker/src/generation.ts`
- Test: `apps/worker/tests/generation.test.ts`

**Interfaces:**
- Consumes: `KeywordRepo.claimGeneration/findById/failGeneration/linkArticle` (Task 2), `OrgRepo.findById`, `ArticleRepo.create`; `buildContext`, `generateArticle` (Task 8); `GenerateTask`, `isPaid` (`@shared/schemas`); `getGenerationClients` (Task 9).
- Produces: `handler: SQSHandler` exported from `apps/worker/src/generation.ts`.

- [ ] **Step 1: Write the failing test**

`apps/worker/tests/generation.test.ts` (mirrors the `strategy.test.ts` mock style):

```ts
import type { SQSEvent } from 'aws-lambda';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  claimGeneration,
  findKeywordById,
  failGeneration,
  linkArticle,
  findOrgById,
  createArticle,
} = vi.hoisted(() => ({
  claimGeneration: vi.fn(async () => true),
  findKeywordById: vi.fn(),
  failGeneration: vi.fn(async () => {}),
  linkArticle: vi.fn(async () => {}),
  findOrgById: vi.fn(),
  createArticle: vi.fn(async () => ({ id: 'art1' })),
}));
vi.mock('@shared/db', () => ({
  KeywordRepo: { claimGeneration, findById: findKeywordById, failGeneration, linkArticle },
  OrgRepo: { findById: findOrgById },
  ArticleRepo: { create: createArticle },
}));

const { generateArticle } = vi.hoisted(() => ({ generateArticle: vi.fn() }));
vi.mock('@shared/generation', async (orig) => ({
  ...(await orig<typeof import('@shared/generation')>()),
  generateArticle,
}));

vi.mock('../src/providers', () => ({ getGenerationClients: () => ({ llm: {} }) }));

import { handler } from '../src/generation';

function event(body: unknown): SQSEvent {
  return {
    Records: [
      {
        messageId: '1',
        receiptHandle: 'rh',
        body: JSON.stringify(body),
        attributes: {} as never,
        messageAttributes: {},
        md5OfBody: '',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn',
        awsRegion: 'us-east-1',
      },
    ],
  };
}

const org = {
  id: 'o1',
  plan: 'paid',
  website_url: 'https://x.com',
  presets: {
    business: { name: 'Acme', language: 'English', country: 'US', description: 'widgets' },
    audience: { target: 'makers', competitors: [] },
    blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
    article_preferences: {
      content_seo: { article_style: 'x', internal_links: false, llm_instructions: '' },
      engagement: { image_style: '' },
    },
  },
};
const keyword = { id: 'k1', org_id: 'o1', keyword: 'best widgets', difficulty: 10, search_volume: 100 };

const okArticle = {
  ok: true,
  article: {
    title: 'Best Widgets For Makers',
    meta_title: 'm',
    meta_description: 'd',
    slug: 's',
    content: '# body',
    usage: { totalTokens: 1, costUsd: 0.01 },
  },
};

describe('generation worker', () => {
  beforeEach(() => vi.clearAllMocks());

  test('claims, generates, persists article, links keyword', async () => {
    findOrgById.mockResolvedValue(org);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(claimGeneration).toHaveBeenCalledWith('k1');
    expect(createArticle).toHaveBeenCalledTimes(1);
    expect(createArticle.mock.calls[0]![0]).toMatchObject({ status: 'generated', featured_image_url: '' });
    expect(linkArticle).toHaveBeenCalledWith('k1', 'art1');
  });

  test('skips when claim fails (already done/in-flight)', async () => {
    claimGeneration.mockResolvedValue(false);
    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});
    expect(findOrgById).not.toHaveBeenCalled();
    expect(createArticle).not.toHaveBeenCalled();
  });

  test('validation failure records failGeneration and does not create an article', async () => {
    findOrgById.mockResolvedValue(org);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue({ ok: false, failures: [{ code: 'word_count', message: 'x' }] });

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(createArticle).not.toHaveBeenCalled();
    expect(failGeneration).toHaveBeenCalledWith('k1', expect.stringContaining('validation'));
  });

  test('non-paid org is skipped and recorded', async () => {
    findOrgById.mockResolvedValue({ ...org, plan: 'free' });
    findKeywordById.mockResolvedValue(keyword);
    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});
    expect(generateArticle).not.toHaveBeenCalled();
    expect(failGeneration).toHaveBeenCalledWith('k1', expect.stringContaining('not paid'));
  });

  test('provider error records failGeneration and rethrows', async () => {
    findOrgById.mockResolvedValue(org);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockRejectedValue(new Error('rate limited'));

    await expect(
      handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {}),
    ).rejects.toThrow('rate limited');
    expect(failGeneration).toHaveBeenCalledWith('k1', 'rate limited');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- generation`
Expected: FAIL — cannot find `../src/generation`.

- [ ] **Step 3: Implement generation.ts**

```ts
import { ArticleRepo, KeywordRepo, OrgRepo } from '@shared/db';
import { buildContext, generateArticle } from '@shared/generation';
import { GenerateTask, isPaid } from '@shared/schemas';
import type { SQSHandler } from 'aws-lambda';
import { logger } from './logger';
import { getGenerationClients } from './providers';

/**
 * Generation worker — triggered by SQS (enqueued by the daily generation
 * scheduler). Atomically claims a due keyword, runs the generation pipeline,
 * persists a `generated` article, and links keyword.article_id. Validation
 * failures are recorded on the keyword (not published); provider errors are
 * recorded and rethrown so SQS redelivers (-> DLQ). See design & epic #56 / #55.
 */
export const handler: SQSHandler = async (event, context): Promise<void> => {
  if (context?.awsRequestId) logger.addContext(context);

  for (const record of event.Records) {
    let keywordId: string | undefined;
    try {
      const task = GenerateTask.parse(JSON.parse(record.body));
      keywordId = task.keyword_id;
      logger.appendKeys({ org_id: task.org_id, keyword_id: keywordId });

      // Atomic claim: only one worker proceeds; already-done/in-flight -> skip.
      if (!(await KeywordRepo.claimGeneration(keywordId))) {
        logger.info('generation skipped: keyword not claimable');
        continue;
      }

      const org = await OrgRepo.findById(task.org_id);
      if (!org?.presets) {
        logger.warn('generation skipped: org or presets missing');
        await KeywordRepo.failGeneration(keywordId, 'org or presets missing');
        continue;
      }
      if (!isPaid(org)) {
        logger.info('generation skipped: org not paid');
        await KeywordRepo.failGeneration(keywordId, 'org not paid');
        continue;
      }

      const keyword = await KeywordRepo.findById(keywordId);
      if (!keyword) {
        logger.warn('generation skipped: keyword missing');
        continue;
      }

      const ctx = buildContext(org, keyword);
      const { llm } = getGenerationClients();
      const result = await generateArticle({ ctx, llm });

      if (!result.ok) {
        const codes = result.failures.map((f) => f.code).join(', ');
        logger.warn('generation validation failed', { failures: result.failures });
        await KeywordRepo.failGeneration(keywordId, `validation: ${codes}`);
        continue;
      }

      const article = await ArticleRepo.create({
        org_id: org.id,
        keyword_id: keyword.id,
        title: result.article.title,
        meta_title: result.article.meta_title,
        slug: result.article.slug,
        keyword: keyword.keyword,
        meta_description: result.article.meta_description,
        featured_image_url: '', // populated by #51
        content: result.article.content,
        difficulty: keyword.difficulty,
        search_volume: keyword.search_volume,
        status: 'generated',
        published_at: null,
      });
      await KeywordRepo.linkArticle(keyword.id, article.id);
      logger.info('article generated', { article_id: article.id });
    } catch (err) {
      // Record the failure, then rethrow so SQS redelivers (-> DLQ after N).
      if (keywordId)
        await KeywordRepo.failGeneration(keywordId, (err as Error).message).catch(() => {});
      logger.error('generation failed', { messageId: record.messageId, error: err as Error });
      throw err;
    } finally {
      logger.removeKeys(['org_id', 'keyword_id']);
    }
  }
};
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- generation` — Expected: PASS (all 5 cases). Then `npm run check` — Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/generation.ts apps/worker/tests/generation.test.ts
git commit -m "[worker] Generation worker: claim, generate, persist, link (#55)"
```

---

## Task 11: Daily scheduler handler + local runner

**Files:**
- Create: `apps/worker/src/generation-scheduler.ts`
- Create: `apps/worker/src/run-scheduler.ts`
- Modify: `apps/worker/package.json`
- Test: `apps/worker/tests/generation-scheduler.test.ts`

**Interfaces:**
- Consumes: `KeywordRepo.listDueForGeneration` (Task 2), `MAX_GENERATION_ATTEMPTS` (Task 3), `enqueueGenerateTask` (Task 9).
- Produces: `runScheduler(): Promise<number>` (returns count enqueued); `handler: ScheduledHandler`.

- [ ] **Step 1: Write the failing test**

`apps/worker/tests/generation-scheduler.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { listDueForGeneration, enqueueGenerateTask } = vi.hoisted(() => ({
  listDueForGeneration: vi.fn(),
  enqueueGenerateTask: vi.fn(async () => {}),
}));
vi.mock('@shared/db', () => ({ KeywordRepo: { listDueForGeneration } }));
vi.mock('../src/queue', () => ({ enqueueGenerateTask }));

import { runScheduler } from '../src/generation-scheduler';

describe('generation scheduler', () => {
  beforeEach(() => vi.clearAllMocks());

  test('enqueues one task per due keyword and returns the count', async () => {
    listDueForGeneration.mockResolvedValue([
      { id: 'k1', org_id: 'o1' },
      { id: 'k2', org_id: 'o2' },
    ]);
    const n = await runScheduler();
    expect(n).toBe(2);
    expect(enqueueGenerateTask).toHaveBeenCalledTimes(2);
    expect(enqueueGenerateTask).toHaveBeenCalledWith({ org_id: 'o1', keyword_id: 'k1' });
    expect(enqueueGenerateTask).toHaveBeenCalledWith({ org_id: 'o2', keyword_id: 'k2' });
  });

  test('passes today (yyyy-mm-dd) and the attempt cap to the repo', async () => {
    listDueForGeneration.mockResolvedValue([]);
    await runScheduler();
    const [today, cap] = listDueForGeneration.mock.calls[0]!;
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cap).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- generation-scheduler`
Expected: FAIL — cannot find `../src/generation-scheduler`.

- [ ] **Step 3: Implement generation-scheduler.ts**

```ts
import { KeywordRepo } from '@shared/db';
import { MAX_GENERATION_ATTEMPTS } from '@shared/generation';
import type { ScheduledHandler } from 'aws-lambda';
import { logger } from './logger';
import { enqueueGenerateTask } from './queue';

/**
 * Find every due, unlinked, non-terminal planner entry (across orgs) and
 * enqueue one generation task each. Returns the number enqueued. The generation
 * worker re-checks paid entitlement, so this stays a simple finder. See #55.
 */
export async function runScheduler(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const due = await KeywordRepo.listDueForGeneration(today, MAX_GENERATION_ATTEMPTS);
  for (const kw of due) {
    await enqueueGenerateTask({ org_id: kw.org_id, keyword_id: kw.id });
  }
  logger.info('generation scheduler enqueued due entries', { count: due.length, today });
  return due.length;
}

/** EventBridge daily trigger. */
export const handler: ScheduledHandler = async (_event, context): Promise<void> => {
  if (context?.awsRequestId) logger.addContext(context);
  await runScheduler();
};
```

- [ ] **Step 4: Implement the local runner + npm script**

`apps/worker/src/run-scheduler.ts`:

```ts
import { runScheduler } from './generation-scheduler';

// Local one-shot: `npm run scheduler:local -w worker` after `docker compose up -d`.
const count = await runScheduler();
console.log(`[scheduler] enqueued ${count} generation task(s)`);
process.exit(0);
```

In `apps/worker/package.json`, add to `scripts`:

```json
    "scheduler:local": "node --env-file-if-exists=../../.env --env-file-if-exists=.env --import tsx src/run-scheduler.ts",
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- generation-scheduler` — Expected: PASS. Then `npm run check` — Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/generation-scheduler.ts apps/worker/src/run-scheduler.ts \
  apps/worker/package.json apps/worker/tests/generation-scheduler.test.ts
git commit -m "[worker] Daily generation scheduler + local runner (#55)"
```

---

## Task 12: Local dev wiring (poller, ElasticMQ queue, env)

**Files:**
- Modify: `apps/worker/src/dev.ts`
- Modify: `elasticmq.conf`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `handler` from `apps/worker/src/generation.ts` (Task 10).
- Produces: local generation-queue polling; a pre-created `generation-queue`; `GENERATION_QUEUE_URL` in the env template.

- [ ] **Step 1: Add generation polling to dev.ts**

In `apps/worker/src/dev.ts`, add the import next to the strategy import:

```ts
import { handler as generationHandler } from './generation';
```

And add, after the `if (strategyUrl) pollers.push(...)` line:

```ts
const generationUrl = process.env.GENERATION_QUEUE_URL;
if (generationUrl) pollers.push(pollQueue('generation', generationUrl, generationHandler));
```

- [ ] **Step 2: Pre-create the local queue**

In `elasticmq.conf`, add `generation-queue {}` inside the `queues { ... }` block, after `strategy-queue {}`:

```
queues {
  scan-queue {}
  strategy-queue {}
  generation-queue {}
}
```

- [ ] **Step 3: Add the env var to the template**

In `.env.example`, add after the `STRATEGY_QUEUE_URL=...` line:

```
GENERATION_QUEUE_URL=http://localhost:9324/000000000000/generation-queue
```

- [ ] **Step 4: Verify the worker still typechecks and boots-shape is valid**

Run: `npm run check`
Expected: no type errors. (Full local round-trip is exercised manually in the verification section; ElasticMQ must be restarted with `docker compose up -d` to pick up the new queue.)

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/dev.ts elasticmq.conf .env.example
git commit -m "[worker] Local dev: poll generation queue + pre-create it + env (#55)"
```

---

## Task 13: Infrastructure (generation queue, worker, scheduler, rule)

**Files:**
- Modify: `infra/lib/api-stack.ts`

**Interfaces:**
- Consumes: worker entries `apps/worker/src/generation.ts` (Task 10) and `apps/worker/src/generation-scheduler.ts` (Task 11).
- Produces: `GenerationQueue`, `GenerationDlq`, `GenerationWorkerFn`, `GenerationSchedulerFn`, and a daily EventBridge `Rule`.

- [ ] **Step 1: Add EventBridge imports**

At the top of `infra/lib/api-stack.ts`, add these imports (after the existing `aws-cdk-lib/aws-apigatewayv2-integrations` import group):

```ts
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
```

- [ ] **Step 2: Add the queue, worker, scheduler, and rule**

In `infra/lib/api-stack.ts`, immediately **after** the `strategyWorkerFn` block (after `mongoUriParam.grantRead(strategyWorkerFn);`), insert:

```ts
    // Dead-letter queue: generation tasks that fail repeatedly land here.
    const generationDlq = new Queue(this, 'GenerationDlq', {
      retentionPeriod: Duration.days(14),
    });

    // Generation task queue. Visibility timeout >= worker timeout so an
    // in-flight message isn't redelivered mid-generation. After maxReceiveCount
    // failed deliveries the message moves to the DLQ.
    const generationQueue = new Queue(this, 'GenerationQueue', {
      visibilityTimeout: Duration.minutes(15),
      deadLetterQueue: { queue: generationDlq, maxReceiveCount: 3 },
    });

    // Generation worker Lambda — consumes generation tasks; produces articles.
    const generationWorkerFn = new NodejsFunction(this, 'GenerationWorkerFn', {
      entry: join(projectRoot, 'apps/worker/src/generation.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.minutes(10),
      memorySize: 512,
      environment: {
        ...mongoEnv,
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
      },
      bundling,
    });
    generationWorkerFn.addEventSource(new SqsEventSource(generationQueue, { batchSize: 1 }));
    mongoUriParam.grantRead(generationWorkerFn);

    // Scheduler Lambda — daily EventBridge trigger; fans out due entries to the
    // generation queue. No provider secret needed (it only reads Mongo + sends SQS).
    const generationSchedulerFn = new NodejsFunction(this, 'GenerationSchedulerFn', {
      entry: join(projectRoot, 'apps/worker/src/generation-scheduler.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.minutes(2),
      memorySize: 256,
      environment: {
        ...mongoEnv,
        GENERATION_QUEUE_URL: generationQueue.queueUrl,
      },
      bundling,
    });
    generationQueue.grantSendMessages(generationSchedulerFn);
    mongoUriParam.grantRead(generationSchedulerFn);

    // Daily at 07:00 UTC — articles generate on/after their scheduled day.
    new Rule(this, 'GenerationSchedule', {
      schedule: Schedule.cron({ minute: '0', hour: '7' }),
      targets: [new LambdaFunction(generationSchedulerFn)],
    });
```

- [ ] **Step 3: Verify the stack synthesizes**

Run:

```bash
cd infra && npm install && npx cdk synth SeoApiStack-staging >/dev/null && cd ..
```

Expected: synth succeeds with no errors (CloudFormation template printed/discarded). If `cdk` is unavailable in the environment, at minimum run `cd infra && npx tsc --noEmit` and expect no type errors.

- [ ] **Step 4: Commit**

```bash
git add infra/lib/api-stack.ts infra/package-lock.json
git commit -m "[infra] Generation queue + worker + daily scheduler rule (#55)"
```

---

## Task 14: Full-suite verification + PROGRESS update

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Run every gate**

```bash
npm run lint
npm run check:all
npm test
docker compose up -d mongo && npm run test:integration
```

Expected: all pass. Fix any failures before continuing.

- [ ] **Step 2: Update PROGRESS.md**

In `PROGRESS.md`, replace the Dashboard bullet that currently reads
`✅ LLM ... provider decision ... worker wiring pending — #55, #51` so it reflects #55 landing. Change it to:

```markdown
- ✅ Article generation (#55) — daily EventBridge scheduler fans out due planner entries to an SQS generation worker (`@shared/generation`: outline → article → humanize → deterministic + LLM validation), persists a `generated` article, and atomically links `keyword.article_id`. Image generation pending — [#51](https://github.com/seopotion/seo/issues/51)
```

Also update the `_Last updated:_` line near the top to today's date with a short note that #55 landed.

- [ ] **Step 3: Commit**

```bash
git add PROGRESS.md
git commit -m "[docs] PROGRESS: article generation (#55) landed"
```

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin faruk/phase3-article-generation
gh pr create --base dev --title "[dashboard] Generate due articles from scheduled planner entries (#55)" \
  --body "$(cat <<'EOF'
Implements Phase 3 article generation (#55) of epic #56.

A daily EventBridge rule triggers a scheduler Lambda that fans out due planner
entries to a new SQS generation worker. The worker atomically claims each
keyword, runs the `@shared/generation` pipeline (outline → article →
humanization → deterministic + LLM validation), persists a `generated` article,
and atomically links `keyword.article_id`. Validation failures are recorded on
the keyword and never published; provider errors are recorded and rethrown so
SQS redelivers (→ DLQ). Retries are bounded by SQS `maxReceiveCount` (same day)
and a persisted attempt cap (across days).

Image generation (#51) and publishing (#53) are out of scope; articles store an
empty `featured_image_url` for now.

Spec: `docs/superpowers/specs/2026-07-08-phase3-article-generation-design.md`
Plan: `docs/superpowers/plans/2026-07-08-phase3-article-generation.md`

Closes #55
Part of #56

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**

- Daily scheduler finds due entries → Task 11 (`runScheduler`) + Task 2 (`listDueForGeneration`) + Task 13 (EventBridge rule). ✓
- Load plan/org/presets/brief → Task 8 (`buildContext`) + Task 10 (worker loads org + keyword). ✓
- Outline + SEO fields → Task 4 (`OutlineSchema`, `buildOutlinePrompt`). ✓
- Full article + humanization → Tasks 5, 8. ✓
- Validation (deterministic + LLM semantic) → Tasks 6, 7, 8. ✓
- Persist `generated` + atomic link → Task 10 + Task 2 (`linkArticle`). ✓
- Idempotent claim/lock → Task 2 (`claimGeneration`) + Task 10. ✓
- Retryable/terminal failure states + attempt metadata → Task 1 (fields), Task 2 (`failGeneration`, attempt cap in `listDueForGeneration`), Task 10 (rethrow vs record), Task 13 (DLQ). ✓
- `auto_publish=false` still stores `generated` → Task 10 always writes `status: 'generated'`; no publish path exists. ✓
- Title distinct from keyword → Task 6 (`title_equals_keyword`). ✓
- Tests: schedule boundaries (Task 2), retries (Task 10 provider-error rethrow), concurrency (Task 2 claim single-winner), validation failures (Tasks 6/8/10). ✓
- Infra secret wiring mirrors strategy worker; SSM deferred → Task 13. ✓
- Local dev poller + queue + env → Task 12. ✓

**2. Placeholder scan:** No `TBD`/`TODO`/"add error handling"/"similar to Task N"; every code step shows complete code. ✓

**3. Type consistency:** `claimGeneration`, `linkArticle`, `failGeneration`, `listDueForGeneration`, `findById` (Task 2) are used with identical names/signatures in Tasks 10–11. `generateArticle` return shape `{ ok, article | failures }` (Task 8) matches its consumer (Task 10). `buildContext(org, keyword)` (Task 8) matches Task 10's call. `enqueueGenerateTask({ org_id, keyword_id })` (Task 9) matches Tasks 10-schema (`GenerateTask`) and Task 11. `GeneratedArticle` fields (`title/meta_title/meta_description/slug/content/usage`) map onto `ArticleRepo.create` input in Task 10. ✓

**Deviation from spec (recorded):** the "output language matches presets language" check runs in the **LLM semantic pass** (Task 7), not the deterministic set (Task 6), to avoid adding a language-detection dependency. The spec was updated to match.
