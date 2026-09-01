import type { LlmMessage } from '@shared/providers';
import { toStrictJsonSchema } from '@shared/schemas';
import { z } from 'zod';
import { INLINE_IMAGE_COUNT } from './config';
import { parseJsonObject } from './json';
import { maskCode } from './links';

/** Inputs for the image-plan prompt — a subset of org presets + the article. */
export interface ImagePlanInput {
  businessName: string;
  businessDescription: string;
  language: string;
  imageStyle: string;
  articleTitle: string;
  metaDescription: string;
  headings: string[];
}

export const ImagePlanSchema = z.object({
  cover: z.object({ prompt: z.string().min(1), alt: z.string().min(1) }),
  inline: z.array(
    z.object({
      prompt: z.string().min(1),
      alt: z.string().min(1),
      section_heading: z.string().min(1),
    }),
  ),
});
export type ImagePlan = z.infer<typeof ImagePlanSchema>;

const TolerantImagePlanSchema = z.object({
  cover: ImagePlanSchema.shape.cover,
  inline: z.array(
    ImagePlanSchema.shape.inline.element.extend({
      section_heading: z.string().min(1).optional(),
    }),
  ),
});

// The STRICT plan is the wire contract: section_heading is required, which is
// exactly the field TolerantImagePlanSchema was written to survive without.
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
  'clothing — are blank, abstract or turned away from the camera.',
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
  '(?:diagrams?|screenshots?|signage|signs?|labels?|captions?|logos?|brand marks?|watermarks?|texts?|words?|lettering|letters?|numbers?|headings?|titles?|typography|fonts?|writing)';
const QUALIFIER = '(?:(?:any|all|visible|readable|other)\\s+)*';
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

/** Every slot whose prompt asks for a banned subject, labelled for feedback. */
export function findImagePlanTextRisks(plan: ImagePlan): { slot: string; term: string }[] {
  return [
    { slot: 'cover', prompt: plan.cover.prompt },
    ...plan.inline.map((img) => ({ slot: img.section_heading, prompt: img.prompt })),
  ].flatMap(({ slot, prompt }) => {
    const term = findTextRisk(prompt);
    return term ? [{ slot, term }] : [];
  });
}

/** The correction handed back to the planner for one more attempt. */
export function buildImagePlanRetryPrompt(risks: { slot: string; term: string }[]): LlmMessage {
  return {
    role: 'user',
    content: [
      `Rejected: ${risks.map((r) => `"${r.slot}" asks for ${r.term}`).join('; ')}.`,
      'Those subjects always render as unreadable lettering. Replan EVERY entry as a scene a',
      'photographer could shoot — people, hardware, places, materials, or abstract light and',
      'texture — with no surface that would carry writing. Keep the same sections.',
    ].join(' '),
  };
}

/**
 * Last resort when the planner will not stop asking for lettering: a plain
 * wordless scene for the slot's subject. Worse than a good planned prompt,
 * far better than a published diagram of garbled text.
 *
 * `context` grounds the scene in what the article is actually about — a bare
 * heading gave fal too little to work with and produced generic stock (the
 * first fallback cover was a laptop with a blank screen). It is dropped when
 * it names a banned subject itself, so the fallback can never smuggle back in
 * what the gate just rejected.
 */
export function wordlessPrompt(subject: string, context?: string): string {
  const grounding =
    context && context.trim() !== '' && findTextRisk(context) === null
      ? ` It illustrates an article about ${context.trim().replace(/\s+/g, ' ')}`
      : '';
  return `A photographic scene evoking ${subject}.${grounding} Shot with natural light and shallow depth of field. No text, lettering, signage or logos anywhere in the frame.`;
}

export function buildImagePlanPrompt(input: ImagePlanInput): LlmMessage[] {
  const system = [
    'You are an art director planning images for one blog article.',
    `Rules: exactly ${INLINE_IMAGE_COUNT} inline entries; each section_heading MUST be copied`,
    'EXACTLY from the provided section list, each from a DIFFERENT section. Prompts describe',
    'a single visual scene that contains NO text and NO logos: never ask for words, letters,',
    'numbers, captions, labels, signs, screens showing an interface, documents, whiteboards,',
    'book covers, branded packaging or the business logo. Prefer subjects that carry no',
    'lettering at all; when a scene needs a screen or a sign, describe it as blank or out of',
    'frame. The requested image style NEVER overrides these rules: a style asking for text,',
    'screenshots, diagrams or logos is reinterpreted as the nearest wordless visual (its mood,',
    'subject and palette kept, its lettering dropped).',
    `alt is a meaningful description of the image for screen readers, written in ${input.language}.`,
  ].join('\n');

  const user = [
    `Business: ${input.businessName} — ${input.businessDescription}`,
    input.imageStyle ? `Image style: ${input.imageStyle}` : '',
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

/** Parse + validate a plan; throws on wrong count, unknown or duplicate headings. */
export function parseImagePlan(text: string, headings: string[]): ImagePlan {
  const parsed = TolerantImagePlanSchema.parse(parseJsonObject(text));
  const specified = parsed.inline.flatMap((img) =>
    img.section_heading === undefined ? [] : [img.section_heading],
  );
  const available = headings.filter((heading) => !specified.includes(heading));
  const plan = ImagePlanSchema.parse({
    ...parsed,
    inline: parsed.inline.map((img) => ({
      ...img,
      section_heading: img.section_heading ?? available.shift(),
    })),
  });
  if (plan.inline.length !== INLINE_IMAGE_COUNT)
    throw new Error(`image plan needs exactly ${INLINE_IMAGE_COUNT} inline images`);
  const seen = new Set<string>();
  for (const img of plan.inline) {
    if (!headings.includes(img.section_heading))
      throw new Error(`image plan references unknown heading: ${img.section_heading}`);
    if (seen.has(img.section_heading))
      throw new Error(`image plan reuses heading: ${img.section_heading}`);
    seen.add(img.section_heading);
  }
  return plan;
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
