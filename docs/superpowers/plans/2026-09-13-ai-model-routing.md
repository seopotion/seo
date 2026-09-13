# Per-org AI Model Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route each org's article generation to models that fit its audience: a scan-assigned `content_complexity` preset picks a per-stage LLM ladder (Haiku → Sonnet → Opus), and a new `diagram` image medium routes to a text-capable image model with a labels-aware prompt.

**Architecture:** `@shared/schemas` gains `content_complexity` on `content_seo` (default `general`) and `diagram` in `IMAGE_MEDIA`. `@shared/providers` gains two pure routing tables, `routeLlm(complexity, task)` and `routeImage(medium)`, plus a per-call `timeoutMs` on the LLM client and `aspectRatio` on the fal client. The article stages in `@shared/articles` read the run's snapshotted presets and pass the routed model per call. `@shared/generation` gets a diagram branch in the planner prompt and in `imagePrompt`. The scanner assigns both new values; the admin presets editor exposes them.

**Tech Stack:** TypeScript 6, zod 4, Vitest 4, OpenRouter (LLM), fal.ai (images), React (admin app), Biome.

Spec: [`design/ai-model-routing.md`](../../../design/ai-model-routing.md).

## Global Constraints

- Run everything from the worktree root `/Users/fco/Documents/projects/seopotion/seo/.claude/worktrees/dev-master-merge-staging-623472`, on branch `claude/ai-gateway-router-orgs-bc42af`. If `node_modules` is missing or stale there, run `npm ci` first.
- Model ids are exact and verified on 2026-09-13: OpenRouter `anthropic/claude-haiku-4.5`, `anthropic/claude-sonnet-5`, `anthropic/claude-opus-5`; fal `fal-ai/flux-2`, `fal-ai/nano-banana-pro`.
- The LLM ladder is exactly the table in Task 3. Every `general` cell must equal today's defaults (`anthropic/claude-haiku-4.5`, 60 000 ms).
- `CONTENT_COMPLEXITIES = ['general', 'professional', 'technical']` — exact values, exact order. Default `general`.
- `IMAGE_MEDIA` becomes `['photograph','flat_illustration','three_d_render','watercolor','line_art','isometric','diagram']` — `diagram` appended last.
- `content_complexity` never influences image routing; `image_direction.medium` never influences text routing.
- fal `nano-banana-pro` takes `aspect_ratio` (enum), not `image_size`; both slots use `'16:9'`. `output_format: 'webp'` is supported.
- Biome style: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` after each task; commit what it reformats.
- `verbatimModuleSyntax`: `import type` for type-only imports.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and reference `Part of #N`, where `#N` is the tracking issue filed in Task 1.
- The one expected local `npm test` failure is `wordpress-plugin-behavior.test.ts` (needs `php`); it passes in CI.
- Never `git stash` bare in this worktree (shared stash stack). Never commit to `dev` or `master`.

---

## File map

| File | Change |
| --- | --- |
| `packages/shared/schemas/src/presets.ts` | `CONTENT_COMPLEXITIES`, `ContentComplexity`, `content_complexity` field + default; `diagram` in `IMAGE_MEDIA` |
| `packages/shared/schemas/tests/presets.test.ts` | Tests for both |
| `packages/shared/providers/src/llm/routing.ts` | **New.** `LlmTask`, `LlmRoute`, `routeLlm`, default model/timeout constants |
| `packages/shared/providers/src/llm/types.ts` | `timeoutMs?` on `LlmCompleteParams` |
| `packages/shared/providers/src/llm/client.ts` | Per-call timeout; defaults imported from routing |
| `packages/shared/providers/src/image/routing.ts` | **New.** `ImageRoute`, `routeImage`, model constants |
| `packages/shared/providers/src/image/types.ts` | `ImageAspectRatio`, `aspectRatio?` on `ImageGenerateParams` |
| `packages/shared/providers/src/image/client.ts` | `aspect_ratio` in the body |
| `packages/shared/providers/src/index.ts` | Export both routing modules |
| `packages/shared/providers/tests/llm-routing.test.ts` | **New.** |
| `packages/shared/providers/tests/image-routing.test.ts` | **New.** |
| `packages/shared/providers/tests/llm.test.ts` | Per-call timeout test |
| `packages/shared/providers/tests/image.test.ts` | `aspect_ratio` test |
| `packages/shared/generation/src/types.ts` | `contentComplexity` on `GenerationContext` |
| `packages/shared/generation/src/context.ts` | Populate it |
| `packages/shared/generation/src/images.ts` | `labels` on the slot, `diagramLabels`, diagram planner prompt, diagram `imagePrompt` branch, `MEDIUM_*` entries |
| `packages/shared/generation/src/index.ts` | Export `diagramLabels`, `MAX_DIAGRAM_LABELS` |
| `packages/shared/generation/tests/images.test.ts` | Diagram tests; media loop excludes `diagram` |
| `packages/shared/generation/tests/outline.test.ts`, `prompts.test.ts` | Add `contentComplexity: 'general'` to the hand-built context |
| `packages/shared/articles/src/llm-usage.ts` | **New.** `logLlmUsage(stage, result)` |
| `packages/shared/articles/src/stages/{outline,draft,humanize,finalize,images}.ts` | Pass routed `model`/`timeoutMs`; log usage; image route + no-text skip for diagram |
| `packages/shared/articles/tests/{early-stages,humanize-stage,finalize-stage,images-stages}.test.ts` | Model assertions |
| `packages/shared/articles/tests/llm-usage.test.ts` | **New.** |
| `apps/worker/src/scanner.ts` | `content_complexity` in the structured output + prompt; diagram guidance |
| `apps/worker/tests/scanner.test.ts` | Fixture + tests |
| `apps/admin/src/pages/org/PresetsEditor.tsx` | `Diagram` label; complexity select |
| `PROGRESS.md` | One line linking the issue |

---

### Task 1: File the tracking issue and the two follow-ups

**Files:** none (GitHub only).

- [ ] **Step 1: File the tracking issue**

```bash
gh issue create --repo seopotion/seo --label backend \
  --title "[articles] Per-org AI model routing: content_complexity ladder + diagram image medium" \
  --body "$(cat <<'EOF'
Design: design/ai-model-routing.md (committed 96b1c54). Plan: docs/superpowers/plans/2026-09-13-ai-model-routing.md.

- Scan-assigned `content_seo.content_complexity` (general | professional | technical), admin-editable, default general.
- Per-stage LLM ladder in `@shared/providers` (Haiku 4.5 / Sonnet 5 / Opus 5) with per-route timeouts; `general` = today's behaviour.
- `diagram` added to `image_direction.medium`, routed to `fal-ai/nano-banana-pro` with a labels-aware planner and prompt.
- No billing cap. Keyword pipeline untouched.

Acceptance: a piperbox staging article routes outline/humanize to Sonnet and draft to Opus (visible in the per-stage `llm usage` log line) and renders three labelled diagrams; an unmarble article is unchanged.
EOF
)"
```

Record the returned number as `#N`; every later commit says `Part of #N`.

- [ ] **Step 2: File the diagrams-as-code follow-up**

```bash
gh issue create --repo seopotion/seo --label backend \
  --title "[articles] Diagrams as code (Mermaid/SVG rendered to PNG) for technical orgs" \
  --body "Very optional — revisit only once technical customers exist. Follow-up to the per-org routing issue: the LLM authors Mermaid/SVG for architecture and flow diagrams and we render to PNG. New stage with its own planner and a renderer in Lambda. Out of scope for design/ai-model-routing.md."
```

- [ ] **Step 3: File the customer-facing select follow-up**

```bash
gh issue create --repo seopotion/seo --label frontend \
  --title "[frontend] Expose content_complexity in article settings and onboarding" \
  --body "Follow-up to the per-org routing issue. The admin presets editor gets the select in that PR; the customer-facing article-settings page and onboarding step do not. Same split as #312 used for image_direction."
```

---

### Task 2: `content_complexity` preset

**Files:**
- Modify: `packages/shared/schemas/src/presets.ts:65-76` (ContentSeoFields), `:118-126` (SetupPresetsSchema content_seo)
- Test: `packages/shared/schemas/tests/presets.test.ts`

