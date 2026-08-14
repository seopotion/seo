# Strategy Job Rearchitect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic SQS strategy Lambda with a Step Functions state machine over Mongo-checkpointed stages, merging four LLM stages into two schema-tolerant calls whose strict output structure is *constructed* by code, never demanded from the model.

**Architecture:** Six stages (`gather → enrich → triage → serp_fetch → plan → persist_schedule`) run as pure functions in `@shared/keywords`; a new `@shared/strategy` package owns run-doc orchestration (create/execute/resume/launch); one `StrategyStageFn` Lambda is invoked per SFN Task state; state lives in a `strategy_runs` Mongo collection. Spec: `docs/superpowers/specs/2026-08-13-strategy-rearchitect-design.md`.

**Tech Stack:** TypeScript 6, Zod 4, Hono/OpenAPIHono, mongodb 7, Vitest 4, AWS CDK (`aws-stepfunctions`, `aws-events`), `@aws-sdk/client-sfn`, Biome.

## Global Constraints

- **Worktree trap:** this worktree has no `node_modules` links — run `npm install` at the repo worktree root FIRST, or every typecheck silently validates the main checkout's branch instead of your code.
- **Lockfile trap:** macOS npm strips Linux `@emnapi` optional deps from `package-lock.json`. Before EVERY commit that touches `package-lock.json`, diff it; if `@emnapi`/optional-dep blocks vanished, restore those hunks from a CI-green ref.
- Verification before any "done" claim: `npm run lint`, `npm run check:all`, `npm test` (all from repo root).
- Biome style: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` on new code.
- `verbatimModuleSyntax`: use `import type` / `export type` for type-only imports/re-exports.
- Shared packages export TS source (`"exports": { ".": "./src/index.ts" }`); internal deps use `"*"`.
- Tests: `vi.mock` external clients / `@shared/db` (auto-hoisted); `vi.hoisted` for spies. `npm test -- <name>` filters by file name.
- Never commit to `dev`/`master`. Work stays on this branch (`claude/strategy-job-prod-failure-dac651`); PR targets `dev`. Reference `Part of #56` in commits.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Breaking changes are allowed (pre-launch product); the old SQS strategy path is deleted, not shimmed.

---

### Task 0: Workspace setup

**Files:** none (environment only)

- [ ] **Step 1: Install workspace deps in the worktree**

```bash
cd /Users/fco/Documents/projects/seopotion/seo/.claude/worktrees/strategy-job-prod-failure-dac651 && npm install
```

- [ ] **Step 2: Verify the baseline is green before changing anything**

Run: `npm run check:all && npm test`
Expected: PASS. If the baseline fails, stop and report — do not build on a broken base.

- [ ] **Step 3: Check the lockfile did not lose optional deps**

Run: `git diff package-lock.json`
Expected: empty diff, or only additions. If `@emnapi`/optionalDependencies hunks were removed, `git checkout package-lock.json`.

---

### Task 1: `WorkingCandidateSchema` + `StrategyRun` schema in `@shared/schemas`

**Files:**
- Modify: `packages/shared/schemas/src/candidate.ts` (append `WorkingCandidateSchema`)
- Create: `packages/shared/schemas/src/strategy-run.ts`
- Modify: `packages/shared/schemas/src/index.ts` (add exports)
- Test: `packages/shared/schemas/tests/strategy-run.test.ts` (create; if the package has no `tests/` dir, mirror wherever existing schema tests live — check `packages/shared/schemas` first; if none exist, create `tests/` and confirm root vitest picks it up via `npm test -- strategy-run`)

**Interfaces:**
- Produces: `WorkingCandidateSchema` (Zod) and `type WorkingCandidate` — the exact field set of the current `WorkingCandidate` interface in `packages/shared/keywords/src/types.ts:14-40`, with Zod defaults matching `CandidateSchema`'s (nullable fields default `null`, `category_ids` default `[]`, `status` default `'candidate'`, `serp_competitors` uses the existing `SerpCompetitorsField`, `serp_validated` default `false`).
- Produces: `STRATEGY_STAGES` const tuple `['gather','enrich','triage','serp_fetch','plan','persist_schedule']`, `type StrategyStageName`, `StrategyRunSchema`, `type StrategyRun`, `CreateStrategyRunInput` (omit `id`/`created_at`/`updated_at`, `z.input` type), `StageStateSchema`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/schemas/tests/strategy-run.test.ts
import { describe, expect, it } from 'vitest';
import {
  STRATEGY_STAGES,
  StrategyRunSchema,
  WorkingCandidateSchema,
} from '../src/index';

const minimalCandidate = {
  keyword: 'ro membrane fouling',
  normalized: 'ro membrane fouling',
  source: 'keyword_suggestions',
};

describe('WorkingCandidateSchema', () => {
  it('fills defaults so a minimal candidate round-trips', () => {
    const c = WorkingCandidateSchema.parse(minimalCandidate);
    expect(c.status).toBe('candidate');
    expect(c.serp_validated).toBe(false);
    expect(c.relevance_score).toBeNull();
    expect(c.category_ids).toEqual([]);
    expect(c.serp_competitors).toBeNull();
  });
});

describe('StrategyRunSchema', () => {
  it('parses a fresh run and a stage-stamped run', () => {
    const base = {
      id: 'r1',
      org_id: 'o1',
      status: 'running',
      input: {
        website_url: 'https://x.com',
        presets: undefined as unknown, // replaced below with a real preset fixture
        existing_keywords: [],
      },
      created_at: new Date(),
      updated_at: new Date(),
    };
    // Reuse whatever SetupPresets fixture existing schema/pipeline tests use;
    // import it or build the minimal valid SetupPresetsSchema input here.
    // (Look at packages/shared/keywords/tests/pipeline.test.ts for one.)
    const presets = buildPresetsFixture();
    const run = StrategyRunSchema.parse({ ...base, input: { ...base.input, presets } });
    expect(run.stages).toEqual({});
    expect(run.candidates).toEqual([]);

    const stamped = StrategyRunSchema.parse({
      ...base,
      input: { ...base.input, presets },
      stages: {
        gather: {
          status: 'completed',
          started_at: new Date(),
          finished_at: new Date(),
          stats: { gathered: 10 },
          error: null,
        },
      },
      candidates: [WorkingCandidateSchema.parse(minimalCandidate)],
    });
    expect(stamped.stages.gather?.status).toBe('completed');
    expect(STRATEGY_STAGES).toContain('persist_schedule');
  });
});
```

(Write `buildPresetsFixture()` in the test by copying the presets fixture from `packages/shared/keywords/tests/pipeline.test.ts` — it already constructs a valid `SetupPresets`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- strategy-run`
Expected: FAIL — `WorkingCandidateSchema`/`StrategyRunSchema` not exported.

- [ ] **Step 3: Implement**

Append to `packages/shared/schemas/src/candidate.ts`:

```ts
/**
 * A candidate as it flows through the strategy pipeline stages (#56 rearchitect).
 * Zod (not a bare interface) because stage state is checkpointed into the
 * `strategy_runs` collection and parsed back at the boundary on resume.
 */
export const WorkingCandidateSchema = z.object({
  keyword: z.string(),
  normalized: z.string(),
  source: z.enum(CANDIDATE_SOURCES),
  source_context: z.string().nullable().default(null),
  core_keyword: z.string().nullable().default(null),
  category_ids: z.array(z.number().int()).default([]),
  topic_cluster_id: z.string().nullable().default(null),
  topic_cluster_label: z.string().nullable().default(null),
  topic_role: z.enum(TOPIC_ROLES).nullable().default(null),
  topic_content_focus: z.string().nullable().default(null),
  topic_primary_keyword: z.string().nullable().default(null),
  search_volume: z.number().int().nullable().default(null),
  difficulty: z.number().int().nullable().default(null),
  cpc: z.number().nullable().default(null),
  competition: z.number().nullable().default(null),
  trend: z.number().nullable().default(null),
  intent: z.enum(SEARCH_INTENTS).nullable().default(null),
  relevance_score: z.number().nullable().default(null),
  opportunity_score: z.number().nullable().default(null),
  article_type: z.enum(ARTICLE_TYPES).nullable().default(null),
  rejection_reason: z.enum(REJECTION_REASONS).nullable().default(null),
  status: z.enum(CANDIDATE_STATUSES).default('candidate'),
  serp_competitors: SerpCompetitorsField,
  serp_validated: z.boolean().default(false),
});
export type WorkingCandidate = z.infer<typeof WorkingCandidateSchema>;
```

Create `packages/shared/schemas/src/strategy-run.ts`:

```ts
import { z } from 'zod';
import { WorkingCandidateSchema } from './candidate';
import { SetupPresetsSchema } from './presets';

/** Stage order of the strategy state machine (#56). */
export const STRATEGY_STAGES = [
  'gather',
  'enrich',
  'triage',
  'serp_fetch',
  'plan',
  'persist_schedule',
] as const;
export type StrategyStageName = (typeof STRATEGY_STAGES)[number];

export const STRATEGY_RUN_STATUSES = ['running', 'completed', 'failed'] as const;

export const StageStateSchema = z.object({
  status: z.enum(['completed', 'failed']),
  started_at: z.date(),
  finished_at: z.date(),
  /** Per-stage funnel/coverage counters — the run's audit trail. */
  stats: z.record(z.string(), z.unknown()).default({}),
  error: z.string().nullable().default(null),
});
export type StageState = z.infer<typeof StageStateSchema>;

/**
 * One strategy run — the checkpoint document the state machine executes over.
 * Stages read the working-state fields (candidates/below_n/rejected/seeds/stats)
 * and write them back; a retried or redriven stage resumes from exactly what the
 * previous stage persisted. See the 2026-08-13 rearchitect spec.
 */
export const StrategyRunSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  status: z.enum(STRATEGY_RUN_STATUSES),
  input: z.object({
    website_url: z.string(),
    presets: SetupPresetsSchema,
    /** Planner keywords already scheduled when the run was launched. */
    existing_keywords: z.array(z.string()).default([]),
  }),
  stages: z.partialRecord(z.enum(STRATEGY_STAGES), StageStateSchema).default({}),
  candidates: z.array(WorkingCandidateSchema).default([]),
  below_n: z.array(WorkingCandidateSchema).default([]),
  rejected: z.array(WorkingCandidateSchema).default([]),
  seeds: z.array(z.string()).default([]),
  stats: z.record(z.string(), z.unknown()).default({}),
  created_at: z.date(),
  updated_at: z.date(),
});
export type StrategyRun = z.infer<typeof StrategyRunSchema>;

export const CreateStrategyRunInput = StrategyRunSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type CreateStrategyRunInput = z.input<typeof CreateStrategyRunInput>;
```

