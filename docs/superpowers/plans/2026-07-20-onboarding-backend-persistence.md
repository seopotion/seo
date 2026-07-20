# Onboarding Backend Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the onboarding data the frontend already collects — richer article preferences (`internal_links_count`, `table_of_contents`, `auto_publish`), a renamed YouTube toggle, plus `referral_source` and selected `integrations` on the org.

**Architecture:** Extend the single-sourced Zod schemas in `@shared/schemas` (presets + org), then thread the new fields through the finalize/presets/settings routes and the `OrgRepo.finalize` write. Generation consumers are updated to the new field names; behaviour is unchanged (storage only).

**Tech Stack:** TypeScript 6, Zod 4, `@hono/zod-openapi` 1, Vitest 4, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-07-20-onboarding-backend-persistence-design.md`
**Issue:** [#73](https://github.com/seopotion/seo/issues/73) — backend parts 3, 4, 5. Parts 1 (real scan) and 2 (single-request finalize) are already implemented.

## Global Constraints

- **No backward compatibility** — pre-alpha; change schemas cleanly, no legacy-doc preprocess shims. (New fields still carry Zod `.default()`s so scan output and parse-based fixtures can omit them.)
- **`import type` / `export type`** for all type-only imports (`verbatimModuleSyntax`).
- **Biome style:** single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` to format.
- **Zod API schemas** use `.openapi('Name')` and are single-sourced from `@shared/schemas` sub-shapes wherever possible.
- **Verification gate (every task):** `npm run lint`, `npm run check` (backend + shared), and `npm test` must pass. `npm test` needs no infra. **Not `check:all`** during the tasks — it includes the web typecheck, which is expected-red against the new shape until the paired frontend change lands (see Final verification's web caveat). Run `check:all` only at the end, interpreting the web failures against the caveat.
- **`ONBOARDING_INTEGRATIONS`** enum values are exactly `['wordpress', 'wordpress-com', 'framer']` (from the frontend `integrationOptions` ids).
- **Field defaults** (mirror the frontend `initialForm`): `internal_links_count` → `1`, `table_of_contents` → `true`, `youtube_videos` → `true`, `auto_publish` → `false`.

---

## File Structure

- `packages/shared/schemas/src/presets.ts` — reshaped `article_preferences` (Task 1).
- `packages/shared/schemas/src/org.ts` — `ONBOARDING_INTEGRATIONS` + `onboarding` field (Task 2).
- `packages/shared/generation/src/context.ts` — derive `internalLinks` from the count (Task 1).
- `apps/worker/src/generation.ts` — read `youtube_videos` (Task 1).
- `apps/worker/src/scanner.ts` — drop `internal_links` from the LLM prompt (Task 1).
- `packages/shared/db/src/repositories/org.repo.ts` — `finalize` persists `onboarding` (Task 3).
- `apps/api/src/schemas/setup.ts` — `FinalizeBody` + `SetupPresetsPatchSchema.publishing` (Task 3).
- `apps/api/src/routes/setup.ts` — finalize handler forwards onboarding (Task 3).
- `apps/api/src/schemas/dashboard.ts` — `ArticlesSettingsPatchBody.publishing` (Task 4).
- Test fixtures across `packages/shared/{schemas,keywords}/tests`, `apps/worker/tests`, `apps/api/tests` — migrated to the new shape (Task 1), with new assertions in Tasks 1/3/4.

**Noted, out of scope (do not do):** the preset fixtures are duplicated verbatim across ~10 test files; a shared fixture factory would cut future churn but is an unrelated refactor. Leave the duplication; edit each fixture in place.

---

## Task 1: Reshape `article_preferences` (schema + consumers + fixtures)

This is one atomic, compile-green deliverable: the schema change breaks two generation consumers and ~14 test fixtures at once, so they all move together.

**Files:**
- Modify: `packages/shared/schemas/src/presets.ts`
- Modify: `packages/shared/generation/src/context.ts:16`
- Modify: `apps/worker/src/generation.ts:75`
- Modify: `apps/worker/src/scanner.ts` (prompt shape)
- Modify/Test: `packages/shared/schemas/tests/presets.test.ts`
- Modify/Test: `packages/shared/schemas/tests/article-video.test.ts`
- Modify (fixtures): `apps/api/tests/merge-presets.test.ts`, `apps/api/tests/setup.test.ts`, `apps/api/tests/dashboard.test.ts`, `apps/worker/tests/generation.test.ts`, `apps/worker/tests/images.test.ts`, `apps/worker/tests/worker.test.ts`, `apps/worker/tests/scanner.test.ts`, and `packages/shared/keywords/tests/{pipeline,llm-prompts,classify,gather,score,config,serp,serp-competitors}.test.ts`

**Interfaces:**
- Produces: `SetupPresets['article_preferences']` shape =
  `{ content_seo: { article_style: string; internal_links_count: number; table_of_contents: boolean; llm_instructions: string }; engagement: { image_style: string; youtube_videos: boolean }; publishing: { auto_publish: boolean } }`.
  (All of `internal_links_count`, `table_of_contents`, `youtube_videos`, `auto_publish`, and the `publishing` object carry defaults → required in the `z.infer` output type.)

- [ ] **Step 1: Update the failing default/validation test first**

In `packages/shared/schemas/tests/presets.test.ts`, change the `base` fixture's `content_seo` line (line 8) and add a new `describe` block for the new fields. Replace line 8:

```ts
    content_seo: { article_style: 's', internal_links_count: 1, llm_instructions: '' },
```

Then append this block after the existing `describe(...)` (end of file, before the final blank line):

```ts
describe('SetupPresetsSchema article_preferences defaults + validation', () => {
  test('applies field defaults when omitted', () => {
    const p = SetupPresetsSchema.parse({
      ...base,
      audience: { target: [], competitors: [] },
    });
    expect(p.article_preferences.content_seo.internal_links_count).toBe(1);
    expect(p.article_preferences.content_seo.table_of_contents).toBe(true);
    expect(p.article_preferences.engagement.youtube_videos).toBe(true);
    expect(p.article_preferences.publishing.auto_publish).toBe(false);
  });

  test('rejects an out-of-range internal_links_count', () => {
    expect(() =>
      SetupPresetsSchema.parse({
        ...base,
        audience: { target: [], competitors: [] },
        article_preferences: {
          content_seo: { article_style: 's', internal_links_count: 4, llm_instructions: '' },
          engagement: { image_style: 'i' },
        },
      }),
    ).toThrow();
  });

  test('rejects a non-integer internal_links_count', () => {
    expect(() =>
      SetupPresetsSchema.parse({
        ...base,
        audience: { target: [], competitors: [] },
        article_preferences: {
          content_seo: { article_style: 's', internal_links_count: 1.5, llm_instructions: '' },
          engagement: { image_style: 'i' },
        },
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- presets`
Expected: FAIL — the new `describe` references `internal_links_count` / `table_of_contents` / `youtube_videos` / `publishing`, none of which exist yet (type errors / undefined).

- [ ] **Step 3: Reshape `SetupPresetsSchema.article_preferences`**

In `packages/shared/schemas/src/presets.ts`, first add the exported publishing sub-schema **above** `SetupPresetsSchema` (after the imports / doc comment):

```ts
/**
 * Publishing workflow prefs (#73). Exported as a named schema so the API patch
 * bodies can reference `.partial()` — a `.default(...)`-wrapped field cannot be
 * drilled via `.shape`.
 */
export const PublishingPrefsSchema = z.object({ auto_publish: z.boolean().default(false) });
```

Then replace the `article_preferences` object (current lines 30–41) with:

```ts
  article_preferences: z.object({
    content_seo: z.object({
      article_style: z.string(),
      // 0–3 internal links per article (frontend dropdown). Replaces the
      // pre-#73 internal_links boolean.
      internal_links_count: z.number().int().min(0).max(3).default(1),
      table_of_contents: z.boolean().default(true),
      llm_instructions: z.string(),
    }),
    engagement: z.object({
      image_style: z.string(),
      // YouTube embed toggle (#85; renamed from include_youtube_video in #73).
      youtube_videos: z.boolean().default(true),
    }),
    // Object-level default (with the field spelled out — Zod uses the default
    // value verbatim, it does NOT re-parse it) so scan output that omits
    // publishing (the LLM never produces it) still parses to auto_publish:false.
    publishing: PublishingPrefsSchema.default({ auto_publish: false }),
  }),
```

> **Verified behaviour (do not "simplify" back):** `.default({})` yields a literal `{}` (auto_publish missing) and `.shape.publishing.partial()` throws (`ZodDefault` has no `.partial()`). The named schema + `.default({ auto_publish: false })` both fills the default and gives the patch bodies something to `.partial()`.

- [ ] **Step 4: Update the two generation consumers**

`packages/shared/generation/src/context.ts` line 16 — derive the boolean from the count:

```ts
    internalLinks: p.article_preferences.content_seo.internal_links_count > 0,
```

`apps/worker/src/generation.ts` line 75 — read the renamed field:

```ts
      if (org.presets.article_preferences.engagement.youtube_videos) {
```

- [ ] **Step 5: Drop `internal_links` from the scanner prompt**

In `apps/worker/src/scanner.ts`, in `buildScanPrompt` replace the `content_seo` line (currently line 30):

```ts
    '    "content_seo": { "article_style": string, "llm_instructions": string },',
```

(`internal_links` / `table_of_contents` / `youtube_videos` / `auto_publish` are defaulted user prefs, not LLM-guessed. `engagement`/`image_style` line is unchanged. The scanner's `SetupPresetsSchema.parse` fills all new defaults.)

- [ ] **Step 6: Migrate the `include_youtube_video` / `internal_links` assertions in article-video.test.ts**

In `packages/shared/schemas/tests/article-video.test.ts`:
- `basePresetsDoc.article_preferences.content_seo` (line 27) → `{ article_style: 'x', internal_links_count: 0, llm_instructions: '' }`
- Rename the second `describe` and its assertions from `include_youtube_video` to `youtube_videos`. Replace lines 43–59 with:

```ts
describe('presets youtube_videos (#73)', () => {
  test('defaults to true when omitted', () => {
    const p = SetupPresetsSchema.parse(basePresetsDoc);
    expect(p.article_preferences.engagement.youtube_videos).toBe(true);
  });

  test('an explicit false is preserved', () => {
    const doc = {
      ...basePresetsDoc,
      article_preferences: {
        ...basePresetsDoc.article_preferences,
        engagement: { image_style: 'Sketch', youtube_videos: false },
      },
    };
    const p = SetupPresetsSchema.parse(doc);
    expect(p.article_preferences.engagement.youtube_videos).toBe(false);
  });
});
```

- [ ] **Step 7: Migrate the merge-presets fixture + its nested-merge assertion**

In `apps/api/tests/merge-presets.test.ts`:
- `base.article_preferences` (lines 12–15) → full new shape:

```ts
  article_preferences: {
    content_seo: {
      article_style: 'Formal',
      internal_links_count: 0,
      table_of_contents: true,
      llm_instructions: 'old',
    },
    engagement: { image_style: 'Minimal', youtube_videos: true },
    publishing: { auto_publish: false },
  },
```

- Rewrite the nested-merge test (lines 38–45) to patch/assert `internal_links_count`:

```ts
  test('merges the two-level nest under article_preferences', () => {
    const result = mergePresets(base, {
      article_preferences: { content_seo: { internal_links_count: 3 } },
    });
    expect(result.article_preferences.content_seo.internal_links_count).toBe(3);
    expect(result.article_preferences.content_seo.article_style).toBe('Formal');
    expect(result.article_preferences.engagement.image_style).toBe('Minimal');
  });
```

- [ ] **Step 8: Migrate the remaining preset fixtures (mechanical)**

For every remaining listed fixture file, replace the `article_preferences` object with the new shape. The uniform mapping: `internal_links: false → internal_links_count: 0`, `internal_links: true → internal_links_count: 1`, add `table_of_contents: true`, rename `include_youtube_video → youtube_videos` (keep the same boolean), add a `publishing: { auto_publish: false }` sibling. Canonical result for a fixture that had `internal_links: false` + `include_youtube_video: true`:

```ts
    article_preferences: {
      content_seo: { article_style: <unchanged>, internal_links_count: 0, table_of_contents: true, llm_instructions: <unchanged> },
      engagement: { image_style: <unchanged>, youtube_videos: true },
      publishing: { auto_publish: false },
    },
```

Apply to, using each file's existing `article_style`/`image_style`/`llm_instructions` values and its existing booleans:
- `apps/api/tests/setup.test.ts` (fixture ~lines 25–28; `internal_links: true` → count `1`; engagement had no youtube key → add `youtube_videos: true`).
- `apps/api/tests/dashboard.test.ts` — **every** `article_preferences` literal in the `orgs` fixture map (includes the `org_1` settings org and the two `internal_links: true` fixtures ~lines 148 & 181): `internal_links: true` → `internal_links_count: 1`, add `table_of_contents: true`, add `youtube_videos: true` to engagement, add `publishing: { auto_publish: false }`. The Task 4 settings test reads `org_1`'s `publishing`, so it must be present here.
- `apps/worker/tests/generation.test.ts` (fixture ~lines 70–73; `internal_links: false` → count `0`, `include_youtube_video: true` → `youtube_videos: true`) **and** the second fixture ~line 218 (`include_youtube_video: false` → `youtube_videos: false`).
- `apps/worker/tests/images.test.ts` (~line 93; `internal_links: false` → count `0`; add `youtube_videos: true` + `publishing`).
- `apps/worker/tests/worker.test.ts` (~line 27; `internal_links: true` → count `1`; add `youtube_videos: true` + `publishing`).
- `apps/worker/tests/scanner.test.ts` — remove the `internal_links: true,` line from `LLM_JSON` (lines 22–26 keep `article_style` + `llm_instructions` only); the mock LLM no longer returns it. No new-shape additions needed (the scanner's own `parse` supplies defaults).
- `packages/shared/keywords/tests/{pipeline,llm-prompts,classify,gather,score,config,serp,serp-competitors}.test.ts` — each has one presets fixture with `internal_links: false` + `include_youtube_video: true`; apply the canonical result above. These are `satisfies SetupPresets` (or passed as `Org.presets`), so they **must** include the full new shape (`table_of_contents`, `youtube_videos`, `publishing`).

- [ ] **Step 9: Run the backend typecheck + full test suite**

Run: `npm run check && npm test`
Expected: PASS — backend + shared typecheck clean and all tests green; no `internal_links` / `include_youtube_video` references remain in backend/shared (`grep -rn "include_youtube_video\|content_seo.internal_links\b" apps/api apps/worker packages | grep -v node_modules` returns nothing). Do **not** run `check:all` here — the web half is expected-red until the paired frontend change (see Final verification).

- [ ] **Step 10: Lint + commit**

```bash
npm run lint:fix
git add packages/shared/schemas apps/worker/src/scanner.ts apps/worker/src/generation.ts packages/shared/generation/src/context.ts packages/shared/schemas/tests packages/shared/keywords/tests apps/api/tests apps/worker/tests
git commit -m "[backend] presets: internal_links_count, table_of_contents, publishing.auto_publish; rename youtube_videos (#73)

Part of #73"
```

---

## Task 2: Add `onboarding` to the org schema

**Files:**
- Modify: `packages/shared/schemas/src/org.ts`
- Test: `packages/shared/schemas/tests/org.test.ts` (create if absent)

**Interfaces:**
- Produces: `ONBOARDING_INTEGRATIONS` (`readonly ['wordpress','wordpress-com','framer']`) and `OrgSchema.onboarding` = `{ referral_source?: string; integrations?: Array<'wordpress'|'wordpress-com'|'framer'> } | undefined`. `CreateOrgInput` is unchanged (`onboarding` is optional).

- [ ] **Step 1: Write the failing schema test**

Create/append `packages/shared/schemas/tests/org.test.ts`. If the file exists, add only the `describe` block; otherwise create it whole:

```ts
import { describe, expect, test } from 'vitest';
import { ONBOARDING_INTEGRATIONS, OrgSchema } from '../src/org';

const baseOrg = {
  id: '6650f1a2b3c4d5e6f7a8b9c0',
  user_id: 'u1',
  website_url: 'https://example.com',
  setup_status: 'setup_complete',
  created_at: new Date(),
};

describe('OrgSchema.onboarding', () => {
  test('onboarding is optional', () => {
    expect(OrgSchema.parse(baseOrg).onboarding).toBeUndefined();
  });

  test('accepts referral_source + valid integrations', () => {
    const org = OrgSchema.parse({
      ...baseOrg,
      onboarding: { referral_source: 'LinkedIn', integrations: ['wordpress', 'framer'] },
    });
    expect(org.onboarding).toEqual({
      referral_source: 'LinkedIn',
      integrations: ['wordpress', 'framer'],
    });
  });

  test('rejects an unknown integration id', () => {
    expect(() =>
      OrgSchema.parse({ ...baseOrg, onboarding: { integrations: ['wix'] } }),
    ).toThrow();
  });

  test('exposes the integration enum values', () => {
    expect(ONBOARDING_INTEGRATIONS).toEqual(['wordpress', 'wordpress-com', 'framer']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- org`
Expected: FAIL — `ONBOARDING_INTEGRATIONS` and `onboarding` are not exported/defined.

- [ ] **Step 3: Add the enum + field to `OrgSchema`**

In `packages/shared/schemas/src/org.ts`, add the enum const above `OrgSchema` (after the imports):

```ts
/** Publishing platforms a user can select during onboarding (#73). */
export const ONBOARDING_INTEGRATIONS = ['wordpress', 'wordpress-com', 'framer'] as const;
```

Then add the field inside `OrgSchema`, immediately after the `domain_rating` block and before `created_at`:

```ts
  // Onboarding metadata captured at finalize (#73). Distinct from the connected
  // integrations concept (dashboard.integrations.connected).
  onboarding: z
    .object({
      referral_source: z.string().optional(),
      integrations: z.array(z.enum(ONBOARDING_INTEGRATIONS)).optional(),
    })
    .optional(),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- org`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + commit**

```bash
npm run check && npm run lint:fix
git add packages/shared/schemas/src/org.ts packages/shared/schemas/tests/org.test.ts
git commit -m "[backend] org: onboarding { referral_source, integrations } (#73)

Part of #73"
```

---

## Task 3: Finalize persists onboarding + enable `publishing` patches

**Files:**
- Modify: `packages/shared/db/src/repositories/org.repo.ts` (`finalize`, ~lines 76–84)
- Modify: `apps/api/src/schemas/setup.ts` (`SetupPresetsPatchSchema`, `FinalizeBody`)
- Modify: `apps/api/src/routes/setup.ts` (finalize handler, ~lines 181–199)
- Test: `apps/api/tests/setup.test.ts`

**Interfaces:**
- Consumes: `ONBOARDING_INTEGRATIONS` (Task 2); the reshaped presets (Task 1).
- Produces: `OrgRepo.finalize(id: string, presets: SetupPresets, onboarding?: { referral_source?: string; integrations?: Array<(typeof ONBOARDING_INTEGRATIONS)[number]> }): Promise<void>`. `FinalizeBody` gains optional `referral_source` + `integrations`.

- [ ] **Step 1: Write the failing route tests**

The `OrgRepo` mock already has `finalize: vi.fn(async () => {})` (setup.test.ts line 107) and `claimStrategy` returns true; the free org `6650f1a2b3c4d5e6f7a8b9c0` is `isPaid === false` so the strategy branch is skipped. The file exposes `const client = testClient<AppType>(app)` and an async `authHeader()` returning `{ Authorization }`. Add these tests inside the finalize `describe` block:

```ts
  test('finalize persists referral_source + integrations onto onboarding', async () => {
    const res = await client.api.v0.setup.finalize.$post(
      {
        json: {
          org_id: '6650f1a2b3c4d5e6f7a8b9c0',
          referral_source: 'LinkedIn',
          integrations: ['wordpress'],
        },
      },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(200);
    expect(OrgRepo.finalize).toHaveBeenCalledWith(
      '6650f1a2b3c4d5e6f7a8b9c0',
      expect.any(Object),
      { referral_source: 'LinkedIn', integrations: ['wordpress'] },
    );
  });

  test('finalize rejects an unknown integration id', async () => {
    const res = await client.api.v0.setup.finalize.$post(
      // @ts-expect-error — 'wix' is not a valid ONBOARDING_INTEGRATIONS member
      { json: { org_id: '6650f1a2b3c4d5e6f7a8b9c0', integrations: ['wix'] } },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(400);
  });
```

(The `@ts-expect-error` is required: the typed client rejects `'wix'` at compile time, so the runtime 400 test needs the suppression to compile.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- setup`
Expected: FAIL — finalize ignores the new body fields; `OrgRepo.finalize` is called with 2 args, and the unknown-id case currently 200s (no validation).

- [ ] **Step 3: Extend `OrgRepo.finalize` to persist onboarding**

In `packages/shared/db/src/repositories/org.repo.ts`, replace the `finalize` method (lines 76–84) with:

```ts
  /** Persist final presets (+ optional onboarding metadata) and flip the org to
   * `setup_complete` in a single update. */
  async finalize(
    id: string,
    presets: SetupPresets,
    onboarding?: { referral_source?: string; integrations?: string[] },
  ): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const data = SetupPresetsSchema.parse(presets); // validate on write
    const set: Record<string, unknown> = { presets: data, setup_status: 'setup_complete' };
    if (onboarding) set.onboarding = onboarding;
    await (await collection()).updateOne({ _id: new ObjectId(id) }, { $set: set });
  },
```

- [ ] **Step 4: Add `publishing` to the patch schema + onboarding fields to `FinalizeBody`**

In `apps/api/src/schemas/setup.ts`:
- Add the imports at the top, merging into the existing `@shared/schemas` import:

```ts
import { ONBOARDING_INTEGRATIONS, PublishingPrefsSchema, SetupPresetsSchema } from '@shared/schemas';
```

- In `SetupPresetsPatchSchema` (the `z.object({...})` at ~lines 51–67), add a `publishing` branch after the `article_preferences` block's `engagement` line, so the nested object becomes (note: `publishing` uses the named schema, NOT `.shape` drilling, because it is `.default(...)`-wrapped in the parent):

```ts
    article_preferences: z
      .object({
        content_seo: SetupPresetsSchema.shape.article_preferences.shape.content_seo
          .partial()
          .optional(),
        engagement: SetupPresetsSchema.shape.article_preferences.shape.engagement
          .partial()
          .optional(),
        publishing: PublishingPrefsSchema.partial().optional(),
      })
      .optional(),
```

- Replace `FinalizeBody` (lines 76–81) with:

```ts
export const FinalizeBody = z
  .object({
    org_id: z.string().openapi({ example: '6650f1a2b3c4d5e6f7a8b9c0' }),
    presets: SetupPresetsPatchSchema.optional(),
    referral_source: z.string().optional(),
    integrations: z.array(z.enum(ONBOARDING_INTEGRATIONS)).optional(),
  })
  .openapi('FinalizeBody');
```

- [ ] **Step 5: Forward onboarding from the finalize handler**

In `apps/api/src/routes/setup.ts`, update the finalize handler (starts ~line 181). Change the destructure and the `finalize` call:

```ts
    async (c) => {
      const { org_id, presets, referral_source, integrations } = c.req.valid('json');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) {
        return c.json({ error: 'Setup details not available' }, 404);
      }
      if (org.setup_status !== 'setup_scan_completed' || !org.presets) {
        return c.json({ error: 'Setup is not ready to finalize' }, 409);
      }
      const merged = mergePresets(org.presets, presets);
      // Build with only the keys that were actually provided — storing an
      // explicit `undefined`/`null` would fail the optional-array read-parse.
      const onboarding =
        referral_source !== undefined || integrations !== undefined
          ? {
              ...(referral_source !== undefined ? { referral_source } : {}),
              ...(integrations !== undefined ? { integrations } : {}),
            }
          : undefined;
      await OrgRepo.finalize(org_id, merged, onboarding);
      // Paid orgs get an automatic 30-day strategy. claimStrategy guarantees
      // exactly one job across finalize retries / re-finalize (#47).
      if (isPaid(org) && (await OrgRepo.claimStrategy(org_id))) {
        await enqueueStrategyTask({ org_id });
      }
      return c.json({ setup_status: 'setup_complete' as const, presets: merged }, 200);
    },
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- setup`
Expected: PASS — finalize is called with the onboarding object; the `wix` case now 400s (zod validation).

- [ ] **Step 7: Backend typecheck + lint + commit**

```bash
npm run check && npm run lint:fix
git add packages/shared/db/src/repositories/org.repo.ts apps/api/src/schemas/setup.ts apps/api/src/routes/setup.ts apps/api/tests/setup.test.ts
git commit -m "[backend] setup: finalize persists referral_source + integrations; publishing patch branch (#73)

Part of #73"
```

---

## Task 4: Editable `publishing` in Article Settings

**Files:**
- Modify: `apps/api/src/schemas/dashboard.ts` (`ArticlesSettingsPatchBody`, ~lines 233–241)
- Test: `apps/api/tests/dashboard.test.ts`

**Interfaces:**
- Consumes: reshaped presets (Task 1). The `GET /settings/articles` response returns `article_preferences` whole, so the new fields already flow through with no code change.
- Produces: `ArticlesSettingsPatchBody` gains an optional `publishing` partial branch.

- [ ] **Step 1: Write the failing settings test**

In `apps/api/tests/dashboard.test.ts`, inside the existing `describe('dashboard settings persistence', ...)` block (which defines the `auth()` helper returning `{ headers }` and uses the `org_1` fixture), add:

```ts
  test('PATCH /settings/articles updates publishing + content_seo counts', async () => {
    const opts = await auth();
    const res = await client.api.v0.dashboard.settings.articles.$patch(
      {
        json: {
          org_id: 'org_1',
          content_seo: { internal_links_count: 2, table_of_contents: false },
          publishing: { auto_publish: true },
        },
      },
      opts,
    );
    expect(res.status).toBe(200);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.article_preferences.content_seo.internal_links_count).toBe(2);
      expect(body.article_preferences.content_seo.table_of_contents).toBe(false);
      expect(body.article_preferences.publishing.auto_publish).toBe(true);
    }
  });