**Interfaces:**
- Produces: `CONTENT_COMPLEXITIES` (readonly tuple), `type ContentComplexity = 'general' | 'professional' | 'technical'`, `CONTENT_COMPLEXITY_DEFAULT = 'general'`, and `SetupPresets['article_preferences']['content_seo']['content_complexity']`. `ContentSeoPatchSchema` accepts an optional `content_complexity` with no default.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/schemas/tests/presets.test.ts` (add `CONTENT_COMPLEXITIES`, `CONTENT_COMPLEXITY_DEFAULT` to the import from `'../src/presets'`):

```ts
describe('SetupPresetsSchema content_seo.content_complexity', () => {
  const withAudience = { ...base, audience: { target: ['a'], competitors: [] } };

  test('the enum is general | professional | technical, in that order', () => {
    expect(CONTENT_COMPLEXITIES).toEqual(['general', 'professional', 'technical']);
  });

  // Pre-existing org docs and article_runs snapshots have no such field; the
  // default is what keeps them parsing and routes them exactly as before.
  test('defaults to general when absent', () => {
    expect(CONTENT_COMPLEXITY_DEFAULT).toBe('general');
    const p = SetupPresetsSchema.parse(withAudience);
    expect(p.article_preferences.content_seo.content_complexity).toBe('general');
  });

  test('keeps an explicit value', () => {
    const p = SetupPresetsSchema.parse({
      ...withAudience,
      article_preferences: {
        ...withAudience.article_preferences,
        content_seo: {
          ...withAudience.article_preferences.content_seo,
          content_complexity: 'technical',
        },
      },
    });
    expect(p.article_preferences.content_seo.content_complexity).toBe('technical');
  });

  test('rejects a value outside the enum', () => {
    expect(() =>
      SetupPresetsSchema.parse({
        ...withAudience,
        article_preferences: {
          ...withAudience.article_preferences,
          content_seo: {
            ...withAudience.article_preferences.content_seo,
            content_complexity: 'expert',
          },
        },
      }),
    ).toThrow();
  });

  test('the patch schema keeps an explicit value and injects no default', () => {
    expect(ContentSeoPatchSchema.parse({ content_complexity: 'professional' })).toEqual({
      content_complexity: 'professional',
    });
    expect(ContentSeoPatchSchema.parse({ article_style: 'x' })).toEqual({ article_style: 'x' });
    expect(() => ContentSeoPatchSchema.parse({ content_complexity: 'expert' })).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- presets`
Expected: FAIL — `CONTENT_COMPLEXITIES` is not exported.

- [ ] **Step 3: Implement**

In `packages/shared/schemas/src/presets.ts`, above `const ContentSeoFields`:

```ts
/**
 * How expert the articles must read. Decided once per org by the scanner and
 * user-editable; it selects the LLM ladder every article stage runs on
 * (design/ai-model-routing.md). `general` is today's behaviour.
 */
export const CONTENT_COMPLEXITIES = ['general', 'professional', 'technical'] as const;
export type ContentComplexity = (typeof CONTENT_COMPLEXITIES)[number];

/** Complexity for orgs scanned before the field existed: routes them as before. */
export const CONTENT_COMPLEXITY_DEFAULT: ContentComplexity = 'general';
```

Add to `ContentSeoFields` after `readability_grade_max`:

```ts
  content_complexity: z.enum(CONTENT_COMPLEXITIES),
```

In `SetupPresetsSchema`'s `content_seo` object, after the `readability_grade_max` default line:

```ts
      // Same reason as readability: pre-existing docs and run snapshots keep parsing.
      content_complexity: ContentSeoFields.content_complexity.default(CONTENT_COMPLEXITY_DEFAULT),
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm test -- presets && npm run check`
Expected: PASS. (`ContentSeoPatchSchema` is built from the un-defaulted fields, so the patch tests pass without further changes.)

- [ ] **Step 5: Lint and commit**

```bash
npm run lint:fix
git add packages/shared/schemas
git commit -m "feat(schemas): content_complexity preset, default general

Part of #N

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: LLM routing table and per-call timeout

**Files:**
- Create: `packages/shared/providers/src/llm/routing.ts`
- Modify: `packages/shared/providers/src/llm/types.ts:9-21`, `packages/shared/providers/src/llm/client.ts:4-7,17-20,30-34,77-90,94-98`, `packages/shared/providers/src/index.ts`
- Test: `packages/shared/providers/tests/llm-routing.test.ts` (new), `packages/shared/providers/tests/llm.test.ts`

**Interfaces:**
- Consumes: `ContentComplexity`, `CONTENT_COMPLEXITIES` from `@shared/schemas` (Task 2).
- Produces:
  ```ts
  export type LlmTask = 'outline' | 'draft' | 'humanize' | 'finalize' | 'image_plan';
  export interface LlmRoute { model: string; timeoutMs: number }
  export const DEFAULT_LLM_MODEL = 'anthropic/claude-haiku-4.5';
  export const DEFAULT_LLM_TIMEOUT_MS = 60_000;
  export const LLM_TASKS: readonly LlmTask[];
  export function routeLlm(complexity: ContentComplexity, task: LlmTask): LlmRoute;
  ```
  and `LlmCompleteParams.timeoutMs?: number` (overrides the client's configured timeout for that call).

- [ ] **Step 1: Write the failing routing tests**

Create `packages/shared/providers/tests/llm-routing.test.ts`:

```ts
import { CONTENT_COMPLEXITIES } from '@shared/schemas';
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_LLM_MODEL,
  DEFAULT_LLM_TIMEOUT_MS,
  LLM_TASKS,
  routeLlm,
} from '../src/llm/routing';

describe('routeLlm', () => {
  test('every cell resolves to a model and a positive timeout', () => {
    for (const complexity of CONTENT_COMPLEXITIES) {
      for (const task of LLM_TASKS) {
        const route = routeLlm(complexity, task);
        expect(route.model.length).toBeGreaterThan(0);
        expect(route.timeoutMs).toBeGreaterThan(0);
      }
    }
  });

  // `general` is today's behaviour — orgs that are not marked professional or
  // technical must see no change in model or cost (design/ai-model-routing.md).
  test('general is the client default everywhere', () => {
    for (const task of LLM_TASKS) {
      expect(routeLlm('general', task)).toEqual({
        model: DEFAULT_LLM_MODEL,
        timeoutMs: DEFAULT_LLM_TIMEOUT_MS,
      });
    }
    expect(DEFAULT_LLM_MODEL).toBe('anthropic/claude-haiku-4.5');
    expect(DEFAULT_LLM_TIMEOUT_MS).toBe(60_000);
  });

  test('the approved ladder', () => {
    const sonnet = 'anthropic/claude-sonnet-5';
    const opus = 'anthropic/claude-opus-5';
    expect(routeLlm('professional', 'outline').model).toBe(sonnet);
    expect(routeLlm('professional', 'draft').model).toBe(sonnet);
    expect(routeLlm('professional', 'humanize').model).toBe(DEFAULT_LLM_MODEL);
    expect(routeLlm('professional', 'finalize').model).toBe(DEFAULT_LLM_MODEL);
    expect(routeLlm('professional', 'image_plan').model).toBe(DEFAULT_LLM_MODEL);
    expect(routeLlm('technical', 'outline').model).toBe(sonnet);
    expect(routeLlm('technical', 'draft').model).toBe(opus);
    expect(routeLlm('technical', 'humanize').model).toBe(sonnet);
    expect(routeLlm('technical', 'finalize').model).toBe(DEFAULT_LLM_MODEL);
    expect(routeLlm('technical', 'image_plan').model).toBe(DEFAULT_LLM_MODEL);
  });

  // The client default is 60s; an Opus draft of ~5k tokens runs past it.
  test('bigger models get longer timeouts', () => {
    expect(routeLlm('professional', 'draft').timeoutMs).toBe(120_000);
    expect(routeLlm('technical', 'draft').timeoutMs).toBe(240_000);
  });
});
```

- [ ] **Step 2: Write the failing per-call timeout test**

Append inside `describe('complete', …)` in `packages/shared/providers/tests/llm.test.ts`:

```ts
  test('a per-call timeoutMs overrides the configured timeout', async () => {
    vi.useFakeTimers();
    try {
      // Never resolves on its own; only an abort can end it.
      const fetchMock = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const c = createOpenRouterClient({ apiKey: 'sk-test', timeoutMs: 1_000, maxRetries: 0 });

      let settled = false;
      const failed = c
        .complete({ messages: [{ role: 'user', content: 'x' }], timeoutMs: 5_000 })
        .then(
          () => 'resolved',
          (err: unknown) => (err as Error).message,
        )
        .finally(() => {
          settled = true;
        });
      await vi.advanceTimersByTimeAsync(1_500);
      expect(settled).toBe(false); // the 1s config timeout did not fire
      await vi.advanceTimersByTimeAsync(4_000);
      expect(settled).toBe(true); // the 5s per-call timeout did
      expect(await failed).toMatch(/timed out/);
    } finally {
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npm test -- llm`
Expected: FAIL — `../src/llm/routing` not found, and the timeout test fails on `expect(settled).toBe(false)` because today the configured 1s timeout aborts the request before 1.5s.

- [ ] **Step 4: Create the routing module**

`packages/shared/providers/src/llm/routing.ts`:

```ts
import type { ContentComplexity } from '@shared/schemas';

/** The article stages that call the LLM. The keyword pipeline pins its own models. */
export type LlmTask = 'outline' | 'draft' | 'humanize' | 'finalize' | 'image_plan';
export const LLM_TASKS: readonly LlmTask[] = [
  'outline',
  'draft',
  'humanize',
  'finalize',
  'image_plan',
];

export interface LlmRoute {
  /** OpenRouter model id. */
  model: string;
  /** Per-request timeout for this model; bigger models need longer. */
  timeoutMs: number;
}

/** The client default: what every call got before routing existed. */
export const DEFAULT_LLM_MODEL = 'anthropic/claude-haiku-4.5';
export const DEFAULT_LLM_TIMEOUT_MS = 60_000;

const HAIKU: LlmRoute = { model: DEFAULT_LLM_MODEL, timeoutMs: DEFAULT_LLM_TIMEOUT_MS };
const SONNET: LlmRoute = { model: 'anthropic/claude-sonnet-5', timeoutMs: 120_000 };
const OPUS: LlmRoute = { model: 'anthropic/claude-opus-5', timeoutMs: 240_000 };

/**
 * Per-stage ladder by the org's content_complexity (design/ai-model-routing.md).
 * The draft is where technical accuracy lives, so it gets the largest jump;
 * humanize on a technical draft risks dumbing it down, so it gets a stronger
 * model at the top tier but never Opus; meta, semantic markup and image
 * planning are mechanical regardless of audience. `general` is the client
 * default everywhere, so unrouted orgs are byte-identical to before.
 */
const LADDER: Record<LlmTask, Record<ContentComplexity, LlmRoute>> = {
  outline: { general: HAIKU, professional: SONNET, technical: SONNET },
  draft: { general: HAIKU, professional: SONNET, technical: OPUS },
  humanize: { general: HAIKU, professional: HAIKU, technical: SONNET },
  finalize: { general: HAIKU, professional: HAIKU, technical: HAIKU },
  image_plan: { general: HAIKU, professional: HAIKU, technical: HAIKU },
};

export function routeLlm(complexity: ContentComplexity, task: LlmTask): LlmRoute {
  return LADDER[task][complexity];
}
```

- [ ] **Step 5: Add `timeoutMs` to the params and thread it through the client**

`packages/shared/providers/src/llm/types.ts` — add to `LlmCompleteParams` after `temperature`:

```ts
  /** Overrides the client's configured timeout for this call (routed per model). */
  timeoutMs?: number;
```

`packages/shared/providers/src/llm/client.ts`:

1. Replace the two local constants with imports:
   ```ts
   import { DEFAULT_LLM_MODEL, DEFAULT_LLM_TIMEOUT_MS } from './routing';
   ```
   delete `const DEFAULT_MODEL = …` and `const DEFAULT_TIMEOUT_MS = …`, and change the two uses to `config.defaultModel ?? DEFAULT_LLM_MODEL` and `config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS`.
2. `once(body)` becomes `once(body: Record<string, unknown>, timeout: number)` and uses `timeout` in `setTimeout(() => controller.abort(), timeout)`.
3. `send(body)` becomes `send(body: Record<string, unknown>, timeout: number)` and calls `once(body, timeout)`.
4. In `complete`, compute `const timeout = params.timeoutMs ?? timeoutMs;` and call `send(body, timeout)` in both places (the initial send and the empty-body retry).

- [ ] **Step 6: Export from the package index**

In `packages/shared/providers/src/index.ts`, after `export * from './llm/client';` add:

```ts
export * from './llm/routing';
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npm test -- llm && npm run check`
Expected: PASS for `llm-routing.test.ts` and `llm.test.ts`.

- [ ] **Step 8: Lint and commit**

```bash
npm run lint:fix
git add packages/shared/providers
git commit -m "feat(providers): per-stage LLM routing table and per-call timeout

Part of #N

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Route the article text stages

**Files:**
- Modify: `packages/shared/generation/src/types.ts:5-29`, `packages/shared/generation/src/context.ts:14-38`, `packages/shared/generation/tests/outline.test.ts:18`, `packages/shared/generation/tests/prompts.test.ts:18`
- Create: `packages/shared/articles/src/llm-usage.ts`
- Modify: `packages/shared/articles/src/stages/outline.ts`, `draft.ts`, `humanize.ts:57`, `finalize.ts:85-90,117-127`, `images.ts:91-105`
- Test: `packages/shared/articles/tests/llm-usage.test.ts` (new), `early-stages.test.ts`, `humanize-stage.test.ts`, `finalize-stage.test.ts`, `images-stages.test.ts`

**Interfaces:**
- Consumes: `routeLlm`, `LlmResult` from `@shared/providers`; `ContentComplexity` from `@shared/schemas`.
- Produces: `GenerationContext.contentComplexity: ContentComplexity`; `logLlmUsage(stage: string, result: LlmResult): void` in `packages/shared/articles/src/llm-usage.ts`.

- [ ] **Step 1: Add `contentComplexity` to the generation context**

`packages/shared/generation/src/types.ts` — add `ContentComplexity` to the `import type` from `@shared/schemas` and, after `readabilityGradeMax`, add:

```ts
  // Selects the LLM ladder each stage runs on (design/ai-model-routing.md).
  // Comes from presets.article_preferences.content_seo.content_complexity.
  contentComplexity: ContentComplexity;
```

`packages/shared/generation/src/context.ts` — after the `readabilityGradeMax:` line add:

```ts
    contentComplexity: p.article_preferences.content_seo.content_complexity,
```

Add `contentComplexity: 'general',` next to `readabilityGradeMax: 8,` in both `packages/shared/generation/tests/outline.test.ts` and `packages/shared/generation/tests/prompts.test.ts` (the hand-built context literals).

Run: `npm run check && npm test -- generation`
Expected: PASS.

- [ ] **Step 2: Write the failing usage-log test**

Create `packages/shared/articles/tests/llm-usage.test.ts`:

```ts
import { afterEach, expect, test, vi } from 'vitest';
import { logLlmUsage } from '../src/llm-usage';

afterEach(() => vi.restoreAllMocks());

// The staging check reads this line to confirm which model a stage ran on;
// the run document records nothing about models (design/ai-model-routing.md).
test('logs stage, served model and measured usage on one info line', () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});

  logLlmUsage('draft', {
    text: 'x',
    model: 'anthropic/claude-opus-5',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, costUsd: 0.5 },
  });

  expect(info).toHaveBeenCalledWith('llm usage', {
    stage: 'draft',
    model: 'anthropic/claude-opus-5',
    prompt_tokens: 10,
    completion_tokens: 20,
    cost_usd: 0.5,
  });
});
```

- [ ] **Step 3: Write the failing stage model assertions**

`packages/shared/articles/tests/early-stages.test.ts` — inside `describe('stageOutline', …)` and `describe('stageDraft', …)`, add one test each (the `presets` fixture defaults to `general`; build a technical run inline):

```ts
  test('routes the outline model by the run snapshot content_complexity', async () => {
    const llm = llmReplying(outlineJson);
    const technical = makeRun({
      presets: {
        ...presets,
        article_preferences: {
          ...presets.article_preferences,
          content_seo: { ...presets.article_preferences.content_seo, content_complexity: 'technical' },
        },
      },
    });

    await stageOutline(technical, llm);

    expect(llm.complete).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'anthropic/claude-sonnet-5', timeoutMs: 120_000 }),
    );
  });
