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
 */
export function extractH2s(content: string): string[] {
  const lines = content.split('\n');
  return maskCode(content)
    .split('\n')
    .flatMap((masked, i) =>
      /^##\s+/.test(masked) ? [(lines[i] as string).replace(/^##\s+/, '').trim()] : [],
    );
}

export function buildImagePlanPrompt(input: ImagePlanInput): LlmMessage[] {
  const system = [
    'You are an art director planning images for one blog article.',
    `Rules: exactly ${INLINE_IMAGE_COUNT} inline entries; each section_heading MUST be copied`,
    'EXACTLY from the provided section list, each from a DIFFERENT section. Prompts describe',
    'a single visual scene with no text or words in the image. alt is a meaningful',
    `description of the image for screen readers, written in ${input.language}.`,
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
    (l, i) => /^##\s+/.test(masked[i] as string) && l.replace(/^##\s+/, '').trim() === heading,
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