(Check the actual export name of the presets schema in `packages/shared/schemas/src/presets.ts` — if it is not `SetupPresetsSchema`, use the real name.) Add to `packages/shared/schemas/src/index.ts` alongside the existing export lines: `export * from './strategy-run';` (and confirm `candidate.ts` is already `export *`-ed — it is, via the existing index).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- strategy-run`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:fix && git add -A && git commit -m "[backend] Add WorkingCandidate + StrategyRun schemas for checkpointed strategy runs

Part of #56.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `StrategyRunRepo` + index

**Files:**
- Create: `packages/shared/db/src/repositories/strategy-run.repo.ts`
- Modify: `packages/shared/db/src/index.ts` (export repo), `packages/shared/db/src/ensure-indexes.ts` (add index)
- Test: integration test next to the existing repository integration tests (find them with `grep -rl "test:integration\|describe.*Repo" packages/shared/db` — mirror the existing file layout and Mongo setup/teardown helpers exactly)

**Interfaces:**
- Consumes: `StrategyRun`, `CreateStrategyRunInput`, `StrategyStageName`, `StageState` from Task 1.
- Produces:
  - `StrategyRunRepo.create(input: CreateStrategyRunInput): Promise<StrategyRun>`
  - `StrategyRunRepo.findById(id: string): Promise<StrategyRun | null>`
  - `StrategyRunRepo.latestByOrg(orgId: string): Promise<StrategyRun | null>`
  - `StrategyRunRepo.saveStageResult(id: string, stage: StrategyStageName, state: { candidates: WorkingCandidate[]; below_n: WorkingCandidate[]; rejected: WorkingCandidate[]; seeds: string[]; stats: Record<string, unknown> }, meta: StageState): Promise<void>`
  - `StrategyRunRepo.markStageFailed(id: string, stage: StrategyStageName, meta: StageState): Promise<void>`
  - `StrategyRunRepo.setStatus(id: string, status: 'running' | 'completed' | 'failed'): Promise<void>`

- [ ] **Step 1: Write the failing integration test** — follow the exact structure of an existing repo integration test (e.g. `candidate.repo` / `org.repo` tests): create → findById round-trip through Zod; `saveStageResult` persists working state + stage meta; `markStageFailed` stamps `stages.<stage>` with `status:'failed'` and error text without touching working state; `setStatus('completed')` flips status; `latestByOrg` returns the newest of two runs.

- [ ] **Step 2: Run to verify it fails**

Run: `docker compose up -d mongo && npm run test:integration -- strategy-run`
Expected: FAIL — repo module not found.

- [ ] **Step 3: Implement the repo** — copy the structural pattern of `packages/shared/db/src/repositories/candidate.repo.ts` (collection accessor, `_id` ↔ string `id` mapping, `Schema.parse` at the boundary, `updated_at` maintenance). Core methods:

```ts
import { ObjectId } from 'mongodb';
import {
  type CreateStrategyRunInput,
  CreateStrategyRunInput as CreateStrategyRunInputSchema,
  type StageState,
  type StrategyRun,
  StrategyRunSchema,
  type StrategyStageName,
  type WorkingCandidate,
} from '@shared/schemas';
import { getDb } from '../client';

const COLLECTION = 'strategy_runs';

type StrategyRunDoc = Omit<StrategyRun, 'id'> & { _id: ObjectId };

function toRun(doc: StrategyRunDoc): StrategyRun {
  const { _id, ...rest } = doc;
  return StrategyRunSchema.parse({ ...rest, id: _id.toHexString() });
}

export interface StrategyWorkStatePatch {
  candidates: WorkingCandidate[];
  below_n: WorkingCandidate[];
  rejected: WorkingCandidate[];
  seeds: string[];
  stats: Record<string, unknown>;
}

export const StrategyRunRepo = {
  async create(input: CreateStrategyRunInput): Promise<StrategyRun> {
    const db = await getDb();
    const now = new Date();
    const data = CreateStrategyRunInputSchema.parse(input);
    const { insertedId } = await db
      .collection<Omit<StrategyRunDoc, '_id'>>(COLLECTION)
      .insertOne({ ...data, created_at: now, updated_at: now });
    return toRun({ ...data, created_at: now, updated_at: now, _id: insertedId });
  },

  async findById(id: string): Promise<StrategyRun | null> {
    if (!ObjectId.isValid(id)) return null;
    const db = await getDb();
    const doc = await db
      .collection<StrategyRunDoc>(COLLECTION)
      .findOne({ _id: new ObjectId(id) });
    return doc ? toRun(doc) : null;
  },

  async latestByOrg(orgId: string): Promise<StrategyRun | null> {
    const db = await getDb();
    const doc = await db
      .collection<StrategyRunDoc>(COLLECTION)
      .findOne({ org_id: orgId }, { sort: { created_at: -1 } });
    return doc ? toRun(doc) : null;
  },

  async saveStageResult(
    id: string,
    stage: StrategyStageName,
    state: StrategyWorkStatePatch,
    meta: StageState,
  ): Promise<void> {
    const db = await getDb();
    await db.collection<StrategyRunDoc>(COLLECTION).updateOne(
      { _id: new ObjectId(id) },
      { $set: { ...state, [`stages.${stage}`]: meta, updated_at: new Date() } },
    );
  },

  async markStageFailed(id: string, stage: StrategyStageName, meta: StageState): Promise<void> {
    const db = await getDb();
    await db.collection<StrategyRunDoc>(COLLECTION).updateOne(
      { _id: new ObjectId(id) },
      { $set: { [`stages.${stage}`]: meta, updated_at: new Date() } },
    );
  },

  async setStatus(id: string, status: StrategyRun['status']): Promise<void> {
    const db = await getDb();
    await db.collection<StrategyRunDoc>(COLLECTION).updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updated_at: new Date() } },
    );
  },
};
```

Add to `ensure-indexes.ts` (with the existing style of comment):

```ts
// Strategy runs are looked up per org, newest first (#56).
await db.collection('strategy_runs').createIndex({ org_id: 1, created_at: -1 });
```

Export from `packages/shared/db/src/index.ts` next to the other repos.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:integration -- strategy-run`
Expected: PASS.

- [ ] **Step 5: Lint + commit** (same pattern as Task 1, message: `[backend] Add StrategyRunRepo + strategy_runs index`)

---

### Task 3: Plan-call contract — prompt + tolerant parser

**Files:**
- Create: `packages/shared/keywords/src/plan-contract.ts`
- Test: `packages/shared/keywords/tests/plan-contract.test.ts`

**Interfaces:**
- Consumes: `parseJsonResponse` (`./json-response`), `compareTopicSignals` (`./topic-signals`), `ARTICLE_TYPES`, `SetupPresets` (`@shared/schemas`), `LlmMessage` (`@shared/providers`), `WorkingCandidate`.
- Produces:
  - `interface PlanVerdict { index: number; intent_ok: boolean; locality_ok: boolean; article_type: string | null }`
  - `interface PlanTargetProposal { cluster: string; member_indices: number[]; content_focus: string; is_pillar: boolean }`
  - `interface PlanResponse { verdicts: PlanVerdict[]; targets: PlanTargetProposal[]; droppedRows: number }`
  - `class PlanParseError extends Error` (name `'PlanParseError'`)
  - `buildPlanPrompt(candidates: readonly WorkingCandidate[], presets: SetupPresets): LlmMessage[]`
  - `parsePlanResponse(text: string): PlanResponse` — throws `PlanParseError` only when *nothing* usable parses; malformed rows are dropped and counted.
  - `PLAN_SERP_TOP = 5`, `PLAN_MAX_CANDIDATES = 150`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/keywords/tests/plan-contract.test.ts
import { describe, expect, it } from 'vitest';
import {
  buildPlanPrompt,
  parsePlanResponse,
  PlanParseError,
} from '../src/plan-contract';
// reuse the candidate + presets fixture builders from pipeline.test.ts

describe('parsePlanResponse', () => {
  it('parses a well-formed response', () => {
    const r = parsePlanResponse(
      JSON.stringify({
        verdicts: [{ index: 0, intent_ok: true, locality_ok: true, article_type: 'how_to_guide' }],
        targets: [
          { cluster: 'ro membranes', member_indices: [0], content_focus: 'x', is_pillar: true },
        ],
      }),
    );
    expect(r.verdicts).toHaveLength(1);
    expect(r.targets).toHaveLength(1);
    expect(r.droppedRows).toBe(0);
  });

  it('drops malformed rows instead of throwing', () => {
    const r = parsePlanResponse(
      JSON.stringify({
        verdicts: [
          { index: 0, intent_ok: true, locality_ok: true },
          { index: 'nope', intent_ok: true, locality_ok: true },
          { intent_ok: false },
        ],
        targets: [{ cluster: 5, member_indices: [0] }, null],
      }),
    );
    expect(r.verdicts).toHaveLength(1);
    expect(r.targets).toHaveLength(0);
    expect(r.droppedRows).toBe(3);
  });

  it('tolerates missing targets entirely (all-singleton plan)', () => {
    const r = parsePlanResponse(
      JSON.stringify({ verdicts: [{ index: 0, intent_ok: true, locality_ok: true }] }),
    );
    expect(r.targets).toEqual([]);
  });

  it('throws PlanParseError on non-JSON and on zero usable verdicts', () => {
    expect(() => parsePlanResponse('not json')).toThrow(PlanParseError);
    expect(() => parsePlanResponse('{"verdicts":[],"targets":[]}')).toThrow(PlanParseError);
  });
});