```

and for draft. Copy the `makeRun({ working: { outline: … } })` argument verbatim from the file's existing `stageDraft` happy-path test (the one that asserts `working.draft`) and add only the `presets` key shown here:

```ts
  test('routes the draft model by the run snapshot content_complexity', async () => {
    const llm = llmReplying('## One\n\nbody');
    const technical = makeRun({
      working: { /* copied from the existing stageDraft happy-path test */ },
      presets: {
        ...presets,
        article_preferences: {
          ...presets.article_preferences,
          content_seo: { ...presets.article_preferences.content_seo, content_complexity: 'technical' },
        },
      },
    });

    await stageDraft(technical, llm);

    expect(llm.complete).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'anthropic/claude-opus-5', timeoutMs: 240_000 }),
    );
  });
```

Also add a `general` assertion to the existing outline test at `early-stages.test.ts:116` (`calls llm.complete with OUTLINE_RESPONSE_SCHEMA…`): extend its `toHaveBeenCalledWith(expect.objectContaining({ … }))` with `model: 'anthropic/claude-haiku-4.5', timeoutMs: 60_000`.

The `makeRun` parameter is typed `typeof presets`, so an object literal with an extra key fails the excess-property check. Add `content_complexity: 'general' as const,` after `readability_grade_max: 8,` in `packages/shared/articles/tests/fixtures.ts` so the key exists on the fixture type.

`packages/shared/articles/tests/humanize-stage.test.ts` — add:

```ts
  test('routes the humanize model by content_complexity', async () => {
    const llm = llmReplying('Acme rewrite-pass');
    const technical = makeRun({
      working: { draft: 'Acme draft' },
      presets: {
        ...presets,
        article_preferences: {
          ...presets.article_preferences,
          content_seo: { ...presets.article_preferences.content_seo, content_complexity: 'technical' },
        },
      },
    });

    await stageHumanize(technical, llm);

    expect(llm.complete).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'anthropic/claude-sonnet-5', timeoutMs: 120_000 }),
    );
  });
