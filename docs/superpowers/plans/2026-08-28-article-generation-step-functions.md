# Article Generation on Step Functions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SQS generation+images workers with a per-keyword Step Functions state machine (checkpointed in a new `article_runs` collection, redrivable, per-stage retries) and add a readability gate that loops the humanize stage with feedback until the Flesch-Kincaid target is met or a cap is hit.

**Architecture:** Mirrors the strategy rearchitect (see `docs/superpowers/specs/2026-08-13-strategy-rearchitect-design.md` and `packages/shared/strategy/`): a single stage-router Lambda invoked by one Task state per stage, Mongo-checkpointed run docs with fenced writes, typed retryable/fatal errors, no Catch states (redrive-friendly), EventBridge failure stamping, and a local in-process runner for dev/CLI parity. New vs. strategy: a Choice state loops `humanize` until the stage reports `readability_ok`. Publish stays on SQS untouched.

**Spec:** `docs/superpowers/specs/2026-08-28-article-generation-step-functions-design.md`. One deliberate amendment (approved rationale: keep the daily scheduler from relaunching a permanently failing keyword forever): **`generation_attempts` / `MAX_GENERATION_ATTEMPTS` / `claimGeneration` are KEPT**, but the attempt counter now counts *launches* (one per day/admin click) instead of SQS deliveries. `KeywordRepo` is almost untouched; only the stale-claim window widens from 15 min to 2 h (longer than the 1 h machine timeout). Task 13 records this amendment in the spec file.

**Tech Stack:** TypeScript 6, zod 4, mongodb 7 driver via `@shared/db` repos, Vitest 4, AWS CDK (`infra/` standalone package), `@aws-sdk/client-sfn`, Biome.

## Global Constraints

- Branch: work happens on the current branch `claude/article-generation-step-functions-0b991c`; PR targets `dev`.
- Run `npm run lint`, `npm run check:all`, `npm test` before claiming any task done; `npm run lint:fix` to format new code.
- `verbatimModuleSyntax`: use `import type` / `export type` for type-only imports/re-exports.
- Biome: single quotes, 2-space indent, 100-char width.
- Shared packages export TS source: `"exports": { ".": "./src/index.ts" }`; internal deps use `"*"`.
- Repositories own `_id` ↔ `id` mapping and Zod-parse at the boundary; app code never touches the driver.
- Never connect/close Mongo in a handler (module-scope cached client).
- Vitest: `vi.mock` externals/`@shared/db` (auto-hoisted), `vi.hoisted` for spies.
- Pre-alpha: no backward-compat shims; deleting the old queue path outright is fine.
- Infra changes (`infra/`) are synth-checked only (`cd infra && npm install && npx tsc --noEmit`) — root checks don't cover it.
- Commit after every task with a `Part of` reference in the final PR body (no issue number exists for this work; reference the spec path in commit bodies instead).

## File Structure (end state)

```
packages/shared/schemas/src/article-run.ts        NEW  ARTICLE_STAGES, ArticleRunSchema, CreateArticleRunInput
packages/shared/schemas/src/article.ts            MOD  + ArticleReadabilitySchema, readability field
packages/shared/schemas/src/scan.ts               MOD  - GenerateTask, - ImageTask
packages/shared/db/src/repositories/article-run.repo.ts  NEW
packages/shared/db/src/ensure-indexes.ts          MOD  + article_runs indexes
packages/shared/db/src/repositories/keyword.repo.ts MOD  stale window 15min -> 2h (claimGeneration)
packages/shared/generation/src/humanize.ts        MOD  + feedback param
packages/shared/generation/src/outline.ts         (no change; export added in index)
packages/shared/generation/src/index.ts           MOD  + OUTLINE_RESPONSE_SCHEMA, SEMANTIC_RESPONSE_SCHEMA exports; - generateArticle
packages/shared/generation/src/context.ts         MOD  org: Pick<Org, 'presets'>
packages/shared/generation/src/generate.ts        DEL  (stages replace it)
packages/shared/generation/tests/generate.test.ts DEL  (stage tests replace it)
packages/shared/articles/                         NEW PACKAGE @shared/articles
  package.json
  src/index.ts
  src/errors.ts                                   ArticleRetryableError/FatalError/toArticleError
  src/clients.ts                                  getArticleStageClients (llm+youtube+image)
  src/sqs.ts                                      enqueuePublishTask (moved pattern from worker queue.ts)
  src/storage.ts                                  MOVED from apps/worker/src/storage.ts
  src/run.ts                                      executeArticleStage, runLocalArticleRun, markArticleRunFailed
  src/launch.ts                                   launchGeneration, launchImageRepair, createArticleRun
  src/context.ts                                  contextFromRun
  src/stages/prepare.ts                           guards + resolveLinkCandidates (moved from worker generation.ts)
  src/stages/outline.ts
  src/stages/draft.ts
  src/stages/humanize.ts                          readability gate decision
  src/stages/finalize.ts                          sanitize/validate/semantic/video/create article
  src/stages/images.ts                            images_plan + images_render (moved from worker images.ts)
  src/stages/handoff.ts                           handoff_publish (moved from worker images.ts)
  tests/errors.test.ts, tests/launch.test.ts, tests/run.test.ts,
  tests/humanize-stage.test.ts, tests/finalize-stage.test.ts, tests/storage.test.ts
apps/worker/src/article-run.ts                    NEW  Lambda adapter (stage + failure events)
apps/worker/src/generation.ts                     DEL
apps/worker/src/images.ts                         DEL
apps/worker/src/queue.ts                          DEL
apps/worker/src/storage.ts                        DEL (moved)
apps/worker/src/generation-scheduler.ts           MOD  launches executions
apps/worker/src/dev.ts                            MOD  drop generation/images pollers
apps/worker/src/providers.ts                      MOD  drop getGenerationClients/getImageClients
apps/worker/tests/generation.test.ts              DEL
apps/worker/tests/images.test.ts                  DEL
apps/worker/tests/storage.test.ts                 DEL (moved)
apps/worker/tests/generation-scheduler.test.ts    MOD
apps/worker/tests/providers.test.ts               MOD
apps/api/src/clients/sqs.ts                       MOD  - enqueueGenerateTask, - enqueueImageTask
apps/api/src/admin/routes/planner.ts              MOD  launchGeneration
apps/api/src/admin/routes/articles.ts             MOD  launchImageRepair
apps/cli/src/lib/articles.ts                      MOD  generate-next via launchGeneration
infra/lib/api-stack.ts                            MOD  ArticleStateMachine + ArticleStageFn; delete gen/images queues+workers
.env.example                                      MOD  queue urls -> note about local in-process runs
PROGRESS.md, CLAUDE.md, spec                      MOD  (Task 13)
```

---

### Task 1: Schemas — `article_runs` + article `readability`

**Files:**
- Create: `packages/shared/schemas/src/article-run.ts`
- Modify: `packages/shared/schemas/src/article.ts` (ArticleSchema, after the `video` field)
- Modify: `packages/shared/schemas/src/index.ts` (add export line)
- Test: `packages/shared/schemas/tests/article-run.test.ts` (create; check `packages/shared/schemas/tests/` exists — if the package has no tests dir, put it there anyway, Vitest picks up `tests/**` via the root config)

**Interfaces (Produces):**
- `ARTICLE_STAGES: readonly ['prepare','outline','draft','humanize','finalize','images_plan','images_render','handoff_publish']`, `ArticleStageName`
- `ArticleRunSchema` / `ArticleRun`, `CreateArticleRunInput` (z.input type), `HumanizeAttemptSchema` / `HumanizeAttempt`, `ArticleRunWorking` (type of `ArticleRun['working']`)
- `ArticleReadabilitySchema` / `ArticleReadability`; `ArticleSchema` gains `readability: ArticleReadabilitySchema.nullable().default(null)`
- Reuses `StageStateSchema` / `StageState` from `./strategy-run`

- [ ] **Step 1: Write the failing test**

`packages/shared/schemas/tests/article-run.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ARTICLE_STAGES, ArticleRunSchema } from '../src/article-run';
import { ArticleSchema } from '../src/article';

const presets = {
  /* copy a minimal valid SetupPresets literal from an existing test —
     `git grep -l "SetupPresetsSchema.parse\|presets: {" packages/shared/schemas/tests apps/worker/tests`
     and reuse the fixture (apps/worker/tests/generation.test.ts has one). */
};
const keyword = {
  id: 'k1', org_id: 'o1', candidate_id: null, keyword: 'best socks', status: 'scheduled',
  scheduled_date: '2026-08-28', search_volume: 100, difficulty: 10, article_id: null,
  created_at: new Date(),
};

describe('ArticleRunSchema', () => {
  it('parses a fresh run with defaulted stages and working state', () => {
    const run = ArticleRunSchema.parse({
      id: 'r1', org_id: 'o1', keyword_id: 'k1', status: 'running',
      input: { website_url: 'https://x.test', presets, keyword },
      created_at: new Date(), updated_at: new Date(),
    });
    expect(run.stages).toEqual({});
    expect(run.working).toEqual({
      link_candidates: [], outline: null, draft: null, humanize_attempts: [],
      content: null, readability_grade: null, article_id: null,
    });
  });

  it('orders stages prepare..handoff_publish', () => {
    expect(ARTICLE_STAGES).toEqual([
      'prepare', 'outline', 'draft', 'humanize', 'finalize',
      'images_plan', 'images_render', 'handoff_publish',
    ]);
  });
});

describe('ArticleSchema.readability', () => {
  it('defaults to null and accepts a stamped object', () => {
    /* Parse an existing minimal article fixture (copy from apps/worker/tests/images.test.ts
       or apps/api tests) once without readability (expect null) and once with
       { metric: 'flesch_kincaid_grade', grade: 7.2, target: 8, target_met: true, attempts: 2 }. */
  });
});
```

