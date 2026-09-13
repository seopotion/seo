# Per-org AI model routing

Design written 2026-09-13. Follows [`llm-image-providers.md`](llm-image-providers.md)
(one model everywhere) and [`article-image-direction.md`](article-image-direction.md)
(#312, org-level medium). Issue: to be filed on implementation.

## Problem

Every org is served by the same models: Haiku 4.5 for all article stages and
`fal-ai/flux-2` for every image. That is right for a general-audience site
(unmarble, clewas) and wrong for a technical one (piperbox): Haiku drafts are
too shallow for a developer audience, and flux-2 cannot render the labelled
diagrams such articles want.

OpenRouter and fal already are the gateway — the model is a per-call parameter
on both `LlmClient` and `ImageClient`, nobody passes it. What is missing is a
**routing decision** per org and per task, not new transport.

## Decision

| Concern | Choice |
| --- | --- |
| Text routing signal | New preset `content_seo.content_complexity`: `general \| professional \| technical`. Scan-assigned, admin-editable, default `general`. |
| Text routing | A const table `(complexity, task) → { model, timeoutMs }` in `@shared/providers`. Article stages pass the result per call. |
| Image routing signal | `image_direction.medium` gains `diagram`. Complexity never touches images. |
| Image routing | `diagram` → a text-capable fal model; every other medium → `flux-2` as today. |
| Billing cap | None. Complexity alone decides; article generation already requires a paid plan. |
| Diagrams as code | Out of scope. Filed as a separate, very-optional issue. |
| Where the tables live | Code constants. No DB, no env, no admin knob for the models themselves. |

`general` resolves to exactly today's models, so orgs that are not marked
`professional` or `technical` see no behaviour or cost change.

## 1. Routing signal: `content_complexity`

```ts
// packages/shared/schemas/src/presets.ts
export const CONTENT_COMPLEXITIES = ['general', 'professional', 'technical'] as const;
export type ContentComplexity = (typeof CONTENT_COMPLEXITIES)[number];

const ContentSeoFields = {
  …
  content_complexity: z.enum(CONTENT_COMPLEXITIES),
};
// In SetupPresetsSchema: content_complexity defaulted to 'general', same
// pattern as readability_grade_max — pre-existing org docs and article_runs
// snapshots keep parsing without a migration. ContentSeoPatchSchema keeps the
// undefaulted field so a PATCH cannot clobber a stored value.
```

- **Scanner** (`apps/worker/src/scanner.ts`): the structured-output schema
  gains `content_complexity: z.enum(CONTENT_COMPLEXITIES)` next to
  `readability_grade_max`, with prompt guidance: `general` for consumer,
  lifestyle and local-service sites; `professional` for B2B, finance, legal,
  agencies; `technical` for developer tools, infrastructure, engineering and
  scientific products whose readers expect precise, expert-level content.
- **Admin presets editor**: a select over `CONTENT_COMPLEXITIES` in the
  content_seo section. Customer-facing article-settings select and onboarding
  are a follow-up frontend issue (same split as #312).
- **Run snapshot**: no change — `article_runs.input.presets` already carries
  the whole presets object, so a run is routed by the complexity at launch.

## 2. Text routing

New module `packages/shared/providers/src/llm/routing.ts`, exported from the
package index:

```ts
export type LlmTask = 'outline' | 'draft' | 'humanize' | 'finalize' | 'image_plan';
export type LlmRoute = { model: string; timeoutMs: number };

export function routeLlm(complexity: ContentComplexity, task: LlmTask): LlmRoute;
```

Backed by this table (OpenRouter model ids; the Sonnet and Opus ids are
**verified against OpenRouter's model list at implementation time**, never
guessed):

| Task | general | professional | technical |
| --- | --- | --- | --- |
| outline | Haiku 4.5 | Sonnet | Sonnet |
| draft | Haiku 4.5 | Sonnet | Opus |
| humanize | Haiku 4.5 | Haiku 4.5 | Sonnet |
| finalize (semantic + meta) | Haiku 4.5 | Haiku 4.5 | Haiku 4.5 |
| image_plan | Haiku 4.5 | Haiku 4.5 | Haiku 4.5 |

Rationale: the draft is where technical accuracy lives, so it gets the
largest jump. Humanize on a technical draft risks dumbing it down, so it gets
a stronger model at the top tier but never Opus. Meta, semantic markup and
image planning are mechanical regardless of audience.

**Timeouts.** The LLM client defaults to 60s per request. An Opus draft of
~5k output tokens will exceed that, so the route carries its own timeout:
Haiku 60s, Sonnet 120s, Opus 240s. `LlmCompleteParams` gains an optional
`timeoutMs` that overrides the client default for that call. The draft
stage's Step Functions task timeout is 5 minutes, so no infra change. Retries
(2, backoff) are unchanged.

**Call sites.** Each article stage reads
`run.input.presets.article_preferences.content_seo.content_complexity` and
passes `{ model, timeoutMs }` from `routeLlm`:

| Stage file | Task |
| --- | --- |
| `stages/outline.ts` | `outline` |
| `stages/draft.ts` | `draft` |
| `stages/humanize.ts` | `humanize` |
| `stages/finalize.ts` (both calls) | `finalize` |
| `stages/images.ts` (plan call) | `image_plan` |

The keyword/strategy pipeline is untouched; it keeps its own pinned model.

**Observability.** `LlmResult.model` and `usage.costUsd` already exist; the
stages already log the result. No new fields — the model actually served
shows up in the existing per-stage log line, which is what the staging check
reads.

## 3. Image routing

### Medium

`IMAGE_MEDIA` gains `'diagram'`. The scanner prompt drops the sentence
"Screenshots, diagrams and interfaces are never a medium" and instead says:
`diagram` for sites whose content is architectural, procedural or
data-oriented (developer tools, infrastructure, engineering) where a labelled
schematic serves the reader better than a picture; screenshots and real
interfaces remain never a medium. The admin editor's medium select picks up
the new value from the enum.

### Model

New module `packages/shared/providers/src/image/routing.ts`:

```ts
export function routeImage(medium: ImageMedium): string;
// 'diagram' → text-capable fal model (Gemini image model on fal; exact id
//             verified against fal's model list at implementation time)
// anything else → 'fal-ai/flux-2'
```

The hardcoded `IMAGE_MODEL` constant in `stages/images.ts` is removed; the
stage passes the routed model to `generate` and records it on the slot, so
slot metadata stays truthful.

### Planning and prompt for `diagram`

Non-diagram media go through the existing planner and `imagePrompt` path
unchanged. For `diagram`:

- The per-slot plan schema gains `labels: z.array(z.string()).max(5)`, each
  label at most 3 words. For non-diagram media the planner is told to return
  `[]` and the field is ignored.
- The planner instruction "Never a screen, diagram, …" for `subject` flips,
  for diagram orgs only, to: describe the diagram (what it explains, which
  shapes or flow) and list the exact labels to render.
- `imagePrompt` gets a diagram branch: the scene sentence names the diagram
  type and subject, then "with exactly these labels, rendered legibly:
  …". The no-text directive (`withNoTextDirective`) is **not** appended;
  instead a short directive asks for clean sans-serif labels and no other
  text.
- `findTextRisk` is skipped for `diagram` — the whole point is text.
- Composition, palette and byte-cap handling are unchanged. The palette still
  applies (diagram in the org's colours).

## 4. Rollout

No migration. The schema default covers every existing org and run snapshot.

1. Deploy to staging.
2. From the admin editor set piperbox to `content_complexity: technical` and
   `image_direction.medium: diagram`.
3. Trigger one piperbox article (`articles generate-next`, per the
   article-pipeline skill). Verify the stage logs show Sonnet for outline
   and humanize and Opus for draft, and that the three images are diagrams
   with legible labels.
4. Confirm an unmarble article still routes to Haiku and flux-2 (no change).
5. Release to prod; repeat step 2 for prod piperbox.

## 5. Testing

Unit (Vitest, no infra):

- `routeLlm`: every `(complexity, task)` cell resolves to a non-empty model
  and positive timeout; every `general` cell equals the client's
  `DEFAULT_MODEL` and default timeout.
- `routeImage`: `diagram` → the text-capable model; every other medium →
  `flux-2`.
- Presets: a doc without `content_complexity` parses to `general`; the
  patch schema does not inject a default.
- Scanner: the structured-output schema accepts the three values and
  rejects others.
- LLM client: `timeoutMs` on a call overrides the config default (assert the
  abort timer value via a fake timer).
- Image stage: routed model is passed to `generate` and recorded on the slot.
- Image prompt: for `diagram`, output contains every label and does not
  contain the no-text directive; for `photograph`, unchanged from today's
  snapshot.

Manual before the PR: a local fal render loop for the diagram prompt (as in
#312) to confirm the chosen model actually renders the labels.

Staging: the rollout steps above.

## 6. Out of scope, filed separately

- **Diagrams as code** — LLM-authored Mermaid/SVG rendered to PNG. Accurate
  and editable, but a new stage with its own planner and a renderer in
  Lambda. Marked very optional until technical customers exist.
- **Customer-facing `content_complexity` select** in article-settings and
  onboarding.
- **Billing-tier cap** on the ladder — deliberately not built; revisit if
  spend on technical orgs becomes a problem.
- **Per-stage cost attribution** in the run document — the cost is already
  in the logs; persisting it is a separate concern.