```

(Check the file's existing `gradeOf` map and `makeRun` usage first; the draft text must be a key whose grade passes, e.g. reuse whatever the first-pass test uses for `working.draft` and the reply text.)

`packages/shared/articles/tests/finalize-stage.test.ts` — add:

```ts
  test('routes the semantic check to the finalize task (Haiku at every complexity)', async () => {
    const llm = llmReplying(semanticPass);
    const technical = makeRun({
      ...runOverrides,
      presets: {
        ...presets,
        article_preferences: {
          ...presets.article_preferences,
          content_seo: { ...presets.article_preferences.content_seo, content_complexity: 'technical' },
        },
      },
    });

    await stageFinalize(technical, { llm, youtube });

    expect(llm.complete).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'anthropic/claude-haiku-4.5', timeoutMs: 60_000 }),
    );
  });
```

where `runOverrides` is whatever `working`/`status` the file's happy-path test passes to `makeRun` (read the file; reuse its run construction verbatim, adding only `presets`).

`packages/shared/articles/tests/images-stages.test.ts` — inside `describe('stageImagesPlan', …)` add:

```ts
  test('plans on the image_plan route (Haiku at every complexity)', async () => {
    findArticleById.mockResolvedValue({ ...article, images: [] });
    llmComplete.mockResolvedValue({ text: planJson, model: 'm', usage: usageStub });

    await stageImagesPlan(run, { complete: llmComplete });

    expect(llmComplete).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'anthropic/claude-haiku-4.5', timeoutMs: 60_000 }),
    );
  });
```

- [ ] **Step 4: Run to verify they fail**

Run: `npm test -- articles`
Expected: FAIL — `../src/llm-usage` missing; `model`/`timeoutMs` absent from the `complete` calls.

- [ ] **Step 5: Create the usage logger**

`packages/shared/articles/src/llm-usage.ts`:

```ts
import type { LlmResult } from '@shared/providers';

/**
 * One info line per LLM call, keyed by stage. The run document records nothing
 * about models, so this is how a staging check (or a cost question) learns
 * which model actually served a stage and what it cost.
 */
export function logLlmUsage(stage: string, result: LlmResult): void {
  console.info('llm usage', {
    stage,
    model: result.model,
    prompt_tokens: result.usage.promptTokens,
    completion_tokens: result.usage.completionTokens,
    cost_usd: result.usage.costUsd,
  });
}
```

- [ ] **Step 6: Route each stage**

`packages/shared/articles/src/stages/outline.ts`:

```ts
import { buildOutlinePrompt, OUTLINE_RESPONSE_SCHEMA, parseOutline } from '@shared/generation';
import { type LlmClient, routeLlm } from '@shared/providers';
import type { ArticleRun } from '@shared/schemas';
import { contextFromRun } from '../context';
import { logLlmUsage } from '../llm-usage';
import type { StageOutcome } from './types';

export async function stageOutline(run: ArticleRun, llm: LlmClient): Promise<StageOutcome> {
  const ctx = contextFromRun(run);
  const res = await llm.complete({
    messages: buildOutlinePrompt(ctx),
    responseSchema: OUTLINE_RESPONSE_SCHEMA,
    ...routeLlm(ctx.contentComplexity, 'outline'),
  });
  logLlmUsage('outline', res);
  const outline = parseOutline(res.text, ctx);
  return { completed: true, working: { outline } };
}
```

`packages/shared/articles/src/stages/draft.ts` — change the import to `import { type LlmClient, routeLlm } from '@shared/providers';`, add `import { logLlmUsage } from '../llm-usage';`, and replace the `complete` call:

```ts
  const res = await llm.complete({
    messages: buildArticlePrompt(ctx, outline),
    ...routeLlm(ctx.contentComplexity, 'draft'),
  });
  logLlmUsage('draft', res);
```

`packages/shared/articles/src/stages/humanize.ts` — same import changes; replace line 57:

```ts
  const res = await llm.complete({
    messages: buildHumanizePrompt(ctx, input, feedback),
    ...routeLlm(ctx.contentComplexity, 'humanize'),
  });
  logLlmUsage('humanize', res);
```

`packages/shared/articles/src/stages/finalize.ts` — add `import { routeLlm } from '@shared/providers';` and `import { logLlmUsage } from '../llm-usage';`. Both calls route to `finalize`:

```ts
  const finalizeRoute = routeLlm(ctx.contentComplexity, 'finalize');
  const semRes = await llm.complete({
    messages: buildSemanticCheckPrompt(ctx, content),
    responseSchema: SEMANTIC_RESPONSE_SCHEMA,
    ...finalizeRoute,
  });
  logLlmUsage('finalize', semRes);
```

and in the video block:

```ts
        const res = await llm.complete({
          messages: buildVideoPickPrompt({ … unchanged … }),
          responseSchema: VIDEO_PICK_RESPONSE_SCHEMA,
          ...finalizeRoute,
        });
        logLlmUsage('finalize', res);
```

`packages/shared/articles/src/stages/images.ts` — change the provider import to `import { type ImageResult, type LlmClient, routeLlm } from '@shared/providers';`, add `import { logLlmUsage } from '../llm-usage';`, and in `stageImagesPlan`:

```ts
  const res = await llm.complete({
    messages: buildImagePlanPrompt({ … unchanged … }),
    responseSchema: IMAGE_PLAN_RESPONSE_SCHEMA,
    ...routeLlm(presets.article_preferences.content_seo.content_complexity, 'image_plan'),
  });
  logLlmUsage('image_plan', res);
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npm test -- articles && npm run check`
Expected: PASS.

- [ ] **Step 8: Lint and commit**

```bash
npm run lint:fix
git add packages/shared/generation packages/shared/articles
git commit -m "feat(articles): route each text stage by content_complexity

Part of #N

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Scanner assigns `content_complexity`

**Files:**
- Modify: `apps/worker/src/scanner.ts:23-36,52-77`
- Test: `apps/worker/tests/scanner.test.ts`

**Interfaces:**
- Consumes: `CONTENT_COMPLEXITIES` from `@shared/schemas`.
- Produces: the scan's structured output includes `article_preferences.content_seo.content_complexity`.

- [ ] **Step 1: Update the fixture and write the failing tests**

In `apps/worker/tests/scanner.test.ts`, add `content_complexity: 'professional',` to `LLM_JSON.article_preferences.content_seo` (after `readability_grade_max: 10,`). Then append inside `describe('scanWebsite', …)`:

```ts
  test('asks for a content complexity and lands it in presets', async () => {
    fetchSite.mockResolvedValue({ text: 'x', links: [] });
    const llm = llmReturning(LLM_JSON);

    const presets = await scanWebsite('https://clewas.com', { llm });

    const system = String(llm.complete.mock.calls[0]![0].messages[0]!.content);
    expect(system).toContain('content_complexity');
    expect(system).toContain('general for consumer');
    expect(system).toContain('technical for developer tools');
    expect(presets.article_preferences.content_seo.content_complexity).toBe('professional');

    const schema = JSON.stringify(llm.complete.mock.calls[0]![0].responseSchema?.schema);
    expect(schema).toContain('"content_complexity"');
    expect(schema).toContain('"technical"');
  });

  test('rejects a content complexity outside the enum', async () => {
    fetchSite.mockResolvedValue({ text: 'x', links: [] });
    const off = JSON.parse(LLM_JSON);
    off.article_preferences.content_seo.content_complexity = 'expert';

    await expect(
      scanWebsite('https://clewas.com', { llm: llmReturning(JSON.stringify(off)) }),
    ).rejects.toThrow();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- scanner`
Expected: the two new tests FAIL (prompt lacks the text; schema lacks the key).

