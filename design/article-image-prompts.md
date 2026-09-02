# Article image prompts: medium, composition and variety

Design for [#309](https://github.com/seopotion/seo/issues/309). Written 2026-09-02.
Builds on [`article-images.md`](article-images.md) (#51) and replaces the prompt
half of [#289](https://github.com/seopotion/seo/pull/289).

## What went wrong

#289 closed the garbled-text problem (#280) by having the planner name 2–4
objects and letting `photoPrompt` wrap them in one fixed sentence. Three rounds
of prompt wording and a deny list had failed before it, because free prose
reaching the image model can always ask for a diagram by another name. The
fix worked, and it over-corrected:

- every image for every org is objects on a surface in natural light;
- the org's `image_style` preset has no visible effect — the planner can only
  answer with objects, and the template ignores style;
- abstract topics get literal props ("deployment automation" → a gear and a
  cable) because there is no way to ask for an evocative scene.

## Decision

Keep the property that made #289 work — **the model never writes the prompt** —
and widen what the code-owned template can express. Every free-text field the
planner returns is short and filtered; everything that shapes the *kind* of
image is an enum the code maps to a fixed clause.

| Concern | Choice |
| --- | --- |
| Where style is decided | The planner classifies the org's free-text `image_style` into a `medium` enum, once per plan. `image_style` stays free text in presets (changing it touches six surfaces; revisit if the classification misreads a style). |
| What varies per slot | `composition` (enum), `lighting` (enum), `palette` (short phrase), `subject`, `objects[]` |
| Who guarantees variety | Code: the three slots must use distinct compositions; duplicates are reassigned |
| Persistence | Unchanged — `ArticleImage.prompt` stores the assembled string. Old articles keep theirs. |
| Vision check on the render | Out of scope; separate follow-up. It is the only thing that catches text flux letters on a textless prompt. |

## Planner contract

One structured-output call, `IMAGE_PLAN_RESPONSE_SCHEMA`:

```ts
medium: 'photograph' | 'flat_illustration' | 'three_d_render' | 'watercolor' | 'line_art' | 'isometric'
cover:  Slot
inline: (Slot & { section_heading: string })[]   // exactly INLINE_IMAGE_COUNT

Slot = {
  subject: string;        // the idea the picture stands for, a short phrase
  composition: 'still_life' | 'macro' | 'environment' | 'abstract' | 'silhouette' | 'top_down';
  lighting: 'natural_daylight' | 'golden_hour' | 'soft_studio' | 'dramatic_low_key' | 'cool_ambient';
  palette: string;        // ≤ 6 words, e.g. "warm amber and slate"; may be ''
  objects: string[];      // 0–4 tangible things, as today
  alt: string;            // screen-reader text in the article language
}
```

Prompt rules the planner is given: `medium` is read off the org's image style
and falls back to `photograph` when the style is empty or asks for something
that carries text (screenshots, diagrams, UI); use a different composition for
each of the three slots; abstract subjects should use `abstract` or
`environment`; the object rules from #289 stand (plain nouns, nothing that
carries writing, no brands); *you are not writing the prompt*.

`parseImagePlan` keeps its heading checks (count, known, distinct) and no
longer tolerates an omitted `section_heading` — the strict schema already
requires it, and alpha needs no lenience for older shapes.

## Prompt assembly

`imagePrompt(medium, slot)` replaces `photoPrompt`. Clauses, joined with spaces:

1. **Medium** — `A photograph`, `A flat vector illustration`, `A 3D rendered
   scene`, `A watercolor painting`, `A minimal line-art illustration`,
   `An isometric illustration`.
2. **Composition**, filled with `subject` and the objects that survive
   `usableObjects`:
   - `still_life`: `of {objects}, arranged on a plain surface`
   - `macro`: `: an extreme close-up of {objects[0]}, showing its texture and detail`
   - `environment`: `: a wide scene evoking {subject}` + `, with {objects} in their natural setting` when objects exist
   - `abstract`: `: abstract shapes, light and texture evoking {subject}, with no recognisable objects`
   - `silhouette`: `of {objects} in silhouette against a bright, plain background`
   - `top_down`: `of {objects} seen from directly above, laid out on a plain surface`
   Compositions that need objects (`still_life`, `macro`, `silhouette`,
   `top_down`) **downgrade to `abstract`** when no object survives the filter.
3. **Lighting** — one fixed phrase per enum value.
4. **Palette** — `Palette: {palette}.` when present and `findTextRisk` is null;
   dropped otherwise.
5. **Tail** — unchanged in intent, worded per medium: photographs get
   `A real physical scene, not a document, page, poster, slide or screen.`,
   illustrations get `A single illustrated scene, not a document, page, poster,
   slide, chart or screen.` Both end with the existing no-text sentence.
   `withNoTextDirective` is still appended at render time.

The document disclaimer stays in every variant: measured on #286, prose without
it renders as a page of garbled text.

## Variety

After parsing, code walks cover → inline in order; a slot whose composition
was already used takes the first unused value from a fixed order
(`still_life, environment, abstract, macro, top_down, silhouette`). This runs
**before** the objects filter, so a downgrade to `abstract` can still produce
two abstract slots — accepted, that case means the planner found nothing
tangible for either, and reassigning would only invent a still life with no
objects.

## Verification

- Unit: every medium and composition clause; the objects-needed downgrade; the
  palette filter; the distinct-composition reassignment; the parser rejects a
  missing `section_heading` and unknown enum values; the stage stores the
  assembled prompt.
- Local render loop against fal (root `.env` keys), before the PR: two slots
  per medium for the piperbox and clewas styles, eyeballed. This loop caught
  the two regressions unit tests could not see on #286/#287.
- A staging article after deploy is still the last word.
