# Onboarding backend persistence (issue #73)

**Date:** 2026-07-20
**Issue:** [#73 — onboarding flow improvements](https://github.com/seopotion/seo/issues/73)
**Scope:** Backend only (parts 3, 4, 5 of the issue). Frontend adapts separately.

## Context / current state

Tracing the code showed the issue is partially stale — two of its five parts are
already implemented:

- **Part 1 (real scan):** `apps/worker/src/scanner.ts` already scrapes the homepage +
  sitemap and calls the LLM to generate real presets (business name, description, etc.).
  Not mock data. **No work needed.**
- **Part 2 (single-request finalize):** `POST /setup/finalize` already accepts `presets`
  and persists them while flipping the org to `setup_complete` in one atomic update
  (`OrgRepo.finalize`). The frontend's two-request flow is a frontend choice. The only
  backend gap is that finalize does not yet accept `referral_source` / `integrations`
  (covered by parts 4 & 5 below). **No new endpoint needed.**

The genuine work is parts 3–5: new article-preference fields, `referral_source`, and
onboarding `integrations`.

**No backward compatibility required** — the project is pre-alpha, so schema changes are
made cleanly without preprocess/default migration shims for existing documents.

## Decisions (agreed)

1. **internal_links → count.** Replace `content_seo.internal_links` (boolean) with
   `internal_links_count: number` (integer 0–3). The frontend dropdown shows literal
   counts 0/1/2/3, so these are genuine numbers, not semantic buckets — an enum would
   misrepresent them.
2. **auto_publish placement.** New `article_preferences.publishing` subgroup holding
   `auto_publish: boolean`. Semantically clean and leaves room to grow (schedule, target
   integration). `table_of_contents` goes in `content_seo`.
3. **Org storage.** `org.onboarding: { referral_source?: string, integrations?: Enum[] }`,
   with `integrations` validated against a strict enum. Groups onboarding metadata and
   keeps it distinct from the existing *connected*-integrations concept
   (`dashboard.integrations.connected`).
4. **YouTube rename.** `engagement.include_youtube_video` → `engagement.youtube_videos`,
   mirroring the frontend field.

## Target schemas

### `packages/shared/schemas/src/presets.ts` — `SetupPresetsSchema.article_preferences`

```ts
article_preferences: z.object({
  content_seo: z.object({
    article_style: z.string(),
    internal_links_count: z.number().int().min(0).max(3).default(1), // was: internal_links: boolean
    table_of_contents: z.boolean().default(true),                    // new
    llm_instructions: z.string(),
  }),
  engagement: z.object({
    image_style: z.string(),
    youtube_videos: z.boolean().default(true),                       // renamed from include_youtube_video
  }),
  publishing: z.object({                                             // new subgroup
    auto_publish: z.boolean().default(false),
  }),
}),
```

**Defaults** mirror the frontend `initialForm` (`internalLinksCount: '1'`,
`tableOfContents: true`, `youtubeVideos: true`) with `auto_publish` defaulting to `false`
(safer off-by-default). These are user-preference toggles with sensible defaults, **not**
scan-derived — so the scanner LLM prompt does not ask for them (see below).

### `packages/shared/schemas/src/org.ts` — `OrgSchema`

```ts
export const ONBOARDING_INTEGRATIONS = ['wordpress', 'wordpress-com', 'framer'] as const;

// added to OrgSchema:
onboarding: z
  .object({
    referral_source: z.string().optional(),
    integrations: z.array(z.enum(ONBOARDING_INTEGRATIONS)).optional(),
  })
  .optional(),
```

`onboarding` is optional, so `CreateOrgInput` (which `.omit`s `id`/`created_at`/`presets`)
needs no change — orgs are created without it and it is set at finalize time.

## Changes by file

### Shared schemas
- `packages/shared/schemas/src/presets.ts` — apply the `article_preferences` changes above.
- `packages/shared/schemas/src/org.ts` — add `ONBOARDING_INTEGRATIONS` + the `onboarding`
  field. Export the enum/const for reuse by the API schema.

### Shared generation
- `packages/shared/generation/src/context.ts` — line 16 currently reads
  `internalLinks: p...content_seo.internal_links`. Change to derive from the count:
  `internalLinks: p...content_seo.internal_links_count > 0`. (Consumer behaviour
  unchanged; richer count-based generation is out of scope.)

### Worker
- `apps/worker/src/scanner.ts` — update `buildScanPrompt`: drop `internal_links` from the
  requested JSON shape (it is now a defaulted user pref, not LLM-guessed). `content_seo`
  the LLM returns is `{ article_style, llm_instructions }`; `engagement` is `{ image_style }`.
  The defaulted fields (`internal_links_count`, `table_of_contents`, `youtube_videos`,
  `auto_publish`) fill in via schema defaults during `SetupPresetsSchema.parse`.
- `apps/worker/src/generation.ts` — line 75 `...engagement.include_youtube_video` →
  `...engagement.youtube_videos`.

### API — org repository
- `packages/shared/db/src/repositories/org.repo.ts` — extend `finalize` to also persist
  onboarding metadata in the same atomic `$set`:
  `finalize(id, presets, onboarding?: { referral_source?; integrations? })`. When
  `onboarding` is provided, include `{ onboarding }` in the update.

### API — setup routes & schemas
- `apps/api/src/schemas/setup.ts`:
  - `SetupPresetsPatchSchema` — add a `publishing` partial branch alongside
    `content_seo` / `engagement` so patches can reach `auto_publish`.
  - `FinalizeBody` — add optional `referral_source: z.string()` and
    `integrations: z.array(z.enum(ONBOARDING_INTEGRATIONS))`.
- `apps/api/src/routes/setup.ts` — in the `finalize` handler, read `referral_source` /
  `integrations` from the body and pass them to `OrgRepo.finalize(org_id, merged, { ... })`.
  `PATCH /setup/presets` stays presets-only (referral/integrations persist only via
  finalize, per the issue).

### API — dashboard (Article Settings)
- `apps/api/src/schemas/dashboard.ts` — `ArticlesSettingsPatchBody` currently allows
  `content_seo` / `engagement` partials; add a `publishing` partial branch so the new
  fields are editable. `ArticlesSettingsResponse` already returns
  `article_preferences` whole, so the new fields flow through automatically.
- `apps/api/src/routes/dashboard.ts` — the GET/PATCH `/settings/articles` handlers pass
  `article_preferences` through `mergePresets` and return it whole; the `publishing`
  branch is picked up by the existing deep-merge with no handler logic change.

### merge-presets
- `apps/api/src/lib/merge-presets.ts` — generic deep-merge, driven by the `SetupPresets`
  type. No code change; the new `publishing` object merges like the others once the
  schema includes it.

## Test-fixture churn (sizeable, mechanical)

`internal_links` and `include_youtube_video` appear as preset fixtures in **~20 test
files** across `packages/shared/keywords/tests`, `apps/worker/tests`, and
`apps/api/tests`. Every fixture that builds a full `article_preferences` object must be
updated to the new shape:
- `internal_links: <bool>` → `internal_links_count: <0-3>` (+ optionally
  `table_of_contents`, though defaults cover omission),
- `include_youtube_video` → `youtube_videos`,
- add `publishing: { auto_publish: ... }` where a full literal object is parsed (defaults
  cover omission where the object is built for `.parse`).

Because the new fields carry Zod defaults, fixtures that rely on `SetupPresetsSchema.parse`
can omit them; only fixtures typed as a full `SetupPresets` literal (no parse) must add
them to satisfy the type.

## New tests

- `packages/shared/schemas/tests/presets.test.ts` — assert new defaults apply
  (`internal_links_count` 1, `table_of_contents` true, `youtube_videos` true,
  `auto_publish` false) and that `internal_links_count` rejects out-of-range/non-int.
- `apps/api/tests/setup.test.ts` — finalize persists `referral_source` + `integrations`
  onto `org.onboarding`; invalid integration id is rejected.
- `apps/api/tests/dashboard.test.ts` — PATCH `/settings/articles` updates `publishing`
  and the new `content_seo` fields; GET returns them.

## Out of scope

- Frontend changes (`apps/web` onboarding `api.ts`/`types.ts`, article-settings page) —
  tracked separately; the frontend adapts to the new backend shape.
- Generation/publishing *behaviour* for the new toggles (`table_of_contents`,
  `auto_publish`, count-based internal linking) — storage only for now, per the issue.
- Reading `referral_source`/`integrations` back via `GET /setup/details` — the issue only
  asks to persist them; not needed for restore.

## Verification

- `npm run lint`, `npm run check:all`, `npm test` all green.
- Targeted: new schema-default + finalize-persistence + settings-patch tests pass.
```