- [ ] **Step 3: Implement**

`apps/worker/src/scanner.ts` — add `CONTENT_COMPLEXITIES` to the `@shared/schemas` import. In `ScanOutputSchema.content_seo`, after `readability_grade_max`:

```ts
      content_complexity: z.enum(CONTENT_COMPLEXITIES),
```

In `buildScanPrompt`'s `system` array, after the three `readability_grade_max` lines:

```ts
    'content_complexity is how expert the articles must read: general for consumer, lifestyle',
    'and local-service sites; professional for B2B, finance, legal and agency audiences;',
    'technical for developer tools, infrastructure, engineering and scientific products whose',
    'readers expect precise, expert-level content.',
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- scanner && npm run check`
Expected: PASS (the whole scanner suite, including the pre-existing readability tests).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint:fix
git add apps/worker
git commit -m "feat(worker): scanner assigns content_complexity

Part of #N

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `diagram` medium and the admin editor

**Files:**
- Modify: `packages/shared/schemas/src/presets.ts:18-26`, `packages/shared/schemas/tests/presets.test.ts:168-177`
- Modify: `packages/shared/generation/src/images.ts:161-178` (the two `Record<ImageMedium, …>` maps), `packages/shared/generation/tests/images.test.ts:376-389`
- Modify: `apps/admin/src/pages/org/PresetsEditor.tsx:1-19,185-226`

**Interfaces:**
- Produces: `ImageMedium` includes `'diagram'`; `MEDIUM_NOUN.diagram = 'labelled schematic diagrams'`; admin editor edits `content_complexity` and can pick `Diagram`.

- [ ] **Step 1: Update the enum test**

In `packages/shared/schemas/tests/presets.test.ts`, rename the test `'the enum is the fixed six media'` to `'the enum is the six media plus diagram, appended last'` and set the expected array to:

```ts
    expect(IMAGE_MEDIA).toEqual([
      'photograph',
      'flat_illustration',
      'three_d_render',
      'watercolor',
      'line_art',
      'isometric',
      'diagram',
    ]);
```

Run: `npm test -- presets` — Expected: FAIL on that test.

- [ ] **Step 2: Add the medium**

`packages/shared/schemas/src/presets.ts` — append `'diagram',` to `IMAGE_MEDIA` and extend the doc comment above it with:

```ts
 * `diagram` (design/ai-model-routing.md) is the one medium that carries text:
 * labelled schematics for technical sites, routed to a text-capable image model.
```

Run: `npm test -- presets` — Expected: PASS. Run `npm run check:all` — Expected: FAIL in `packages/shared/generation/src/images.ts` (two `Record<ImageMedium, string>` maps) and `apps/admin/src/pages/org/PresetsEditor.tsx` (`MEDIUM_LABEL`). That is the compiler enumerating every place a medium is spelled out.

- [ ] **Step 3: Fill the generation records and scope the media loop test**

`packages/shared/generation/src/images.ts`:

```ts
const MEDIUM_CLAUSE: Record<ImageMedium, string> = {
  …existing six…,
  diagram: 'A clean, flat schematic diagram',
};

const MEDIUM_NOUN: Record<ImageMedium, string> = {
  …existing six…,
  diagram: 'labelled schematic diagrams',
};
```

In `packages/shared/generation/tests/images.test.ts`, the test `'always disclaims being a document, worded per medium'` loops over every medium and asserts the no-text clause. A diagram is the one medium that carries text (Task 8 gives it its own prompt and tests), so change the loop to:

```ts
    // `diagram` is the one medium that carries text; it has its own prompt branch.
    for (const medium of IMAGE_MEDIA.filter((m) => m !== 'diagram')) {
```

Run: `npm test -- generation` — Expected: PASS.

- [ ] **Step 4: Admin editor: label and complexity select**

`apps/admin/src/pages/org/PresetsEditor.tsx`:

Import line 1 becomes:

```ts
import {
  CONTENT_COMPLEXITIES,
  type ContentComplexity,
  IMAGE_MEDIA,
  type ImageMedium,
} from '@shared/schemas';
```

Add `diagram: 'Diagram (labelled schematic)',` to `MEDIUM_LABEL`, and below it:

```ts
/** Option labels for `CONTENT_COMPLEXITIES` — picks the LLM ladder every stage runs on. */
const COMPLEXITY_LABEL: Record<ContentComplexity, string> = {
  general: 'General (Haiku everywhere — today\'s default)',
  professional: 'Professional (Sonnet outline + draft)',
  technical: 'Technical (Sonnet outline + humanize, Opus draft)',
};
```

In the `Article preferences` group, directly after the `Internal links per article` `<label>` block, add:

```tsx
          <label className="block">
            <span className={LABEL}>Content complexity</span>
            <select
              className={`${INPUT} mt-1`}
              value={contentSeo.content_complexity}
              onChange={(event) =>
                setContentSeo({ content_complexity: event.target.value as ContentComplexity })
              }
            >
              {CONTENT_COMPLEXITIES.map((complexity) => (
                <option key={complexity} value={complexity}>
                  {COMPLEXITY_LABEL[complexity]}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-neutral-500">
              How expert the articles must read; selects the models each stage runs on.
            </span>
          </label>
```

Run: `npm run check:all` — Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint:fix
git add packages/shared/schemas packages/shared/generation apps/admin
git commit -m "feat: diagram image medium; admin editor edits complexity and medium

Part of #N

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Image routing table and fal `aspect_ratio`

**Files:**
- Create: `packages/shared/providers/src/image/routing.ts`
- Modify: `packages/shared/providers/src/image/types.ts:10-18`, `packages/shared/providers/src/image/client.ts:5,66-71`, `packages/shared/providers/src/index.ts`
- Test: `packages/shared/providers/tests/image-routing.test.ts` (new), `packages/shared/providers/tests/image.test.ts`

**Interfaces:**
- Consumes: `ImageMedium`, `IMAGE_MEDIA` from `@shared/schemas`.
- Produces:
  ```ts
  export const DEFAULT_IMAGE_MODEL = 'fal-ai/flux-2';
  export const DIAGRAM_IMAGE_MODEL = 'fal-ai/nano-banana-pro';
  export interface ImageRoute { model: string; sizing: 'pixels' | 'aspect_ratio' }
  export function routeImage(medium: ImageMedium): ImageRoute;
  export type ImageAspectRatio = '21:9' | '16:9' | '4:3' | '1:1';
  ```
  and `ImageGenerateParams.aspectRatio?: ImageAspectRatio` → fal body `aspect_ratio`.

- [ ] **Step 1: Write the failing routing tests**

`packages/shared/providers/tests/image-routing.test.ts`:

```ts
import { IMAGE_MEDIA } from '@shared/schemas';
import { describe, expect, test } from 'vitest';
import { DEFAULT_IMAGE_MODEL, DIAGRAM_IMAGE_MODEL, routeImage } from '../src/image/routing';

describe('routeImage', () => {
  // The medium is the only image-routing signal; content_complexity never is.
  test('diagram goes to the text-capable model, sized by aspect ratio', () => {
    expect(routeImage('diagram')).toEqual({ model: DIAGRAM_IMAGE_MODEL, sizing: 'aspect_ratio' });
    expect(DIAGRAM_IMAGE_MODEL).toBe('fal-ai/nano-banana-pro');
  });

  test('every other medium keeps flux-2 with exact pixels', () => {
    for (const medium of IMAGE_MEDIA.filter((m) => m !== 'diagram')) {
      expect(routeImage(medium)).toEqual({ model: DEFAULT_IMAGE_MODEL, sizing: 'pixels' });
    }
    expect(DEFAULT_IMAGE_MODEL).toBe('fal-ai/flux-2');
  });
});
```

- [ ] **Step 2: Write the failing client test**

Append inside `describe('generate', …)` in `packages/shared/providers/tests/image.test.ts`:

```ts
  // nano-banana-pro takes aspect_ratio, not image_size (fal OpenAPI, 2026-09-13).
  test('sends aspectRatio as fal aspect_ratio', async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    await client().generate({ prompt: 'a diagram', model: 'fal-ai/nano-banana-pro', aspectRatio: '16:9' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://fal.run/fal-ai/nano-banana-pro');
    expect(JSON.parse(init.body as string)).toEqual({ prompt: 'a diagram', aspect_ratio: '16:9' });
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm test -- image`
Expected: FAIL — routing module missing; `aspect_ratio` absent from the body.

- [ ] **Step 4: Implement**

`packages/shared/providers/src/image/routing.ts`:

