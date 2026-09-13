import type { LlmMessage } from '@shared/providers';
import { type ImageDirection, type ImageMedium, toStrictJsonSchema } from '@shared/schemas';
import { z } from 'zod';
import { INLINE_IMAGE_COUNT } from './config';
import { parseJsonObject } from './json';
import { maskCode } from './links';

/** Inputs for the image-plan prompt — a subset of org presets + the article. */
export interface ImagePlanInput {
  businessName: string;
  businessDescription: string;
  language: string;
  imageDirection: ImageDirection;
  articleTitle: string;
  metaDescription: string;
  headings: string[];
}

/** Also the order a duplicate composition is reassigned in (`parseImagePlan`). */
export const IMAGE_COMPOSITIONS = [
  'still_life',
  'environment',
  'abstract',
  'macro',
  'top_down',
  'silhouette',
] as const;
export const IMAGE_LIGHTING = [
  'natural_daylight',
  'golden_hour',
  'soft_studio',
  'dramatic_low_key',
  'cool_ambient',
] as const;
export type ImageComposition = (typeof IMAGE_COMPOSITIONS)[number];
export type ImageLighting = (typeof IMAGE_LIGHTING)[number];

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
export type ImagePlan = z.infer<typeof ImagePlanSchema>;

export const IMAGE_PLAN_RESPONSE_SCHEMA = toStrictJsonSchema(ImagePlanSchema, 'image_plan');

/**
 * H2 heading texts, in order, from markdown content. Detection runs against a
 * `maskCode` twin — same length, index-aligned — so a `## ` line inside a
 * fenced code sample is not mistaken for a section (an image slot or video
 * embed anchored to it would land inside the code block); the heading text
 * still comes from the original line.
 *
 * Up to 3 leading spaces still opens a heading per CommonMark — the same bound
 * `FENCE_RE` uses. A 4th space (or a tab) makes it indented code instead, which
 * is why that case needs no masking to be excluded.
 */
export function extractH2s(content: string): string[] {
  const lines = content.split('\n');
  return maskCode(content)
    .split('\n')
    .flatMap((masked, i) =>
      /^ {0,3}##\s+/.test(masked) ? [(lines[i] as string).replace(/^ {0,3}##\s+/, '').trim()] : [],
    );
}

/**
 * Appended to every prompt before it reaches the image model. The planner is
 * already told to avoid lettering, but flux-2 renders garbled text whenever the
 * scene merely *implies* it (a screen, a sign, a label), so the ban is repeated
 * at the point of generation — where it also covers plans made before this rule.
 */
export const NO_TEXT_DIRECTIVE = [
  'Absolutely no text anywhere in the image: no words, letters, numbers, captions,',
  'labels, signage, watermarks, logos or brand marks. Surfaces that would normally',
  'carry writing — screens, monitors, signs, packaging, documents, book covers,',
  'clothing, circuit boards and other electronic components — are blank, unmarked',
  'or turned away from the camera; no silkscreen printing, chip markings or part',
  'numbers.',
].join(' ');

/** Prompt as sent to the image model: the planned scene plus the no-text ban. */
export function withNoTextDirective(prompt: string): string {
  return `${prompt.trim()}\n\n${NO_TEXT_DIRECTIVE}`;
}

/**
 * Subjects that carry lettering whatever the prompt says not to. A staging run
 * with the ban AND the style-precedence line in the planner prompt still asked
 * for "a split-screen technical visualization" and published a diagram of
 * garbled headings, so the ban is enforced here instead of merely stated (#280).
 */
const TEXT_RISK =
  /\b(?:diagrams?|flow ?charts?|infographics?|split[- ](?:screens?|scenes?)|screenshots?|charts?|graphs?|dashboards?|interfaces?|UIs?|terminals?|monitors?|screens?|displaying|displays?|code|whiteboards?|documents?|book covers?|posters?|banners?|signage|signs?|labell?ed|labels?|captions?|annotat(?:ed|ions?)|logos?|watermarks?|typography|fonts?|texts?|words?|lettering|letters?|headings?|titles?)\b/i;

