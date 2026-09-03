# Org-level Image Direction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text `image_style` preset with a structured `image_direction` (medium enum, palette, notes) chosen by the scanner once per org and inherited by every article's image prompts.

**Architecture:** `@shared/schemas` owns the `IMAGE_MEDIA` enum and `ImageDirectionSchema`; a `z.preprocess` on `engagement` moves a legacy `image_style` string into `image_direction.notes` on read (no migration, no data loss). The scanner's structured output returns `image_direction`; the planner (`@shared/generation` `images.ts`) stops returning `medium` and per-slot `palette` and `imagePrompt(direction, slot)` takes both from the preset. The admin presets editor gets a medium select plus palette and notes fields.

**Tech Stack:** TypeScript 6, zod 4, Vitest 4, Hono/`@hono/zod-openapi`, React (admin app), Biome.

Spec: [`docs/superpowers/specs/2026-09-02-image-direction-design.md`](../specs/2026-09-02-image-direction-design.md). Issue: [#312](https://github.com/seopotion/seo/issues/312).

## Global Constraints

- Run everything from the worktree root `/Users/fco/Documents/projects/seopotion/seo/.claude/worktrees/issue-312-be689c`. If `node_modules` is missing or stale there, run `npm ci` first (worktree trap, see memory).
- `IMAGE_MEDIA = ['photograph','flat_illustration','three_d_render','watercolor','line_art','isometric']` — exact values, exact order.
- Legacy mapping is exactly `{ medium: 'photograph', palette: '', notes: <old image_style> }`.
- Per-slot `palette` is removed from the plan, not kept as an override.
- Biome style: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` after each task; commit what it reformats.
- `verbatimModuleSyntax`: `import type` for type-only imports.
- Never touch `docs/superpowers/plans/2026-08-05-internal-linking.md` (historical) and never edit the `design/product-flow.md` competitor notes.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and reference `Part of #312`.
- The one expected local `npm test` failure is `wordpress-plugin-behavior.test.ts` (needs `php`); it passes in CI.

---

## File map

| File | Change |
| --- | --- |
| `packages/shared/schemas/src/presets.ts` | `IMAGE_MEDIA`, `ImageDirectionSchema`, `engagement` preprocess, patch schema |
| `packages/shared/schemas/tests/presets.test.ts` | legacy mapping + new shape tests |
| `packages/shared/generation/src/images.ts` | planner drops `medium`/`palette`; `imagePrompt(direction, slot)`; prompt states direction |
| `packages/shared/generation/src/index.ts` | stop re-exporting `IMAGE_MEDIA`/`ImageMedium` |
| `packages/shared/generation/tests/images.test.ts` | updated planner + prompt tests |
| `packages/shared/articles/src/stages/images.ts` | pass `image_direction` |
| `packages/shared/articles/tests/images-stages.test.ts`, `tests/fixtures.ts` | plan JSON without medium/palette; direction from presets |
| `apps/worker/src/scanner.ts`, `apps/worker/tests/scanner.test.ts` | structured `image_direction` output + prompt guidance |
| ~30 test fixture files | `image_style: '…'` → `image_direction: {…}` |
| `apps/api/tests/{dashboard,setup,merge-presets,admin.orgs}.test.ts` | patch/assert `image_direction` |
| `apps/web/app/[locale]/(authenticated)/(product)/article-settings/article-settings.ts` | response type |
| `apps/admin/src/pages/org/PresetsEditor.tsx` | medium select, palette, notes |
| `design/article-image-direction.md`, `design/README.md`, `design/article-image-prompts.md`, `PROGRESS.md` | docs |

---

### Task 1: Schema — `ImageDirectionSchema`, legacy preprocess, patch schema, fixture sweep

**Files:**
- Modify: `packages/shared/schemas/src/presets.ts`
- Test: `packages/shared/schemas/tests/presets.test.ts`
- Modify (mechanical sweep): every test file listed in Step 6

**Interfaces:**
- Produces (from `@shared/schemas`):
  - `IMAGE_MEDIA: readonly ['photograph','flat_illustration','three_d_render','watercolor','line_art','isometric']`
  - `type ImageMedium = (typeof IMAGE_MEDIA)[number]`
  - `ImageDirectionSchema: z.object({ medium: z.enum(IMAGE_MEDIA), palette: z.string(), notes: z.string() })`
  - `type ImageDirection = z.infer<typeof ImageDirectionSchema>`
  - `SetupPresets['article_preferences']['engagement']` is `{ image_direction: ImageDirection; include_cta: boolean; youtube_videos: boolean }`
  - `EngagementPrefsPatchSchema` accepts `{ image_direction?: Partial<ImageDirection>; include_cta?: boolean; youtube_videos?: boolean }`

- [ ] **Step 1: Write the failing tests**

In `packages/shared/schemas/tests/presets.test.ts`, change the import and `base` fixture, and add a describe block:

```ts
import { describe, expect, test } from 'vitest';
import {
  EngagementPrefsPatchSchema,
  IMAGE_MEDIA,
  ImageDirectionSchema,
  SetupPresetsSchema,
} from '../src/presets';

const direction = { medium: 'photograph', palette: '', notes: '' } as const;

const base = {
  business: { name: 'n', language: 'English', country: 'United States', description: 'd' },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: { article_style: 's', internal_links_count: 1, llm_instructions: '' },
    engagement: { image_direction: direction },
  },
};
```

Replace every remaining `engagement: { image_style: 'i' }` / `{ image_style: 'i', include_cta: false }` in that file with `engagement: { image_direction: direction }` / `{ image_direction: direction, include_cta: false }`. Change the patch test:

```ts
  test('engagement patches do not inject defaults for omitted fields', () => {
    expect(EngagementPrefsPatchSchema.parse({ image_direction: { medium: 'line_art' } })).toEqual({
      image_direction: { medium: 'line_art' },
    });
    expect(EngagementPrefsPatchSchema.parse({ youtube_videos: false })).toEqual({
      youtube_videos: false,
    });
  });
```

Add at the end of the file:

```ts
describe('SetupPresetsSchema engagement.image_direction', () => {
  const withEngagement = (engagement: Record<string, unknown>) =>
    SetupPresetsSchema.parse({
      ...base,
      audience: { target: [], competitors: [] },
      article_preferences: { ...base.article_preferences, engagement },
    });

  test('passes a structured direction through', () => {
    const p = withEngagement({
      image_direction: { medium: 'flat_illustration', palette: 'teal and sand', notes: 'hardware' },
    });
    expect(p.article_preferences.engagement.image_direction).toEqual({
      medium: 'flat_illustration',
      palette: 'teal and sand',
      notes: 'hardware',
    });
  });

  // #312: pre-existing orgs stored a free-text image_style. It is moved into
  // notes on read, never dropped, and the medium starts as photograph.
  test('moves a legacy image_style into notes with a photograph medium', () => {
    const p = withEngagement({ image_style: 'hardware photos, CLI screenshots', include_cta: false });
    expect(p.article_preferences.engagement.image_direction).toEqual({
      medium: 'photograph',
      palette: '',
      notes: 'hardware photos, CLI screenshots',
    });
    expect(p.article_preferences.engagement.include_cta).toBe(false);
    expect(p.article_preferences.engagement.youtube_videos).toBe(true);
  });

  test('a document with both keys keeps image_direction', () => {
    const p = withEngagement({
      image_style: 'old',
      image_direction: { medium: 'watercolor', palette: '', notes: 'new' },
    });
    expect(p.article_preferences.engagement.image_direction.notes).toBe('new');
    expect(p.article_preferences.engagement.image_direction.medium).toBe('watercolor');
  });

  test('rejects a medium outside the enum', () => {
    expect(() =>
      withEngagement({ image_direction: { medium: 'oil', palette: '', notes: '' } }),
    ).toThrow();
    expect(() => ImageDirectionSchema.parse({ medium: 'oil', palette: '', notes: '' })).toThrow();
  });

  test('rejects an engagement with neither key', () => {
    expect(() => withEngagement({ include_cta: true })).toThrow();
  });

  test('the enum is the fixed six media', () => {
    expect(IMAGE_MEDIA).toEqual([
      'photograph',
      'flat_illustration',
      'three_d_render',
      'watercolor',
      'line_art',
      'isometric',
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/shared/schemas/tests/presets.test.ts`
Expected: FAIL — `IMAGE_MEDIA`/`ImageDirectionSchema` are not exported; the legacy and new-shape tests fail on `image_direction` being undefined.

- [ ] **Step 3: Implement the schema**

In `packages/shared/schemas/src/presets.ts`, replace the block from `const EngagementPrefsFields = {` through `export const EngagementPrefsPatchSchema = …` with:

```ts
/**
 * The kind of picture every article image is. Decided once per org by the
 * scanner and inherited by every article's image prompts (#312); the planner
 * used to guess it per article from a free-text phrase.
 */
export const IMAGE_MEDIA = [
  'photograph',
  'flat_illustration',
  'three_d_render',
  'watercolor',
  'line_art',
  'isometric',
] as const;
export type ImageMedium = (typeof IMAGE_MEDIA)[number];

export const ImageDirectionSchema = z.object({
  medium: z.enum(IMAGE_MEDIA),
  /** At most 6 words naming the colours, e.g. "deep navy and warm white"; '' = none. */
  palette: z.string(),
  /** Subject matter the images should favour, one short phrase; '' = none. */
  notes: z.string(),
});
export type ImageDirection = z.infer<typeof ImageDirectionSchema>;

const EngagementPrefsFields = {
  image_direction: ImageDirectionSchema,
  include_cta: z.boolean(),
  youtube_videos: z.boolean(),
};

/** Partial down to the direction's leaves so a PATCH can change just the medium. */
export const EngagementPrefsPatchSchema = z
  .object({ ...EngagementPrefsFields, image_direction: ImageDirectionSchema.partial() })
  .partial();

/**
 * Pre-#312 documents carry a free-text `image_style` instead of
 * `image_direction`. The phrase is moved into `notes` (never dropped) and the
 * medium starts as photograph until an operator picks one. Same
 * deploy-order-proof pattern as `audience.target` below.
 */
function migrateLegacyImageStyle(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const engagement = value as Record<string, unknown>;
  if (engagement.image_direction !== undefined || typeof engagement.image_style !== 'string') {
    return value;
  }
  const { image_style, ...rest } = engagement;
  return { ...rest, image_direction: { medium: 'photograph', palette: '', notes: image_style } };
}
```

Then change the `engagement:` entry inside `SetupPresetsSchema` to:

```ts
    engagement: z.preprocess(
      migrateLegacyImageStyle,
      z.object({
        ...EngagementPrefsFields,
        include_cta: EngagementPrefsFields.include_cta.default(true),
        // YouTube embed toggle (#85; renamed from include_youtube_video in #73).
        youtube_videos: EngagementPrefsFields.youtube_videos.default(true),
      }),
    ),
```

- [ ] **Step 4: Run the schema tests to verify they pass**

Run: `npx vitest run packages/shared/schemas/tests/presets.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Confirm the patch schemas still compile against the preprocess**

`apps/api/src/schemas/setup.ts` and `dashboard.ts` only drill `SetupPresetsSchema.shape.article_preferences.shape.content_seo` and use `EngagementPrefsPatchSchema` for engagement, so nothing reads `.shape.engagement`. Verify:

Run: `grep -rn "shape.engagement" apps packages --include='*.ts' | grep -v node_modules`
Expected: no output.

- [ ] **Step 6: Mechanical fixture sweep**

Every fixture that spells out `image_style: '<x>'` is now a TypeScript excess-property error (typed fixtures) or a legacy-path exercise (untyped ones). Replace them all in one pass:

```bash
grep -rl "image_style: '" --include='*.ts' --include='*.tsx' packages apps | grep -v node_modules | grep -v schemas/tests/presets.test.ts | xargs sed -i '' "s/image_style: '[^']*'/image_direction: { medium: 'photograph', palette: '', notes: '' }/g"
```

Then inspect the result:

Run: `grep -rn "image_style" --include='*.ts' --include='*.tsx' packages apps | grep -v node_modules`
Expected: only these remain, each handled in a later task:
- `packages/shared/schemas/src/presets.ts` (the migration function, correct)
- `packages/shared/schemas/tests/presets.test.ts` (legacy tests, correct)
- `apps/api/tests/dashboard.test.ts` lines asserting `.image_style` (Task 5)
- `apps/api/tests/setup.test.ts` line asserting `.image_style` (Task 5)
- `apps/api/tests/merge-presets.test.ts` line asserting `.image_style` (Task 5)
- `apps/worker/src/scanner.ts` (Task 4)
- `apps/admin/src/pages/org/PresetsEditor.tsx` (Task 6)
- `apps/web/app/[locale]/(authenticated)/(product)/article-settings/article-settings.ts` (Task 5)

If the sed touched `docs/`, revert that file: it only targets `packages` and `apps`, so it should not have.

- [ ] **Step 7: Lint-fix and run the schemas package tests**

Run: `npm run lint:fix && npx vitest run packages/shared/schemas`
Expected: PASS. (Other packages' typechecks are still red until Tasks 2–5; that is expected.)

- [ ] **Step 8: Commit**

```bash
git add -A packages apps
git commit -m "feat(schemas): structured engagement.image_direction replaces image_style

Legacy image_style is moved into image_direction.notes on read.

Part of #312

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Planner — direction comes from the preset

**Files:**
- Modify: `packages/shared/generation/src/images.ts`
- Modify: `packages/shared/generation/src/index.ts`
- Test: `packages/shared/generation/tests/images.test.ts`

**Interfaces:**
- Consumes: `IMAGE_MEDIA`, `ImageMedium`, `ImageDirection` from `@shared/schemas` (Task 1).
- Produces:
  - `interface ImagePlanInput { businessName; businessDescription; language; imageDirection: ImageDirection; articleTitle; metaDescription; headings }`
  - `ImageSlot = { subject: string; composition: ImageComposition; lighting: ImageLighting; objects: string[]; alt: string }` (no `palette`)
  - `ImagePlan = { cover: ImageSlot; inline: (ImageSlot & { section_heading: string })[] }` (no `medium`)
  - `imagePrompt(direction: ImageDirection, slot: Omit<ImageSlot, 'alt'>): string`
  - `@shared/generation` no longer exports `IMAGE_MEDIA` / `ImageMedium` (import them from `@shared/schemas`).

- [ ] **Step 1: Update the tests to the new contract**

In `packages/shared/generation/tests/images.test.ts`:

Imports become:

```ts
import { IMAGE_MEDIA, type ImageDirection } from '@shared/schemas';
import { describe, expect, test } from 'vitest';
import { INLINE_IMAGE_COUNT } from '../src/config';
import type { ImageSlot } from '../src/images';
import {
  buildImagePlanPrompt,
  extractH2s,
  findTextRisk,
  IMAGE_COMPOSITIONS,
  IMAGE_LIGHTING,
  imagePrompt,
  injectImageAfterHeading,
  NO_TEXT_DIRECTIVE,
  parseImagePlan,
  usableObjects,
  withNoTextDirective,
} from '../src/images';
```

Remove `medium: 'photograph',` and every `palette: …,` line from `validPlan`.

Add after `headings`:

```ts
const photo: ImageDirection = { medium: 'photograph', palette: '', notes: '' };
const direction = (patch: Partial<ImageDirection>): ImageDirection => ({ ...photo, ...patch });
```

Rewrite the `buildImagePlanPrompt` describe:

```ts
describe('buildImagePlanPrompt', () => {
  const input = {
    businessName: 'Acme',
    businessDescription: 'widgets',
    language: 'English',
    imageDirection: direction({ medium: 'flat_illustration', notes: 'hardware, workbenches' }),
    articleTitle: 'T',
    metaDescription: 'M',
    headings,
  };

  test('carries headings, language, and the inline count', () => {
    const messages = buildImagePlanPrompt(input);
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain(`exactly ${INLINE_IMAGE_COUNT}`);
    expect(messages[0]!.content).toContain('English');
    expect(messages[1]!.content).toContain('First Section | Second Section');
  });

  // #312: the medium is fixed by the org preset; the planner is told which
  // kind of picture it is planning for and what subjects the org favours.
  test('states the preset medium and notes instead of asking for them', () => {
    const [system, user] = buildImagePlanPrompt(input).map((m) => String(m.content));
    expect(user).toContain('Images are flat vector illustrations.');
    expect(user).toContain('Subject preferences: hardware, workbenches');
    expect(system).not.toContain('medium:');
    expect(system).not.toContain('palette');
  });

  test('omits the subject line when notes are empty', () => {
    const [, user] = buildImagePlanPrompt({ ...input, imageDirection: photo }).map((m) =>
      String(m.content),
    );
    expect(user).toContain('Images are photographs.');
    expect(user).not.toContain('Subject preferences');
  });

  // #289: the planner used to write the prompt, and no wording stopped it
  // asking for lettering. It names objects and enums (#309) and never sees a prompt.
  test('asks for enums and objects and says its answer is not the prompt', () => {
    const [system] = buildImagePlanPrompt(input).map((m) => String(m.content));
    for (const value of [...IMAGE_COMPOSITIONS, ...IMAGE_LIGHTING]) {
      expect(system).toContain(value);
    }
    expect(system).toContain('DIFFERENT composition');
    expect(system).toContain('carries writing');
    expect(system).toContain('You are NOT writing the image prompt');
    expect(system).toContain('not "Raspberry Pi"');
  });
});
```

In `parseImagePlan` tests, replace the `rejects an unknown medium or composition` test with:

```ts
  test('rejects an unknown composition', () => {
    const bad = { ...validPlan, cover: { ...validPlan.cover, composition: 'collage' } };
    expect(() => parseImagePlan(JSON.stringify(bad), headings)).toThrow();
  });
```

In the `imagePrompt` describe: the `slot` helper drops `palette: ''`. Every `imagePrompt('photograph', …)` becomes `imagePrompt(photo, …)`; the medium-clause `test.each` becomes `imagePrompt(direction({ medium }), slot({}))`; the disclaimer loop becomes `imagePrompt(direction({ medium }), slot({}))`. Replace the palette test with:

```ts
  test('carries lighting and the preset palette, drops a risky or empty one', () => {
    const lit = imagePrompt(
      direction({ palette: 'warm amber and slate' }),
      slot({ lighting: 'golden_hour' }),
    );
    expect(lit).toContain('Warm golden-hour light with long shadows.');
    expect(lit).toContain('Palette: warm amber and slate.');
    expect(imagePrompt(direction({ palette: 'neon signage colours' }), slot({}))).not.toContain(
      'Palette:',
    );
    expect(imagePrompt(direction({ palette: '  ' }), slot({}))).not.toContain('Palette:');
  });

  // #312: one palette per org, so every slot of every article shares it.
  test('every slot gets the same preset palette', () => {
    const teal = direction({ palette: 'teal and sand' });
    for (const composition of IMAGE_COMPOSITIONS) {
      expect(imagePrompt(teal, slot({ composition }))).toContain('Palette: teal and sand.');
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/shared/generation/tests/images.test.ts`
Expected: FAIL — type/shape mismatches (`imagePrompt` expects a medium string, plan schema demands `medium` and `palette`).

- [ ] **Step 3: Implement the planner change**

In `packages/shared/generation/src/images.ts`:

Imports:

```ts
import type { LlmMessage } from '@shared/providers';
import { type ImageDirection, type ImageMedium, toStrictJsonSchema } from '@shared/schemas';
import { z } from 'zod';
```

`ImagePlanInput`: replace `imageStyle: string;` with `imageDirection: ImageDirection;`.

Delete the `IMAGE_MEDIA` const and the `export type ImageMedium = …` line (they now live in schemas). Keep `IMAGE_COMPOSITIONS`, `IMAGE_LIGHTING` and their types.

Update the schema comment and shapes:

```ts
/**
 * The planner names WHAT each picture shows and, through enums, how it is
 * framed and lit; the kind of picture (medium) and its palette are fixed by the
 * org's image direction (#312) and the prompt itself is assembled in
 * `imagePrompt`.
 *
 * It used to return the prompt as free prose, and no amount of instruction
 * stopped it asking for lettering — banning "diagram" got "split-screen", and
 * banning that got "technical visualization", each one published as garbled
 * headings. A deny list cannot cover a synonym space, so prose no longer
 * reaches the image model at all (#289). The single fixed template that
 * replaced it made every image the same still life and ignored the org's
 * style; enums are how variety and style come back without prose (#309).
 */
const ImageSlotSchema = z.object({
  subject: z.string().min(1),
  composition: z.enum(IMAGE_COMPOSITIONS),
  lighting: z.enum(IMAGE_LIGHTING),
  objects: z.array(z.string()),
  alt: z.string().min(1),
});
export type ImageSlot = z.infer<typeof ImageSlotSchema>;

export const ImagePlanSchema = z.object({
  cover: ImageSlotSchema,
  inline: z.array(ImageSlotSchema.extend({ section_heading: z.string().min(1) })),
});
```

Add next to `MEDIUM_CLAUSE`:

```ts
/** How the planner is told what kind of picture it is planning for. */
const MEDIUM_NOUN: Record<ImageMedium, string> = {
  photograph: 'photographs',
  flat_illustration: 'flat vector illustrations',
  three_d_render: '3D rendered scenes',
  watercolor: 'watercolor paintings',
  line_art: 'minimal line-art illustrations',
  isometric: 'isometric illustrations',
};
```

Replace `imagePrompt`:

```ts
/**
 * The prompt sent to the image model, assembled from the org's image direction
 * and the planner's structured answer. This is the only way a prompt is built —
 * the model never writes the string, so it cannot ask for a diagram however it
 * phrases things. Enums map to fixed clauses; the only free text is the
 * subject, the filtered objects and the org's palette phrase, which is dropped
 * when it trips the text-risk check.
 *
 * A composition that needs objects downgrades to `abstract` when none survive
 * the filter — that is what an abstract topic gets instead of blank
 * stationery. The "not a document" clause is load-bearing: given prose and no
 * such clause, fal rendered the prompt itself as a page of garbled text
 * (measured, #286).
 */
export function imagePrompt(direction: ImageDirection, slot: Omit<ImageSlot, 'alt'>): string {
  const objects = usableObjects(slot.objects);
  const composition =
    objects.length === 0 && NEEDS_OBJECTS.has(slot.composition) ? 'abstract' : slot.composition;
  const palette = direction.palette.trim();
  return [
    scene(direction.medium, composition, slot.subject, objects),
    LIGHTING_CLAUSE[slot.lighting],
    palette !== '' && findTextRisk(palette) === null ? `Palette: ${palette}.` : '',
    direction.medium === 'photograph'
      ? 'A real physical scene, not a document, page, poster, slide or screen.'
      : 'A single illustrated scene, not a document, page, poster, slide, chart or screen.',
    'No text, lettering, signage or logos anywhere in the frame.',
  ]
    .filter(Boolean)
    .join(' ');
}
```

Replace `buildImagePlanPrompt`:

```ts
export function buildImagePlanPrompt(input: ImagePlanInput): LlmMessage[] {
  const system = [
    'You are an art director deciding what each image of one blog article shows.',
    `Return a cover entry and exactly ${INLINE_IMAGE_COUNT} inline entries; each`,
    'section_heading MUST be copied EXACTLY from the provided section list, each from a',
    'DIFFERENT section.',
    'The kind of picture and its colours are fixed by the business and stated below; choose',
    'subjects and objects that suit them.',
    'For every entry:',
    '- subject: the idea the picture stands for, a short phrase. Never a screen, diagram,',
    '  chart, document, sign or interface.',
    `- composition: ${IMAGE_COMPOSITIONS.join(' | ')}. still_life is objects on a surface,`,
    '  environment a wide scene, abstract is light, shape and texture with no objects, macro',
    '  an extreme close-up of one object, top_down objects seen from above.',
    '  Use a DIFFERENT composition for each of the three images. Abstract ideas (strategy,',
    '  automation, pricing) suit abstract or environment.',
    `- lighting: ${IMAGE_LIGHTING.join(' | ')}.`,
    '- objects: 0 to 4 tangible things a photographer could put on a table, each a plain noun',
    '  with at most one adjective. Real objects only — no concepts, activities, people or places.',
    '  Never name anything that carries writing in real life: no documents, screens, phones,',
    '  laptops, keyboards, signs, labels, badges, plaques, stickers, certificates, mugs, shirts,',
    '  books, packaging, bottles or boxes. Never name a brand or a branded product: say',
    '  "single-board computer", not "Raspberry Pi". Prefer bare surfaces: hardware, tools,',
    '  materials, components, natural objects.',
    `- alt: a meaningful description of the image for screen readers, written in ${input.language}.`,
    'You are NOT writing the image prompt. Nothing you return is passed to the image model',
    'verbatim, so do not describe a scene, a composition, a style or a diagram.',
  ].join('\n');

  const notes = input.imageDirection.notes.trim();
  const user = [
    `Business: ${input.businessName} — ${input.businessDescription}`,
    `Images are ${MEDIUM_NOUN[input.imageDirection.medium]}.`,
    notes ? `Subject preferences: ${notes}` : '',
    `Article title: ${input.articleTitle}`,
    `Article summary: ${input.metaDescription}`,
    `Sections: ${input.headings.join(' | ')}`,
  ]
    .filter(Boolean)
    .join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
```

`parseImagePlan` is unchanged.

In `packages/shared/generation/src/index.ts`, remove `ImageMedium,` from the `export type { … } from './images'` block and `IMAGE_MEDIA,` from the value export block.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/shared/generation/tests/images.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint-fix, run the whole generation package, commit**

Run: `npm run lint:fix && npx vitest run packages/shared/generation`
Expected: PASS.

```bash
git add packages/shared/generation
git commit -m "feat(generation): image prompts take medium and palette from the org direction

The planner no longer classifies a medium or picks a palette per slot.

Part of #312

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Articles stage passes the preset direction

**Files:**
- Modify: `packages/shared/articles/src/stages/images.ts:91-142`
- Modify: `packages/shared/articles/tests/fixtures.ts:6-19`
- Test: `packages/shared/articles/tests/images-stages.test.ts`

**Interfaces:**
- Consumes: `imagePrompt(direction, slot)`, `ImagePlanInput.imageDirection` (Task 2); `presets.article_preferences.engagement.image_direction` (Task 1).

- [ ] **Step 1: Update the stage tests**

In `packages/shared/articles/tests/images-stages.test.ts`:

Remove `medium: '…',` and every `palette: '…',` line from `planJson` and from the two inline plan literals in the `objects that carry writing…` and `invalid plan…` tests.

Directly under the existing `const run = makeRun({ working: { article_id: 'a1' } });` line, add:

```ts
// The direction the prompts are built from is the org preset, not the plan (#312).
const directedRun = makeRun({
  working: { article_id: 'a1' },
  presets: {
    ...presets,
    article_preferences: {
      ...presets.article_preferences,
      engagement: {
        ...presets.article_preferences.engagement,
        image_direction: { medium: 'flat_illustration', palette: 'teal and sand', notes: '' },
      },
    },
  },
});
```

Rewrite the prompt-assembly test:

```ts
  // #289: the planner names objects and the prompt is assembled here, so a
  // request for a diagram cannot reach the image model however it is phrased.
  // #309: the planned composition shapes that prompt; #312: the org's medium
  // and palette do, from the preset rather than the plan.
  test('builds each prompt from the preset direction, composition and objects, never from planner prose', async () => {
    findArticleById.mockResolvedValue({ ...article, images: [] });
    llmComplete.mockResolvedValue({ text: planJson, model: 'm', usage: usageStub });

    await stageImagesPlan(directedRun, { complete: llmComplete });

    expect(llmComplete).toHaveBeenCalledTimes(1);
    const messages = llmComplete.mock.calls[0]![0].messages as { content: string }[];
    expect(messages[1]!.content).toContain('Images are flat vector illustrations.');
    const slots = setImagePlan.mock.calls[0]![1] as ArticleImage[];
    expect(slots[0]!.prompt).toContain(
      'A flat vector illustration of brass gear, arranged on a plain surface.',
    );
    expect(slots[0]!.prompt).toContain('Palette: teal and sand.');
    expect(slots[0]!.prompt).toContain('not a document, page, poster, slide, chart or screen');
    expect(slots[0]!.alt).toBe('cover alt');
    expect(slots[1]!.prompt).toContain('an extreme close-up of coiled cable');
    expect(slots[1]!.prompt).toContain('Palette: teal and sand.');
    expect(slots[2]!.prompt).toContain('textured surfaces and light evoking s2');
    expect(slots[2]!.prompt).toContain('Palette: teal and sand.');
  });
```

The other plan tests keep using `run` (photograph, empty palette) and need no assertion changes beyond the removed keys.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/shared/articles/tests/images-stages.test.ts`
Expected: FAIL — the stage still reads `engagement.image_style` (undefined) and calls `imagePrompt(plan.medium, …)`, so a type error or `Cannot read properties of undefined`.

- [ ] **Step 3: Implement**

In `packages/shared/articles/src/stages/images.ts`, inside `stageImagesPlan`:

```ts
  const presets = run.input.presets;
  const direction = presets.article_preferences.engagement.image_direction;
  const headings = extractH2s(article.content);
  const res = await llm.complete({
    messages: buildImagePlanPrompt({
      businessName: presets.business.name,
      businessDescription: presets.business.description,
      language: presets.business.language,
      imageDirection: direction,
      articleTitle: article.title,
      metaDescription: article.meta_description,
      headings,
    }),
    responseSchema: IMAGE_PLAN_RESPONSE_SCHEMA,
  });
```

and the two prompt calls become `imagePrompt(direction, plan.cover)` and `imagePrompt(direction, img)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/shared/articles`
Expected: PASS.

- [ ] **Step 5: Lint-fix and commit**

```bash
npm run lint:fix
git add packages/shared/articles
git commit -m "feat(articles): image plan stage reads the org image direction

Part of #312

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Scanner decides the direction

**Files:**
- Modify: `apps/worker/src/scanner.ts:20-60`
- Test: `apps/worker/tests/scanner.test.ts`

**Interfaces:**
- Consumes: `ImageDirectionSchema` from `@shared/schemas` (Task 1).

- [ ] **Step 1: Update the scanner tests**

In `apps/worker/tests/scanner.test.ts`, change `LLM_JSON`'s engagement to:

```ts
    engagement: {
      image_direction: { medium: 'flat_illustration', palette: 'teal and white', notes: '' },
    },
```

Add to the first test (`assembles presets…`):

```ts
    expect(presets.article_preferences.engagement.image_direction).toEqual({
      medium: 'flat_illustration',
      palette: 'teal and white',
      notes: '',
    });
```

Add two tests to the describe:

```ts
  // #312: the medium is a structured-output enum, so the model cannot invent one.
  test('constrains image_direction.medium to the enum in the response schema', async () => {
    fetchSite.mockResolvedValue({ text: 'x', links: [] });
    const llm = llmReturning(LLM_JSON);

    await scanWebsite('https://clewas.com', { llm });

    const { responseSchema } = llm.complete.mock.calls[0]![0];
    const schema = JSON.stringify(responseSchema?.schema);
    expect(schema).toContain('"image_direction"');
    expect(schema).toContain('"flat_illustration"');
    expect(schema).not.toContain('image_style');
    const system = String(llm.complete.mock.calls[0]![0].messages[0]!.content);
    expect(system).toContain('medium');
    expect(system).toContain('palette');
    expect(system).toContain('notes');
  });

  test('rejects a medium outside the enum', async () => {
    fetchSite.mockResolvedValue({ text: 'x', links: [] });
    const bad = JSON.parse(LLM_JSON);
    bad.article_preferences.engagement.image_direction.medium = 'screenshot';

    await expect(
      scanWebsite('https://clewas.com', { llm: llmReturning(JSON.stringify(bad)) }),
    ).rejects.toThrow();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run apps/worker/tests/scanner.test.ts`
Expected: FAIL — `ScanOutputSchema` still requires `image_style`, so the first test throws on parse.

- [ ] **Step 3: Implement**

In `apps/worker/src/scanner.ts`:

Import: add `ImageDirectionSchema` to the `@shared/schemas` import list.

`ScanOutputSchema.article_preferences.engagement` becomes:

```ts
    engagement: z.object({ image_direction: ImageDirectionSchema }),
```

The system prompt in `buildScanPrompt` becomes:

```ts
  const system = [
    'You are an SEO onboarding assistant.',
    'From the scraped website content, produce onboarding presets as JSON.',
    'language is the primary content language (e.g. "English"); country is the primary target',
    'market as a plain country name (e.g. "United States") — never a region or "Global".',
    'description is 2-4 sentences summarizing the business.',
    'target is an array of 3-7 short, distinct audience segments (one segment per entry —',
    'never a single comma-separated sentence). article_style is a short phrase.',
    'image_direction is the art direction every blog image of this site will follow:',
    '- medium: the kind of picture that matches the site\'s visual character — photograph for',
    '  product, hardware or photo-led sites; flat_illustration or isometric for software and',
    '  services with flat brand graphics; three_d_render, watercolor or line_art only when the',
    '  site itself looks that way. Screenshots, diagrams and interfaces are never a medium; when',
    '  the site suggests those, choose photograph.',
    '- palette: the site\'s brand colours as at most 6 words (e.g. "deep navy and warm white"),',
    '  or "" when none are evident.',
    '- notes: one short phrase of subject matter the images should favour (e.g. "workshop',
    '  hardware and tools"), or "".',
  ].join('\n');
```

Nothing else in `scanWebsite` changes — `fields.article_preferences` already carries `engagement.image_direction`, and `SetupPresetsSchema.parse` accepts it (the preprocess passes a present `image_direction` through).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run apps/worker`
Expected: PASS.

- [ ] **Step 5: Lint-fix and commit**

```bash
npm run lint:fix
git add apps/worker
git commit -m "feat(worker): scanner picks an image medium, palette and notes per org

Part of #312

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: API tests, web type, full typecheck

**Files:**
- Modify: `apps/api/tests/dashboard.test.ts` (~lines 2148-2170, 2251-2286)
- Modify: `apps/api/tests/setup.test.ts` (~line 332)
- Modify: `apps/api/tests/merge-presets.test.ts` (~line 50)
- Modify: `apps/web/app/[locale]/(authenticated)/(product)/article-settings/article-settings.ts:20-24`

**Interfaces:**
- Consumes: `EngagementPrefsPatchSchema` accepting a partial `image_direction` (Task 1).

- [ ] **Step 1: Update the API assertions**

`apps/api/tests/dashboard.test.ts`, test `PATCH /settings/articles deep-merges and persists across reads`:

```ts
    const patched = await client.api.v0.dashboard.settings.articles.$patch(
      { json: { org_id: 'org_1', engagement: { image_direction: { medium: 'watercolor' } } } },
      opts,
    );
    expect(patched.status).toBe(200);
    if (patched.status === 200) {
      const direction = (await patched.json()).article_preferences.engagement.image_direction;
      expect(direction.medium).toBe('watercolor');
      // A partial direction patch keeps the other leaves (deep merge).
      expect(direction.palette).toBe('');
      expect(direction.notes).toBe('');
    }
```

and in the GET half: `expect(body.article_preferences.engagement.image_direction.medium).toBe('watercolor');`.

Test `persists a disabled CTA preference`: `expect(preferences.engagement.image_direction.medium).toBeTruthy();` (the seeded org may already carry the previous test's medium — the in-memory repo persists across tests in this file, which is what the old `toBeTruthy()` on `image_style` allowed for).

Test `preserves disabled engagement siblings on a partial update`: the second patch becomes `engagement: { image_direction: { palette: 'slate and amber' } }` and the assertions:

```ts
      expect(engagement.image_direction.palette).toBe('slate and amber');
      expect(engagement.image_direction.medium).toBeTruthy(); // sibling leaf survives
      expect(engagement.include_cta).toBe(false);
      expect(engagement.youtube_videos).toBe(false);
```

`apps/api/tests/setup.test.ts` line ~332: `expect(engagement.image_direction.medium).toBe('photograph');`.

`apps/api/tests/merge-presets.test.ts`: the fixture's `engagement` (already swept) becomes `{ image_direction: { medium: 'line_art', palette: 'ink', notes: '' }, include_cta: true, youtube_videos: true }`; line ~50 becomes `expect(result.article_preferences.engagement.image_direction.medium).toBe('line_art');`. Add one test:

```ts
  test('merges a partial image_direction, keeping its other leaves', () => {
    const result = mergePresets(base, {
      article_preferences: { engagement: { image_direction: { medium: 'watercolor' } } },
    });
    expect(result.article_preferences.engagement.image_direction).toEqual({
      medium: 'watercolor',
      palette: 'ink',
      notes: '',
    });
  });
```

- [ ] **Step 2: Update the web response type**

In `apps/web/app/[locale]/(authenticated)/(product)/article-settings/article-settings.ts`, replace `image_style: string;` with:

```ts
      image_direction: { medium: string; palette: string; notes: string };
```

- [ ] **Step 3: Run the API and web tests**

Run: `npx vitest run apps/api/tests/dashboard.test.ts apps/api/tests/setup.test.ts apps/api/tests/merge-presets.test.ts apps/api/tests/admin.orgs.test.ts apps/web`
Expected: PASS.

- [ ] **Step 4: Full lint + typecheck + tests**

Run: `npm run lint:fix && npm run lint && npm run check:all && npm test`
Expected: lint and both typechecks clean; tests pass except `wordpress-plugin-behavior.test.ts` (php missing locally). If `check:all` reports an `image_style` excess-property error anywhere, the sweep in Task 1 missed a file: apply the same replacement there.

- [ ] **Step 5: Commit**

```bash
git add -A apps packages
git commit -m "test(api,web): patch and assert engagement.image_direction

Part of #312

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Admin presets editor

**Files:**
- Modify: `apps/admin/src/pages/org/PresetsEditor.tsx` (imports, ~lines 200-205, field components)

**Interfaces:**
- Consumes: `IMAGE_MEDIA`, `ImageMedium` from `@shared/schemas`; `Presets['article_preferences']['engagement']['image_direction']`.

- [ ] **Step 1: Implement the fields**

Imports at the top of `PresetsEditor.tsx`:

```ts
import { IMAGE_MEDIA, type ImageMedium } from '@shared/schemas';
```

Below `setEngagement` add:

```ts
  const direction = engagement.image_direction;
  const setDirection = (values: Partial<typeof direction>) =>
    setEngagement({ image_direction: { ...direction, ...values } });
```

Replace the `<TextField label="Image style" …/>` block with:

```tsx
          <label className="block">
            <span className={LABEL}>Image medium</span>
            <select
              className={`${INPUT} mt-1`}
              value={direction.medium}
              onChange={(event) => setDirection({ medium: event.target.value as ImageMedium })}
            >
              {IMAGE_MEDIA.map((medium) => (
                <option key={medium} value={medium}>
                  {MEDIUM_LABEL[medium]}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-neutral-500">
              The kind of picture every article image is.
            </span>
          </label>
          <TextField
            label="Image palette"
            hint="Up to 6 words naming the colours; empty for none."
            value={direction.palette}
            onChange={(palette) => setDirection({ palette })}
          />
          <TextField
            label="Image subject notes"
            hint="What the pictures should favour showing."
            value={direction.notes}
            onChange={(notes) => setDirection({ notes })}
          />
```

Add a module-level constant next to `MAX_AUDIENCE`:

```ts
/** Option labels for the `IMAGE_MEDIA` enum — the stored value is the enum key. */
const MEDIUM_LABEL: Record<ImageMedium, string> = {
  photograph: 'Photograph',
  flat_illustration: 'Flat illustration',
  three_d_render: '3D render',
  watercolor: 'Watercolor',
  line_art: 'Line art',
  isometric: 'Isometric',
};
```

Give `TextField` an optional hint, matching `TextAreaField`:

```tsx
function TextField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <input
        className={`${INPUT} mt-1`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}
```

`diffPresets` already recurses into nested objects, so editing only the medium sends `{ article_preferences: { engagement: { image_direction: { medium } } } }`, which Task 1's patch schema accepts.

- [ ] **Step 2: Add a diff test for the nested direction**

In `apps/admin/tests/presets.test.ts`, add inside `describe('diffPresets')`:

```ts
  test('a changed image medium sends only that leaf of the direction', () => {
    const patch = diffPresets(
      PRESETS,
      edit((draft) => {
        draft.article_preferences.engagement.image_direction.medium = 'line_art';
      }),
    );

    expect(patch).toEqual({
      article_preferences: { engagement: { image_direction: { medium: 'line_art' } } },
    });
  });
```

Run: `npx vitest run apps/admin`
Expected: PASS.

- [ ] **Step 3: Typecheck the admin app**

Run: `npm run check:all` (its `check:admin` half typechecks the admin app).
Expected: clean.

- [ ] **Step 4: Lint-fix and commit**

```bash
npm run lint:fix
git add apps/admin
git commit -m "feat(admin): presets editor edits image medium, palette and notes

Part of #312

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Docs

**Files:**
- Create: `design/article-image-direction.md`
- Modify: `design/README.md` (append one bullet)
- Modify: `design/article-image-prompts.md` (Decision table row "Where style is decided")
- Modify: `PROGRESS.md:55`

- [ ] **Step 1: Write the design note**

`design/article-image-direction.md`:

```markdown
# Org-level image direction

Design for [#312](https://github.com/seopotion/seo/issues/312). Written 2026-09-02.
Follows [`article-image-prompts.md`](article-image-prompts.md) (#309/#310), which
left the medium as a per-article classification of a free-text preset.

## Decision

Art direction is a structured org preset, decided once by the scanner and
inherited by every article. The planner only decides what each picture shows.

```ts
engagement.image_direction: {
  medium: 'photograph' | 'flat_illustration' | 'three_d_render' | 'watercolor' | 'line_art' | 'isometric';
  palette: string;  // ≤ 6 words, '' = none
  notes: string;    // subject preferences, '' = none
}
```

| Concern | Choice |
| --- | --- |
| Who picks the medium | The scanner, as a structured-output enum, from the site's visual character. Screenshots/diagrams are never a medium. |
| Palette | One per org, from the site's brand colours; applied to every slot. Per-slot palette is gone — it is what broke colour identity. Still filtered by `findTextRisk` at assembly. |
| Planner | Told the medium and notes; returns `subject`, `composition`, `lighting`, `objects`, `alt` per slot. No `medium`, no `palette`. |
| Legacy `image_style` | Moved into `notes` on read by a `z.preprocess` (medium `photograph`, palette `''`). No migration, nothing dropped. |
| Editing | Admin presets editor: medium select, palette, notes. Customer settings/onboarding UI is a separate frontend issue. |

## Verification

Unit tests per package; a local fal render loop before the PR; a staging article
after deploy showing three images with one medium and one palette.
```

- [ ] **Step 2: Link and cross-reference**

Append to `design/README.md`:

```markdown
- [article-image-direction.md](article-image-direction.md) — org-level image direction (#312): the scanner picks a medium enum, palette and subject notes once; the planner inherits them, and legacy `image_style` is moved into notes on read.
```

In `design/article-image-prompts.md`, replace the "Where style is decided" table row with:

```markdown
| Where style is decided | Superseded by [`article-image-direction.md`](article-image-direction.md) (#312): the scanner fixes `engagement.image_direction` (medium enum, palette, notes) once per org and the planner inherits it. |
```

and the "What varies per slot" row with:

```markdown
| What varies per slot | `composition` (enum), `lighting` (enum), `subject`, `objects[]` — palette is per org since #312 |
```

In `PROGRESS.md` line 55, change `the org's \`image_style\` picks the medium` to `the org's \`image_direction\` (medium enum, palette, notes, chosen by the scanner — [#312](https://github.com/seopotion/seo/issues/312)) fixes the medium and palette`.

- [ ] **Step 3: Commit**

```bash
git add design PROGRESS.md
git commit -m "docs: org-level image direction design note

Part of #312

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Local fal render check, final verification, PR

**Files:**
- Create (scratch, not committed): `/private/tmp/claude-501/-Users-fco-Documents-projects-seopotion-seo--claude-worktrees-issue-312-be689c/b97e4f67-5d46-4061-b7c8-c48c356e6091/scratchpad/render.ts`

- [ ] **Step 1: Render two slots against fal with a real direction**

The main checkout's root `.env` (`../../../.env` relative to the worktree; the worktree has none) holds `FAL_KEY` and `OPENROUTER_API_KEY`. Script:

```ts
import { readFileSync } from 'node:fs';
import { IMAGE_PLAN_RESPONSE_SCHEMA, buildImagePlanPrompt, imagePrompt, parseImagePlan, withNoTextDirective } from '@shared/generation';
import { createFalClient, createOpenRouterClient } from '@shared/providers';
import type { ImageDirection } from '@shared/schemas';

const direction: ImageDirection = {
  medium: 'photograph',
  palette: 'metallic gray and deep blue',
  notes: 'workshop hardware, single-board computers, cables',
};
const headings = ['Why self-host', 'Picking the hardware'];
const llm = createOpenRouterClient({ apiKey: process.env.OPENROUTER_API_KEY! });
const fal = createFalClient({ apiKey: process.env.FAL_KEY! });

const res = await llm.complete({
  messages: buildImagePlanPrompt({
    businessName: 'Piperbox',
    businessDescription: 'Self-hosted home server kits for developers.',
    language: 'English',
    imageDirection: direction,
    articleTitle: 'Beyond Vercel: running your own deploys',
    metaDescription: 'What it takes to move off managed hosting.',
    headings,
  }),
  responseSchema: IMAGE_PLAN_RESPONSE_SCHEMA,
});
const plan = parseImagePlan(res.text, headings);
for (const slot of [plan.cover, ...plan.inline]) {
  const prompt = withNoTextDirective(imagePrompt(direction, slot));
  console.log('\n---\n' + prompt);
  const out = await fal.generate({ prompt, size: 'landscape_16_9', outputFormat: 'webp' });
  console.log(out.images[0]?.url);
}
```

Run from the worktree root:

```bash
node --env-file=../../../.env --import tsx /private/tmp/claude-501/-Users-fco-Documents-projects-seopotion-seo--claude-worktrees-issue-312-be689c/b97e4f67-5d46-4061-b7c8-c48c356e6091/scratchpad/render.ts
```

`LlmConfig` and `ImageConfig` both need only `apiKey`. Open the three URLs; every image must be a photograph, share the gray-and-blue palette, and carry no lettering. Repeat once with `medium: 'flat_illustration'` and `palette: 'teal and sand'`. If a render shows lettering or ignores the palette, that is a prompt-wording problem in `imagePrompt`/`MEDIUM_CLAUSE`, not a schema problem; fix it there and re-run the generation unit tests.

- [ ] **Step 2: Final verification**

Run: `npm run lint && npm run check:all && npm test`
Expected: clean, with only the known php-dependent failure.

Check the lockfile did not lose Linux optional deps (memory: macOS prunes `@emnapi`):

Run: `git diff --stat origin/dev -- package-lock.json`
Expected: no diff. If there is one, `git checkout origin/dev -- package-lock.json`.

- [ ] **Step 3: Push and open the PR against `dev`**

```bash
git push -u origin claude/issue-312-be689c
gh pr create --base dev --title "[generation] Org-level image direction decided at scan time" --body "$(cat <<'EOF'
Closes #312

## What

- `engagement.image_style` (free text) is replaced by a structured `engagement.image_direction { medium, palette, notes }` in `@shared/schemas`. The `IMAGE_MEDIA` enum moves there from `@shared/generation`.
- Legacy documents are handled on read: a `z.preprocess` moves `image_style` into `notes` with `medium: 'photograph'`, `palette: ''`. No migration, nothing dropped. Existing orgs (4 staging, 1 prod) keep their text as notes until an operator picks a medium.
- The scanner returns `image_direction` as structured output, so the medium is always in the enum, with prompt guidance for medium, palette (brand colours) and notes.
- The planner no longer returns `medium` or per-slot `palette`; `imagePrompt(direction, slot)` takes both from the preset, so every image of an org shares one medium and one palette. The planner prompt states the medium and subject notes.
- Admin presets editor: medium select, palette and subject-notes fields. Customer-facing settings/onboarding UI is a separate frontend issue.
- Design note: `design/article-image-direction.md`.

## Verification

- Unit tests across schemas, generation, articles, worker, api, admin.
- Local fal render loop: [fill in: N renders, media tried, result].
- Staging article after merge is the last word: three images with one medium and one palette.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Fill in the render-loop line with what Step 1 actually showed before running the command.