```ts
import type { ImageMedium } from '@shared/schemas';

/** What every image got before routing existed. */
export const DEFAULT_IMAGE_MODEL = 'fal-ai/flux-2';
/**
 * Gemini's image model on fal: the one that renders the labels a diagram is
 * made of legibly. flux-2 letters garbage on anything that implies text.
 */
export const DIAGRAM_IMAGE_MODEL = 'fal-ai/nano-banana-pro';

export interface ImageRoute {
  /** fal model id. */
  model: string;
  /** flux-2 takes exact pixels (`image_size`); nano-banana takes an `aspect_ratio` enum. */
  sizing: 'pixels' | 'aspect_ratio';
}

/** The org's medium is the only image-routing signal (design/ai-model-routing.md). */
export function routeImage(medium: ImageMedium): ImageRoute {
  return medium === 'diagram'
    ? { model: DIAGRAM_IMAGE_MODEL, sizing: 'aspect_ratio' }
    : { model: DEFAULT_IMAGE_MODEL, sizing: 'pixels' };
}
```

`packages/shared/providers/src/image/types.ts` — after `ImageOutputFormat`:

```ts
/** fal `aspect_ratio` values shared by the nano-banana models. */
export type ImageAspectRatio = '21:9' | '16:9' | '4:3' | '1:1';
```

and in `ImageGenerateParams` after `size?`:

```ts
  /** For models sized by ratio rather than pixels (nano-banana). */
  aspectRatio?: ImageAspectRatio;
```

`packages/shared/providers/src/image/client.ts` — replace `const DEFAULT_MODEL = 'fal-ai/flux-2';` with `import { DEFAULT_IMAGE_MODEL } from './routing';` and use `config.defaultModel ?? DEFAULT_IMAGE_MODEL`. In `generate`, after `if (params.size) body.image_size = params.size;` add:

```ts
      if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
```

`packages/shared/providers/src/index.ts` — after `export * from './image/client';` add `export * from './image/routing';`.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -- image && npm run check`
Expected: PASS.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint:fix
git add packages/shared/providers
git commit -m "feat(providers): image routing by medium; fal aspect_ratio param

Part of #N

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Diagram planner and prompt

**Files:**
- Modify: `packages/shared/generation/src/images.ts` (slot schema, `imagePrompt`, `buildImagePlanPrompt`), `packages/shared/generation/src/index.ts`
- Test: `packages/shared/generation/tests/images.test.ts`

**Interfaces:**
- Produces: `ImageSlot.labels: string[]` (parse default `[]`, required on the wire); `MAX_DIAGRAM_LABELS = 5`; `diagramLabels(labels: string[]): string[]`; `imagePrompt` returns the diagram prompt when `direction.medium === 'diagram'`; `buildImagePlanPrompt` uses the diagram system prompt for that medium.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/generation/tests/images.test.ts` (add `diagramLabels`, `MAX_DIAGRAM_LABELS` to the `'../src/images'` import):

```ts
describe('diagramLabels', () => {
  test('trims, collapses whitespace, drops blanks and case-insensitive duplicates, caps at 5', () => {
    expect(
      diagramLabels([' API  Gateway ', '', 'api gateway', 'Queue', 'Worker', 'DB', 'Cache', 'CDN']),
    ).toEqual(['API Gateway', 'Queue', 'Worker', 'DB', 'Cache']);
    expect(MAX_DIAGRAM_LABELS).toBe(5);
  });
});

describe('imagePrompt for the diagram medium', () => {
  const diagram = direction({ medium: 'diagram', palette: 'deep navy and white' });
  const slot = {
    subject: 'how a scan task moves from the API to the worker',
    composition: 'still_life' as const,
    lighting: 'natural_daylight' as const,
    objects: ['server rack'],
    labels: ['API', 'SQS queue', 'Worker', 'MongoDB'],
  };

  test('asks for a labelled schematic with exactly the planned labels and no other text', () => {
    const prompt = imagePrompt(diagram, slot);
    expect(prompt).toContain(
      'A clean, flat schematic diagram explaining how a scan task moves from the API to the worker',
    );
    expect(prompt).toContain('exactly these 4 labels');
    expect(prompt).toContain('"API", "SQS queue", "Worker", "MongoDB"');
    expect(prompt).toContain('Palette: deep navy and white.');
    expect(prompt).toContain('No other words, captions, titles, logos or watermarks.');
    // The no-text ban and the photographic clauses do not apply to diagrams.
    expect(prompt).not.toContain('No text, lettering, signage or logos anywhere in the frame.');
    expect(prompt).not.toContain('server rack');
    expect(prompt).not.toContain('daylight');
  });

  test('with no usable labels it asks for a wordless diagram', () => {
    const prompt = imagePrompt(diagram, { ...slot, labels: ['', '  '] });
    expect(prompt).toContain('No text anywhere in the image.');
    expect(prompt).not.toContain('exactly these');
  });

  test('every non-diagram medium ignores labels', () => {
    for (const medium of IMAGE_MEDIA.filter((m) => m !== 'diagram')) {
      const prompt = imagePrompt(direction({ medium }), slot);
      expect(prompt).not.toContain('SQS queue');
      expect(prompt).toContain('No text, lettering, signage or logos anywhere in the frame.');
    }
  });
});

describe('buildImagePlanPrompt for the diagram medium', () => {
  const input = {
    businessName: 'Piper',
    businessDescription: 'infra tooling',
    language: 'English',
    imageDirection: direction({ medium: 'diagram' }),
    articleTitle: 'T',
    metaDescription: 'M',
    headings,
  };

  test('asks for labels and says they are the only words rendered', () => {
    const [system, user] = buildImagePlanPrompt(input).map((m) => String(m.content));
    expect(user).toContain('Images are labelled schematic diagrams.');
    expect(system).toContain('labels: 3 to 5 short labels');
    expect(system).toContain('at most 3 words each');
    expect(system).toContain('ONLY words that will appear in the image');
    expect(system).toContain('written in English');
    expect(system).toContain(`exactly ${INLINE_IMAGE_COUNT}`);
    expect(system).not.toContain('Never a screen, diagram');
  });

  test('non-diagram media are told to return no labels', () => {
    const [system] = buildImagePlanPrompt({ ...input, imageDirection: photo }).map((m) =>
      String(m.content),
    );
    expect(system).toContain('labels: return an empty list');
  });
});

describe('parseImagePlan labels', () => {
  test('a plan without labels parses to empty label lists', () => {
    const plan = parseImagePlan(JSON.stringify(validPlan), headings);
    expect(plan.cover.labels).toEqual([]);
    expect(plan.inline[0]!.labels).toEqual([]);
  });

  test('labels are required on the wire schema', () => {
    const cover = (
      (IMAGE_PLAN_RESPONSE_SCHEMA.schema.properties as Record<string, { required: string[] }>)
        .cover
    );
    expect(cover.required).toContain('labels');
  });
});
```

Add `IMAGE_PLAN_RESPONSE_SCHEMA` to the import from `'../src/images'`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- generation/tests/images`
Expected: FAIL — `diagramLabels` not exported; prompts lack the diagram text.

- [ ] **Step 3: Implement in `packages/shared/generation/src/images.ts`**

Slot schema — add `labels` with a parse default (the wire schema still requires it; see `toStrictJsonSchema`'s `io: 'input'` note):

```ts
const ImageSlotSchema = z.object({
  subject: z.string().min(1),
  composition: z.enum(IMAGE_COMPOSITIONS),
  lighting: z.enum(IMAGE_LIGHTING),
  objects: z.array(z.string()),
  // The words a diagram is made of; every other medium ignores them (#N).
  // Defaulted so plans stored before the field existed still parse.
  labels: z.array(z.string()).default([]),
  alt: z.string().min(1),
});
```

Add after `usableObjects`:

```ts
/** Most labels a diagram may carry; more than this stops being legible at 1200px. */
export const MAX_DIAGRAM_LABELS = 5;

/**
 * The only text a diagram may carry: the planner's labels, tidied, de-duplicated
 * (case-insensitively) and capped. Never filtered by `findTextRisk` — words are
 * the point here.
 */
export function diagramLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const label = raw.trim().replace(/\s+/g, ' ');
    const key = label.toLowerCase();
    if (label === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out.slice(0, MAX_DIAGRAM_LABELS);
}
```

Add before `imagePrompt`:

```ts
/**
 * The diagram medium's prompt. Composition, lighting and objects are photographic
 * ideas and are ignored; the subject says what the diagram explains and the
 * labels are the only text the model may render, spelled out verbatim. The
 * no-text ban is deliberately absent — the render stage skips it too.
 */
