# Org-level image direction decided at scan time

Design for [#312](https://github.com/seopotion/seo/issues/312). Written 2026-09-02.
Follows [`design/article-image-prompts.md`](../../../design/article-image-prompts.md)
(#309/#310), which left style as a per-article classification of a free-text preset.

## Problem

The only org-level image decision is the scanner's free-text `image_style`. At
article time the planner classifies that phrase into a medium enum on every run,
and picks a palette per slot. Consequences:

- the scan tends to produce subject matter ("hardware photos, CLI screenshots"),
  so the medium is a guess from an ambiguous phrase, re-made per article;
- an org's images share no colour identity (piperbox's three images on
  2026-09-02 had three unrelated palettes);
- the admin field gives no hint of what it controls.

## Decision

Art direction becomes a structured org preset, decided once at scan time and
inherited by every article. The planner stops classifying; it only decides what
each picture shows.

Scope of this PR: schema, scanner, planner, API plumbing, admin editor. The
customer-facing article-settings page and onboarding step are a separate
frontend PR.

## Schema

`packages/shared/schemas/src/presets.ts`:

```ts
export const IMAGE_MEDIA = [
  'photograph', 'flat_illustration', 'three_d_render', 'watercolor', 'line_art', 'isometric',
] as const;
export type ImageMedium = (typeof IMAGE_MEDIA)[number];

export const ImageDirectionSchema = z.object({
  medium: z.enum(IMAGE_MEDIA),
  palette: z.string(), // ≤ 6 words, e.g. "deep navy and warm white"; '' = no preference
  notes: z.string(),   // subject preferences, one short phrase; '' = none
});
export type ImageDirection = z.infer<typeof ImageDirectionSchema>;
```

`article_preferences.engagement.image_direction` holds it. `image_style` leaves
the schema. `IMAGE_MEDIA` and `ImageMedium` move here from `@shared/generation`,
which re-exports them so existing imports keep working.

### Legacy documents: moved, not deleted

A `z.preprocess` on `engagement`, the same pattern as `audience.target`: a
document with a string `image_style` and no `image_direction` parses to
`image_direction: { medium: 'photograph', palette: '', notes: <image_style> }`.
The old key is left in place on disk; the next save through the admin editor
persists the new shape. Existing orgs (4 staging, 1 prod) get `photograph`
until someone picks a medium in the editor. No migration script.

### Patch schema

`EngagementPrefsPatchSchema` stays `z.object(fields).partial()`, so a patch may
carry a whole `image_direction`. `mergePresets` deep-merges nested objects, so
`{ engagement: { image_direction: { medium } } }` keeps `palette` and `notes`.
No route changes.

## Scanner

`apps/worker/src/scanner.ts`: `ScanOutputSchema.article_preferences.engagement`
becomes `{ image_direction: ImageDirectionSchema }`, so the structured-output
call cannot return a medium outside the enum. Prompt guidance added:

- `medium`: pick from the enum to match the site's visual character
  (product/photo-heavy site → `photograph`; SaaS with flat brand graphics →
  `flat_illustration`; and so on). Screenshots, diagrams and interfaces are
  never a medium; when the site suggests those, use `photograph`.
- `palette`: the site's brand colours as at most 6 words, or `''`.
- `notes`: one short phrase of subject matter the images should favour, or `''`.

## Planner

`packages/shared/generation/src/images.ts`:

- `ImagePlanSchema` drops top-level `medium`; `ImageSlotSchema` drops `palette`.
  A slot is `{ subject, composition, lighting, objects, alt }`.
- `ImagePlanInput.imageStyle` becomes `imageDirection: ImageDirection`. The
  user message states the medium and notes, e.g.
  `Images are photographs. Subject preferences: hardware, workbenches.`, so
  subjects and objects stay consistent with them. The "read medium off the
  style" and per-slot palette lines leave the system prompt.
- `imagePrompt(direction: ImageDirection, slot)` takes medium and palette from
  the preset. Per-slot palette is dropped, not kept as an override: per-image
  colour choice is what broke colour identity. The existing `findTextRisk`
  check on the palette stays at assembly time; scanner and editor need none.
- `parseImagePlan` keeps its heading checks and distinct-composition pass.

`packages/shared/articles/src/stages/images.ts` passes
`presets.article_preferences.engagement.image_direction` and calls
`imagePrompt(direction, slot)`.

## Admin editor

`apps/admin/src/pages/org/PresetsEditor.tsx`: the "Image style" text field
becomes three controls in the Article preferences group:

- **Image medium**: select over `IMAGE_MEDIA`, labels humanised
  ("Photograph", "Flat illustration", "3D render", "Watercolor", "Line art",
  "Isometric"). Hint: "The kind of picture every article image is."
- **Palette**: text. Hint: "Up to 6 words naming the colours; empty for none."
- **Subject notes**: text. Hint: "What the pictures should favour showing."

`apps/web`'s `ArticleSettingsResponse` type gets the new shape only so the web
typecheck passes; no UI there.

## Tests

- schemas: legacy `image_style` preprocesses into `image_direction`; the new
  shape passes through; an unknown medium is rejected; the patch schema accepts
  a partial `image_direction`.
- generation: `imagePrompt` uses the preset medium and palette in every slot;
  a text-risk palette is dropped; the planner prompt states medium and notes;
  `parseImagePlan` still enforces headings and distinct compositions.
- scanner: the output schema requires `image_direction` with an enum medium.
- articles stage: stores prompts assembled from the preset direction.
- Fixtures (~35 files): `image_style: …` becomes
  `image_direction: { medium: 'photograph', palette: '', notes: '' }`. Tests
  that PATCH `image_style` (dashboard, setup, admin orgs, merge-presets) patch
  `image_direction` instead.

## Verification

`npm run lint`, `npm run check:all`, `npm test` (the php-dependent test fails
locally, as known). Then the local fal render loop from #310 with one
piperbox-like direction (two slots), eyeballed. A staging article after merge is
the last word: three images sharing one medium and palette.

## Docs

- `design/article-image-direction.md`: short design note (this spec's
  Decision, Schema, Planner sections) linked from `design/README.md`.
- `design/article-image-prompts.md`: one-line note that style/palette now come
  from the preset, pointing at the new doc.
- `PROGRESS.md`: one line under images, linking #312.

## Out of scope

Customer-facing settings/onboarding UI (separate frontend issue). The vision
reject-and-regenerate pass for residual lettering (unfiled).
