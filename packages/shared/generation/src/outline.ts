import type { LlmMessage } from '@shared/providers';
import { z } from 'zod';
import { parseJsonObject } from './json';
import type { GenerationContext, Outline } from './types';

export const OutlineSchema = z.object({
  h1: z.string(),
  meta_title: z.string(),
  meta_description: z.string(),
  slug: z.string(),
  sections: z.array(z.object({ heading: z.string(), intent: z.string() })).min(1),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })).default([]),
  internal_link_opportunities: z.array(z.string()).default([]),
  cta: z.string().default(''),
});

export function buildOutlinePrompt(ctx: GenerationContext): LlmMessage[] {
  const system = [
    'You are an expert SEO content strategist.',
    'Produce a JSON outline for one blog article that can rank for the target keyword.',
    'Respond with ONLY a JSON object of this shape:',
    '{ "h1": string, "meta_title": string, "meta_description": string, "slug": string,',
    '  "sections": [{ "heading": string, "intent": string }],',
    '  "faqs": [{ "question": string, "answer": string }],',
    // internal_links_count = 0 turns linking off (#186), so don't ask for
    // topics the article step is then required to discard — the field is
    // `.default([])`, so leaving it out of the shape parses fine.
    ctx.internalLinks
      ? '  "internal_link_opportunities": string[], "cta": string }'
      : '  "cta": string }',
    'Rules: h1 must NOT be identical to the keyword; meta_title <= 60 chars;',
    'meta_description between 120 and 160 chars; slug is kebab-case; at least 3 sections.',
  ].join('\n');

  const user = [
    `Business: ${ctx.businessName} — ${ctx.businessDescription}`,
    `Audience: ${ctx.audience}`,
    `Language: ${ctx.language} (${ctx.country})`,
    `Target keyword: ${ctx.keyword}`,
    ctx.articleType ? `Article type: ${ctx.articleType}` : '',
    ctx.intent ? `Search intent: ${ctx.intent}` : '',
    ctx.competitors.length
      ? `Competitors to differentiate from (never promote them): ${ctx.competitors.join(', ')}`
      : '',
    ctx.serpCompetitors.length
      ? `Articles currently ranking for this keyword (differentiate the angle and craft a stronger title; never copy them):\n${ctx.serpCompetitors
          .map((r) => `${r.rank ?? '-'}. ${r.title ?? r.domain}${r.url ? ` (${r.url})` : ''}`)
          .join('\n')}`
      : '',
    ctx.llmInstructions ? `Extra instructions: ${ctx.llmInstructions}` : '',
    `Write all text in ${ctx.language}.`,
  ]
    .filter(Boolean)
    .join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function parseOutline(text: string): Outline {
  return OutlineSchema.parse(parseJsonObject(text));
}
