# Per-org readability target — design

Tracked in [#313](https://github.com/seopotion/seo/issues/313).

## Problem

Every English article is judged against one global Flesch–Kincaid target,
`FLESCH_KINCAID_TARGET = 8` (`packages/shared/generation/src/config.ts`). The
humanize stage rewrites the draft up to three times until the grade is at or
below the target, and the article records `readability.target_met`.

The score is `0.39 × words/sentence + 11.8 × syllables/word − 15.59`. Measured
on a staging piperbox run: sentence length contributed ~3.5 points (already
9 words per sentence), syllables per word contributed ~22 (1.87). Reaching 8 at
that sentence length needs ≤ 1.70 syllables per word, and the words that keep
it high are the required vocabulary (deployment, infrastructure, security,
Kubernetes). The prompt rightly forbids dropping keywords and technical terms,
so each retry only shortens sentences further and gains 0.2–0.4 points.

Staging evidence (last 25 runs): piperbox attempts 10.4→10.2→9.8, 9.4→9.1→8.8,
9.6→8.8→8.6, 9.0→8.9→8.5 — three LLM rewrites of a ~2,700-word article per
piece, still shipped `target_met: false`. Unmarble (consumer copy) passes in one
or two passes. Non-English orgs get `grade: null` and pass immediately.

The target is a property of the audience, not a constant.

## Design

### 1. The preset

`SetupPresetsSchema.article_preferences.content_seo` gains

```ts
readability_grade_max: z.number().int().min(6).max(14).default(READABILITY_GRADE_MAX_DEFAULT)
```

with `READABILITY_GRADE_MAX_DEFAULT = 8` exported from `@shared/schemas`
(same single-sourcing pattern as `META_TITLE_MAX`). `FLESCH_KINCAID_TARGET` is
removed; `@shared/generation`'s config re-exports the default for its own test.

The `.default(8)` means:

- existing org docs parse unchanged (no backfill, no migration);
- in-flight `article_runs` whose `input.presets` snapshot predates the field
  parse with 8, i.e. current behaviour;
- the dashboard and setup patch bodies, which derive from
  `SetupPresetsSchema.shape.…content_seo.partial()`, accept the field with no
  API change.

Semantics: the article's Flesch–Kincaid grade must be **at or below** this
value to pass. Only applied when `business.language === 'English'` (the grader
returns `null` otherwise, unchanged).

### 2. The scan assigns it

`ScanOutputSchema.article_preferences.content_seo` (apps/worker/src/scanner.ts)
gains `readability_grade_max: z.union([z.literal(8), z.literal(10), z.literal(12)])`.
Three literals keep the model on a reviewable menu; the preset's 6–14 range is
for manual edits.

`buildScanPrompt` gains one system line:

> readability_grade_max is the highest acceptable Flesch–Kincaid grade for
> articles: 8 for general-public or consumer audiences, 10 for business and
> professional audiences, 12 for developers, engineers, scientists and other
> specialists.

`scanWebsite` passes `fields.article_preferences` through as today; the field
rides along.

### 3. Generation reads the org target

`GenerationContext` gains `readabilityGradeMax: number`; `buildContext` reads
`p.article_preferences.content_seo.readability_grade_max`. `contextFromRun`
already goes through `buildContext`, so every stage sees it.

Consumers, each replacing the constant with `ctx.readabilityGradeMax`:

| Site | Change |
| --- | --- |
| `generation/src/article.ts` draft prompt | "Aim for Flesch-Kincaid grade level ${n} or lower. …" |
| `generation/src/humanize.ts` prompt | same line; the retry feedback `target` is the org value |
| `articles/src/stages/humanize.ts` | `passes(grade)` compares against the ctx target; feedback `{ grade, target }` uses it |
| `articles/src/stages/finalize.ts` | `readability.target` stores the ctx target, `target_met` compares against it |

The three-pass cap, best-attempt fallback, brand-mention guard and the Choice
loop in the state machine are untouched. An early exit on marginal improvement
is a separate follow-up.

### 4. Article settings UI

`apps/web/app/[locale]/(authenticated)/(product)/article-settings/`:

- `article-settings.ts`: form field `readabilityGradeMax: string`
  (`'8' | '10' | '12'`, initial `'8'`); response type gains the number;
  `mergeArticleSettings` stringifies it; `buildArticleSettingsPatch` sends
  `content_seo.readability_grade_max: Number.parseInt(...)`.
- `page.tsx`: a "Readability" `Select` after Article style, options from a
  new `readabilityTiers` constant in `onboarding/constants.ts`:

  ```ts
  export const readabilityTiers = [
    { value: '8', labelKey: 'generalPublic' },
    { value: '10', labelKey: 'professional' },
    { value: '12', labelKey: 'technical' },
  ] as const;
  ```

- Messages (`en.json` + `tr.json`): `ArticleSettingsPage.fields.readability.{label,description,placeholder}`
  and `Onboarding.options.readabilityTiers.{generalPublic,professional,technical}`.
  Labels name the audience ("General public", "Professional", "Technical");
  the description says it sets how simple the writing must read and applies
  to English articles only.

A value outside the three tiers (only reachable via the API) leaves the
select unhighlighted; saving sends whatever the form holds. No custom entry.

The onboarding wizard's article-settings step is **not** changed: the scan's
tier lands in presets and is editable afterwards from the settings page.

## Testing

- `schemas` tests: a preset without the field parses with 8; 5 and 15 are
  rejected.
- `scanner` tests: prompt contains the tier line; a reply with 12 lands in
  `presets.article_preferences.content_seo.readability_grade_max`.
- `generation` prompt tests: draft and humanize system prompts quote the ctx
  target; humanize feedback quotes it.
- `articles` humanize-stage tests: grade 10 passes under target 12 in one
  pass; grade 10 under target 8 loops as today. Finalize test: stored
  `readability.target` equals the org target.
- web: `apps/web/tests/article-settings-cta.test.ts` (existing) gains a case that
  `mergeArticleSettings` / `buildArticleSettingsPatch` round-trip the field.
- `npm run lint`, `npm run check:all`, `npm test` green (php-dependent
  wordpress test excepted locally).

## Rollout

Ships with the normal dev → staging flow. Staging: set piperbox to 12 from the
settings page (or rescan) and confirm the next article passes humanize in one
pass with `target_met: true`. Unmarble stays at 8.