Fill the two fixture comments with real literals copied from the named existing tests (they exist today; do not invent shapes).

- [ ] **Step 2: Run to verify it fails** — `npm test -- article-run` → FAIL (module not found).

- [ ] **Step 3: Implement**

`packages/shared/schemas/src/article-run.ts`:

```ts
import { z } from 'zod';
import { TOPIC_ROLES } from './candidate';
import { KeywordSchema } from './keyword';
import { SetupPresetsSchema } from './presets';
import { StageStateSchema } from './strategy-run';

/** Stage order of the article-generation state machine. */
export const ARTICLE_STAGES = [
  'prepare',
  'outline',
  'draft',
  'humanize',
  'finalize',
  'images_plan',
  'images_render',
  'handoff_publish',
] as const;
export type ArticleStageName = (typeof ARTICLE_STAGES)[number];

export const ARTICLE_RUN_STATUSES = ['running', 'completed', 'failed'] as const;

/** Snapshot of @shared/generation's LinkCandidate (schemas cannot import generation). */
const LinkCandidateSnapshotSchema = z.object({
  title: z.string(),
  url: z.string(),
  topic_cluster_id: z.string().nullable(),
  topic_role: z.enum(TOPIC_ROLES).nullable(),
});

/** Snapshot of @shared/generation's Outline (same rationale as LinkCandidateSnapshot). */
const OutlineSnapshotSchema = z.object({
  h1: z.string(),
  meta_title: z.string(),
  meta_description: z.string(),
  slug: z.string(),
  sections: z.array(z.object({ heading: z.string(), intent: z.string() })),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })).default([]),
  internal_links: z.array(z.string()).default([]),
  cta: z.string().default(''),
});

export const HumanizeAttemptSchema = z.object({
  attempt: z.number().int(),
  /** Flesch-Kincaid grade of this attempt's content; null = unmeasurable or non-English. */
  grade: z.number().nullable(),
  content: z.string(),
});
export type HumanizeAttempt = z.infer<typeof HumanizeAttemptSchema>;

/**
 * One article-generation run — the checkpoint document the state machine
 * executes over. Each stage reads `working`, does its one expensive thing, and
 * writes its result back; a retried or redriven stage resumes from exactly what
 * the previous stage persisted. See the 2026-08-28 design spec.
 */
export const ArticleRunSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  keyword_id: z.string(),
  status: z.enum(ARTICLE_RUN_STATUSES),
  input: z.object({
    website_url: z.string(),
    presets: SetupPresetsSchema,
    /** Keyword snapshot at launch; the live doc may move on (article_id etc). */
    keyword: KeywordSchema,
  }),
  stages: z.partialRecord(z.enum(ARTICLE_STAGES), StageStateSchema).default({}),
  working: z
    .object({
      link_candidates: z.array(LinkCandidateSnapshotSchema).default([]),
      outline: OutlineSnapshotSchema.nullable().default(null),
      draft: z.string().nullable().default(null),
      humanize_attempts: z.array(HumanizeAttemptSchema).default([]),
      /** The chosen (readability-approved or best-of-cap) humanized content. */
      content: z.string().nullable().default(null),
      /** FK grade of `content`; what finalize stamps onto the article. */
      readability_grade: z.number().nullable().default(null),
      /** Set by finalize once the article doc exists; images stages key off it. */
      article_id: z.string().nullable().default(null),
    })
    .default({
      link_candidates: [],
      outline: null,
      draft: null,
      humanize_attempts: [],
      content: null,
      readability_grade: null,
      article_id: null,
    }),
  created_at: z.date(),
  updated_at: z.date(),
});
export type ArticleRun = z.infer<typeof ArticleRunSchema>;
export type ArticleRunWorking = ArticleRun['working'];

export const CreateArticleRunInput = ArticleRunSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type CreateArticleRunInput = z.input<typeof CreateArticleRunInput>;
```

In `packages/shared/schemas/src/article.ts`, above `ArticleSchema`:

```ts
/** Readability measured at generation time (#readability gate, 2026-08-28 spec). */
export const ArticleReadabilitySchema = z.object({
  metric: z.literal('flesch_kincaid_grade'),
  grade: z.number().nullable(),
  target: z.number(),
  target_met: z.boolean(),
  /** Humanize passes consumed (1 = passed first try). */
  attempts: z.number().int(),
});
export type ArticleReadability = z.infer<typeof ArticleReadabilitySchema>;
```

and inside `ArticleSchema`, after the `video` field:

```ts
  // Readability gate result (2026-08-28 spec). Defaulted so older docs parse.
  readability: ArticleReadabilitySchema.nullable().default(null),
```

`CreateArticleInput` needs no change (it only omits server-assigned fields, so `readability` flows through as optional-with-default).