function diagramPrompt(direction: ImageDirection, slot: Omit<ImageSlot, 'alt'>): string {
  const labels = diagramLabels(slot.labels);
  const palette = direction.palette.trim();
  return [
    `${MEDIUM_CLAUSE.diagram} explaining ${slot.subject}: simple labelled boxes connected by arrows on a plain background, in the style of technical documentation.`,
    labels.length > 0
      ? `The only text in the image is exactly these ${labels.length} labels, each rendered once in a clean sans-serif typeface and spelled exactly: ${labels.map((l) => `"${l}"`).join(', ')}.`
      : 'No text anywhere in the image.',
    palette !== '' && findTextRisk(palette) === null ? `Palette: ${palette}.` : '',
    'No other words, captions, titles, logos or watermarks.',
  ]
    .filter(Boolean)
    .join(' ');
}
```

At the top of `imagePrompt`'s body insert:

```ts
  if (direction.medium === 'diagram') return diagramPrompt(direction, slot);
```

Planner prompt — extract the existing `system` array in `buildImagePlanPrompt` into `function picturePlanSystem(language: string): string` (verbatim, returning the joined string, with `input.language` → `language`), and add one bullet after the `- alt:` line:

```ts
    '- labels: return an empty list; these images carry no text.',
```

Add the diagram variant:

```ts
function diagramPlanSystem(language: string): string {
  return [
    'You are a technical illustrator deciding what each diagram of one blog article shows.',
    `Return a cover entry and exactly ${INLINE_IMAGE_COUNT} inline entries; each`,
    'section_heading MUST be copied EXACTLY from the provided section list, each from a',
    'DIFFERENT section.',
    'Every image is a labelled schematic diagram — boxes and arrows in the style of technical',
    'documentation. For every entry:',
    '- subject: what the diagram explains — a process, an architecture, a data flow or a',
    '  comparison — as a short phrase. Use a DIFFERENT subject for each of the three images.',
    `- labels: 3 to ${MAX_DIAGRAM_LABELS} short labels naming the boxes or steps, at most 3 words each,`,
    `  written in ${language}. These are the ONLY words that will appear in the image.`,
    '  Never name a brand or a branded product.',
    `- composition: ${IMAGE_COMPOSITIONS.join(' | ')} and lighting: ${IMAGE_LIGHTING.join(' | ')}`,
    '  are not used for diagrams; return any value.',
    '- objects: return an empty list.',
    `- alt: a meaningful description of the diagram for screen readers, written in ${language}.`,
    'You are NOT writing the image prompt. Nothing you return is passed to the image model',
    'verbatim except the labels.',
  ].join('\n');
}
```

and in `buildImagePlanPrompt`:

```ts
  const system =
    input.imageDirection.medium === 'diagram'
      ? diagramPlanSystem(input.language)
      : picturePlanSystem(input.language);
```

(the `user` message is unchanged; `MEDIUM_NOUN.diagram` already yields `Images are labelled schematic diagrams.`).

`packages/shared/generation/src/index.ts` — add `diagramLabels` and `MAX_DIAGRAM_LABELS` to the `./images` export list (alphabetical: `diagramLabels` after `buildImagePlanPrompt`, `MAX_DIAGRAM_LABELS` after `injectImageAfterHeading`).

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- generation && npm run check`
Expected: PASS, including the pre-existing `buildImagePlanPrompt` and `imagePrompt` tests.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint:fix
git add packages/shared/generation
git commit -m "feat(generation): diagram planner and prompt with verbatim labels

Part of #N

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Image stages route by medium

**Files:**
- Modify: `packages/shared/articles/src/stages/images.ts:18-19,153-235`
- Test: `packages/shared/articles/tests/images-stages.test.ts`

**Interfaces:**
- Consumes: `routeImage`, `DEFAULT_IMAGE_MODEL`, `DIAGRAM_IMAGE_MODEL` from `@shared/providers`; `ImageSlot.labels` from Task 8.
- Produces: the render stage passes the routed model, `size` or `aspectRatio` per route, skips `withNoTextDirective` for `diagram`, and records the routed model on the slot. `IMAGE_MODEL` is deleted.

- [ ] **Step 1: Write the failing tests**

In `packages/shared/articles/tests/images-stages.test.ts` add a diagram run next to `directedRun`:

```ts
const diagramRun = makeRun({
  working: { article_id: 'a1' },
  presets: {
    ...presets,
    article_preferences: {
      ...presets.article_preferences,
      engagement: {
        ...presets.article_preferences.engagement,
        image_direction: { medium: 'diagram', palette: 'navy and white', notes: '' },
      },
    },
  },
});
```

Inside `describe('stageImagesRender', …)` add:

```ts
  test('non-diagram media render on flux-2 with exact pixels and record that model', async () => {
    findArticleById
      .mockResolvedValueOnce({ ...article, images: plannedSlots() })
      .mockResolvedValue({ ...article, images: filledSlots() });

    await stageImagesRender(run, { generate: imageGenerate });

    const first = imageGenerate.mock.calls[0]![0] as Record<string, unknown>;
    expect(first.model).toBe('fal-ai/flux-2');
    expect(first.size).toEqual({ width: 1200, height: 630 });
    expect(first.aspectRatio).toBeUndefined();
    expect((fillImageSlot.mock.calls[0]![2] as { model: string }).model).toBe('fal-ai/flux-2');
  });

  // Diagrams are the one medium made of text: the no-text ban would fight the
  // labels, and flux-2 cannot render them, so the medium picks the model.
  test('the diagram medium renders on nano-banana-pro at 16:9 without the no-text directive', async () => {
    findArticleById
      .mockResolvedValueOnce({ ...article, images: plannedSlots() })
      .mockResolvedValue({ ...article, images: filledSlots() });

    await stageImagesRender(diagramRun, { generate: imageGenerate });

    for (const call of imageGenerate.mock.calls) {
      const params = call[0] as Record<string, unknown>;
      expect(params.model).toBe('fal-ai/nano-banana-pro');
      expect(params.aspectRatio).toBe('16:9');
      expect(params.size).toBeUndefined();
      expect(params.outputFormat).toBe('webp');
      expect(params.prompt as string).not.toContain(NO_TEXT_DIRECTIVE);
    }
    expect((fillImageSlot.mock.calls[0]![2] as { model: string }).model).toBe(
      'fal-ai/nano-banana-pro',
    );
  });
```

Inside `describe('stageImagesPlan', …)` add:

```ts
  test('a diagram org gets label-bearing prompts', async () => {
    findArticleById.mockResolvedValue({ ...article, images: [] });
    const plan = JSON.parse(planJson);
    plan.cover.labels = ['API', 'Queue', 'Worker'];
    llmComplete.mockResolvedValue({ text: JSON.stringify(plan), model: 'm', usage: usageStub });

    await stageImagesPlan(diagramRun, { complete: llmComplete });

    const messages = llmComplete.mock.calls[0]![0].messages as { content: string }[];
    expect(messages[0]!.content).toContain('technical illustrator');
    const slots = setImagePlan.mock.calls[0]![1] as ArticleImage[];
    expect(slots[0]!.prompt).toContain('"API", "Queue", "Worker"');
    expect(slots[0]!.prompt).toContain('Palette: navy and white.');
    expect(slots[1]!.prompt).toContain('No text anywhere in the image.');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- images-stages`
Expected: FAIL — model is `fal-ai/flux-2` for the diagram run; `aspectRatio` undefined; no-text directive present.

- [ ] **Step 3: Implement in `packages/shared/articles/src/stages/images.ts`**

Change the provider import to:

```ts
import { type ImageResult, type LlmClient, routeImage, routeLlm } from '@shared/providers';
```

Delete the `IMAGE_MODEL` constant and its comment (lines 18-19).

In `stageImagesRender`, before the `for` loop:

```ts
  const medium = run.input.presets.article_preferences.engagement.image_direction.medium;
  const route = routeImage(medium);
```

Replace the `image.generate({ … })` call:

```ts
    const res = await image.generate({
      // The planner is told to avoid lettering, but flux-2 still renders
      // garbled words on any surface that implies them — so the ban is
      // restated here, which also covers slots planned before that rule.
      // A diagram is made of its labels, so the ban is skipped for that medium.
      prompt: medium === 'diagram' ? slot.prompt : withNoTextDirective(slot.prompt),
      model: route.model,
      // flux-2 takes exact pixels; nano-banana takes a ratio (both slots are ~16:9).
      ...(route.sizing === 'pixels' ? { size: SLOT_SIZE[slot.role] } : { aspectRatio: '16:9' }),
      // fal encodes WebP itself, so no PNG is ever downloaded, stored or
      // published. Measured 63KB-555KB depending on subject detail, against
      // ~2MB as PNG; fal has no quality knob, so the spread is not ours to
      // narrow — see design/article-images.md § Measured (#178).
      outputFormat: 'webp',
    });
```