```

This relies on `org_1`'s presets being in the new shape — ensured by the Task 1 migration of the `orgs` fixture map. The `if (res.status === 200)` guard matches the file's existing narrowing pattern for the typed client union.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- dashboard`
Expected: FAIL — `publishing` is stripped by `ArticlesSettingsPatchBody` (not in the schema), so `auto_publish` is not applied.

- [ ] **Step 3: Add the `publishing` branch to the patch body**

In `apps/api/src/schemas/dashboard.ts`, add `PublishingPrefsSchema` to the existing `@shared/schemas` import (find the current import line and merge it in), e.g.:

```ts
import { PublishingPrefsSchema, SetupPresetsSchema } from '@shared/schemas';
```

Then replace `ArticlesSettingsPatchBody` (lines 233–241) with:

```ts
export const ArticlesSettingsPatchBody = z
  .object({
    org_id: z.string().openapi({ example: '6650f1a2b3c4d5e6f7a8b9c0' }),
    content_seo: SetupPresetsSchema.shape.article_preferences.shape.content_seo
      .partial()
      .optional(),
    engagement: SetupPresetsSchema.shape.article_preferences.shape.engagement.partial().optional(),
    publishing: PublishingPrefsSchema.partial().optional(),
  })
  .openapi('ArticlesSettingsPatch');
```