In `packages/shared/schemas/src/index.ts`, add (matching the file's existing export style — inspect it first):

```ts
export * from './article-run';
```

(If the index uses named exports instead of `export *`, list: `ARTICLE_STAGES`, `ARTICLE_RUN_STATUSES`, `ArticleRunSchema`, `CreateArticleRunInput`, `HumanizeAttemptSchema` and the types `ArticleStageName`, `ArticleRun`, `ArticleRunWorking`, `HumanizeAttempt`, `ArticleReadability`, plus `ArticleReadabilitySchema` from `./article`.)

- [ ] **Step 4: Run tests** — `npm test -- article-run` → PASS; `npm run check:all` clean.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(schemas): article_runs checkpoint schema + article readability field"`

---

### Task 2: `ArticleRunRepo` + indexes

**Files:**
- Create: `packages/shared/db/src/repositories/article-run.repo.ts`
- Modify: `packages/shared/db/src/index.ts` (export repo — match how `StrategyRunRepo` is exported there)
- Modify: `packages/shared/db/src/ensure-indexes.ts` (append two indexes)
- Modify: `apps/cli/src/lib/db.ts` — in the `delete-org` purge, alongside the existing `StrategyRunRepo.deleteByOrgId(orgId)` call, add `ArticleRunRepo.deleteByOrgId(orgId)` and include its count in the same result shape (find the call with `grep -n deleteByOrgId apps/cli/src/lib/db.ts`)
- Test: mirror the existing strategy-run repo test if one exists (`git grep -ln "strategy_runs\|StrategyRunRepo" -- '*test*'`); if only integration tests cover repos, add `article_runs` cases next to the strategy ones in the same file; if nothing covers StrategyRunRepo, skip dedicated repo tests (the run.ts tests in Task 9 exercise the repo through mocks).

**Interfaces (Produces):**

```ts
export const ArticleRunRepo: {
  create(input: CreateArticleRunInput): Promise<ArticleRun>;
  findById(id: string): Promise<ArticleRun | null>;
  /** Fenced completed-stage checkpoint: flattens `working` patch to dot-paths. */
  saveStageResult(id: string, stage: ArticleStageName, working: Partial<ArticleRunWorking>, meta: StageState): Promise<void>;
  /** Unfenced working patch for a NOT-completed humanize attempt. */
  patchWorking(id: string, working: Partial<ArticleRunWorking>): Promise<void>;
  markStageFailed(id: string, stage: ArticleStageName, meta: StageState): Promise<void>;
  setStatus(id: string, status: ArticleRun['status']): Promise<void>;
  deleteByOrgId(orgId: string): Promise<number>;
};
```

- [ ] **Step 1: Implement the repo** (copy the structure of `packages/shared/db/src/repositories/strategy-run.repo.ts` — the fenced-write comment included — with these differences):

```ts
import {
  type ArticleRun,
  ArticleRunSchema,
  type ArticleRunWorking,
  type ArticleStageName,
  type CreateArticleRunInput,
  CreateArticleRunInput as CreateArticleRunInputSchema,
  type StageState,
} from '@shared/schemas';
import { ObjectId } from 'mongodb';
import { getDb } from '../client';

const COLLECTION = 'article_runs';

type ArticleRunDoc = Omit<ArticleRun, 'id'> & { _id: ObjectId };

function toRun(doc: ArticleRunDoc): ArticleRun {
  const { _id, ...rest } = doc;
  return ArticleRunSchema.parse({ ...rest, id: _id.toHexString() });
}

/** `working` patch -> dot-path $set so untouched working fields survive. */
function workingSet(working: Partial<ArticleRunWorking>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(working).map(([key, value]) => [`working.${key}`, value]),
  );
}

export const ArticleRunRepo = {
  async create(input: CreateArticleRunInput): Promise<ArticleRun> {
    const db = await getDb();
    const now = new Date();
    const data = CreateArticleRunInputSchema.parse(input);
    const { insertedId } = await db
      .collection<Omit<ArticleRunDoc, '_id'>>(COLLECTION)
      .insertOne({ ...data, created_at: now, updated_at: now });
    return toRun({ ...data, created_at: now, updated_at: now, _id: insertedId });
  },

  async findById(id: string): Promise<ArticleRun | null> {
    if (!ObjectId.isValid(id)) return null;
    const db = await getDb();
    const doc = await db.collection<ArticleRunDoc>(COLLECTION).findOne({ _id: new ObjectId(id) });
    return doc ? toRun(doc) : null;
  },

  async saveStageResult(
    id: string,
    stage: ArticleStageName,
    working: Partial<ArticleRunWorking>,
    meta: StageState,
  ): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const db = await getDb();
    await db.collection<ArticleRunDoc>(COLLECTION).updateOne(
      // Fenced (same rationale as StrategyRunRepo.saveStageResult): once a
      // stage is completed, a zombie Lambda's late write is rejected.
      { _id: new ObjectId(id), [`stages.${stage}.status`]: { $ne: 'completed' } },
      { $set: { ...workingSet(working), [`stages.${stage}`]: meta, updated_at: new Date() } },
    );
  },

  async patchWorking(id: string, working: Partial<ArticleRunWorking>): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const db = await getDb();
    await db
      .collection<ArticleRunDoc>(COLLECTION)
      .updateOne(
        { _id: new ObjectId(id) },
        { $set: { ...workingSet(working), updated_at: new Date() } },
      );
  },

  async markStageFailed(id: string, stage: ArticleStageName, meta: StageState): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const db = await getDb();
    await db
      .collection<ArticleRunDoc>(COLLECTION)
      .updateOne(
        { _id: new ObjectId(id) },
        { $set: { [`stages.${stage}`]: meta, updated_at: new Date() } },
      );
  },

  async setStatus(id: string, status: ArticleRun['status']): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const db = await getDb();
    await db
      .collection<ArticleRunDoc>(COLLECTION)
      .updateOne({ _id: new ObjectId(id) }, { $set: { status, updated_at: new Date() } });
  },

  /** Every run for the org (used by the `db delete-org` CLI). */
  async deleteByOrgId(orgId: string): Promise<number> {
    const db = await getDb();
    const res = await db.collection<ArticleRunDoc>(COLLECTION).deleteMany({ org_id: orgId });
    return res.deletedCount;
  },
};
```

- [ ] **Step 2: Indexes** — in `ensure-indexes.ts`, next to the strategy_runs index (find with `grep -n strategy_runs`; if none exists, append at the end before the function closes):

```ts
  await db.collection('article_runs').createIndex({ org_id: 1, created_at: -1 });
  await db.collection('article_runs').createIndex({ keyword_id: 1, created_at: -1 });
```

- [ ] **Step 3: Export + CLI purge wiring** (see Files above). Run `npm test -- delete` (or the db CLI test filter) to catch the changed purge result shape; update the CLI test fixture if it asserts the purge counts object.
- [ ] **Step 4: Verify** — `npm run check:all` and `npm test` pass. If the strategy repo has integration coverage, run `docker compose up -d mongo && npm run test:integration`.
- [ ] **Step 5: Commit** — `git commit -m "feat(db): ArticleRunRepo with fenced stage checkpoints"`

---

### Task 3: `@shared/generation` — humanize feedback + exports + context loosening

**Files:**
- Modify: `packages/shared/generation/src/humanize.ts`
- Modify: `packages/shared/generation/src/context.ts:8-12`
- Modify: `packages/shared/generation/src/index.ts`
- Test: `packages/shared/generation/tests/prompts.test.ts` (append cases — this file already tests `buildHumanizePrompt`; check with `grep -n buildHumanizePrompt packages/shared/generation/tests/prompts.test.ts`, otherwise add to a new `humanize.test.ts`)

**Interfaces (Produces):**
- `buildHumanizePrompt(ctx, markdown, feedback?: HumanizeFeedback)` where `export interface HumanizeFeedback { attempt: number; grade: number; target: number }`
- `buildContext(org: Pick<Org, 'presets'>, keyword: Keyword, linkCandidates?: LinkCandidate[])` (signature loosened; all existing callers still compile)
- index re-exports `OUTLINE_RESPONSE_SCHEMA` (from `./outline`) and `SEMANTIC_RESPONSE_SCHEMA` (from `./semantic`)

- [ ] **Step 1: Failing test** (append to the prompts test):

```ts
it('humanize retry prompt carries the readability feedback', () => {
  const messages = buildHumanizePrompt(ctx, '# Draft', { attempt: 1, grade: 11.2, target: 8 });
  const system = messages[0]!.content;
  expect(system).toContain('11.2');
  expect(system).toContain('grade level 8');
  expect(system).toContain('previous attempt');
});

it('humanize prompt without feedback is unchanged', () => {
  const system = buildHumanizePrompt(ctx, '# Draft')[0]!.content;
  expect(system).not.toContain('previous attempt');
});
```

(`ctx` = the existing English-language context fixture in that test file.)

- [ ] **Step 2: Run** — `npm test -- prompts` → FAIL (arity/content).
- [ ] **Step 3: Implement** — in `humanize.ts`:

```ts
export interface HumanizeFeedback {
  attempt: number;
  grade: number;
  target: number;
}

export function buildHumanizePrompt(
  ctx: GenerationContext,
  markdown: string,
  feedback?: HumanizeFeedback,
): LlmMessage[] {
```

and append one more entry to the `system` array (after the existing Flesch-Kincaid line, before `.filter(Boolean)`):

```ts
    feedback
      ? `Your previous attempt (attempt ${feedback.attempt}) scored Flesch-Kincaid grade level ${feedback.grade}, above the target of grade level ${feedback.target}. Simplify further: shorter sentences, fewer syllables per word, one idea per sentence — without dropping facts, keywords, or meaning.`
      : '',
```

In `context.ts`, change the signature to `org: Pick<Org, 'presets'>` (body unchanged — it only reads `org.presets`). In `index.ts`, extend the outline export line to `export { buildOutlinePrompt, OUTLINE_RESPONSE_SCHEMA, OutlineSchema, parseOutline } from './outline';` and the semantic line to include `SEMANTIC_RESPONSE_SCHEMA`; export `type { HumanizeFeedback }` next to `buildHumanizePrompt`.

- [ ] **Step 4: Run** — `npm test -- prompts` PASS; `npm run check:all` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(generation): humanize feedback prompt + stage-building exports"`

---

### Task 4: `@shared/articles` package scaffold (errors, clients, sqs, storage)

**Files:**
- Create: `packages/shared/articles/package.json`, `src/index.ts`, `src/errors.ts`, `src/clients.ts`, `src/sqs.ts`
- Move: `apps/worker/src/storage.ts` → `packages/shared/articles/src/storage.ts` (git mv; keep content identical)
- Move: `apps/worker/tests/storage.test.ts` → `packages/shared/articles/tests/storage.test.ts` (fix its import path to `../src/storage`)
- Test: `packages/shared/articles/tests/errors.test.ts`

**Interfaces (Produces):**
- `ArticleRetryableError`, `ArticleFatalError`, `toArticleError(err: unknown)` — exact analogues of `packages/shared/strategy/src/errors.ts` (`name` fields `'ArticleRetryableError'` / `'ArticleFatalError'`; unknown errors default retryable; explicit `retryable: false` → fatal)
- `getArticleStageClients(): Promise<{ llm: LlmClient; youtube: YouTubeClient; image: ImageClient }>` and `type ArticleStageClients = Awaited<ReturnType<typeof getArticleStageClients>>` (use the concrete client types `@shared/providers` exports — check its index for the exact names, e.g. what `createYouTubeClient`/`createFalClient` return)
- `enqueuePublishTask(task: PublishTask): Promise<void>` — same body as the current `apps/worker/src/queue.ts` publish function including the ElasticMQ `SQS_ENDPOINT` client setup
- `storeImage(...)` — unchanged signature from the moved file

- [ ] **Step 1: package.json** (copy `@aws-sdk` version strings from `apps/worker/package.json` / `packages/shared/strategy/package.json` — do not guess):

```json
{
  "name": "@shared/articles",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "sideEffects": false,
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@aws-sdk/client-s3": "<copy from apps/worker/package.json>",
    "@aws-sdk/client-sfn": "<copy from packages/shared/strategy/package.json>",
    "@aws-sdk/client-sqs": "<copy from apps/worker/package.json>",
    "@shared/db": "*",
    "@shared/generation": "*",
    "@shared/providers": "*",
    "@shared/schemas": "*"
  }
}
```

Run `npm install` at the root so the workspace links (confirm the root `package.json` `workspaces` glob covers `packages/shared/*` — it does for the existing shared packages).

- [ ] **Step 2: Failing test** — `tests/errors.test.ts`: copy `packages/shared/strategy/tests/errors.test.ts` wholesale, rename Strategy→Article throughout (class names, import path `../src/errors`).
- [ ] **Step 3: Implement `errors.ts`** — copy `packages/shared/strategy/src/errors.ts`, rename `Strategy`→`Article` in class names, `name` strings, function name, and doc comments.
- [ ] **Step 4: Implement `clients.ts`** (merge of worker `getGenerationClients` + `getImageClients`):

```ts
import {
  createFalClient,
  createOpenRouterClient,
  createYouTubeClient,
  resolveProviderSecret,
} from '@shared/providers';

/** Same runtime-secret pattern as apps/worker/src/providers.ts (SSM param when
 * deployed, plain env var locally; Powertools caches ~1h). */
export async function getArticleStageClients() {
  const [apiKey, youtubeKey, falKey] = await Promise.all([
    resolveProviderSecret('OPENROUTER_API_KEY'),
    resolveProviderSecret('YOUTUBE_API_KEY'),
    resolveProviderSecret('FAL_KEY'),
  ]);
  return {
    llm: createOpenRouterClient({ apiKey }),
    youtube: createYouTubeClient({ apiKey: youtubeKey }),
    image: createFalClient({ apiKey: falKey }),
  };
}
export type ArticleStageClients = Awaited<ReturnType<typeof getArticleStageClients>>;
```

- [ ] **Step 5: Implement `sqs.ts`** — copy the SQS client setup block and `enqueuePublishTask` from `apps/worker/src/queue.ts` verbatim (leave the worker file alone for now; it dies in Task 10).
- [ ] **Step 6: Move storage** — `git mv apps/worker/src/storage.ts packages/shared/articles/src/storage.ts && git mv apps/worker/tests/storage.test.ts packages/shared/articles/tests/storage.test.ts`; fix the test's import. `apps/worker/src/images.ts` still imports `./storage` — repoint that one import to `@shared/articles` (add `"@shared/articles": "*"` to `apps/worker/package.json` dependencies now; the worker keeps this dep for the adapter in Task 10).
- [ ] **Step 7: `index.ts`**:

```ts
export { getArticleStageClients } from './clients';
export type { ArticleStageClients } from './clients';
export { ArticleFatalError, ArticleRetryableError, toArticleError } from './errors';
export { enqueuePublishTask } from './sqs';
export { storeImage } from './storage';
```

- [ ] **Step 8: Verify** — `npm test -- errors` and `npm test -- storage` PASS; `npm run check:all` clean.
- [ ] **Step 9: Commit** — `git commit -m "feat(articles): @shared/articles scaffold — errors, clients, sqs, storage"`

---

### Task 5: Stages — prepare, outline, draft (+ contextFromRun)

**Files:**
- Create: `packages/shared/articles/src/context.ts`, `src/stages/prepare.ts`, `src/stages/outline.ts`, `src/stages/draft.ts`
- Test: `packages/shared/articles/tests/early-stages.test.ts`

**Interfaces:**
- Consumes: `ArticleRun`/`ArticleRunWorking` (Task 1), `buildContext(Pick<Org,'presets'>, …)` + `OUTLINE_RESPONSE_SCHEMA`/`parseOutline`/`buildArticlePrompt`/`buildOutlinePrompt` (Task 3), `ArticleFatalError` (Task 4)
- Produces (used by Task 9's dispatcher):

```ts
export interface StageOutcome {
  working: Partial<ArticleRunWorking>;
  /** false only for a humanize attempt that must loop. */
  completed: boolean;
  output?: { readability_ok: boolean };
}
export function contextFromRun(run: ArticleRun): GenerationContext;
export function stagePrepare(run: ArticleRun): Promise<StageOutcome>;
export function stageOutline(run: ArticleRun, llm: LlmClient): Promise<StageOutcome>;
export function stageDraft(run: ArticleRun, llm: LlmClient): Promise<StageOutcome>;
```

Define `StageOutcome` in `src/stages/types.ts` (created here, imported by every stage file and by run.ts).

- [ ] **Step 1: Failing tests** — `tests/early-stages.test.ts`. Mock `@shared/db` with `vi.mock` (the prepare stage uses `OrgRepo.findById`, `IntegrationRepo.listByOrgId`, `ArticleRepo.listPublishedByTopicCluster`, `ArticleRepo.listByOrg`) and mock `@shared/generation`'s `verifyCandidates` to pass candidates through (`vi.mock('@shared/generation', async (importOriginal) => ({ ...(await importOriginal()), verifyCandidates: vi.fn(async (c) => c) }))`). Reuse the org/keyword/presets fixtures from `apps/worker/tests/generation.test.ts` (copy them into a local `tests/fixtures.ts`). Cases:
  1. `stagePrepare` throws `ArticleFatalError` when the org is missing, when presets are null, and when `isPaid(org)` is false.
  2. `stagePrepare` resolves link candidates and returns `{ completed: true, working: { link_candidates } }` (assert shape, not the full resolution matrix — that logic is moved code already covered by the deleted worker test's fixtures; port the "org with published articles yields candidates" case).
  3. `stageOutline` calls `llm.complete` with `responseSchema: OUTLINE_RESPONSE_SCHEMA`, parses, and returns `{ completed: true, working: { outline } }` (stub llm returning a valid outline JSON string — copy the outline fixture from `packages/shared/generation/tests/generate.test.ts` before that file is deleted).
  4. `stageDraft` throws `ArticleFatalError` when `working.outline` is null; returns `{ completed: true, working: { draft: '<llm text>' } }` otherwise.
- [ ] **Step 2: Run** — `npm test -- early-stages` → FAIL.
- [ ] **Step 3: Implement.**

`src/context.ts`:

```ts
import { buildContext } from '@shared/generation';
import type { GenerationContext } from '@shared/generation';
import type { ArticleRun } from '@shared/schemas';

/** Rebuild the generation context from the run's launch snapshot. */
export function contextFromRun(run: ArticleRun): GenerationContext {
  return buildContext(
    { presets: run.input.presets },
    run.input.keyword,
    run.working.link_candidates,
  );
}
```

`src/stages/prepare.ts`: move `resolveLinkCandidates` from `apps/worker/src/generation.ts:44-123` (leave the worker copy; it dies in Task 10) with these changes: signature `resolveLinkCandidates(orgId: string, presets: SetupPresets, keyword: Keyword)` (it used `org.id` and `org.presets` only); replace the two `logger.warn`/`logger.info` calls with `console.warn`/`console.info` carrying the same message + JSON payload (shared packages don't import the worker's Powertools logger — same convention as `@shared/strategy`, which logs nothing; keep these two because #228 relies on the signal). Then:

```ts
export async function stagePrepare(run: ArticleRun): Promise<StageOutcome> {
  const org = await OrgRepo.findById(run.org_id);
  if (!org?.presets) throw new ArticleFatalError(`org ${run.org_id} missing or has no presets`);
  if (!isPaid(org)) throw new ArticleFatalError('org not paid');
  const link_candidates = await resolveLinkCandidates(org.id, org.presets, run.input.keyword);
  return { completed: true, working: { link_candidates } };
}
```

`src/stages/outline.ts`:

```ts
export async function stageOutline(run: ArticleRun, llm: LlmClient): Promise<StageOutcome> {
  const ctx = contextFromRun(run);
  const res = await llm.complete({
    messages: buildOutlinePrompt(ctx),
    responseSchema: OUTLINE_RESPONSE_SCHEMA,
  });
  const outline = parseOutline(res.text, ctx);
  return { completed: true, working: { outline } };
}
```

`src/stages/draft.ts`:

```ts
export async function stageDraft(run: ArticleRun, llm: LlmClient): Promise<StageOutcome> {
  const outline = run.working.outline;
  if (!outline) throw new ArticleFatalError('draft stage requires a checkpointed outline');
  const ctx = contextFromRun(run);
  const res = await llm.complete({ messages: buildArticlePrompt(ctx, outline) });
  return { completed: true, working: { draft: res.text } };
}
```

(`parseOutline` can throw — e.g. missing CTA; that propagates and Task 9's dispatcher classifies it via `toArticleError` → retryable, which is correct: a re-sampled outline may pass.)

- [ ] **Step 4: Run** — `npm test -- early-stages` PASS; `npm run check:all`.
- [ ] **Step 5: Commit** — `git commit -m "feat(articles): prepare/outline/draft stages"`

---

### Task 6: Humanize stage — the readability gate

**Files:**
- Create: `packages/shared/articles/src/stages/humanize.ts`
- Test: `packages/shared/articles/tests/humanize-stage.test.ts`

**Interfaces:**
- Consumes: `buildHumanizePrompt(ctx, markdown, feedback?)` (Task 3), `fleschKincaidGrade`, `FLESCH_KINCAID_TARGET`, `HUMANIZE` from `@shared/generation`; `HumanizeAttempt` (Task 1)
- Produces: `stageHumanize(run: ArticleRun, llm: LlmClient): Promise<StageOutcome>` and `export const READABILITY_MAX_PASSES = 3;` — outcome always carries `output: { readability_ok: boolean }`; when `completed: true`, `working` includes `content`, `readability_grade`, and the full `humanize_attempts`; when `completed: false`, `working` is `{ humanize_attempts }` only.

Decision table (this IS the feature — test every row):

| language | grade of new attempt | attempts after this one | completed | readability_ok | chosen content |
|---|---|---|---|---|---|
| English | ≤ 8 | any | true | true | this attempt |
| English | null (unmeasurable) | any | true | true | this attempt |
| English | > 8 | < 3 | false | false | — |
| English | > 8 | = 3 (cap) | true | true | lowest-grade attempt |
| non-English | not measured (null) | 1 | true | true | this attempt |
| any, `HUMANIZE === false` | not measured | 0 (no LLM call) | true | true | the draft verbatim |

- [ ] **Step 1: Failing tests** covering each row above, plus: retry passes `feedback` built from the previous attempt (`{ attempt: prev.attempt, grade: prev.grade, target: FLESCH_KINCAID_TARGET }`) and rewrites the *previous attempt's content*, not the original draft; and cap-selection picks the minimum grade among all attempts. Drive grades deterministically by stubbing the llm to return fixed strings and mocking `fleschKincaidGrade` via the partial-module mock pattern from Task 5 (`vi.mock('@shared/generation', …)` overriding just `fleschKincaidGrade`), mapping content → grade.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement:**

```ts
import {
  buildHumanizePrompt,
  FLESCH_KINCAID_TARGET,
  fleschKincaidGrade,
  HUMANIZE,
} from '@shared/generation';
import type { LlmClient } from '@shared/providers';
import type { ArticleRun, HumanizeAttempt } from '@shared/schemas';
import { ArticleFatalError } from '../errors';
import { contextFromRun } from '../context';
import type { StageOutcome } from './types';

/** Initial humanize pass + up to 2 readability retries (2026-08-28 spec). */
export const READABILITY_MAX_PASSES = 3;

const passes = (grade: number | null) => grade === null || grade <= FLESCH_KINCAID_TARGET;

/** Lowest measured grade wins; a passing (null) grade would have exited earlier. */
function bestAttempt(attempts: HumanizeAttempt[]): HumanizeAttempt {
  return attempts.reduce((best, a) =>
    (a.grade ?? Number.NEGATIVE_INFINITY) < (best.grade ?? Number.NEGATIVE_INFINITY) ? a : best,
  );
}

export async function stageHumanize(run: ArticleRun, llm: LlmClient): Promise<StageOutcome> {
  const draft = run.working.draft;
  if (draft === null) throw new ArticleFatalError('humanize stage requires a checkpointed draft');
  const ctx = contextFromRun(run);

  if (!HUMANIZE) {
    return {
      completed: true,
      working: { content: draft, readability_grade: null, humanize_attempts: [] },
      output: { readability_ok: true },
    };
  }

  const prior = run.working.humanize_attempts;
  const previous = prior.at(-1);
  const input = previous?.content ?? draft;
  const feedback =
    previous && previous.grade !== null
      ? { attempt: previous.attempt, grade: previous.grade, target: FLESCH_KINCAID_TARGET }
      : undefined;

  const res = await llm.complete({ messages: buildHumanizePrompt(ctx, input, feedback) });
  const grade = ctx.language === 'English' ? fleschKincaidGrade(res.text) : null;
  const attempt: HumanizeAttempt = { attempt: prior.length + 1, grade, content: res.text };
  const attempts = [...prior, attempt];

  if (passes(grade)) {
    return {
      completed: true,
      working: { content: attempt.content, readability_grade: grade, humanize_attempts: attempts },
      output: { readability_ok: true },
    };
  }
  if (attempts.length >= READABILITY_MAX_PASSES) {
    const best = bestAttempt(attempts);
    return {
      completed: true,
      working: {
        content: best.content,
        readability_grade: best.grade,
        humanize_attempts: attempts,
      },
      output: { readability_ok: true }, // proceed anyway (spec: cap behavior)
    };
  }
  return { completed: false, working: { humanize_attempts: attempts }, output: { readability_ok: false } };
}
```

- [ ] **Step 4: Run** — `npm test -- humanize-stage` PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(articles): humanize stage with readability gate + feedback loop"`

---

### Task 7: Finalize stage

**Files:**
- Create: `packages/shared/articles/src/stages/finalize.ts`
- Test: `packages/shared/articles/tests/finalize-stage.test.ts`

**Interfaces:**
- Consumes: `sanitizeLinks`, `validateArticle`, `buildSemanticCheckPrompt`, `parseSemanticResult`, `SEMANTIC_RESPONSE_SCHEMA`, video helpers (`extractH2s`, `buildVideoPickPrompt`, `parseVideoPick`, `buildVideoEmbed`, `injectBlockAfterHeading`, `languageCodeFromName`, `VIDEO_PICK_RESPONSE_SCHEMA`), `FLESCH_KINCAID_TARGET` — all `@shared/generation`; `ArticleRepo.create`, `KeywordRepo.linkArticle`; `ArticleStageClients` (llm + youtube)
- Produces: `stageFinalize(run: ArticleRun, clients: Pick<ArticleStageClients, 'llm' | 'youtube'>): Promise<StageOutcome>` — `working: { article_id }` on success.

Behavior = `apps/worker/src/generation.ts:159-248` from the sanitize step onward, restructured:

1. Guard: `working.outline` and `working.content` non-null, else `ArticleFatalError`.
2. **Redrive guard:** if `working.article_id` is already set, return `{ completed: true, working: { article_id: run.working.article_id } }` immediately (a crash between article-create and checkpoint must not create a second article).
3. `content = sanitizeLinks(working.content, outline.internal_links, ctx.maxInternalLinks)`.
4. `validateArticle` + semantic LLM call exactly as `packages/shared/generation/src/generate.ts:57-81` (that file is deleted in Task 10 — port the code, including the failure-accumulation). On any failures: `throw new ArticleFatalError('validation: ' + failures.map((f) => f.code).join(', '))` (parity with the old permanent `failGeneration`).
5. Video step: port `apps/worker/src/generation.ts:186-225` verbatim (still best-effort try/catch; `console.warn` instead of `logger.warn`), gated on `run.input.presets.article_preferences.engagement.youtube_videos`.
6. Readability stamp:

```ts
const readability = {
  metric: 'flesch_kincaid_grade' as const,
  grade: run.working.readability_grade,
  target: FLESCH_KINCAID_TARGET,
  target_met:
    run.working.readability_grade === null ||
    run.working.readability_grade <= FLESCH_KINCAID_TARGET,
  attempts: run.working.humanize_attempts.length,
};
```

7. `ArticleRepo.create({...})` with the exact field list from `apps/worker/src/generation.ts:227-247` — sourcing `title`/`meta_title`/`slug`/`meta_description` from `outline` (`outline.h1` → `title`), `keyword`/topic fields/difficulty/search_volume from `run.input.keyword`, plus `readability`. Then `KeywordRepo.linkArticle(run.input.keyword.id, article.id)`.
8. Return `{ completed: true, working: { article_id: article.id } }`.

- [ ] **Step 1: Failing tests** — mock `@shared/db` (`ArticleRepo.create` spy returning `{ id: 'a1', ... }`, `KeywordRepo.linkArticle` spy) and stub llm/youtube. Cases: (a) happy path creates the article with the readability object and links the keyword; (b) semantic failure → `ArticleFatalError` with `validation: semantic`, no article created; (c) redrive guard: `working.article_id` set → no `ArticleRepo.create` call; (d) video failure swallowed (youtube throws → article still created with `video: null`); (e) cap-missed run stamps `target_met: false`. Port fixture data from `apps/worker/tests/generation.test.ts`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** per above. **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(articles): finalize stage — validate, video, persist, readability stamp"`

---### Task 8: Images + handoff stages (moves from the images worker)

**Files:**
- Create: `packages/shared/articles/src/stages/images.ts`, `src/stages/handoff.ts`
- Test: `packages/shared/articles/tests/images-stages.test.ts` (port the relevant cases from `apps/worker/tests/images.test.ts`; that file is deleted in Task 10)

**Interfaces:**
- Produces:

```ts
export function stageImagesPlan(run: ArticleRun, llm: LlmClient): Promise<StageOutcome>;
export function stageImagesRender(run: ArticleRun, image: ArticleStageClients['image']): Promise<StageOutcome>;
export function stageHandoffPublish(run: ArticleRun): Promise<StageOutcome>;
```

All three resolve the article via `run.working.article_id` (`ArticleFatalError` if null or article not found) and return `{ completed: true, working: {} }`.

- [ ] **Step 1: Move the logic.** `stageImagesPlan` = `apps/worker/src/images.ts:147-203` (skip-if-`images.length > 0`, plan LLM call, `parseImagePlan` — on parse failure keep the `ArticleRepo.failImages` + rethrow, `setImagePlan`), with org presets read from `run.input.presets` instead of an `OrgRepo` fetch. `stageImagesRender` = `images.ts:205-291` (the slot loop, byte-cap logging via `console`, CAS `fillImageSlot`, loser-adopts-winner, `completeImages`); if `article.images.length === 0` when render runs, throw `ArticleRetryableError('image plan missing')` (plan stage checkpoint lost — retry re-enters after plan). If `article.images_status === 'complete'`, short-circuit to `{ completed: true, working: {} }`. `stageHandoffPublish` = `handoffToPublishing` from `images.ts:79-126` moved wholesale — same guards (article/org/`images_status`/auto_publish preset), same WordPress-mirror bridge; its api-lib imports become relative: `../../../../../apps/api/src/lib/crypto`, `.../publishing-errors`, `.../secrets` (this cross-boundary import already has precedent — `apps/worker/src/images.ts:12-14` does exactly this today; the root tsc pass covers it). `enqueuePublishTask` now comes from `../sqs` (Task 4). Constants `IMAGE_MODEL`, `SLOT_SIZE`, `SLOT_BYTE_CAP`, `EXT_BY_TYPE`, `slotKeyBase`, `assertImageDimensions` move into `stages/images.ts` with their comments.
- [ ] **Step 2: Port tests** from `apps/worker/tests/images.test.ts` — keep at minimum: plan is set-if-absent (second call with `images.length > 0` makes no LLM call); render resumes at first unfilled slot; render loser-adopts-winner path; invalid dimensions throw; handoff enqueues one task per provider and records the preflight error when no integrations exist. Rewire mocks from SQS-handler-shaped invocations to direct stage calls on a run fixture with `working.article_id` set.
- [ ] **Step 3: Run** — `npm test -- images-stages` PASS; `npm run check:all` clean (the worker's `images.ts` still exists and compiles — untouched apart from Task 4's storage repoint).
- [ ] **Step 4: Commit** — `git commit -m "feat(articles): images_plan/images_render/handoff_publish stages"`

---

### Task 9: run.ts (dispatcher) + launch.ts

**Files:**
- Create: `packages/shared/articles/src/run.ts`, `src/launch.ts`
- Modify: `packages/shared/articles/src/index.ts` (export everything below)
- Modify: `packages/shared/db/src/repositories/keyword.repo.ts:137` — stale-claim window `15 * 60 * 1000` → `2 * 60 * 60 * 1000`, comment updated to say it must exceed the state machine's 1 h timeout
- Test: `packages/shared/articles/tests/run.test.ts`, `tests/launch.test.ts` (model both on `packages/shared/strategy/tests/run.test.ts` / `launch.test.ts`)

**Interfaces (Produces):**

```ts
export type StageResult = { readability_ok: boolean } | undefined;
export function executeArticleStage(runId: string, stage: ArticleStageName, clients: ArticleStageClients): Promise<StageResult>;
export function runLocalArticleRun(runId: string, clients?: ArticleStageClients): Promise<void>;
export function markArticleRunFailed(runId: string): Promise<void>;
export function createArticleRun(orgId: string, keywordId: string): Promise<ArticleRun>;
export function launchGeneration(orgId: string, keywordId: string, opts?: { wait?: boolean }): Promise<{ run_id: string } | null>;
export function launchImageRepair(orgId: string, articleId: string, opts?: { wait?: boolean }): Promise<{ run_id: string }>;
```

- [ ] **Step 1: Failing tests.**

`run.test.ts` (mock `@shared/db`'s `ArticleRunRepo` + `KeywordRepo`, and mock every `./stages/*` module):
  1. run not found → `ArticleFatalError`.
  2. run `status: 'completed'` → returns `{ readability_ok: true }` for `humanize`, `undefined` for `outline`; no stage fn called.
  3. stage already `completed` in `run.stages` → same short-circuit.
  4. completed outcome → `ArticleRunRepo.saveStageResult` called with the stage's working patch and `{ status: 'completed', … }` meta.
  5. humanize `completed: false` outcome → `patchWorking` called (NOT `saveStageResult`), returns `{ readability_ok: false }`.
  6. stage throws provider error with `retryable: false` → `markStageFailed` called, `ArticleFatalError` rethrown; generic Error → `ArticleRetryableError` rethrown.
  7. `handoff_publish` completed → `setStatus(runId, 'completed')`.
  8. `runLocalArticleRun` with a humanize stub failing readability twice then passing → humanize executed 3 times, all 8 stages completed in order.
  9. `markArticleRunFailed` → `KeywordRepo.failGeneration(keyword_id, <error from the failed stage meta, falling back to 'execution failed'>)` + `setStatus(runId, 'failed')`.

`launch.test.ts` (mock `@shared/db`, `@aws-sdk/client-sfn` as in the strategy launch test, and `./run`):
  1. claim lost (`claimGeneration` → false) → returns `null`, no run created.
  2. `createArticleRun` propagates a missing-presets `ArticleFatalError` AND `failGeneration` is called to release the claim.
  3. `ARTICLE_STATE_MACHINE_ARN` set → `StartExecution` with `name: 'article-<run.id>'`, input `{ run_id, org_id }`.
  4. no ARN + `wait: true` → `runLocalArticleRun` awaited; no ARN default → fire-and-forget (`.catch` attached).
  5. `launchImageRepair` creates a run whose `stages` pre-complete `prepare|outline|draft|humanize|finalize` and whose `working.article_id` is the article id; throws `ArticleFatalError` on article/org mismatch or missing keyword.

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.**

`run.ts`:

```ts
import { ArticleRunRepo, KeywordRepo } from '@shared/db';
import { ARTICLE_STAGES, type ArticleRun, type ArticleStageName } from '@shared/schemas';
import { type ArticleStageClients, getArticleStageClients } from './clients';
import { ArticleFatalError, toArticleError } from './errors';
import { stageDraft } from './stages/draft';
import { stageFinalize } from './stages/finalize';
import { stageHandoffPublish } from './stages/handoff';
import { stageHumanize } from './stages/humanize';
import { stageImagesPlan, stageImagesRender } from './stages/images';
import { stageOutline } from './stages/outline';
import { stagePrepare } from './stages/prepare';
import type { StageOutcome } from './stages/types';

export type StageResult = { readability_ok: boolean } | undefined;

const SHORT_CIRCUIT: Record<ArticleStageName, StageResult> = {
  prepare: undefined, outline: undefined, draft: undefined,
  humanize: { readability_ok: true },
  finalize: undefined, images_plan: undefined, images_render: undefined, handoff_publish: undefined,
};

function dispatch(run: ArticleRun, stage: ArticleStageName, clients: ArticleStageClients): Promise<StageOutcome> {
  switch (stage) {
    case 'prepare': return stagePrepare(run);
    case 'outline': return stageOutline(run, clients.llm);
    case 'draft': return stageDraft(run, clients.llm);
    case 'humanize': return stageHumanize(run, clients.llm);
    case 'finalize': return stageFinalize(run, clients);
    case 'images_plan': return stageImagesPlan(run, clients.llm);
    case 'images_render': return stageImagesRender(run, clients.image);
    case 'handoff_publish': return stageHandoffPublish(run);
  }
}

/**
 * Execute one stage against the run's checkpointed state. Idempotent against
 * SFN double-fire/redrive (completed stages short-circuit). A humanize attempt
 * that misses the readability target persists its attempt WITHOUT completing
 * the stage and returns readability_ok: false — the Choice state loops it.
 */
export async function executeArticleStage(
  runId: string,
  stage: ArticleStageName,
  clients: ArticleStageClients,
): Promise<StageResult> {
  const run = await ArticleRunRepo.findById(runId);
  if (run === null) throw new ArticleFatalError(`article run ${runId} not found`);
  if (run.status === 'completed' || run.stages[stage]?.status === 'completed') {
    return SHORT_CIRCUIT[stage];
  }
  const started = new Date();
  try {
    const outcome = await dispatch(run, stage, clients);
    if (outcome.completed) {
      await ArticleRunRepo.saveStageResult(runId, stage, outcome.working, {
        status: 'completed', started_at: started, finished_at: new Date(), stats: {}, error: null,
      });
      if (stage === 'handoff_publish') await ArticleRunRepo.setStatus(runId, 'completed');
    } else {
      await ArticleRunRepo.patchWorking(runId, outcome.working);
    }
    return outcome.output;
  } catch (err) {
    const typed = toArticleError(err);
    await ArticleRunRepo.markStageFailed(runId, stage, {
      status: 'failed', started_at: started, finished_at: new Date(), stats: {}, error: typed.message,
    }).catch(() => {});
    throw typed;
  }
}

/** Local/dev/CLI runner: sequential stages, looping humanize until it passes. */
export async function runLocalArticleRun(runId: string, clients?: ArticleStageClients): Promise<void> {
  const resolved = clients ?? (await getArticleStageClients());
  for (const stage of ARTICLE_STAGES) {
    if (stage === 'humanize') {
      let result: StageResult;
      do {
        result = await executeArticleStage(runId, stage, resolved);
      } while (result?.readability_ok === false);
    } else {
      await executeArticleStage(runId, stage, resolved);
    }
  }
}

/** EventBridge failure handler: stamp keyword + run failed after the execution dies. */
export async function markArticleRunFailed(runId: string): Promise<void> {
  const run = await ArticleRunRepo.findById(runId);
  if (!run) return;
  const stageError = Object.values(run.stages).find((s) => s.status === 'failed')?.error;
  await KeywordRepo.failGeneration(run.keyword_id, stageError ?? 'execution failed');
  await ArticleRunRepo.setStatus(runId, 'failed');
}
```

`launch.ts` (model on `packages/shared/strategy/src/launch.ts`, same `LaunchOptions.wait` doc comment adapted):

```ts
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { ArticleRepo, ArticleRunRepo, KeywordRepo, OrgRepo } from '@shared/db';
import { type ArticleRun, type StageState } from '@shared/schemas';
import { ArticleFatalError } from './errors';
import { runLocalArticleRun } from './run';

export async function createArticleRun(orgId: string, keywordId: string): Promise<ArticleRun> {
  const org = await OrgRepo.findById(orgId);
  if (!org?.presets) throw new ArticleFatalError(`org ${orgId} missing or has no presets`);
  const keyword = await KeywordRepo.findById(keywordId);
  if (!keyword || keyword.org_id !== orgId)
    throw new ArticleFatalError(`keyword ${keywordId} not found in org ${orgId}`);
  return ArticleRunRepo.create({
    org_id: orgId,
    keyword_id: keywordId,
    status: 'running',
    input: { website_url: org.website_url, presets: org.presets, keyword },
  });
}

async function start(run: ArticleRun, opts?: { wait?: boolean }): Promise<void> {
  const arn = process.env.ARTICLE_STATE_MACHINE_ARN;
  if (arn) {
    const sfn = new SFNClient({});
    await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: arn,
        name: `article-${run.id}`,
        input: JSON.stringify({ run_id: run.id, org_id: run.org_id }),
      }),
    );
  } else if (opts?.wait) {
    await runLocalArticleRun(run.id);
  } else {
    void runLocalArticleRun(run.id).catch((err) => {
      console.error(`[articles] local run ${run.id} failed`, err);
    });
  }
}

/**
 * Launch article generation for one planner keyword. The atomic
 * KeywordRepo.claimGeneration is the idempotency guard (returns null when the
 * keyword is already in flight / linked); attempts now count launches, one per
 * scheduler day or admin click. The execution is named by run_id (NOT keyword)
 * so a failed keyword stays relaunchable — SFN reserves names ~90 days.
 */
export async function launchGeneration(
  orgId: string,
  keywordId: string,
  opts?: { wait?: boolean },
): Promise<{ run_id: string } | null> {
  if (!(await KeywordRepo.claimGeneration(keywordId))) return null;
  let run: ArticleRun;
  try {
    run = await createArticleRun(orgId, keywordId);
    await start(run, opts);
  } catch (err) {
    // Release the claim so tomorrow's scheduler (or an admin) can relaunch.
    await KeywordRepo.failGeneration(keywordId, (err as Error).message).catch(() => {});
    throw err;
  }
  return { run_id: run.id };
}

/**
 * Re-run just the image + publish-handoff stages for an existing article
 * (admin images-regenerate). Implemented as a normal run whose earlier stages
 * are pre-completed — they short-circuit in seconds and the machine drops
 * straight into images_plan. Replay-safe via the article's set-if-absent plan
 * and per-slot CAS fills; no keyword claim involved.
 */
export async function launchImageRepair(
  orgId: string,
  articleId: string,
  opts?: { wait?: boolean },
): Promise<{ run_id: string }> {
  const article = await ArticleRepo.findById(articleId);
  if (!article || article.org_id !== orgId)
    throw new ArticleFatalError(`article ${articleId} not found in org ${orgId}`);
  const org = await OrgRepo.findById(orgId);
  if (!org?.presets) throw new ArticleFatalError(`org ${orgId} missing or has no presets`);
  const keyword = await KeywordRepo.findById(article.keyword_id);
  if (!keyword) throw new ArticleFatalError(`keyword ${article.keyword_id} not found`);

  const now = new Date();
  const done: StageState = {
    status: 'completed', started_at: now, finished_at: now, stats: {}, error: null,
  };
  const run = await ArticleRunRepo.create({
    org_id: orgId,
    keyword_id: keyword.id,
    status: 'running',
    input: { website_url: org.website_url, presets: org.presets, keyword },
    stages: { prepare: done, outline: done, draft: done, humanize: done, finalize: done },
    working: {
      link_candidates: [], outline: null, draft: null, humanize_attempts: [],
      content: null, readability_grade: null, article_id: articleId,
    },
  });
  await start(run, opts);
  return { run_id: run.id };
}
```

Add all of it to `src/index.ts`. Apply the keyword.repo stale-window edit.

- [ ] **Step 4: Run** — `npm test -- "run|launch"` scoped to the articles package PASS; full `npm test` still green (the keyword repo change is behavior-compatible; if a worker test pins the 15-minute window, update its clock fixture).
- [ ] **Step 5: Commit** — `git commit -m "feat(articles): stage dispatcher, local runner, launchGeneration/launchImageRepair"`

---

### Task 10: Worker adapter + scheduler; delete the old pipeline

**Files:**
- Create: `apps/worker/src/article-run.ts`
- Modify: `apps/worker/src/generation-scheduler.ts`, `apps/worker/src/dev.ts`, `apps/worker/src/providers.ts`
- Delete: `apps/worker/src/generation.ts`, `apps/worker/src/images.ts`, `apps/worker/src/queue.ts`, `apps/worker/tests/generation.test.ts`, `apps/worker/tests/images.test.ts`
- Modify: `packages/shared/schemas/src/scan.ts` (delete `GenerateTask` + `ImageTask` blocks; keep `ScanTask`, `PublishTask`), `packages/shared/schemas/src/index.ts` if it names them
- Modify: `apps/api/src/clients/sqs.ts` (delete `enqueueGenerateTask` + `enqueueImageTask` and the two type imports; keep scan + publish)
- Delete: `packages/shared/generation/src/generate.ts`, `packages/shared/generation/tests/generate.test.ts`; remove the `generateArticle` export from the generation index
- Test: `apps/worker/tests/article-run.test.ts` (new, modeled on `apps/worker/tests/strategy.test.ts`), `apps/worker/tests/generation-scheduler.test.ts` (rewrite), `apps/worker/tests/providers.test.ts` (trim)

**Interfaces:**
- Consumes: `executeArticleStage`, `markArticleRunFailed`, `getArticleStageClients` (Task 9/4), `ARTICLE_STAGES` (Task 1), `launchGeneration` (Task 9)
- Produces: `apps/worker/src/article-run.ts` exports `handler` (the entry infra Task 12 points at)

- [ ] **Step 1: Adapter.** Copy `apps/worker/src/strategy.ts` to `apps/worker/src/article-run.ts` and adapt: `StageEvent` uses `z.enum(ARTICLE_STAGES)`; the stage branch becomes

```ts
  const { run_id, org_id, stage } = StageEvent.parse(event);
  logger.appendKeys({ org_id, run_id, stage });
  try {
    const clients = await getArticleStageClients();
    const result = await executeArticleStage(run_id, stage, clients);
    logger.info('article stage completed', result ? { readability_ok: result.readability_ok } : {});
    return result;
  } catch (err) {
    logger.error('article stage failed', { error: err as Error });
    throw err;
  } finally {
    logger.removeKeys(['org_id', 'run_id', 'stage']);
  }
```

with handler return type `Promise<{ readability_ok: boolean } | undefined | void>` (the humanize Task state reads `$.Payload.readability_ok`). The failure branch parses the same `ExecutionFailedEvent` shape and calls `markArticleRunFailed(input.data.run_id)`.

- [ ] **Step 2: Scheduler.** `runScheduler` keeps `listDueForGeneration(today, MAX_GENERATION_ATTEMPTS)` but replaces the enqueue loop:

```ts
  for (const kw of due) {
    // wait:true only matters locally (no ARN): run sequentially so a CLI/dev
    // invocation doesn't race process exit. Deployed, this is StartExecution.
    const launched = await launchGeneration(kw.org_id, kw.id, { wait: true });
    if (!launched) logger.info('generation launch skipped: keyword not claimable', { keyword_id: kw.id });
  }
```

Remove the `enqueueGenerateTask` import.

- [ ] **Step 3: Deletions + trims.** Delete the five files listed; in `dev.ts` remove the generation/images imports, URL reads, and the two `pollers.push` lines (scan required + optional publish remain); in `providers.ts` delete `getGenerationClients` and `getImageClients` (scan stays — check nothing else imports them first: `git grep -n "getGenerationClients\|getImageClients"`). Trim `scan.ts` and the api sqs client. Remove `generateArticle` from the generation index and delete `generate.ts` + its test (the finalize/outline stage code and tests own that logic now). `git grep -n "GenerateTask\|ImageTask\|enqueueImageTask\|generateArticle"` must come back empty outside admin routes (fixed next task) and the CLI (fixed next task) — if the CLI/admin still reference them, leave those two call sites compiling by doing Task 11 before running the full check, or do Steps 3 of this task and Task 11 in one commit. **Recommended: execute Task 10 and Task 11 back-to-back and verify/commit once** if the intermediate state won't typecheck.
- [ ] **Step 4: Tests.** `article-run.test.ts`: copy `strategy.test.ts`'s structure — stage event dispatches to `executeArticleStage` (mock `@shared/articles`), failure event calls `markArticleRunFailed`, malformed input logs and returns. Scheduler test: mock `@shared/articles`' `launchGeneration`; assert one call per due keyword with `{ wait: true }` and that a `null` return doesn't throw. Providers test: drop the two deleted factories' cases.
- [ ] **Step 5: Run** — `npm run lint && npm run check:all && npm test` (jointly with Task 11 if merged). **Step 6: Commit** — `git commit -m "feat(worker): article stage Lambda adapter; retire SQS generation/images pipeline"`

---

### Task 11: API admin routes + CLI

**Files:**
- Modify: `apps/api/src/admin/routes/planner.ts` (the `/scheduled/{keyword_id}/generate` handler, ~line 201)
- Modify: `apps/api/src/admin/routes/articles.ts` (the images-regenerate handler, ~line 393)
- Modify: `apps/cli/src/lib/articles.ts` (`generateNext`, lines ~301-380)
- Modify: `apps/api/package.json`, `apps/cli/package.json` — add `"@shared/articles": "*"`
- Test: existing admin route tests (`git grep -ln "generate_now\|generate'" apps/api` to find them) — rewire mocks from `enqueueGenerateTask`/`enqueueImageTask` to `launchGeneration`/`launchImageRepair`

- [ ] **Step 1: planner.ts** — replace the enqueue line with:

```ts
      // Claim-lost (already in flight) intentionally still reports enqueued:
      // same silent dedupe the SQS worker's claim used to provide. Launch
      // errors (missing presets etc.) propagate -> 500, surfaced to admin.
      await launchGeneration(org.id, keyword.id);
```

(fire-and-forget local branch is correct for the long-lived API process; keep the existing audit call and `{ enqueued: true }` response so `AdminGenerateNowResponse` and the web client are untouched). Update imports; drop `enqueueGenerateTask`.

- [ ] **Step 2: articles.ts** — replace `await enqueueImageTask({ org_id: article.org_id, article_id: article.id });` with `await launchImageRepair(article.org_id, article.id);` and update the 200-description string from "Image task enqueued; the worker's set-if-absent plan…" to "Image repair run started; the article's set-if-absent plan and per-slot guards make replay safe". Response shape unchanged.
- [ ] **Step 3: CLI `generateNext`** — delete the `GENERATION_QUEUE_URL` check and `preflightQueue` call; keep the org/eligibility logic verbatim; replace the send loop with:

```ts
    const launched: { keyword_id: string; keyword: string; run_id: string }[] = [];
    for (const target of targets) {
      const res = await launchGeneration(orgId, target.id, { wait: opts.wait });
      if (res) launched.push({ keyword_id: target.id, keyword: target.keyword, run_id: res.run_id });
    }
```

`{ wait: opts.wait }`: locally a `--wait` run executes the whole pipeline in-process before the outcome poll (which then sees the terminal state immediately); deployed, `wait` is a no-op and the existing `pollUntil` outcome loop still does the watching — keep it. Extend `GenerateNextData`'s enqueued entries with `run_id` (find the type near the function; the CLI's JSON output is for humans/agents, no compat constraint). Update the `QUEUE_URL_MISSING` failure path: it no longer exists; if `process.env.ARTICLE_STATE_MACHINE_ARN` is unset, that's now the *local in-process* mode, which is valid — no preflight needed (Mongo access is the real prerequisite and existing `resolveOrgId` surfaces that). Check `apps/cli` for other `GENERATION_QUEUE_URL` references (`git grep -n GENERATION_QUEUE_URL apps/cli`) and update help/hint strings.
- [ ] **Step 4: Run** — `npm run lint && npm run check:all && npm test` all green (this is the first fully-consistent state if merged with Task 10).
- [ ] **Step 5: Commit** — `git commit -m "feat(api,cli): launch article runs via @shared/articles instead of SQS"`

---

### Task 12: Infra — state machine, stage Lambda, cleanup

**Files:**
- Modify: `infra/lib/api-stack.ts`
- Verify: `cd infra && npm install && npx tsc --noEmit` (and `npx cdk synth --quiet` if a default AWS env is configured; skip synth if it demands credentials)

**Changes (place next to the strategy equivalents; delete the old resources in the same commit):**

- [ ] **Step 1: Delete** `GenerationDlq`, `GenerationQueue`, `ImagesDlq`, `ImagesQueue`, `GenerationWorkerFn`, `ImagesWorkerFn` constructs and every reference to them (`generationQueue.grantSendMessages(generationSchedulerFn)`, event sources, the `GENERATION_QUEUE_URL`/`IMAGES_QUEUE_URL` env entries). **Keep** `imagesBucket`, `imagesCorsFn`, `imagesCdn`, `publishQueue`, `publishWorkerFn`, `GenerationSchedulerFn`, `GenerationSchedule` rule.
- [ ] **Step 2: ArticleStageFn** (env = union of the two deleted workers'):

```ts
    const articleStageFn = new NodejsFunction(this, 'ArticleStageFn', {
      entry: join(projectRoot, 'apps/worker/src/article-run.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.minutes(10),
      memorySize: 512,
      environment: {
        ...mongoEnv,
        OPENROUTER_API_KEY_PARAM: cfg.openRouterApiKeyParam,
        YOUTUBE_API_KEY_PARAM: cfg.youtubeApiKeyParam,
        FAL_KEY_PARAM: cfg.falKeyParam,
        IMAGES_BUCKET: imagesBucket.bucketName,
        IMAGES_CDN_DOMAIN: imagesCdn.distributionDomainName,
        PUBLISH_QUEUE_URL: publishQueue.queueUrl,
        GSC_TOKEN_KEY_PARAM: cfg.gscTokenKeyParam,
      },
      bundling,
    });
    mongoUriParam.grantRead(articleStageFn);
    openRouterApiKeyParam.grantRead(articleStageFn);
    youtubeApiKeyParam.grantRead(articleStageFn);
    falKeyParam.grantRead(articleStageFn);
    gscTokenKeyParam.grantRead(articleStageFn);
    imagesBucket.grantPut(articleStageFn);
    publishQueue.grantSendMessages(articleStageFn);
```

- [ ] **Step 3: State machine** (add `Choice`, `Condition` to the existing `aws-stepfunctions` import):

```ts
    // Article state machine (2026-08-28 spec): linear stages + a readability
    // Choice that loops humanize until the stage reports readability_ok (the
    // stage itself caps the loop at 3 passes, so no machine-side counter).
    // Same recipe as strategy: per-stage retries on ArticleRetryableError, no
    // Catch states (redrive-friendly), EventBridge failure stamping below.
    const articleStage = (stage: string, timeout: Duration) => {
      const task = new LambdaInvoke(this, `Article_${stage}`, {
        lambdaFunction: articleStageFn,
        payload: TaskInput.fromObject({
          run_id: JsonPath.stringAt('$.run_id'),
          org_id: JsonPath.stringAt('$.org_id'),
          stage,
        }),
        resultPath: JsonPath.DISCARD,
        taskTimeout: Timeout.duration(timeout),
      });
      task.addRetry({
        errors: ['ArticleRetryableError', 'States.Timeout'],
        maxAttempts: 3,
        interval: Duration.seconds(30),
        backoffRate: 2,
      });
      return task;
    };

    // humanize is the one state whose output survives: the Choice reads it.
    const humanizeTask = new LambdaInvoke(this, 'Article_humanize', {
      lambdaFunction: articleStageFn,
      payload: TaskInput.fromObject({
        run_id: JsonPath.stringAt('$.run_id'),
        org_id: JsonPath.stringAt('$.org_id'),
        stage: 'humanize',
      }),
      resultSelector: { 'readability_ok.$': '$.Payload.readability_ok' },
      resultPath: '$.humanize',
      taskTimeout: Timeout.duration(Duration.minutes(5)),
    });
    humanizeTask.addRetry({
      errors: ['ArticleRetryableError', 'States.Timeout'],
      maxAttempts: 3,
      interval: Duration.seconds(30),
      backoffRate: 2,
    });

    const finalizeChain = articleStage('finalize', Duration.minutes(5))
      .next(articleStage('images_plan', Duration.minutes(3)))
      .next(articleStage('images_render', Duration.minutes(9)))
      .next(articleStage('handoff_publish', Duration.minutes(2)));

    const readabilityGate = new Choice(this, 'Article_readability_gate')
      .when(Condition.booleanEquals('$.humanize.readability_ok', true), finalizeChain)
      .otherwise(humanizeTask);

    const articleDefinition = articleStage('prepare', Duration.minutes(3))
      .next(articleStage('outline', Duration.minutes(5)))
      .next(articleStage('draft', Duration.minutes(5)))
      .next(humanizeTask.next(readabilityGate));

    const articleStateMachine = new StateMachine(this, 'ArticleStateMachine', {
      definitionBody: DefinitionBody.fromChainable(articleDefinition),
      timeout: Duration.hours(1),
    });

    articleStateMachine.grantStartExecution(apiFn);
    apiFn.addEnvironment('ARTICLE_STATE_MACHINE_ARN', articleStateMachine.stateMachineArn);
    articleStateMachine.grantStartExecution(generationSchedulerFn);
    generationSchedulerFn.addEnvironment('ARTICLE_STATE_MACHINE_ARN', articleStateMachine.stateMachineArn);

    new Rule(this, 'ArticleExecutionFailedRule', {
      eventPattern: {
        source: ['aws.states'],
        detailType: ['Step Functions Execution Status Change'],
        detail: {
          status: ['FAILED', 'TIMED_OUT', 'ABORTED'],
          stateMachineArn: [articleStateMachine.stateMachineArn],
        },
      },
      targets: [new LambdaFunction(articleStageFn)],
    });

    // Replaces the generation/images DLQs as the "a customer got no article" signal.
    new Alarm(this, 'ArticleExecutionsFailedAlarm', {
      metric: articleStateMachine.metricFailed({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
```

Note construct ordering: `humanizeTask.next(readabilityGate)` requires the gate (and therefore `finalizeChain`) to be defined first, as written above; and `generationSchedulerFn`'s definition no longer takes `GENERATION_QUEUE_URL` in its environment. Also remove the CDK `.next()` chain nothing now references and re-read the scheduler Lambda block to drop `generationQueue.grantSendMessages(generationSchedulerFn)`.

- [ ] **Step 4: `.env.example`** — remove `GENERATION_QUEUE_URL`/`IMAGES_QUEUE_URL` entries (grep first; only touch lines that exist) and add a commented `# ARTICLE_STATE_MACHINE_ARN=` line noting "unset = article runs execute in-process (local dev)".
- [ ] **Step 5: Verify** — `cd infra && npm install && npx tsc --noEmit` clean.
- [ ] **Step 6: Commit** — `git commit -m "feat(infra): article generation state machine, retire generation/images queues"`

---

### Task 13: Full verification + docs

- [ ] **Step 1:** `npm run lint && npm run check:all && npm test` — all green at the repo root; `cd infra && npx tsc --noEmit` green.
- [ ] **Step 2:** Local smoke via the runner path: with `docker compose up -d` and root `.env` loaded, `npm run --silent cli -- articles generate-next --output json` against a known staging org **only if the operator confirms** (root `.env` points at the staging DB — see memory note); otherwise rely on the mocked end-to-end test (Task 9, case 8).
- [ ] **Step 3: Spec amendment** — append to `docs/superpowers/specs/2026-08-28-article-generation-step-functions-design.md` under Decisions: "Amended at implementation: `generation_attempts`/`MAX_GENERATION_ATTEMPTS`/`claimGeneration` are retained as the launch-time guard — the counter now counts launches (scheduler days / admin clicks), capping how many runs a permanently failing keyword can burn; the stale-claim window widened to 2 h (> the 1 h machine timeout). `admin images-regenerate` is served by a pre-completed 'repair run' on the same machine rather than a retained images queue."
- [ ] **Step 4: Docs** — `CLAUDE.md` § Async scan flow: update the strategy paragraph's sibling sentence so article generation is described as "a Step Functions state machine over Mongo-checkpointed `article_runs` docs, launched by `@shared/articles`' `launchGeneration` (daily scheduler, admin, CLI); publish remains SQS." `PROGRESS.md`: one line noting the article pipeline moved to Step Functions with the readability gate, linking the spec. Skills that mention queue-based triggering (`article-pipeline`) live outside the repo tree — flag in the PR body that the skill text needs a follow-up edit rather than editing here.
- [ ] **Step 5: Commit + PR** — `git commit -m "docs: spec amendment + progress/CLAUDE.md for article SFN port"`; push branch, open PR into `dev` titled `[backend] Article generation on Step Functions with readability gate`, body summarizing: state machine + `article_runs`, readability gate behavior (target 8, 3 passes, proceed-with-best), retained attempts cap, admin repair runs, deleted queue resources, and a **deploy note**: first staging deploy destroys the generation/images queues — confirm no in-flight messages matter (pre-alpha; they don't).

## Execution notes

- Tasks 1→9 are purely additive (old pipeline keeps working); Tasks 10-11 are the cutover and may need to land as one verification unit; 12 is infra-only; 13 is docs.
- If `npm run check:all` fails mid-cutover on a file scheduled for deletion later in the same task, delete it then — the task boundaries above already group the coupled edits.
- The `images_render` state's 9-minute task timeout is inside the Lambda's 10-minute ceiling on purpose: the timeout must fire in SFN (retryable `States.Timeout`) before the Lambda dies silently.