describe('buildPlanPrompt', () => {
  it('numbers candidates, includes SERP titles, states the omission rule', () => {
    const candidates = [
      candidateFixture({
        keyword: 'ro membrane fouling',
        serp_competitors: [
          { rank: 1, url: 'https://a.com/x', domain: 'a.com', title: 'Fouling guide' },
        ],
      }),
    ];
    const messages = buildPlanPrompt(candidates, presetsFixture());
    const system = messages[0]?.content ?? '';
    const user = messages[1]?.content ?? '';
    expect(system).toContain('standalone');       // omission = standalone article, not discard
    expect(system).toContain('intent_ok');
    expect(system).toContain('is_pillar');
    expect(user).toContain('0. ro membrane fouling');
    expect(user).toContain('Fouling guide');
  });

  it('caps at PLAN_MAX_CANDIDATES', () => {
    const many = Array.from({ length: 151 }, (_, i) => candidateFixture({ keyword: `k${i}` }));
    expect(() => buildPlanPrompt(many, presetsFixture())).toThrow(/150/);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- plan-contract` → FAIL (module missing).

- [ ] **Step 3: Implement `plan-contract.ts`**

```ts
import type { LlmMessage } from '@shared/providers';
import { ARTICLE_TYPES, type SetupPresets, type WorkingCandidate } from '@shared/schemas';
import { parseJsonResponse } from './json-response';
import { compareTopicSignals } from './topic-signals';

export const PLAN_MAX_CANDIDATES = 150;
export const PLAN_SERP_TOP = 5;
export const PLAN_SERP_NEIGHBORS = 3;

export interface PlanVerdict {
  index: number;
  intent_ok: boolean;
  locality_ok: boolean;
  article_type: string | null;
}

export interface PlanTargetProposal {
  cluster: string;
  member_indices: number[];
  content_focus: string;
  is_pillar: boolean;
}

export interface PlanResponse {
  verdicts: PlanVerdict[];
  targets: PlanTargetProposal[];
  /** Rows dropped for being structurally unusable — logged, never fatal. */
  droppedRows: number;
}

/** The plan response yielded nothing usable — triggers the repair retry. */
export class PlanParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanParseError';
  }
}

function businessContext(presets: SetupPresets): string {
  return [
    `Business: ${presets.business.name}`,
    `Description: ${presets.business.description}`,
    `Target audience: ${presets.audience.target.join(', ')}`,
    `Country: ${presets.business.country}`,
    `Language: ${presets.business.language}`,
  ].join('\n');
}

/**
 * Pairwise SERP-overlap evidence, top-N neighbors per candidate. Moved from the
 * deleted topic-clusters.ts (same selection logic, same output shape).
 */
function positivePairwiseEvidence(
  candidates: readonly WorkingCandidate[],
): Array<{ left_index: number; right_index: number; serp_url_overlap: number }> {
  // Copy the body of `positivePairwiseEvidence` verbatim from
  // packages/shared/keywords/src/topic-clusters.ts:90-134 (git show HEAD if
  // already deleted), substituting WorkingCandidate for TopicClusterCandidate
  // and PLAN_SERP_NEIGHBORS for TOPIC_CLUSTER_SERP_NEIGHBORS.
}

/**
 * One call, whole finalist pool. The model does JUDGMENT (is this keyword
 * winnable, what type of article, which keywords are one page, what is the
 * pillar); all bookkeeping — index partitions, primary selection, cluster ids —
 * is constructed by materializePlan. Nothing here can make the run unbuildable.
 */
export function buildPlanPrompt(
  candidates: readonly WorkingCandidate[],
  presets: SetupPresets,
): LlmMessage[] {
  if (candidates.length > PLAN_MAX_CANDIDATES) {
    throw new Error(
      `plan call accepts at most ${PLAN_MAX_CANDIDATES} candidates; received ${candidates.length}`,
    );
  }
  const rows = candidates.map((c, index) => {
    const row: Record<string, unknown> = {
      index,
      keyword: c.keyword,
      intent: c.intent,
      search_volume: c.search_volume,
      difficulty: c.difficulty,
      opportunity_score: c.opportunity_score,
    };
    if (c.core_keyword) row.core_keyword = c.core_keyword;
    if (c.category_ids.length > 0) row.category_ids = c.category_ids;
    row.serp_top = (c.serp_competitors ?? [])
      .slice(0, PLAN_SERP_TOP)
      .map(({ domain, title }) => ({ domain, title }));
    return row;
  });
  const evidence = positivePairwiseEvidence(candidates);
  const numbered = candidates.map((c, i) => `${i}. ${c.keyword}`).join('\n');

  return [
    {
      role: 'system',
      content:
        'You are building a content plan from validated keyword candidates. Do THREE things ' +
        'in one response.\n' +
        '1) VERDICTS — for EVERY candidate index return one verdict. intent_ok=false if its ' +
        'Google results are product/navigational pages a blog article cannot outrank. ' +
        'locality_ok=false if results are dominated by local businesses or directories for a ' +
        'location that does not match the business country. article_type is exactly one of: ' +
        `${ARTICLE_TYPES.map((t) => `"${t}"`).join(', ')} — copy the string verbatim.\n` +
        '2) TARGETS — group accepted candidates that should become ONE article page into a ' +
        'target: singular/plural/synonymous/wording variants belong together; meaningfully ' +
        'distinct search intents stay separate targets. Give each target the broad topic ' +
        'cluster it belongs to (cluster: a short subject-family label, reused verbatim across ' +
        'targets of the same family) and a one-sentence content_focus. A candidate you leave ' +
        'out of every target becomes its own standalone article — omission is allowed and ' +
        'safe, never a discard. Never put one index in two targets.\n' +
        '3) PILLARS — mark is_pillar=true on the one broad, useful pillar target of each ' +
        'cluster.\n' +
        'Evidence rules: missing evidence is unknown, not disagreement; different provider ' +
        'core keywords do not prove different topics; zero measured SERP URL overlap does not ' +
        'by itself prove different topics; category evidence is supporting evidence only.\n' +
        'Respond ONLY with JSON matching: {"verdicts":[{"index":number,"intent_ok":boolean,' +
        '"locality_ok":boolean,"article_type":string}],"targets":[{"cluster":string,' +
        '"member_indices":number[],"content_focus":string,"is_pillar":boolean}]}.',
    },
    {
      role: 'user',
      content: [
        businessContext(presets),
        `Candidates:\n${numbered}`,
        `Candidate data:\n${rows.map((r) => JSON.stringify(r)).join('\n')}`,
        `Positive measured SERP-overlap evidence:\n${
          evidence.length > 0 ? evidence.map((e) => JSON.stringify(e)).join('\n') : '(none available)'
        }`,
      ].join('\n\n'),
    },
  ];
}

export function parsePlanResponse(text: string): PlanResponse {
  const parsed = parseJsonResponse(text) as {
    verdicts?: unknown;
    targets?: unknown;
  } | null;
  if (parsed === null || typeof parsed !== 'object') {
    throw new PlanParseError('plan response is not valid JSON');
  }
  let droppedRows = 0;
  const verdicts: PlanVerdict[] = [];
  for (const row of Array.isArray(parsed.verdicts) ? parsed.verdicts : []) {
    const r = row as Record<string, unknown> | null;
    if (
      r === null ||
      typeof r !== 'object' ||
      typeof r.index !== 'number' ||
      !Number.isInteger(r.index) ||
      typeof r.intent_ok !== 'boolean' ||
      typeof r.locality_ok !== 'boolean'
    ) {
      droppedRows++;
      continue;
    }
    verdicts.push({
      index: r.index,
      intent_ok: r.intent_ok,
      locality_ok: r.locality_ok,
      article_type: typeof r.article_type === 'string' ? r.article_type : null,
    });
  }
  const targets: PlanTargetProposal[] = [];
  for (const row of Array.isArray(parsed.targets) ? parsed.targets : []) {
    const r = row as Record<string, unknown> | null;
    if (
      r === null ||
      typeof r !== 'object' ||
      typeof r.cluster !== 'string' ||
      !Array.isArray(r.member_indices)
    ) {
      droppedRows++;
      continue;
    }
    targets.push({
      cluster: r.cluster,
      member_indices: r.member_indices.filter(
        (i): i is number => typeof i === 'number' && Number.isInteger(i),
      ),
      content_focus: typeof r.content_focus === 'string' ? r.content_focus : '',
      is_pillar: r.is_pillar === true,
    });
  }
  if (verdicts.length === 0) {
    throw new PlanParseError('plan response contained zero usable verdicts');
  }
  return { verdicts, targets, droppedRows };
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test -- plan-contract` → PASS.
- [ ] **Step 5: Lint + commit** (`[backend] Add plan-call LLM contract (prompt + tolerant parser)`)

---

### Task 4: Materializer + surviving selection logic

**Files:**
- Create: `packages/shared/keywords/src/materializer.ts`, `packages/shared/keywords/src/plan-select.ts`
- Test: `packages/shared/keywords/tests/materializer.test.ts`

**Interfaces:**
- Consumes: `PlanResponse` (Task 3), `WorkingCandidate`, `reject` (`./filters`), `toArticleType` (`./llm-prompts`), `normalizeKeyword`.
- Produces (materializer):
  - `PLAN_REPAIR_KINDS = ['verdict_index_invalid','verdict_duplicate','target_index_invalid','target_index_duplicate','target_member_unaccepted','target_empty','pillar_defaulted','singleton_created'] as const`, `type PlanRepairKind`
  - `interface PlanCoverage { finalists: number; verdicts: number; unjudged: number; accepted: number; targets: number; clusters: number; singletons: number; duplicates: number; pillars: number; supports: number; repaired: Record<PlanRepairKind, number>; repairRetried: boolean }`
  - `class PlanCoverageError extends Error` (name `'PlanCoverageError'`)
  - `materializePlan(candidates: readonly WorkingCandidate[], response: PlanResponse, minCoverage: number): { accepted: WorkingCandidate[]; rejected: WorkingCandidate[]; coverage: PlanCoverage }` — `accepted` are primary targets with all `topic_*` fields stamped, `article_type` applied, `serp_validated: true`; `rejected` holds `serp_intent`/`serp_locality`/`topic_duplicate` rejects (duplicates also carry topic fields + `serp_validated: true`). `coverage.repairRetried` is always `false` here (the stage flips it).
- Produces (plan-select): `selectTopicCandidateTargets`, `selectTopicClusterTargets`, `type TopicCandidateTarget`, `type MaterializedTopicTarget`, `TopicClusterValidationError` — **moved verbatim** from `topic-clusters.ts` (lines 388-583 plus the types/error they need) so the persist stage's ordering logic survives the file's deletion.

- [ ] **Step 1: Write the failing tests** — table-driven over the repair rules. MUST include:

```ts
// packages/shared/keywords/tests/materializer.test.ts
import { describe, expect, it } from 'vitest';
import { materializePlan, PlanCoverageError } from '../src/materializer';
// fixtures: candidate({keyword, opportunity_score, ...}) builder + a verdictAll()
// helper returning {index,intent_ok:true,locality_ok:true,article_type:'other'}
// for every candidate.

describe('materializePlan', () => {
  it('THE PROD BUG SHAPE: a target grouping keywords under an external primary cannot fail', () => {
    // Prod incident 2026-08-13: model put the "primary" outside member_indices.
    // In the new contract there is no primary field — the same intent arrives as
    // a plain group, and the primary is computed. This must produce a valid plan.
    const candidates = [c('ro fouling', 5), c('membrane fouling', 9), c('fouling ro', 3)];
    const out = materializePlan(
      candidates,
      {
        verdicts: allOk(candidates),
        targets: [{ cluster: 'fouling', member_indices: [0, 1, 2], content_focus: 'x', is_pillar: true }],
        droppedRows: 0,
      },
      0.5,
    );
    expect(out.accepted).toHaveLength(1);
    expect(out.accepted[0]?.keyword).toBe('membrane fouling'); // highest opportunity wins primary
    expect(out.accepted[0]?.topic_role).toBe('pillar');
    expect(out.rejected.filter((r) => r.rejection_reason === 'topic_duplicate')).toHaveLength(2);
  });

  it('unmentioned accepted candidates become singleton pillar targets', () => { /* 2 candidates, targets: [] → 2 accepted, each its own cluster, role pillar, coverage.singletons === 2 */ });
  it('failed verdicts reject with serp_intent / serp_locality', () => { /* intent_ok:false → rejection_reason 'serp_intent'; locality false → 'serp_locality' */ });
  it('out-of-range and duplicate member indices are dropped and counted', () => { /* target with [0, 0, 99] over 1 candidate → 1 member; repaired.target_index_duplicate===1, target_index_invalid===1 */ });
  it('a target whose members were all rejected is dropped', () => { /* repaired.target_empty === 1 */ });
  it('multiple is_pillar targets in one cluster → highest-opportunity target is pillar, counted', () => { /* repaired.pillar_defaulted === 1 */ });
  it('no is_pillar in a cluster → highest-opportunity target defaults to pillar, counted', () => {});
  it('verdict below minCoverage throws PlanCoverageError', () => {
    const candidates = [c('a', 1), c('b', 1), c('c', 1), c('d', 1)];
    expect(() =>
      materializePlan(
        candidates,
        { verdicts: [{ index: 0, intent_ok: true, locality_ok: true, article_type: null }], targets: [], droppedRows: 0 },
        0.5,
      ),
    ).toThrow(PlanCoverageError);
  });
  it('unjudged candidates are excluded (not accepted, not rejected) and counted', () => {});
  it('article_type from the verdict is normalized via toArticleType, invalid → other', () => {});
  it('cluster id is topic:<normalized pillar primary keyword>', () => {});
});
```

Fill in each skeleton with real assertions (the `/* */` notes state exactly what each must assert).

- [ ] **Step 2: Run to verify failure** — `npm test -- materializer` → FAIL.

- [ ] **Step 3: Implement `materializer.ts`**

```ts
import { normalizeKeyword, type WorkingCandidate } from '@shared/schemas';
import { reject } from './filters';
import { toArticleType } from './llm-prompts';
import type { PlanResponse, PlanTargetProposal, PlanVerdict } from './plan-contract';

export const PLAN_REPAIR_KINDS = [
  'verdict_index_invalid',
  'verdict_duplicate',
  'target_index_invalid',
  'target_index_duplicate',
  'target_member_unaccepted',
  'target_empty',
  'pillar_defaulted',
  'singleton_created',
] as const;
export type PlanRepairKind = (typeof PLAN_REPAIR_KINDS)[number];

export interface PlanCoverage {
  finalists: number;
  verdicts: number;
  unjudged: number;
  accepted: number;
  targets: number;
  clusters: number;
  singletons: number;
  duplicates: number;
  pillars: number;
  supports: number;
  repaired: Record<PlanRepairKind, number>;
  repairRetried: boolean;
}

/** Too few verdicts to trust the call — triggers the repair retry (#211). */
export class PlanCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanCoverageError';
  }
}

interface BuiltTarget {
  cluster: string;
  members: number[];
  primary: number;
  content_focus: string;
  is_pillar: boolean;
}

function emptyRepairs(): Record<PlanRepairKind, number> {
  return Object.fromEntries(PLAN_REPAIR_KINDS.map((k) => [k, 0])) as Record<PlanRepairKind, number>;
}

/** Highest opportunity wins; null scores last; ties → lowest index (stable). */
function pickPrimary(members: number[], candidates: readonly WorkingCandidate[]): number {
  return [...members].sort((a, b) => {
    const sa = candidates[a]?.opportunity_score ?? null;
    const sb = candidates[b]?.opportunity_score ?? null;
    if (sa === null) return sb === null ? a - b : 1;
    if (sb === null) return -1;
    return sb - sa || a - b;
  })[0] as number;
}

/**
 * Build the strict plan structure FROM the model's forgiving output. Every
 * invariant the old validator threw on is either unrepresentable here or made
 * true by construction; slips become counted repairs, never failures. The one
 * exception is verdict coverage — a mostly-unjudged pool must not silently ship
 * as a mostly-singleton plan (#211), so that throws PlanCoverageError.
 */
export function materializePlan(
  candidates: readonly WorkingCandidate[],
  response: PlanResponse,
  minCoverage: number,
): { accepted: WorkingCandidate[]; rejected: WorkingCandidate[]; coverage: PlanCoverage } {
  const repaired = emptyRepairs();

  // 1. Verdicts by index — first row wins, invalid indexes dropped.
  const verdicts = new Map<number, PlanVerdict>();
  for (const v of response.verdicts) {
    if (v.index < 0 || v.index >= candidates.length) {
      repaired.verdict_index_invalid++;
      continue;
    }
    if (verdicts.has(v.index)) {
      repaired.verdict_duplicate++;
      continue;
    }
    verdicts.set(v.index, v);
  }
  if (candidates.length > 0 && verdicts.size / candidates.length < minCoverage) {
    throw new PlanCoverageError(
      `plan call judged ${verdicts.size}/${candidates.length} finalists ` +
        `(minLlmCoverage ${Math.round(minCoverage * 100)}%); return one verdict per index`,
    );
  }

  // 2. Apply verdicts: accepted set + intent/locality rejects; unjudged excluded.
  const acceptedIdx = new Set<number>();
  const rejected: WorkingCandidate[] = [];
  let unjudged = 0;
  candidates.forEach((c, i) => {
    const v = verdicts.get(i);
    if (v === undefined) {
      unjudged++;
      return;
    }
    if (!v.intent_ok) rejected.push(reject(c, 'serp_intent'));
    else if (!v.locality_ok) rejected.push(reject(c, 'serp_locality'));
    else acceptedIdx.add(i);
  });

  // 3. Targets: sanitize members (first target claims an index).
  const claimed = new Set<number>();
  const built: BuiltTarget[] = [];
  for (const t of response.targets) {
    const members: number[] = [];
    for (const idx of t.member_indices) {
      if (idx < 0 || idx >= candidates.length) {
        repaired.target_index_invalid++;
        continue;
      }
      if (!acceptedIdx.has(idx)) {
        repaired.target_member_unaccepted++;
        continue;
      }
      if (claimed.has(idx)) {
        repaired.target_index_duplicate++;
        continue;
      }
      claimed.add(idx);
      members.push(idx);
    }
    if (members.length === 0) {
      repaired.target_empty++;
      continue;
    }
    built.push({
      cluster: t.cluster.trim() || (candidates[members[0] as number] as WorkingCandidate).keyword,
      members,
      primary: pickPrimary(members, candidates),
      content_focus: t.content_focus.trim(),
      is_pillar: t.is_pillar,
    });
  }

  // 4. Singletons: accepted candidates the model left out of every target.
  let singletons = 0;
  for (const idx of acceptedIdx) {
    if (claimed.has(idx)) continue;
    const c = candidates[idx] as WorkingCandidate;
    built.push({
      cluster: c.keyword,
      members: [idx],
      primary: idx,
      content_focus: '',
      is_pillar: false,
    });
    singletons++;
    repaired.singleton_created++;
  }

  // 5. Clusters: group by label; resolve exactly one pillar target per cluster.
  const byCluster = new Map<string, BuiltTarget[]>();
  for (const t of built) {
    const list = byCluster.get(t.cluster) ?? [];
    list.push(t);
    byCluster.set(t.cluster, list);
  }
  const accepted: WorkingCandidate[] = [];
  let duplicates = 0;
  let pillars = 0;
  let supports = 0;
  for (const [label, targets] of byCluster) {
    const flagged = targets.filter((t) => t.is_pillar);
    let pillar: BuiltTarget;
    if (flagged.length === 1) {
      pillar = flagged[0] as BuiltTarget;
    } else {
      // Zero or several pillar flags — default deterministically, count it
      // (except the trivial single-target cluster, where there is no choice).
      pillar = targets[pickTargetIndexByOpportunity(targets, candidates)] as BuiltTarget;
      if (targets.length > 1 || flagged.length > 1) repaired.pillar_defaulted++;
    }
    const pillarPrimary = candidates[pillar.primary] as WorkingCandidate;
    const clusterId = `topic:${normalizeKeyword(pillarPrimary.keyword)}`;
    for (const t of targets) {
      const role = t === pillar ? 'pillar' : 'support';
      if (role === 'pillar') pillars++;
      else supports++;
      const primaryCandidate = candidates[t.primary] as WorkingCandidate;
      const focus = t.content_focus || primaryCandidate.keyword;
      for (const idx of t.members) {
        const c = candidates[idx] as WorkingCandidate;
        const v = verdicts.get(idx) as PlanVerdict;
        const stamped: WorkingCandidate = {
          ...c,
          topic_cluster_id: clusterId,
          topic_cluster_label: label,
          topic_role: role,
          topic_content_focus: focus,
          topic_primary_keyword: primaryCandidate.keyword,
          article_type:
            (v.article_type !== null ? toArticleType(v.article_type) : null) ?? 'other',
          serp_validated: true,
        };
        if (idx === t.primary) accepted.push(stamped);
        else {
          rejected.push(reject(stamped, 'topic_duplicate'));
          duplicates++;
        }
      }
    }
  }

  return {
    accepted,
    rejected,
    coverage: {
      finalists: candidates.length,
      verdicts: verdicts.size,
      unjudged,
      accepted: acceptedIdx.size,
      targets: built.length,
      clusters: byCluster.size,
      singletons,
      duplicates,
      pillars,
      supports,
      repaired,
      repairRetried: false,
    },
  };
}

function pickTargetIndexByOpportunity(
  targets: BuiltTarget[],
  candidates: readonly WorkingCandidate[],
): number {
  let best = 0;
  let bestScore = -Infinity;
  targets.forEach((t, i) => {
    const s = candidates[t.primary]?.opportunity_score ?? -Infinity;
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return best;
}
```

Create `plan-select.ts` by **moving verbatim** from `topic-clusters.ts`: `TopicClusterValidationError` (lines 77-82), the `MaterializedTopicTarget` / `TopicCandidateTarget` interfaces (45-54, 67-75), `compareNullableScore`, `compareText`, `selectionClusters`, `selectTopicClusterTargets`, `requiredCandidateText`, `selectTopicCandidateTargets` (388-583). Do not edit their logic — only fix imports.

- [ ] **Step 4: Run** — `npm test -- materializer` → PASS. Also `npm test -- topic-clusters` still passes (topic-clusters.ts is untouched until Task 5).
- [ ] **Step 5: Lint + commit** (`[backend] Add plan materializer (construct-don't-validate) + surviving selection logic`)

---

### Task 5: Stage functions + pipeline recomposition + deletions

This is the core refactor of `@shared/keywords`. It keeps `runKeywordPipeline`'s export (the CLI dry-run entrypoint) but reimplements it as the sequential composition of the new stage functions, and deletes the old clustering/classify/SERP-judge machinery.

**Files:**
- Create: `packages/shared/keywords/src/stages.ts`
- Modify: `packages/shared/keywords/src/pipeline.ts` (recompose), `packages/shared/keywords/src/types.ts` (re-export `WorkingCandidate` from schemas; replace coverage types), `packages/shared/keywords/src/serp.ts` (fetch+authority only, no LLM), `packages/shared/keywords/src/score.ts` (per-batch repair retry), `packages/shared/keywords/src/config.ts` (`StageModels` → `{ seeds?, relevance?, plan? }`; default `plan: 'anthropic/claude-haiku-4.5'`), `packages/shared/keywords/src/index.ts` (exports), `packages/shared/keywords/src/llm-prompts.ts` (delete classify + SERP-judge sections; keep seeds, relevance, `toArticleType`)
- Delete: `packages/shared/keywords/src/topic-clusters.ts`, `packages/shared/keywords/src/classify.ts`
- Tests: create `packages/shared/keywords/tests/stages.test.ts`; rewrite `pipeline.test.ts`, `serp.test.ts`, `llm-prompts.test.ts`, `serp-competitors.test.ts` for the new flow; delete `topic-clusters.test.ts`, `classify.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3-4 plus existing `gatherCandidates`, `dedupe`, `brandNavFilter`, `fillDifficulty`, `applyDifficultyCeiling`, `applyRelevance`, `scoreCandidates`, `reject`, `resolveConfig`.
- Produces (all exported from `stages.ts` and the package index):

```ts
export interface StrategyWorkState {
  candidates: WorkingCandidate[]; // the active pool a stage transforms
  belowN: WorkingCandidate[];
  rejected: WorkingCandidate[];
  seeds: string[];
  stats: Record<string, unknown>; // accumulated PipelineStats fragments
}
export interface StageContext {
  orgId: string;
  websiteUrl: string;
  presets: SetupPresets;
  competitors: string[];
  existingKeywords: string[];
  clients: { dataForSeo: DataForSeoClient; llm: LlmClient };
  config: ResolvedConfig;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}
export const emptyWorkState: () => StrategyWorkState;
export async function stageGather(state, ctx): Promise<StrategyWorkState>;
export async function stageEnrich(state, ctx): Promise<StrategyWorkState>;
export async function stageTriage(state, ctx): Promise<StrategyWorkState>;
export async function stageSerpFetch(state, ctx): Promise<StrategyWorkState>;
export async function stagePlan(state, ctx): Promise<StrategyWorkState>;
export function toEnriched(c: WorkingCandidate, orgId: string): EnrichedCandidate; // moved from pipeline.ts
```

- Stage semantics (each returns a NEW state, never mutates):
  - `stageGather`: gather → dedupe → brandNav; sets `candidates`, `seeds`, stats `gathered`, `gatheredBySource`, `afterDedupe`, `afterBrandNav`; brandNav rejects appended to `rejected`.
  - `stageEnrich`: fillDifficulty → ceiling; stats `afterCeiling`; ceiling rejects appended.
  - `stageTriage`: applyRelevance (+ coverage guard exactly as `pipeline.ts:167` — throw the same message on shortfall) → cannibal set from `ctx.existingKeywords` → scoreCandidates → relevance floor (`pipeline.ts:179-185` logic) → rank (`rankKey` from `pipeline.ts:94`) → split at `config.serpTopN`; sets `candidates` = topN, `belowN`, stats `scored`, `afterRelevanceFloor`, `serpChecked`, `relevance` coverage. Also carries forward the empty-pool guard from `pipeline.ts:216-221` reworded for the new flow: if `stats.gathered > 0` and topN is empty, throw (`'strategy aborted: gathered N keywords but 0 reached SERP validation…'`).
  - `stageSerpFetch`: the trimmed `serp.ts` — concurrent fetch (`SERP_FETCH_CONCURRENCY = 12`), authority filter (rejects appended as `serp_authority`), survivors get `serp_competitors` (top `config.serpTopK`, same mapping as `serp.ts:130-136`) but `serp_validated` stays `false`; stats `serpFetched`, `authorityRejected`.
  - `stagePlan`: build prompt → `llm.complete({ messages, temperature: 0, responseFormat: 'json', model: config.models.plan })` → `parsePlanResponse` → `materializePlan(candidates, response, config.minLlmCoverage)`. On `PlanParseError`/`PlanCoverageError`: ONE repair retry — append `{ role: 'assistant', content: firstResponse.text }` and `{ role: 'user', content: 'Your previous response was rejected: <err.message>. Return the complete corrected JSON — nothing else.' }`, call again, re-parse/re-materialize, set `coverage.repairRetried = true`; a second failure propagates the error. Sets `candidates` = accepted, appends rejects, stats `plan` = coverage.
- `runKeywordPipeline(input: PipelineInput): Promise<PipelineResult>` — unchanged signature; body becomes `emptyWorkState()` piped through the five stages with `resolveConfig`, then assembles `PipelineResult` exactly as `pipeline.ts:258-290` does today (`[...accepted, ...belowN, ...rejected]`, `rejectedByReason` tally, stats object).
- `PipelineStats` (in `types.ts`): remove `judgment`, `classification`, `topicClustering`; add `serpFetched: number`, `authorityRejected: number`, `plan: PlanCoverage`. Keep everything else. `RelevanceCoverage` stays; delete `ClassificationCoverage`, `JudgmentCoverage`.
- `score.ts` repair retry: in `applyRelevance`, when a batch's `parsed === false`, retry that batch once with the same repair-message pattern before counting it failed.

- [ ] **Step 1: Write failing stage tests** (`stages.test.ts`) — mock clients per the existing `pipeline.test.ts` pattern. Cover at minimum:
  - `stageTriage` throws the coverage-guard error when the relevance mock answers under `minLlmCoverage` (mirror the existing pipeline test for #211 — move it here).
  - `stageSerpFetch` rejects an authority-dominated SERP with `serp_authority` and stamps `serp_competitors` on survivors with `serp_validated: false`.
  - `stagePlan` happy path: LLM mock returns a valid plan response → accepted candidates carry topic fields and `serp_validated: true`.
  - `stagePlan` repair ladder: first LLM call returns `'garbage'`, second returns valid JSON → succeeds, `stats.plan.repairRetried === true`, and the second call's messages include the error text.
  - `stagePlan` double failure: both calls garbage → throws `PlanParseError`.
  - State immutability: input state object is not mutated by any stage.
- [ ] **Step 2: Run** — `npm test -- stages` → FAIL.
- [ ] **Step 3: Implement** `stages.ts` + the modifications listed above, moving code rather than rewriting wherever the semantics are unchanged (gather/enrich/triage bodies come from `pipeline.ts`; serp fetch from `serp.ts`). Update `index.ts` exports: remove all `topic-clusters` exports **except** re-exporting `selectTopicCandidateTargets`, `selectTopicClusterTargets`, `TopicClusterValidationError` and their types from `./plan-select`; add `./stages`, `./plan-contract`, `./materializer` exports. Then delete `topic-clusters.ts` and `classify.ts` and the classify/SERP-judge sections of `llm-prompts.ts`.
- [ ] **Step 4: Update the sibling tests** — rewrite `pipeline.test.ts` (same scenarios, new mocked plan-call response instead of classify+cluster responses; keep the #211 regression tests, retargeted), trim `serp.test.ts` to fetch+authority, delete `topic-clusters.test.ts` / `classify.test.ts`, remove classify/judge cases from `llm-prompts.test.ts`.
- [ ] **Step 5: Run the whole keywords package** — `npm test -- packages/shared/keywords` → PASS; `npm run check` → PASS (CLI will break — expected, fixed in Task 9; if `check` covers the CLI, note the errors and confirm they are only in `apps/cli` / callers slated for later tasks before proceeding).
- [ ] **Step 6: Lint + commit** (`[backend] Decompose pipeline into checkpointable stages; merge judge+classify+cluster into one plan call`)

---

### Task 6: `@shared/strategy` package — errors, clients, persist stage

**Files:**
- Create: `packages/shared/strategy/package.json`, `packages/shared/strategy/src/index.ts`, `packages/shared/strategy/src/errors.ts`, `packages/shared/strategy/src/clients.ts`, `packages/shared/strategy/src/persist.ts`
- Modify: root `package.json` only if its `workspaces` globs don't already cover `packages/shared/*` (check first)
- Test: `packages/shared/strategy/tests/errors.test.ts`, `packages/shared/strategy/tests/persist.test.ts`

**Interfaces:**
- Produces:
  - `class StrategyRetryableError extends Error` (name `'StrategyRetryableError'`), `class StrategyFatalError extends Error` (name `'StrategyFatalError'`), both `constructor(message: string, options?: { cause?: unknown })`
  - `toStrategyError(err: unknown): StrategyRetryableError | StrategyFatalError` — already-typed errors pass through; anything carrying `retryable === false` → fatal; **everything else → retryable** (unknown/network/Mongo blips are transient by default; only an explicit non-retryable provider verdict is final)
  - `getStrategyClients(): Promise<{ dataForSeo: DataForSeoClient; llm: LlmClient }>` — moved verbatim from `apps/worker/src/providers.ts:17-27`
  - `stagePersistSchedule(state: StrategyWorkState, ctx: { orgId: string; log?: (msg: string, meta?: Record<string, unknown>) => void }): Promise<StrategyWorkState>` — the scheduling half of today's `apps/worker/src/strategy.ts:112-237` (`runStrategy` from `semanticTargetPool` down), moved with these changes: takes candidates from `state` (mapped through `toEnriched`), the trimmed eligibility check replaces `isPersistedTargetEligible` (keep ONLY: status `candidate`/`selected`, `rejection_reason === null`, `serp_validated`, `search_volume !== null`, `difficulty !== null`), keeps `PLAN_DAYS = 30`, `nextFreeDate`, the budget/offset math, pillar-confirmation gating, the under-fill warning, and ends with `OrgRepo.setStrategyStatus(orgId, 'completed')`. Also keeps the idempotency guard: if `org.strategy_status === 'completed'`, log and return state unchanged.

`package.json`:

```json
{
  "name": "@shared/strategy",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "sideEffects": false,
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@aws-sdk/client-sfn": "^3.0.0",
    "@shared/db": "*",
    "@shared/keywords": "*",
    "@shared/providers": "*",
    "@shared/schemas": "*"
  }
}
```

(Match the `@aws-sdk/*` version range other workspace packages pin — check `apps/api/package.json` for the SQS client's range and use the same style.)

`errors.ts`:

```ts
/** A stage failure worth retrying — SFN's Retry matches on this name. */
export class StrategyRetryableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StrategyRetryableError';
  }
}

/** A stage failure retrying cannot fix — fails the execution immediately. */
export class StrategyFatalError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StrategyFatalError';
  }
}