/**
 * A prompt may say what it is avoiding — "no text or signage", "free of
 * lettering" — and that phrasing must not read as a request for it. The
 * negation carries across a whole list, which is how these are usually
 * written: "no words, letters, captions or logos".
 */
const BANNED_NOUN =
  '(?:diagrams?|charts?|screenshots?|signage|signs?|labels?|captions?|logos?|brand marks?|watermarks?|texts?|words?|lettering|letters?|numbers?|headings?|titles?|typography|fonts?|writing|documents?|pages?|posters?|banners?|slides?|screens?|monitors?|interfaces?|dashboards?|whiteboards?)';
const QUALIFIER = '(?:(?:a|an|the|any|all|visible|readable|other)\\s+)*';
const NEGATED = new RegExp(
  `\\b(?:no|not|non|without|free of|devoid of|avoid(?:ing)?|omit(?:ting)?|exclude|excluding|never)\\s+${QUALIFIER}${BANNED_NOUN}(?:\\s*(?:,|,?\\s*(?:or|and|nor))\\s*${QUALIFIER}${BANNED_NOUN})*`,
  'gi',
);

/**
 * The banned subject a prompt asks for, or null when it is safe. Negated
 * mentions are dropped first, so "a quiet workshop, no text or signage"
 * passes while "a labelled diagram" does not.
 */
export function findTextRisk(prompt: string): string | null {
  const match = TEXT_RISK.exec(prompt.replace(NEGATED, ' '));
  return match ? (match[0] as string).toLowerCase() : null;
}

/**
 * Objects that carry writing in the real world, so fal letters them however
 * the prompt is phrased — a returned "deployment badge" came back stamped
 * "NRLUMA B OLOPYMENT". Separate from TEXT_RISK, which is about the kind of
 * image being asked for rather than the props inside it.
 */
const OBJECT_TEXT_RISK =
  /\b(?:badges?|plaques?|stickers?|decals?|certificates?|awards?|trophies|mugs?|t-?shirts?|jerseys?|caps?|books?|magazines?|newspapers?|manuals?|brochures?|leaflets?|notebooks?|notepads?|calendars?|clocks?|watches|phones?|tablets?|laptops?|keyboards?|bottles?|cans?|jars?|boxes|cartons?|packaging|envelopes?|tickets?|receipts?|cards?|number plates?|license plates?)\b/i;

/** The objects worth photographing: risky ones are dropped, not repaired. */
export function usableObjects(objects: string[]): string[] {
  return objects
    .map((object) => object.trim().replace(/\s+/g, ' '))
    .filter(
      (object) => object !== '' && findTextRisk(object) === null && !OBJECT_TEXT_RISK.test(object),
    )
    .slice(0, 4);
}

const MEDIUM_CLAUSE: Record<ImageMedium, string> = {
  photograph: 'A photograph',
  flat_illustration: 'A flat vector illustration',
  three_d_render: 'A 3D rendered scene',
  watercolor: 'A watercolor painting',
  line_art: 'A minimal line-art illustration',
  isometric: 'An isometric illustration',
  diagram: 'A clean, flat schematic diagram',
};

/** How the planner is told what kind of picture it is planning for. */
const MEDIUM_NOUN: Record<ImageMedium, string> = {
  photograph: 'photographs',
  flat_illustration: 'flat vector illustrations',
  three_d_render: '3D rendered scenes',
  watercolor: 'watercolor paintings',
  line_art: 'minimal line-art illustrations',
  isometric: 'isometric illustrations',
  diagram: 'labelled schematic diagrams',
};

const LIGHTING_CLAUSE: Record<ImageLighting, string> = {
  natural_daylight: 'Soft natural daylight.',
  golden_hour: 'Warm golden-hour light with long shadows.',
  soft_studio: 'Even, soft studio lighting.',
  dramatic_low_key: 'Dramatic low-key lighting with deep shadows.',
  cool_ambient: 'Cool, ambient blue-toned light.',
};