and in the `fillImageSlot` call replace `model: IMAGE_MODEL,` with `model: route.model,`.

(`stageImagesPlan` needs no change beyond Task 4: `buildImagePlanPrompt` and `imagePrompt` already branch on the medium from `presets`.)

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- images-stages && npm run check`
Expected: PASS, including `'sends the planned prompt with the no-text directive appended'` (a photograph run).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint:fix
git add packages/shared/articles
git commit -m "feat(articles): route image model by medium; diagrams skip the no-text ban

Part of #N

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Scanner may pick `diagram`

**Files:**
- Modify: `apps/worker/src/scanner.ts:62-68`
- Test: `apps/worker/tests/scanner.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside `describe('scanWebsite', …)`:

```ts
  test('describes when diagram is the medium and keeps screenshots out', async () => {
    fetchSite.mockResolvedValue({ text: 'x', links: [] });
    const llm = llmReturning(LLM_JSON);

    await scanWebsite('https://clewas.com', { llm });

    const system = String(llm.complete.mock.calls[0]![0].messages[0]!.content);
    expect(system).toContain('diagram for developer tools');
    expect(system).toContain('Screenshots and real interfaces are never a medium');
    expect(system).not.toContain('Screenshots, diagrams and interfaces are never a medium');
    const schema = JSON.stringify(llm.complete.mock.calls[0]![0].responseSchema?.schema);
    expect(schema).toContain('"diagram"');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- scanner`
Expected: FAIL on the prompt text (the schema already contains `diagram` via the shared enum).

- [ ] **Step 3: Implement**

In `buildScanPrompt`, replace the medium bullet (the lines from `"- medium: …"` through `'  the site suggests those, choose photograph.'`) with:

```ts
    "- medium: the kind of picture that matches the site's visual character — photograph for",
    '  product, hardware or photo-led sites; flat_illustration or isometric for software and',
    '  services with flat brand graphics; three_d_render, watercolor or line_art only when the',
    '  site itself looks that way; diagram for developer tools, infrastructure and engineering',
    '  products whose readers are better served by a labelled schematic than by a picture.',
    '  Screenshots and real interfaces are never a medium; when the site suggests those, choose',
    '  photograph.',
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- scanner && npm run check`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint:fix
git add apps/worker
git commit -m "feat(worker): scanner may choose the diagram medium

Part of #N

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Local render loop for the diagram prompt

**Files:** scratch only (`/private/tmp/claude-501/…/scratchpad/diagram-render.ts`); nothing committed.

This is the manual check the spec requires before the PR: that `nano-banana-pro` actually renders the labels legibly, returns width/height (the stage asserts them), and honours `aspect_ratio` + `webp`.

- [ ] **Step 1: Confirm a fal key is available**

`FAL_KEY` must be in the root `.env` (see `.env.example`). If it is absent, stop and report; do not proceed to Step 2.

- [ ] **Step 2: Write the loop**

```ts
// scratchpad/diagram-render.ts — run with: node --env-file=.env --import tsx <path>
import { imagePrompt } from '@shared/generation';
import { createFalClient, routeImage } from '@shared/providers';

const direction = { medium: 'diagram' as const, palette: 'deep navy and white', notes: '' };
const slots = [
  {
    subject: 'how a scan task moves from the API to the worker',
    composition: 'still_life' as const,
    lighting: 'soft_studio' as const,
    objects: [],
    labels: ['API', 'SQS queue', 'Worker', 'MongoDB'],
  },
  {
    subject: 'the three-tier deploy flow',
    composition: 'abstract' as const,
    lighting: 'soft_studio' as const,
    objects: [],
    labels: ['dev', 'master (staging)', 'GitHub Release (prod)'],
  },
];

const fal = createFalClient({ apiKey: process.env.FAL_KEY! });
const route = routeImage('diagram');
for (const slot of slots) {
  const prompt = imagePrompt(direction, slot);
  console.log('\nPROMPT:', prompt);
  const res = await fal.generate({ prompt, model: route.model, aspectRatio: '16:9', outputFormat: 'webp' });
  console.log('RESULT:', JSON.stringify(res, null, 2));
}
```

- [ ] **Step 3: Run it and inspect the images**

Run from the worktree root:

```bash
node --env-file=.env --import tsx /private/tmp/claude-501/-Users-fco-Documents-projects-seopotion-seo--claude-worktrees-dev-master-merge-staging-623472/e20fb5ae-5c7e-4ea9-a8ff-577c0e81e3da/scratchpad/diagram-render.ts
```

Open each returned URL (the Read tool renders images). Record, per image: were all labels present and spelled correctly, was there any extra text, were `width`/`height` non-null, and the byte size against the 250 KB / 200 KB caps.

- [ ] **Step 4: Act on the result**

- Labels legible and correct, dimensions non-null: continue to Task 12.
- Dimensions null: stop and report — the render stage would throw on `assertImageDimensions`; this needs a decision (probe the bytes vs. a different model), not a silent workaround.
- Labels misspelled or extra text: tweak only the wording of `diagramPrompt` in `packages/shared/generation/src/images.ts`, keep the tests green, re-run. Two attempts max, then report what you saw.

---

### Task 12: Docs, full verification, PR

**Files:**
- Modify: `PROGRESS.md:56` (append one line after the image-prompts entry)

- [ ] **Step 1: PROGRESS.md**

After line 56 add:

```md
- ✅ Per-org model routing: a scan-assigned `content_complexity` picks a per-stage LLM ladder (Haiku → Sonnet → Opus) and a new `diagram` image medium routes to `nano-banana-pro` with verbatim labels; `general` orgs are unchanged ([`design/ai-model-routing.md`](design/ai-model-routing.md)) — [#N](https://github.com/seopotion/seo/issues/N). Staging click-through pending: flip piperbox in the admin editor and generate one article
```

- [ ] **Step 2: Full verification**

```bash
npm run lint && npm run check:all && npm test
```

Expected: lint clean, all three typechecks pass, tests pass except `wordpress-plugin-behavior.test.ts` (php). Paste the summary lines into the PR body.

- [ ] **Step 3: Check the lockfile and branch freshness**

```bash
git status --short && git diff --stat origin/dev -- package-lock.json
```

Expected: no `package-lock.json` change. If there is one, restore it from `origin/dev` (macOS npm prunes Linux `@emnapi` optional deps; see memory). Then:

```bash
git fetch origin dev && git merge origin/dev
```

Resolve conflicts if any, re-run Step 2, commit.

- [ ] **Step 4: Commit and push**

```bash
git add PROGRESS.md
git commit -m "docs: PROGRESS entry for per-org model routing

Part of #N

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin claude/ai-gateway-router-orgs-bc42af
```

- [ ] **Step 5: Open the PR into `dev`**

```bash
gh pr create --repo seopotion/seo --base dev --title "[articles] Per-org AI model routing: content_complexity ladder + diagram medium" --body "$(cat <<'EOF'
Closes #N

Design: `design/ai-model-routing.md`. Plan: `docs/superpowers/plans/2026-09-13-ai-model-routing.md`.

## What
- `content_seo.content_complexity` (general | professional | technical): scan-assigned, admin-editable, schema default `general` — no migration.
- `routeLlm(complexity, task)` in `@shared/providers`: per-stage ladder with per-route timeouts (Opus draft 240s); `general` = today's models byte-for-byte. Article stages pass the route per call and log `llm usage` with the served model.
- `diagram` added to `image_direction.medium`; `routeImage(medium)` sends it to `fal-ai/nano-banana-pro` (aspect_ratio 16:9, webp) with a labels-aware planner and prompt; the render stage skips the no-text ban for that medium.
- Admin presets editor: complexity select, `Diagram` medium.
- Keyword pipeline untouched. No billing cap.

## Verified
- `npm run lint`, `npm run check:all`, `npm test` (only the known php-dependent test fails locally).
- Local fal render loop: <paste the Task 11 result: labels legible, dimensions non-null, byte sizes>.

## After merge to staging
1. Admin editor: piperbox → `technical` + `diagram`.
2. `articles generate-next` for piperbox; check the `llm usage` lines show Sonnet (outline, humanize) and Opus (draft), and the three images are labelled diagrams.
3. Generate one unmarble article; confirm Haiku + flux-2 throughout.

Follow-ups: diagrams-as-code (very optional), customer-facing complexity select — filed as separate issues.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Update memory**

Edit `/Users/fco/.claude/projects/-Users-fco-Documents-projects-seopotion-seo/memory/ai-model-routing-spec.md` so it points at the PR and says the staging click-through (piperbox flip + one article) is pending; keep it to pointers, no restated content.