/**
 * Classify any stage error for the state machine. Providers already carry a
 * `retryable` verdict (ProviderError, DataForSeoError); only an explicit
 * `retryable: false` is fatal — unknown failures (network, Mongo blips) default
 * to retryable because a retry is cheap at stage granularity.
 */
export function toStrategyError(err: unknown): StrategyRetryableError | StrategyFatalError {
  if (err instanceof StrategyRetryableError || err instanceof StrategyFatalError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const retryable = (err as { retryable?: unknown })?.retryable !== false;
  return retryable
    ? new StrategyRetryableError(message, { cause: err })
    : new StrategyFatalError(message, { cause: err });
}
```

- [ ] **Step 1: Write failing tests** — `errors.test.ts`: ProviderError-shaped `{retryable: true}` → retryable; `{retryable: false}` → fatal; plain `Error` → retryable; pass-through of already-typed. `persist.test.ts`: port the scheduling assertions from the existing worker strategy tests if any exist (`grep -rl "runStrategy\|strategy" apps/worker/tests apps/worker/src/*.test.ts` — if the worker has no tests, write fresh ones): mocks `@shared/db` (`vi.mock`), asserts ≤30 scheduled in pillar-first order, support gated on unconfirmed pillar skipped, `date_occupied` race retried once, under-fill logged, completed-org short-circuit, `setStrategyStatus('completed')` called last.
- [ ] **Step 2: Run** — `npm test -- packages/shared/strategy` → FAIL.
- [ ] **Step 3: Implement**; run `npm install` after creating the package so the workspace links it (then re-check the lockfile trap).
- [ ] **Step 4: Run** — `npm test -- packages/shared/strategy` → PASS.
- [ ] **Step 5: Lint + commit** (`[backend] @shared/strategy: typed stage errors, clients, persist_schedule stage`)

---

### Task 7: `@shared/strategy` — executeStage, local runner, launcher, mark-failed

**Files:**
- Create: `packages/shared/strategy/src/run.ts`, `packages/shared/strategy/src/launch.ts`
- Modify: `packages/shared/strategy/src/index.ts` (exports)
- Test: `packages/shared/strategy/tests/run.test.ts`

**Interfaces:**
- Consumes: `StrategyRunRepo` (Task 2), stage functions (Task 5), `stagePersistSchedule` + `toStrategyError` + `getStrategyClients` (Task 6), `OrgRepo`, `KeywordRepo`, `resolveConfig` (`@shared/keywords`), `STRATEGY_STAGES`.
- Produces:
  - `executeStage(runId: string, stage: StrategyStageName, clients: { dataForSeo: DataForSeoClient; llm: LlmClient }): Promise<void>`
  - `runLocalStrategy(runId: string, clients?: …): Promise<void>` — sequential loop, resume-aware
  - `createStrategyRun(orgId: string): Promise<StrategyRun>` — loads org (throws `StrategyFatalError` if missing/presets missing), snapshots input incl. `KeywordRepo.listByOrg` keywords
  - `launchStrategy(orgId: string): Promise<{ run_id: string }>` (the claim/idempotency guard stays at the call sites, exactly as with the old queue)
  - `markRunFailed(runId: string, orgId: string): Promise<void>`

`run.ts` core:

```ts
import type { DataForSeoClient, LlmClient } from '@shared/providers';
import { OrgRepo, StrategyRunRepo } from '@shared/db';
import {
  emptyWorkState,
  resolveConfig,
  type StageContext,
  stageGather,
  stageEnrich,
  stageTriage,
  stageSerpFetch,
  stagePlan,
  type StrategyWorkState,
} from '@shared/keywords';
import { STRATEGY_STAGES, type StrategyRun, type StrategyStageName } from '@shared/schemas';
import { getStrategyClients } from './clients';
import { StrategyFatalError, toStrategyError } from './errors';
import { stagePersistSchedule } from './persist';

type Clients = { dataForSeo: DataForSeoClient; llm: LlmClient };

function toWorkState(run: StrategyRun): StrategyWorkState {
  return {
    candidates: run.candidates,
    belowN: run.below_n,
    rejected: run.rejected,
    seeds: run.seeds,
    stats: run.stats,
  };
}

function toContext(run: StrategyRun, clients: Clients): StageContext {
  const presets = run.input.presets;
  return {
    orgId: run.org_id,
    websiteUrl: run.input.website_url,
    presets,
    competitors: presets.audience.competitors,
    existingKeywords: run.input.existing_keywords,
    clients,
    config: resolveConfig(presets),
  };
}

/**
 * Execute one stage against the run's checkpointed state. Idempotent: a
 * duplicate invocation of an already-completed stage (SFN redrive double-fire)
 * is a no-op. On failure the stage is stamped failed and a typed error is
 * rethrown so the state machine's Retry/error handling sees the right name.
 */
export async function executeStage(
  runId: string,
  stage: StrategyStageName,
  clients: Clients,
): Promise<void> {
  const run = await StrategyRunRepo.findById(runId);
  if (run === null) throw new StrategyFatalError(`strategy run ${runId} not found`);
  if (run.status === 'completed') return;
  if (run.stages[stage]?.status === 'completed') return;

  const started = new Date();
  try {
    const state = toWorkState(run);
    const ctx = toContext(run, clients);
    const next =
      stage === 'persist_schedule'
        ? await stagePersistSchedule(state, { orgId: run.org_id })
        : await runComputeStage(stage, state, ctx);
    await StrategyRunRepo.saveStageResult(
      runId,
      stage,
      {
        candidates: next.candidates,
        below_n: next.belowN,
        rejected: next.rejected,
        seeds: next.seeds,
        stats: next.stats,
      },
      { status: 'completed', started_at: started, finished_at: new Date(), stats: {}, error: null },
    );
    if (stage === 'persist_schedule') await StrategyRunRepo.setStatus(runId, 'completed');
  } catch (err) {
    const typed = toStrategyError(err);
    await StrategyRunRepo.markStageFailed(runId, stage, {
      status: 'failed',
      started_at: started,
      finished_at: new Date(),
      stats: {},
      error: typed.message,
    }).catch(() => {});
    throw typed;
  }
}

async function runComputeStage(
  stage: Exclude<StrategyStageName, 'persist_schedule'>,
  state: StrategyWorkState,
  ctx: StageContext,
): Promise<StrategyWorkState> {
  switch (stage) {
    case 'gather':
      return stageGather(state, ctx);
    case 'enrich':
      return stageEnrich(state, ctx);
    case 'triage':
      return stageTriage(state, ctx);
    case 'serp_fetch':
      return stageSerpFetch(state, ctx);
    case 'plan':
      return stagePlan(state, ctx);
  }
}

/** Local/dev/CLI runner: same stages, sequentially, resuming past completed ones. */
export async function runLocalStrategy(runId: string, clients?: Clients): Promise<void> {
  const resolved = clients ?? (await getStrategyClients());
  for (const stage of STRATEGY_STAGES) {
    await executeStage(runId, stage, resolved);
  }
}

/** EventBridge failure handler: stamp org + run failed after the execution dies. */
export async function markRunFailed(runId: string, orgId: string): Promise<void> {
  await OrgRepo.setStrategyStatus(orgId, 'failed');
  await StrategyRunRepo.setStatus(runId, 'failed');
}
```

`launch.ts`:

```ts
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { KeywordRepo, OrgRepo, StrategyRunRepo } from '@shared/db';
import type { StrategyRun } from '@shared/schemas';
import { StrategyFatalError } from './errors';
import { runLocalStrategy } from './run';

/** Snapshot the org into a fresh running strategy_runs doc. */
export async function createStrategyRun(orgId: string): Promise<StrategyRun> {
  const org = await OrgRepo.findById(orgId);
  if (!org?.presets) throw new StrategyFatalError(`org ${orgId} missing or has no presets`);
  const scheduled = await KeywordRepo.listByOrg(orgId);
  return StrategyRunRepo.create({
    org_id: orgId,
    status: 'running',
    input: {
      website_url: org.website_url,
      presets: org.presets,
      existing_keywords: scheduled.map((k) => k.keyword),
    },
  });
}

/**
 * Start a strategy run. Deployed (STRATEGY_STATE_MACHINE_ARN set): starts a
 * Step Functions execution named strategy-<run_id>. Local: runs the sequential
 * in-process runner fire-and-forget, keeping `npm run dev` infra-free. Callers
 * keep their own OrgRepo.claimStrategy guard, exactly as with the old queue.
 */
export async function launchStrategy(orgId: string): Promise<{ run_id: string }> {
  const run = await createStrategyRun(orgId);
  const arn = process.env.STRATEGY_STATE_MACHINE_ARN;
  if (arn) {
    const sfn = new SFNClient({});
    await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: arn,
        name: `strategy-${run.id}`,
        input: JSON.stringify({ run_id: run.id, org_id: orgId }),
      }),
    );
  } else {
    void runLocalStrategy(run.id).catch((err) => {
      console.error(`[strategy] local run ${run.id} failed`, err);
    });
  }
  return { run_id: run.id };
}
```

- [ ] **Step 1: Write failing tests** (`run.test.ts`) — `vi.mock('@shared/db')` and `vi.mock('@shared/keywords', async (importOriginal) => …)` to spy on stage functions:
  - happy path: `runLocalStrategy` calls all six stages in order; run ends `completed`; `saveStageResult` called per stage.
  - **resume**: run doc has `gather`/`enrich`/`triage` completed → only `serp_fetch`, `plan`, `persist_schedule` execute.
  - failure: `stagePlan` mock throws a `{retryable: false}` error → `executeStage` rethrows `StrategyFatalError`, `markStageFailed` recorded, later stages never run.
  - duplicate invocation of a completed stage is a no-op (stage fn not called).
  - `launchStrategy` with `STRATEGY_STATE_MACHINE_ARN` set → `StartExecutionCommand` sent with `{run_id, org_id}` input (mock `@aws-sdk/client-sfn`); without it → `runLocalStrategy` invoked.
  - `markRunFailed` sets org `failed` and run `failed`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Lint + commit** (`[backend] @shared/strategy: executeStage, resume-aware local runner, launcher`)

---

### Task 8: Worker adapter rewrite + dev poller cleanup

**Files:**
- Rewrite: `apps/worker/src/strategy.ts`
- Modify: `apps/worker/src/dev.ts` (drop the strategy poller + import), `apps/worker/src/providers.ts` (delete `getStrategyClients`, now in `@shared/strategy`), `apps/worker/package.json` (add `"@shared/strategy": "*"`)
- Test: `apps/worker/tests/strategy.test.ts` (create or rewrite; mirror however existing worker tests are laid out — check with `ls apps/worker/tests` / `grep -rl vitest apps/worker`)

**Interfaces:**
- Consumes: `executeStage`, `markRunFailed`, `getStrategyClients` from `@shared/strategy`.
- Produces: `handler(event: unknown, context?: Context): Promise<void>` — the single Lambda entry for both SFN stage invocations and the EventBridge failure rule.

New `apps/worker/src/strategy.ts` (complete file):

```ts
import { executeStage, getStrategyClients, markRunFailed } from '@shared/strategy';
import { STRATEGY_STAGES } from '@shared/schemas';
import type { Context } from 'aws-lambda';
import { z } from 'zod';
import { logger } from './logger';

