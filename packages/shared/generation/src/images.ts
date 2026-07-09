import type { LlmMessage } from '@shared/providers';
import { z } from 'zod';
import { INLINE_IMAGE_COUNT } from './config';
import { parseJsonObject } from './json';

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

/** H2 heading texts, in order, from markdown content. */
export function extractH2s(content: string): string[] {
  return content
    .split('\n')
    .filter((l) => /^##\s+/.test(l))
    .map((l) => l.replace(/^##\s+/, '').trim());
}

export function buildImagePlanPrompt(input: ImagePlanInput): LlmMessage[] {
  const system = [
    'You are an art director planning images for one blog article.',
    'Respond with ONLY a JSON object of this shape:',
    '{ "cover": { "prompt": string, "alt": string },',
    '  "inline": [{ "prompt": string, "alt": string, "section_heading": string }] }',
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
  const plan = ImagePlanSchema.parse(parseJsonObject(text));
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

/** Insert `![alt](url)` right after the `## heading` line. Throws when missing. */
export function injectImageAfterHeading(
  content: string,
  heading: string,
  alt: string,
  url: string,
): string {
  const lines = content.split('\n');
  const idx = lines.findIndex(
    (l) => /^##\s+/.test(l) && l.replace(/^##\s+/, '').trim() === heading,
  );
  if (idx === -1) throw new Error(`heading not found in content: ${heading}`);
  lines.splice(idx + 1, 0, '', `![${alt}](${url})`);
  return lines.join('\n');
}