(`publishing` uses the named schema, not `.shape` drilling — the parent field is `.default(...)`-wrapped. Verify the current `@shared/schemas` import in this file and merge `PublishingPrefsSchema` into it rather than adding a duplicate import.)

(The route handler already does `const { org_id, ...patch } = ...; mergePresets(org.presets, { article_preferences: patch })`, so `publishing` flows through the deep-merge with no handler change.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- dashboard`
Expected: PASS.

- [ ] **Step 5: Backend verification + lint + commit**

```bash
npm run lint && npm run check && npm test
npm run lint:fix
git add apps/api/src/schemas/dashboard.ts apps/api/tests/dashboard.test.ts
git commit -m "[backend] dashboard: editable publishing.auto_publish in article settings (#73)

Part of #73"
```

---

## Task 5: Minimal frontend reconciliation (keep `check:all` green)

Scope is **only** what the schema change forces: fix type errors and make the
`internal_links` → `internal_links_count` mapping lossless (the frontend already
collects the 0–3 value). Do **not** add new form-field wiring for
`table_of_contents` / `youtube_videos` / `auto_publish` — that is the deferred
frontend feature task.

**Files:**
- Modify: `apps/web/app/[locale]/(authenticated)/onboarding/api.ts` (lines 125, 152)
- Modify: `apps/web/app/[locale]/(authenticated)/(product)/article-settings/page.tsx` (lines 38, 67, 75)

**Interfaces:**
- Consumes: reshaped `SetupPresets` (Task 1) + `ArticlesSettingsPatchBody` (Task 4).

- [ ] **Step 1: Fix the onboarding api read/write mapping**

In `apps/web/app/[locale]/(authenticated)/onboarding/api.ts`:
- Line 125 (`mapPresetsToFormPatch`) — read the count directly (lossless):

```ts
    internalLinksCount: String(presets.article_preferences.content_seo.internal_links_count),
```

- Line 152 (`buildPresetsPatch`, inside `article_preferences.content_seo`) — write the count:

```ts
        internal_links_count: Number.parseInt(form.internalLinksCount, 10),
```

- [ ] **Step 2: Fix the article-settings page type + mapping**

In `apps/web/app/[locale]/(authenticated)/(product)/article-settings/page.tsx`:
- Line 38 — the local `ArticleSettingsResponse.content_seo` field:

```ts
      internal_links_count: number;
```

- Line 67 (`mergeArticleSettings`):

```ts
    internalLinksCount: String(data.article_preferences.content_seo.internal_links_count),
```

- Line 75 (`buildArticleSettingsPatch`, inside `content_seo`):

```ts
      internal_links_count: Number.parseInt(settings.internalLinksCount, 10),
```

- [ ] **Step 3: Full typecheck (backend + web) + test**

Run: `npm run check:all && npm test`
Expected: PASS — web now compiles against the new `AppType`; no remaining `internal_links`/`include_youtube_video` references in `apps/web` (`grep -rn "internal_links\b\|include_youtube_video" apps/web/app | grep -v internal_links_count` returns nothing).

- [ ] **Step 4: Lint + commit**

```bash
npm run lint:fix
git add "apps/web/app/[locale]/(authenticated)/onboarding/api.ts" "apps/web/app/[locale]/(authenticated)/(product)/article-settings/page.tsx"
git commit -m "[frontend] onboarding/settings: map internal_links_count (#73)

Minimal reconciliation to the new backend shape; keeps check:all green.
Part of #73"
```

---

## Final verification

- [ ] `npm run lint` — clean.
- [ ] `npm run check:all` — backend + shared + web typecheck fully clean (Task 5 reconciles the web read/write sites).
- [ ] `npm test` — all suites green.
- [ ] `grep -rn "include_youtube_video\|content_seo\.internal_links\b" apps packages | grep -v node_modules` — only the plan/spec docs remain.
- [ ] `grep -rn "internal_links\b" apps/web/app | grep -v internal_links_count` — nothing (no stale web references).

> **Scope note:** Task 5 is deliberately minimal — it fixes type errors and makes the `internal_links_count` mapping lossless. Full frontend wiring of the new toggles (`table_of_contents`, `youtube_videos`, `auto_publish`) through the onboarding/settings forms is a separate frontend task and is **not** part of this plan.
```