const StageEvent = z.object({
  run_id: z.string(),
  org_id: z.string(),
  stage: z.enum(STRATEGY_STAGES),
});

const ExecutionFailedEvent = z.object({
  'detail-type': z.literal('Step Functions Execution Status Change'),
  detail: z.object({ status: z.string(), input: z.string() }),
});

/**
 * Strategy stage Lambda — invoked once per Step Functions Task state with
 * {run_id, org_id, stage}, and by the EventBridge rule on terminal execution
 * failure (marks the org failed). Stage state/checkpoints live in the
 * strategy_runs collection; see the 2026-08-13 rearchitect spec and #56.
 */
export const handler = async (event: unknown, context?: Context): Promise<void> => {
  if (context?.awsRequestId) logger.addContext(context);

  const failed = ExecutionFailedEvent.safeParse(event);
  if (failed.success) {
    const input = StageEvent.omit({ stage: true }).safeParse(JSON.parse(failed.data.detail.input));
    if (!input.success) {
      logger.error('strategy failure event with unreadable input', { event });
      return;
    }
    logger.appendKeys({ org_id: input.data.org_id, run_id: input.data.run_id });
    try {
      logger.error('strategy execution failed', { status: failed.data.detail.status });
      await markRunFailed(input.data.run_id, input.data.org_id);
    } finally {
      logger.removeKeys(['org_id', 'run_id']);
    }
    return;
  }

  const { run_id, org_id, stage } = StageEvent.parse(event);
  logger.appendKeys({ org_id, run_id, stage });
  try {
    const clients = await getStrategyClients();
    await executeStage(run_id, stage, clients);
    logger.info('strategy stage completed');
  } catch (err) {
    logger.error('strategy stage failed', { error: err as Error });
    throw err;
  } finally {
    logger.removeKeys(['org_id', 'run_id', 'stage']);
  }
};
```

In `dev.ts`: delete the `strategyHandler` import, the `strategyUrl` const, and the `if (strategyUrl) pollers.push(…)` line (strategy no longer flows through SQS; the API's local launcher runs it in-process).

- [ ] **Step 1: Write failing tests** — stage event routes to `executeStage` with parsed fields (mock `@shared/strategy`); EventBridge event routes to `markRunFailed`; malformed stage event throws (Zod).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — `npm test -- apps/worker` → PASS.
- [ ] **Step 5: Lint + commit** (`[backend] Strategy worker becomes the SFN stage adapter; drop SQS strategy path`)

---

### Task 9: API + CLI swap

**Files:**
- Modify: `apps/api/src/clients/sqs.ts` (delete `enqueueStrategyTask` + its `StrategyTask` import), `apps/api/src/routes/setup.ts:209`, `apps/api/src/admin/routes/orgs.ts:162,299`, `apps/api/src/lib/billing/apply-event.ts:55` (all: `enqueueStrategyTask({ org_id })` → `launchStrategy(org_id)` imported from `@shared/strategy`), `apps/api/package.json` (add `"@shared/strategy": "*"`), `packages/shared/schemas/src/scan.ts` (delete `StrategyTask`)
- Modify: `apps/cli/src/lib/db.ts` + `apps/cli/src/lib/strategy-dryrun.ts` (adapt to the new `PipelineStats` — replace every read of `stats.judgment` / `stats.classification` / `stats.topicClustering` with the `stats.plan` `PlanCoverage` fields; render `repaired` counts and `repairRetried` in the report), `apps/cli/src/commands/db.ts` (add `strategy-run`)
- Test: update the api route tests that mock `enqueueStrategyTask` (find them: `grep -rl "enqueueStrategyTask" apps/api`) to mock `@shared/strategy`'s `launchStrategy` instead; CLI compiles and `strategy-dryrun --help` renders

New CLI command in `apps/cli/src/commands/db.ts`, following the exact `defineCommand` shape of the adjacent `strategy-audit`:

```ts
'strategy-run': defineCommand({
  meta: {
    name: 'strategy-run',
    description:
      'Create and execute a REAL strategy run for one org, in-process (#56): persists candidates, ' +
      'schedules planner entries, writes a strategy_runs doc. The recovery path for a failed org. ' +
      'Needs Mongo + provider credentials in the environment.',
  },
  args: {
    org: { type: 'positional', description: 'Org id', required: true },
  },
  async run({ args }) {
    const { createStrategyRun, runLocalStrategy } = await import('@shared/strategy');
    const run = await createStrategyRun(args.org);
    console.log(`strategy run ${run.id} created; executing…`);
    await runLocalStrategy(run.id);
    console.log(`strategy run ${run.id} finished`);
  },
}),
```

(Adapt the emitter/output-json plumbing to match how sibling commands in that file actually report progress — copy `strategy-audit`'s emitter usage.) Add `"@shared/strategy": "*"` to `apps/cli/package.json`.

- [ ] **Step 1: Update the failing api tests first** (swap the mock target), run to see them fail against unmodified code.
- [ ] **Step 2: Make the four call-site swaps + deletions.** Grep to confirm zero remaining references: `grep -rn "enqueueStrategyTask\|StrategyTask" apps packages` → only historical docs.
- [ ] **Step 3: Adapt the CLI stats rendering + add `strategy-run`.**
- [ ] **Step 4: Run** — `npm test && npm run check:all` → PASS (everything compiles again from here on).
- [ ] **Step 5: Lint + commit** (`[backend] Launch strategy via @shared/strategy; retire SQS strategy task + CLI stats update`)

---

### Task 10: Infra — state machine, failure rule, alarm, queue removal

**Files:**
- Modify: `infra/lib/api-stack.ts`

**Interfaces:** consumes the deployed names only — `apps/worker/src/strategy.ts` `handler`, env `STRATEGY_STATE_MACHINE_ARN` (read by `launchStrategy`).

Changes, all in `api-stack.ts`:

1. **Delete** `strategyDlq`, `strategyQueue` (lines ~174-187), the `strategyWorkerFn.addEventSource(...)` line, `STRATEGY_QUEUE_URL` from `apiFn` environment, and `strategyQueue.grantSendMessages(apiFn)`.
2. **Repurpose** the existing `StrategyWorkerFn` `NodejsFunction` (same entry `apps/worker/src/strategy.ts`) — rename construct id to `StrategyStageFn`, set `timeout: Duration.minutes(10)`, keep memory/env/grants (mongo, DataForSEO, OpenRouter).
3. **Add** imports: `aws_stepfunctions as sfn`, `aws_stepfunctions_tasks as tasks`, `aws_events as events`, `aws_events_targets as targets`, `aws_cloudwatch as cloudwatch` (match the file's existing import style — it imports classes directly, so import `StateMachine`, `DefinitionBody`, `Timeout`, `JsonPath`, `TaskInput`, `LambdaInvoke`, `Rule`, `LambdaFunction`, `Alarm`, `TreatMissingData` accordingly).
4. **State machine** after the stage Lambda:

```ts
// Strategy state machine (#56): one Task state per pipeline stage, all invoking
// the same stage Lambda with {run_id, org_id, stage}. Retries are per stage and
// only for StrategyRetryableError (+ Lambda service errors + state timeouts);
// a StrategyFatalError fails the execution immediately. No Catch states — a
// failed execution must stay redrivable from the failed state, so org-failure
// stamping happens via the EventBridge rule below instead.
const stageState = (stage: string, timeout: Duration) => {
  const task = new LambdaInvoke(this, `Strategy_${stage}`, {
    lambdaFunction: strategyStageFn,
    payload: TaskInput.fromObject({
      run_id: JsonPath.stringAt('$.run_id'),
      org_id: JsonPath.stringAt('$.org_id'),
      stage,
    }),
    resultPath: JsonPath.DISCARD, // keep {run_id, org_id} flowing to the next state
    taskTimeout: Timeout.duration(timeout),
  });
  task.addRetry({
    errors: ['StrategyRetryableError', 'States.Timeout'],
    maxAttempts: 3,
    interval: Duration.seconds(30),
    backoffRate: 2,
  });
  return task;
};

