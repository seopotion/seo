# Per-org Readability Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the global Flesch–Kincaid target of 8 with a per-org preset, `readability_grade_max`, that the onboarding scan assigns from the audience (8 / 10 / 12) and the article-settings page lets the user edit.

**Architecture:** One new integer field on `SetupPresetsSchema.article_preferences.content_seo` with a schema default of 8 (so no migration; in-flight runs and old orgs keep today's behaviour). The scanner's LLM output schema constrains it to three literals. `GenerationContext` carries it as `readabilityGradeMax`, and the four readers of the old constant (draft prompt, humanize prompt, humanize stage, finalize stage) read the context instead. The web settings page adds a three-tier select. Spec: `docs/superpowers/specs/2026-09-02-per-org-readability-target-design.md`. Issue: #313.

**Tech Stack:** TypeScript 6, zod 4, Vitest 4, Next 16 + next-intl, Biome. Run everything from the worktree root. Worktree has no `node_modules` — run `npm ci` once first (see memory: worktree @shared resolution trap).

## Global Constraints

- Field name is exactly `readability_grade_max`; context field is exactly `readabilityGradeMax`; default constant is exactly `READABILITY_GRADE_MAX_DEFAULT = 8`, exported from `@shared/schemas`.
- Preset range: integer, `min(6)`, `max(14)`. Scan output: literals `8 | 10 | 12` only.
- Semantics: grade must be **at or below** the value to pass. Non-English stays unmeasured (`null` grade passes) — do not change the grader or the `language === 'English'` gates.
- `FLESCH_KINCAID_TARGET` is removed (Task 4). Nothing new may import it.
- The three-pass cap (`READABILITY_MAX_PASSES = 3`), best-attempt fallback, brand-mention guard, and the Step Functions Choice loop are untouched.
- Onboarding wizard is untouched. Only the article-settings page gains UI.
- Biome style: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` before each commit.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and reference `Part of #313`.
- Before every commit, check `git diff package-lock.json` is empty (memory: macOS npm prunes `@emnapi` optional deps; never commit a lockfile diff).
- Locally `npm test` has one expected failure: `wordpress-plugin-behavior.test.ts` (`spawnSync php ENOENT`). Everything else must pass.

---

### Task 1: The preset field and its default

**Files:**
- Modify: `packages/shared/schemas/src/presets.ts` (content_seo object, ~line 44)
- Test: `packages/shared/schemas/tests/presets.test.ts`
- Possibly modify (exact-object assertions): `apps/api/tests/dashboard.test.ts`, `apps/api/tests/setup.test.ts`, `apps/api/tests/admin.orgs.test.ts`, `apps/api/tests/merge-presets.test.ts`

**Interfaces:**
- Produces: `READABILITY_GRADE_MAX_DEFAULT: 8` exported from `@shared/schemas` (via the existing `export * from './presets'` in `packages/shared/schemas/src/index.ts`); `SetupPresets['article_preferences']['content_seo']['readability_grade_max']: number`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/schemas/tests/presets.test.ts` (import `READABILITY_GRADE_MAX_DEFAULT` alongside the existing imports from `'../src/presets'`):

```ts
describe('SetupPresetsSchema content_seo.readability_grade_max', () => {
  const withAudience = { ...base, audience: { target: ['a'], competitors: [] } };

  test('defaults to READABILITY_GRADE_MAX_DEFAULT (8) when absent', () => {
    expect(READABILITY_GRADE_MAX_DEFAULT).toBe(8);
    const p = SetupPresetsSchema.parse(withAudience);
    expect(p.article_preferences.content_seo.readability_grade_max).toBe(8);
  });

  test('keeps an explicit value', () => {
    const p = SetupPresetsSchema.parse({
      ...withAudience,
      article_preferences: {
        ...withAudience.article_preferences,
        content_seo: { ...withAudience.article_preferences.content_seo, readability_grade_max: 12 },
      },
    });
    expect(p.article_preferences.content_seo.readability_grade_max).toBe(12);
  });

  test.each([5, 15, 8.5])('rejects %s', (value) => {
    expect(() =>
      SetupPresetsSchema.parse({
        ...withAudience,
        article_preferences: {
          ...withAudience.article_preferences,
          content_seo: { ...withAudience.article_preferences.content_seo, readability_grade_max: value },
        },
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- presets`
Expected: FAIL — `READABILITY_GRADE_MAX_DEFAULT` is not exported / `readability_grade_max` is `undefined`.

- [ ] **Step 3: Add the field and constant**

In `packages/shared/schemas/src/presets.ts`, above `SetupPresetsSchema`:

```ts
/** Highest acceptable Flesch–Kincaid grade for English articles when an org has
 * no preset of its own (#313). The scan assigns 8 / 10 / 12 by audience. */
export const READABILITY_GRADE_MAX_DEFAULT = 8;
```

In the `content_seo` object, after `table_of_contents`:

```ts
      // Highest acceptable Flesch–Kincaid grade (#313). Scan-assigned by
      // audience (8 general public / 10 professional / 12 technical), user-
      // editable. The default keeps pre-#313 docs and run snapshots parsing.
      readability_grade_max: z.number().int().min(6).max(14).default(READABILITY_GRADE_MAX_DEFAULT),
```

- [ ] **Step 4: Run the schema tests**

Run: `npm test -- presets`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and repair exact-object assertions**

Run: `npm test`

Parsed presets now carry `readability_grade_max: 8`. Any test that asserts a parsed `content_seo` with `toEqual`/`toStrictEqual` on the exact object fails with a diff showing `+ readability_grade_max: 8`. For each such failure, add `readability_grade_max: 8` to the *expected* object (not to the input). Likely candidates are the four `apps/api/tests` files listed above; `toMatchObject` assertions need no change. Do not touch the input fixtures — leaving them without the field is what proves the default works.

Expected after repair: only the php-dependent wordpress test fails.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npm run lint:fix && npm run check:all && git diff --stat package-lock.json
git add packages/shared/schemas apps/api/tests
git commit -m "feat(schemas): per-org readability_grade_max preset, default 8

Part of #313

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The scan assigns the tier

**Files:**
- Modify: `apps/worker/src/scanner.ts` (`ScanOutputSchema` ~line 21, `buildScanPrompt` ~line 42)
- Test: `apps/worker/tests/scanner.test.ts`

**Interfaces:**
- Consumes: `SetupPresetsSchema` (Task 1) — parses the scan result, so the field lands in presets automatically.
- Produces: scan replies carry `article_preferences.content_seo.readability_grade_max` ∈ {8, 10, 12}.

- [ ] **Step 1: Write the failing tests**

In `apps/worker/tests/scanner.test.ts`, add `readability_grade_max: 10` to `LLM_JSON.article_preferences.content_seo` (between `article_style` and `llm_instructions`), then append inside `describe('scanWebsite', …)`:

```ts
  test('asks for a readability tier and lands it in presets (#313)', async () => {
    fetchSite.mockResolvedValue({ text: 'x', links: [] });
    const llm = llmReturning(LLM_JSON);

    const presets = await scanWebsite('https://clewas.com', { llm });

    const system = llm.complete.mock.calls[0]![0].messages[0]!.content;
    expect(system).toContain('readability_grade_max');
    expect(system).toContain('8 for general-public');
    expect(system).toContain('12 for developers');
    expect(presets.article_preferences.content_seo.readability_grade_max).toBe(10);

    // The constraint must reach the provider, not just the post-parse (#313).
    const { responseSchema } = llm.complete.mock.calls[0]![0];
    const contentSeo = (
      (responseSchema?.schema.properties as Record<string, { properties?: Record<string, unknown> }>)
        .article_preferences?.properties as Record<string, { properties?: Record<string, unknown> }>
    ).content_seo?.properties as Record<string, unknown>;
    expect(contentSeo.readability_grade_max).toEqual({ type: 'number', enum: [8, 10, 12] });
  });

  test('rejects a readability tier outside 8 / 10 / 12 (#313)', async () => {
    fetchSite.mockResolvedValue({ text: 'x', links: [] });
    const off = JSON.parse(LLM_JSON);
    off.article_preferences.content_seo.readability_grade_max = 9;

    await expect(
      scanWebsite('https://clewas.com', { llm: llmReturning(JSON.stringify(off)) }),
    ).rejects.toThrow();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- scanner`
Expected: the first new test FAILS on the prompt assertion (and `readability_grade_max` is dropped by the strict output schema, so the value is 8 not 10); the second FAILS because 9 is not rejected.

- [ ] **Step 3: Constrain the output schema and extend the prompt**

In `apps/worker/src/scanner.ts`, change `ScanOutputSchema`'s `content_seo`:

```ts
    content_seo: z.object({
      article_style: z.string(),
      llm_instructions: z.string(),
      // Three reviewable tiers (#313); the preset itself allows 6–14 for edits.
      readability_grade_max: z.literal([8, 10, 12]),
    }),
```

In `buildScanPrompt`, append one entry to the `system` array after the `article_style / image_style` line:

```ts
    'readability_grade_max is the highest acceptable Flesch-Kincaid grade for articles: 8 for general-public',
    'or consumer audiences, 10 for business and professional audiences, 12 for developers, engineers,',
    'scientists and other specialists.',
```

- [ ] **Step 4: Run the scanner tests**

Run: `npm test -- scanner`
Expected: PASS (all, including the pre-existing `constrains the response to the presets schema` test).

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint:fix && npm run check:all && git diff --stat package-lock.json
git add apps/worker/src/scanner.ts apps/worker/tests/scanner.test.ts
git commit -m "feat(scanner): assign readability_grade_max by audience (8/10/12)

Part of #313

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Generation context and prompts read the org target

**Files:**
- Modify: `packages/shared/generation/src/types.ts` (`GenerationContext`, ~line 21)
- Modify: `packages/shared/generation/src/context.ts` (`buildContext`)
- Modify: `packages/shared/generation/src/article.ts` (~line 35)
- Modify: `packages/shared/generation/src/humanize.ts` (~line 33)
- Modify: `packages/shared/generation/tests/prompts.test.ts`, `packages/shared/generation/tests/outline.test.ts` (ctx fixtures)
- Test: `packages/shared/generation/tests/prompts.test.ts`

**Interfaces:**
- Consumes: `SetupPresets…content_seo.readability_grade_max: number` (Task 1).
- Produces: `GenerationContext.readabilityGradeMax: number` (required). Task 4 reads it.

- [ ] **Step 1: Write the failing tests**

In `packages/shared/generation/tests/prompts.test.ts`, add `readabilityGradeMax: 8,` to the `ctx` literal (after `llmInstructions: '',`). Then replace the test `'adds grade 8 readability guidance to both English prompts only'` body's fixed string with the org value and add a second case. The full replacement test plus the new one:

```ts
  test('adds readability guidance at the org target to both English prompts only', () => {
    const english = { ...ctx, language: 'English', readabilityGradeMax: 12 };
    const readabilityInstruction = 'Flesch-Kincaid grade level 12 or lower';

    const englishArticle = buildArticlePrompt(english, outline)
      .map((message) => message.content)
      .join('\n');
    const englishHumanize = buildHumanizePrompt(english, '# Title\n\nbody')
      .map((message) => message.content)
      .join('\n');

    expect(englishArticle).toContain(readabilityInstruction);
    expect(englishHumanize).toContain(readabilityInstruction);
    expect(englishArticle).not.toContain('grade level 8');
    expect(englishHumanize).not.toContain('grade level 8');
```

Keep the rest of that test's existing non-English assertions exactly as they are (the lines after the two `toContain` checks that build Spanish prompts and assert `not.toContain`), only renaming the test title as above.

Also update `'humanize retry prompt carries the readability feedback'` to use a non-default target so it proves the value flows from feedback:

```ts
  test('humanize retry prompt carries the readability feedback', () => {
    const messages = buildHumanizePrompt(ctx, '# Draft', { attempt: 1, grade: 11.2, target: 10 });
    const system = messages[0]!.content;
    expect(system).toContain('11.2');
    expect(system).toContain('target of grade level 10');
    expect(system).toContain('previous attempt');
  });
```

In `packages/shared/generation/tests/outline.test.ts`, add `readabilityGradeMax: 8,` to its `GenerationContext` literal (after `llmInstructions: 'be concise',`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- prompts`
Expected: FAIL — typecheck-level complaint about the unknown `readabilityGradeMax` key is not fatal under Vitest, but the assertion `toContain('Flesch-Kincaid grade level 12 or lower')` fails because the prompt still says 8.

- [ ] **Step 3: Add the context field and thread it into both prompts**

`packages/shared/generation/src/types.ts`, in `GenerationContext` after `llmInstructions: string;`:

```ts
  // Highest acceptable Flesch–Kincaid grade for English articles (#313). Comes
  // from presets.article_preferences.content_seo.readability_grade_max.
  readabilityGradeMax: number;
```

`packages/shared/generation/src/context.ts`, in the returned object after `llmInstructions: …,`:

```ts
    readabilityGradeMax: p.article_preferences.content_seo.readability_grade_max,
```

`packages/shared/generation/src/article.ts`, replace the English readability line:

```ts
    ctx.language === 'English'
      ? `Aim for Flesch-Kincaid grade level ${ctx.readabilityGradeMax} or lower. Prefer familiar words and direct sentences. Use active voice and short paragraphs. Explain necessary technical terms. Do not sacrifice factual accuracy, useful detail, required keywords, or meaning.`
      : '',
```

`packages/shared/generation/src/humanize.ts`, replace the English readability line the same way:

```ts
    ctx.language === 'English'
      ? `Aim for Flesch-Kincaid grade level ${ctx.readabilityGradeMax} or lower. Prefer familiar words and direct sentences. Use active voice and short paragraphs. Explain necessary technical terms. Do not sacrifice factual accuracy, useful detail, required keywords, or meaning.`
      : '',
```

The feedback line in `humanize.ts` already interpolates `feedback.target`; leave it.

- [ ] **Step 4: Run the generation tests**

Run: `npm test -- generation`
Expected: PASS for prompts, outline, and everything else under `packages/shared/generation`.

- [ ] **Step 5: Typecheck — expect Task 4's files to still compile**

Run: `npm run check:all`
Expected: PASS. (`FLESCH_KINCAID_TARGET` still exists; the articles stages still import it. Any other `GenerationContext` literal missing `readabilityGradeMax` shows up here — the only ones are the two test fixtures already updated.)

- [ ] **Step 6: Lint, commit**

```bash
npm run lint:fix && git diff --stat package-lock.json
git add packages/shared/generation
git commit -m "feat(generation): prompts aim for the org's readability_grade_max

Part of #313

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Humanize and finalize judge against the org target; retire the constant

**Files:**
- Modify: `packages/shared/articles/src/stages/humanize.ts`
- Modify: `packages/shared/articles/src/stages/finalize.ts` (~lines 7, 126–134)
- Modify: `packages/shared/generation/src/config.ts`, `packages/shared/generation/src/index.ts` (remove `FLESCH_KINCAID_TARGET`)
- Modify: `packages/shared/generation/tests/readability.test.ts`
- Test: `packages/shared/articles/tests/humanize-stage.test.ts`, `packages/shared/articles/tests/finalize-stage.test.ts`

**Interfaces:**
- Consumes: `GenerationContext.readabilityGradeMax` (Task 3) via `contextFromRun(run)`; `READABILITY_GRADE_MAX_DEFAULT` from `@shared/schemas` (Task 1).
- Produces: `articles.readability.target` on created articles now equals the org preset.

- [ ] **Step 1: Write the failing tests**

`packages/shared/articles/tests/humanize-stage.test.ts`:

1. Remove the line `import { FLESCH_KINCAID_TARGET } from '@shared/generation';`.
2. In the test `'retry rewrites the previous attempt content (not the original draft) with feedback'`, replace
   ``expect(messages[0]!.content).toContain(`grade level ${FLESCH_KINCAID_TARGET}`);``
   with
   `expect(messages[0]!.content).toContain('target of grade level 8');`
3. Append inside `describe('stageHumanize', …)`:

```ts
  test('a grade above 8 but at the org target passes in one pass (#313)', async () => {
    // gradeOf['rewrite-high-2'] is 10; the org allows 12.
    const llm = llmReplying('rewrite-high-2');
    const technical = {
      ...presets,
      article_preferences: {
        ...presets.article_preferences,
        content_seo: { ...presets.article_preferences.content_seo, readability_grade_max: 12 },
      },
    };
    const run = makeRun({ working: { draft: 'draft text' }, presets: technical });

    const result = await stageHumanize(run, llm);

    expect(result).toEqual({
      completed: true,
      working: {
        content: 'rewrite-high-2',
        readability_grade: 10,
        humanize_attempts: [{ attempt: 1, grade: 10, content: 'rewrite-high-2' }],
      },
      output: { readability_ok: true },
    });
  });

  test('retry feedback quotes the org target, not a global one (#313)', async () => {
    const technical = {
      ...presets,
      article_preferences: {
        ...presets.article_preferences,
        content_seo: { ...presets.article_preferences.content_seo, readability_grade_max: 10 },
      },
    };
    const priorAttempts = [{ attempt: 1, grade: 12, content: 'rewrite-high-1' }];
    const llm = llmReplying('rewrite-pass');
    const run = makeRun({
      working: { draft: 'draft text', humanize_attempts: priorAttempts },
      presets: technical,
    });

    await stageHumanize(run, llm);

    const { messages } = vi.mocked(llm.complete).mock.calls[0]![0];
    expect(messages[0]!.content).toContain('target of grade level 10');
    expect(messages[0]!.content).toContain('grade level 10 or lower');
  });
```

`packages/shared/articles/tests/finalize-stage.test.ts`, append inside `describe('stageFinalize', …)`:

```ts
  test('stores the org readability target on the article (#313)', async () => {
    const llm = llmReplying(semanticPass);
    const youtube = youtubeThat();
    const technical = {
      ...presetsNoVideo,
      article_preferences: {
        ...presetsNoVideo.article_preferences,
        content_seo: {
          ...presetsNoVideo.article_preferences.content_seo,
          readability_grade_max: 12,
        },
      },
    };
    const run = makeRun({
      working: {
        outline,
        content,
        readability_grade: 10,
        humanize_attempts: [{ attempt: 1, grade: 10, content }],
      },
      presets: technical,
    });

    await stageFinalize(run, { llm, youtube });

    expect(createArticle.mock.calls[0]![0]).toMatchObject({
      readability: { grade: 10, target: 12, target_met: true, attempts: 1 },
    });
  });
```

(`presetsNoVideo` is the fixture already used by the neighbouring tests in that file; `semanticPass`, `youtubeThat`, `createArticle`, `outline`, `content` likewise.)

`packages/shared/generation/tests/readability.test.ts`: replace the import line with

```ts
import { READABILITY_GRADE_MAX_DEFAULT } from '@shared/schemas';
import { fleschKincaidGrade } from '../src';
```

and replace both `FLESCH_KINCAID_TARGET` uses in that file with `READABILITY_GRADE_MAX_DEFAULT`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- humanize-stage finalize-stage readability`
Expected: the two new humanize tests FAIL (grade 10 loops under the global 8; feedback says `grade level 8`); the new finalize test FAILS (`target: 8`); `readability.test.ts` FAILS to import if `@shared/schemas` isn't resolvable — it is a workspace package, so it should PASS.

- [ ] **Step 3: Read the target from the context in both stages**

`packages/shared/articles/src/stages/humanize.ts`:

1. Remove `FLESCH_KINCAID_TARGET,` from the `@shared/generation` import.
2. Replace the module-level `passes` with a target-taking version:

```ts
const passes = (grade: number | null, target: number) => grade === null || grade <= target;
```

3. Inside `stageHumanize`, right after `const ctx = contextFromRun(run);`, add:

```ts
  const target = ctx.readabilityGradeMax;
```

4. In the `feedback` object, replace the two constant references:

```ts
        ...(previous.grade !== null && previous.grade > target ? { grade: previous.grade, target } : {}),
```

5. Replace `if (passes(grade) && keepsBrand(attempt.content)) {` with `if (passes(grade, target) && keepsBrand(attempt.content)) {`.

`packages/shared/articles/src/stages/finalize.ts`:

1. Remove `FLESCH_KINCAID_TARGET,` from the `@shared/generation` import.
2. Replace the `readability` block:

```ts
  const readability = {
    metric: 'flesch_kincaid_grade' as const,
    grade: run.working.readability_grade,
    target: ctx.readabilityGradeMax,
    target_met:
      run.working.readability_grade === null ||
      run.working.readability_grade <= ctx.readabilityGradeMax,
    attempts: run.working.humanize_attempts.length,
  };
```

`packages/shared/generation/src/config.ts`: delete the line `export const FLESCH_KINCAID_TARGET = 8;`.

`packages/shared/generation/src/index.ts`: delete `FLESCH_KINCAID_TARGET,` from the `./config` re-export list.

- [ ] **Step 4: Run the stage tests and the generation tests**

Run: `npm test -- articles generation`
Expected: PASS.

- [ ] **Step 5: Confirm the constant is gone everywhere**

Run: `grep -rn FLESCH_KINCAID_TARGET --include='*.ts' --include='*.tsx' packages apps infra | grep -v node_modules`
Expected: no output. (Docs under `docs/superpowers/` may still mention it historically; leave them.)

- [ ] **Step 6: Lint, typecheck, full suite, commit**

```bash
npm run lint:fix && npm run check:all && npm test && git diff --stat package-lock.json
git add packages/shared/articles packages/shared/generation
git commit -m "feat(articles): humanize and finalize judge against the org readability target

Retires FLESCH_KINCAID_TARGET; the default lives in @shared/schemas.

Part of #313

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected `npm test`: only the php-dependent wordpress test fails.

---

### Task 5: Article-settings UI select

**Files:**
- Modify: `apps/web/app/[locale]/(authenticated)/onboarding/constants.ts` (after `articleStyles`)
- Modify: `apps/web/app/[locale]/(authenticated)/(product)/article-settings/article-settings.ts`
- Modify: `apps/web/app/[locale]/(authenticated)/(product)/article-settings/page.tsx` (after the Article style block, ~line 356)
- Modify: `apps/web/messages/en.json`, `apps/web/messages/tr.json`
- Test: `apps/web/tests/article-settings-cta.test.ts`

**Interfaces:**
- Consumes: the API's `ArticlesSettingsResponse` / `ArticlesSettingsPatchBody` already include `content_seo.readability_grade_max` because they derive from `SetupPresetsSchema` (Task 1). No API change.
- Produces: `readabilityTiers` constant; `ArticleSettingsForm.readabilityGradeMax: string`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/tests/article-settings-cta.test.ts`, add `readabilityGradeMax: '8',` to the `settings` literal (after `internalLinksCount: '2',`), add `readability_grade_max: 8,` to the `content_seo` object inside the existing `mergeArticleSettings` call (after `table_of_contents: false,`), and append a new describe:

```ts
describe('article settings readability target (#313)', () => {
  const response = {
    article_preferences: {
      content_seo: {
        article_style: 'Informative',
        internal_links_count: 1,
        table_of_contents: true,
        llm_instructions: '',
        readability_grade_max: 12,
      },
      engagement: { image_style: 'Sketch', include_cta: true, youtube_videos: true },
      publishing: { auto_publish: false },
    },
  };

  test('hydrates the tier from the API response as a string', () => {
    expect(mergeArticleSettings(response, settings).readabilityGradeMax).toBe('12');
  });

  test('sends the tier back as a number alongside the other content_seo fields', () => {
    expect(buildArticleSettingsPatch({ ...settings, readabilityGradeMax: '10' }).content_seo).toEqual({
      article_style: 'Practical',
      internal_links_count: 2,
      table_of_contents: true,
      readability_grade_max: 10,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- article-settings-cta`
Expected: FAIL — `readabilityGradeMax` is `undefined` after merge; patch lacks `readability_grade_max`.

- [ ] **Step 3: Form module and constants**

`apps/web/app/[locale]/(authenticated)/onboarding/constants.ts`, after `articleStyles`:

```ts
/** Article-settings readability tiers (#313): value is the preset's
 * readability_grade_max; labels name the audience, not the number. */
export const readabilityTiers = [
  { value: '8', labelKey: 'generalPublic' },
  { value: '10', labelKey: 'professional' },
  { value: '12', labelKey: 'technical' },
] as const;
```

`article-settings.ts`:

- `ArticleSettingsForm`: add `readabilityGradeMax: string;` after `internalLinksCount: string;`.
- `ArticleSettingsResponse.article_preferences.content_seo`: add `readability_grade_max: number;` after `llm_instructions: string;`.
- `initialArticleSettings`: add `readabilityGradeMax: '8',` after `internalLinksCount: '1',`.
- `mergeArticleSettings` return: add
  `readabilityGradeMax: String(data.article_preferences.content_seo.readability_grade_max),`
  after the `internalLinksCount` line.
- `buildArticleSettingsPatch` `content_seo`: add
  `readability_grade_max: Number.parseInt(settings.readabilityGradeMax, 10),`
  after `table_of_contents: settings.tableOfContents,`.

- [ ] **Step 4: Run the test**

Run: `npm test -- article-settings-cta`
Expected: PASS.

- [ ] **Step 5: The select and its messages**

`page.tsx`: change the constants import to
`import { articleStyles, internalLinkCounts, readabilityTiers } from '../../onboarding/constants';`
and insert this block directly after the Article style `</div>` (before the Internal links block):

```tsx
        <div className="grid gap-2 p-4">
          <div>
            <Label htmlFor="readability">{t('fields.readability.label')}</Label>
            <p className="mt-1 text-muted-foreground text-sm">
              {t('fields.readability.description')}
            </p>
          </div>
          <Select
            value={settings.readabilityGradeMax}
            onValueChange={(value) => updateSetting('readabilityGradeMax', value)}
          >
            <SelectTrigger id="readability" className="max-w-95">
              <SelectValue placeholder={t('fields.readability.placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {readabilityTiers.map((tier) => (
                <SelectItem key={tier.value} value={tier.value}>
                  {optionsT(`readabilityTiers.${tier.labelKey}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
```

`apps/web/messages/en.json`:

- In `ArticleSettingsPage.fields`, insert after the `"internalLinks": { … }` object (keys are kept alphabetical in this file):

```json
      "readability": {
        "description": "How simply generated articles must read. Pick the tier that matches your audience; applies to English articles only.",
        "label": "Readability",
        "placeholder": "Select audience"
      },
```

- In `Onboarding.options`, insert after `"languages": { … }` (alphabetical: `articleStyles`, `countries`, `languages`, `readabilityTiers`, …):

```json
      "readabilityTiers": {
        "generalPublic": "General public",
        "professional": "Professional",
        "technical": "Technical"
      },
```

`apps/web/messages/tr.json`, same two locations:

```json
      "readability": {
        "description": "Oluşturulan makalelerin ne kadar sade okunması gerektiği. Hedef kitlenize uyan seviyeyi seçin; yalnızca İngilizce makalelere uygulanır.",
        "label": "Okunabilirlik",
        "placeholder": "Hedef kitle seç"
      },
```

```json
      "readabilityTiers": {
        "generalPublic": "Genel okuyucu",
        "professional": "Profesyonel",
        "technical": "Teknik"
      },
```

Check the JSON stays valid and the key sits in the same alphabetical slot in both files: `node -e "for (const f of ['en','tr']) JSON.parse(require('fs').readFileSync('apps/web/messages/'+f+'.json','utf8'))"`.

- [ ] **Step 6: Typecheck the web app, lint, full suite, commit**

```bash
npm run check:web && npm run lint:fix && npm test && git diff --stat package-lock.json
git add apps/web
git commit -m "feat(web): readability tier select on article settings

Part of #313

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: `check:web` PASS (the typed client's response type already carries `readability_grade_max: number`); `npm test` only fails the php-dependent wordpress test.

- [ ] **Step 7: Eyeball it**

Start the stack (`docker compose up -d`, `npm run dev`), open `/article-settings` for an org with a completed setup, confirm the Readability select renders between Article style and Internal links, change it to Technical, save, reload, and confirm it stays at Technical. Then confirm in Mongo (`orgs` doc → `presets.article_preferences.content_seo.readability_grade_max`) that the value is `12`.

---

### Task 6: Progress map and PR

**Files:**
- Modify: `PROGRESS.md` (line 54, the article-generation entry)

- [ ] **Step 1: Point PROGRESS.md at the change**

Append to the end of the line-54 bullet in `PROGRESS.md` (the one ending with the 2026-08-28 spec link):

```markdown
; the readability gate targets a per-org `readability_grade_max` the scan assigns by audience — [#313](https://github.com/seopotion/seo/issues/313)
```

- [ ] **Step 2: Final verification**

```bash
npm run lint && npm run check:all && npm test
git status --short
git diff --stat package-lock.json
```

Expected: lint and typecheck clean, tests green except the php wordpress one, no lockfile diff, working tree clean except `PROGRESS.md`.

- [ ] **Step 3: Commit and open the PR into `dev`**

```bash
git add PROGRESS.md
git commit -m "docs: PROGRESS points at the per-org readability target (#313)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin claude/article-humanize-readability-59a733
gh pr create --base dev --title "[onboarding] Per-org readability target assigned by the scan" --body "$(cat <<'EOF'
Closes #313

## Why

Every English article was judged against a global Flesch–Kincaid target of 8. For technical audiences that bar is structurally out of reach — the score is dominated by syllables per word and the required vocabulary keeps it near 9–10 — so on staging every piperbox article ran humanize three times, gained under one grade point, and still shipped `target_met: false`.

## What

- New preset `article_preferences.content_seo.readability_grade_max` (int 6–14, default 8, single-sourced as `READABILITY_GRADE_MAX_DEFAULT` in `@shared/schemas`). The default means no migration: old orgs and in-flight run snapshots keep today's behaviour.
- The onboarding scan assigns it from the audience: 8 general public, 10 professional, 12 technical (three literals in the scan output schema).
- `GenerationContext.readabilityGradeMax` feeds the draft + humanize prompts, the humanize pass check and retry feedback, and the `readability.target` stored on the article. `FLESCH_KINCAID_TARGET` is gone.
- Article settings page: a "Readability" select with the three tiers (labels by audience), en + tr.

Out of scope (follow-up): the three-pass cap and an early exit when a pass gains < 0.5.

Spec: `docs/superpowers/specs/2026-09-02-per-org-readability-target-design.md`.

## Staging check

Set piperbox to Technical from the settings page, run `articles generate-next --org <piperbox> --wait`, and confirm the run's `humanize_attempts` has one entry and the article's `readability.target` is 12 with `target_met: true`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