/** Compositions that are nothing without something to photograph. */
const NEEDS_OBJECTS: ReadonlySet<ImageComposition> = new Set([
  'still_life',
  'macro',
  'silhouette',
  'top_down',
]);

/** First sentence: medium + composition, filled with the subject and objects. */
function scene(
  medium: ImageMedium,
  composition: ImageComposition,
  subject: string,
  objects: string[],
): string {
  const lead = MEDIUM_CLAUSE[medium];
  const list = objects.join(', ');
  switch (composition) {
    case 'still_life':
      return `${lead} of ${list}, arranged on a plain surface.`;
    case 'macro':
      return `${lead}: an extreme close-up of ${objects[0]}, showing its texture and detail.`;
    case 'environment':
      return `${lead}: a wide scene evoking ${subject}${
        objects.length > 0 ? `, with ${list} in their natural setting` : ''
      }.`;
    case 'abstract':
      // "Light and texture" alone rendered as an out-of-focus blur; asking for
      // sharp, textured surfaces keeps it abstract without turning to mush.
      return `${lead}: an abstract composition of geometric shapes, textured surfaces and light evoking ${subject}, sharp and detailed, with no recognisable objects.`;
    case 'silhouette':
      return `${lead} of ${list} in silhouette against a bright, plain background.`;
    case 'top_down':
      return `${lead} of ${list} seen from directly above, laid out on a plain surface.`;
  }
}

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

/**
 * Parse + validate a plan; throws on wrong count, unknown or duplicate
 * headings. Compositions are made pairwise distinct here rather than trusted:
 * a duplicate takes the first unused value in `IMAGE_COMPOSITIONS` order. This
 * runs before the objects filter in `imagePrompt`, so two slots can still both
 * end up abstract when neither had a usable object — accepted, since a still
 * life with nothing to photograph is the worse outcome.
 */
export function parseImagePlan(text: string, headings: string[]): ImagePlan {
  const parsed = ImagePlanSchema.parse(parseJsonObject(text));
  if (parsed.inline.length !== INLINE_IMAGE_COUNT)
    throw new Error(`image plan needs exactly ${INLINE_IMAGE_COUNT} inline images`);
  const seen = new Set<string>();
  for (const img of parsed.inline) {
    if (!headings.includes(img.section_heading))
      throw new Error(`image plan references unknown heading: ${img.section_heading}`);
    if (seen.has(img.section_heading))
      throw new Error(`image plan reuses heading: ${img.section_heading}`);
    seen.add(img.section_heading);
  }

  const used = new Set<ImageComposition>();
  const distinct = <T extends ImageSlot>(slot: T): T => {
    const composition = used.has(slot.composition)
      ? (IMAGE_COMPOSITIONS.find((c) => !used.has(c)) ?? slot.composition)
      : slot.composition;
    used.add(composition);
    return { ...slot, composition };
  };
  return { ...parsed, cover: distinct(parsed.cover), inline: parsed.inline.map(distinct) };
}

/**
 * Insert a markdown/HTML block right after the `## heading` line. Throws when
 * missing. Heading detection is masked the same way as `extractH2s`, so a
 * fenced code sample of the heading never anchors the injection.
 */
export function injectBlockAfterHeading(content: string, heading: string, block: string): string {
  const lines = content.split('\n');
  const masked = maskCode(content).split('\n');
  const idx = lines.findIndex(
    (l, i) =>
      /^ {0,3}##\s+/.test(masked[i] as string) && l.replace(/^ {0,3}##\s+/, '').trim() === heading,
  );
  if (idx === -1) throw new Error(`heading not found in content: ${heading}`);
  lines.splice(idx + 1, 0, '', block);
  return lines.join('\n');
}

/** Insert `![alt](url)` right after the `## heading` line. Throws when missing. */
export function injectImageAfterHeading(
  content: string,
  heading: string,
  alt: string,
  url: string,
): string {
  return injectBlockAfterHeading(content, heading, `![${alt}](${url})`);
}