const strategyDefinition = stageState('gather', Duration.minutes(5))
  .next(stageState('enrich', Duration.minutes(5)))
  .next(stageState('triage', Duration.minutes(5)))
  .next(stageState('serp_fetch', Duration.minutes(8)))
  .next(stageState('plan', Duration.minutes(5)))
  .next(stageState('persist_schedule', Duration.minutes(5)));

const strategyStateMachine = new StateMachine(this, 'StrategyStateMachine', {
  definitionBody: DefinitionBody.fromChainable(strategyDefinition),
  timeout: Duration.hours(1),
});

strategyStateMachine.grantStartExecution(apiFn);
apiFn.addEnvironment('STRATEGY_STATE_MACHINE_ARN', strategyStateMachine.stateMachineArn);

// Terminal-failure handling: Step Functions emits execution status changes to
// EventBridge; on FAILED/TIMED_OUT/ABORTED the stage Lambda (same fn, different
// event shape) marks the org + run failed. Kept OUT of the state machine so
// redrive resumes at the failed stage.
new Rule(this, 'StrategyExecutionFailedRule', {
  eventPattern: {
    source: ['aws.states'],
    detailType: ['Step Functions Execution Status Change'],
    detail: {
      status: ['FAILED', 'TIMED_OUT', 'ABORTED'],
      stateMachineArn: [strategyStateMachine.stateMachineArn],
    },
  },
  targets: [new LambdaFunction(strategyStageFn)],
});

// Replaces the strategy DLQ as the "a customer got no plan" pager signal.
new Alarm(this, 'StrategyExecutionsFailedAlarm', {
  metric: strategyStateMachine.metricFailed({ period: Duration.minutes(5) }),
  threshold: 1,
  evaluationPeriods: 1,
  treatMissingData: TreatMissingData.NOT_BREACHING,
});
```

- [ ] **Step 1: Make the changes** (remember `infra/` is a standalone package: `cd infra && npm install` if needed).
- [ ] **Step 2: Verify synth** — `cd infra && npx cdk synth SeoApiStack-staging > /dev/null` (or the stack id pattern `infra/lib/config.ts` uses — check it): Expected: synth succeeds; grep the synthesized template for `StrategyStateMachine` and confirm no `StrategyQueue`/`StrategyDlq` resources remain.
- [ ] **Step 3: Commit** (`[infra] Strategy Step Functions state machine; retire strategy SQS queue + DLQ`)

---

### Task 11: Docs, verification sweep, PR

**Files:**
- Modify: `CLAUDE.md` (the "Async scan flow (SQS)" section: one sentence noting strategy now runs as a Step Functions state machine over `strategy_runs` checkpoints, launched by `@shared/strategy`; keep it terse), `PROGRESS.md` (one line linking #56 and this change)
- Delete: `docs/superpowers/specs/…` stays (specs are records)

- [ ] **Step 1: Full verification**

Run: `npm run lint && npm run check:all && npm test && (docker compose up -d mongo && npm run test:integration)`
Expected: all PASS.

- [ ] **Step 2: Docs updates** as listed; keep each edit to the minimum lines.
- [ ] **Step 3: Lockfile check** — `git diff origin/dev -- package-lock.json`; restore any stripped `@emnapi` optional-dep hunks from a CI-green ref.
- [ ] **Step 4: Commit + push + PR** targeting `dev`:

```bash
git push -u origin claude/strategy-job-prod-failure-dac651
gh pr create --base dev --title "[backend] Strategy job rearchitect: Step Functions stages, 2 LLM calls, construct-don't-validate" --body "$(cat <<'EOF'
Rearchitects the strategy job per docs/superpowers/specs/2026-08-13-strategy-rearchitect-design.md:

- Step Functions state machine over 6 Mongo-checkpointed stages; failed stages retry alone, executions are redrivable.
- SERP judge + classify + topic clustering merged into ONE plan call whose strict structure is constructed by code (materializer) — the 2026-08-13 prod DLQ failure shape is now unrepresentable.
- New @shared/strategy package (run orchestration, local runner, launcher); strategy SQS queue/DLQ retired.
- Recovery for org 6a7d6cc57785b8e00b5c9406 post-release: start a fresh execution (see spec §Rollout).

Part of #56.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Post-merge/staging note** — after this merges to `dev` and later ships to staging, verify one real org end-to-end on staging before any prod release; prod recovery steps are in the spec's Rollout section. (Human-gated; not part of this branch.)

---

## Self-review notes (already applied)

- Spec coverage: every spec section maps to a task — schemas/repo (1-2), plan contract + materializer incl. the prod-bug test (3-4), stages + coverage guards + repair ladder (5), package/persist/errors (6), orchestration/launcher/resume (7), worker adapter + EventBridge handler (8), API/CLI incl. `strategy-run` recovery path (9), state machine/no-Catch/redrive/alarm/queue removal (10), docs + rollout (11).
- Type consistency: `StrategyWorkState` fields are `belowN` in code / `below_n` in the Mongo doc — the mapping lives ONLY in `executeStage`/`toWorkState` (Task 7); stage functions and the repo never see the other convention.
- Known judgment calls an implementer may NOT revisit silently: keep `runKeywordPipeline`'s export (CLI dry-run depends on it); default plan model stays `anthropic/claude-haiku-4.5`; unknown errors default to *retryable*.
- **Deliberate deviation from the spec:** provider-side `json_schema` enforcement is NOT implemented — the existing `responseFormat: 'json'` (OpenRouter `json_object`) plus the tolerant parser + repair retry already carry the spec's guarantee, and extending `LlmCompleteParams` would touch every provider test for a belt-and-braces win. If wanted later, it is an isolated follow-up on `@shared/providers`.
