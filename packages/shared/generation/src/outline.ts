import type { LlmMessage } from '@shared/providers';
import { z } from 'zod';
import { parseJsonObject } from './json';
import { normalizeUrl } from './links';
import { completeTopicBrief } from './topic';
import type { GenerationContext, Outline } from './types';

export const OutlineSchema = z.object({
  h1: z.string(),
  meta_title: z.string(),
  meta_description: z.string(),
  slug: z.string(),
  sections: z.array(z.object({ heading: z.string(), intent: z.string() })).min(1),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })).default([]),
  // URLs the model selected from the candidates we supplied. Unvetted here —
  // `parseOutline` is what filters them down to the approved set (#186).
  internal_links: z.array(z.string()).default([]),
  cta: z.string().default(''),
});

export function buildOutlinePrompt(ctx: GenerationContext): LlmMessage[] {
  const canLink = ctx.linkCandidates.length > 0 && ctx.maxInternalLinks > 0;
  const topic = completeTopicBrief(ctx);

  const system = [
    'You are an expert SEO content strategist.',
    'Produce a JSON outline for one blog article that can rank for the target keyword.',
    'Respond with ONLY a JSON object of this shape:',
    '{ "h1": string, "meta_title": string, "meta_description": string, "slug": string,',
    '  "sections": [{ "heading": string, "intent": string }],',
    '  "faqs": [{ "question": string, "answer": string }],',
    '  "internal_links": string[], "cta": string }',
    'Rules: h1 must NOT be identical to the keyword; meta_title <= 60 chars;',
    'meta_description between 120 and 160 chars; slug is kebab-case; at least 3 sections.',
    ctx.includeCta
      ? 'Set "cta" to one concise, relevant next step for the reader. Do not invent business claims.'
      : 'Set "cta" to an empty string. Do not include a call to action.',
    '"internal_links" may contain ONLY URLs copied verbatim from the candidate list.',
    'Never invent, shorten, or modify a URL, and never use a placeholder such as "#".',
    topic?.topic_role === 'pillar'
      ? 'Topic scope: produce a broad, authoritative cluster overview and hub that orients readers across the subject. Do not exhaustively replace the narrower support articles.'
      : '',
    topic?.topic_role === 'support'
      ? 'Topic scope: go deep on the assigned content focus. Do not broaden it into a second cluster overview, and keep it distinct from the pillar and other article targets.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const user = [
    `Business: ${ctx.businessName} — ${ctx.businessDescription}`,
    `Audience: ${ctx.audience}`,
    `Language: ${ctx.language} (${ctx.country})`,
    `Target keyword: ${ctx.keyword}`,
    ctx.articleType ? `Article type: ${ctx.articleType}` : '',
    ctx.intent ? `Search intent: ${ctx.intent}` : '',
    topic ? `Topic cluster: ${topic.topic_cluster_label}` : '',
    topic ? `Topic role: ${topic.topic_role}` : '',
    topic
      ? `Assigned content focus (the intended scope of this article): ${topic.topic_content_focus}`
      : '',
    ctx.competitors.length
      ? `Competitors to differentiate from (never promote them): ${ctx.competitors.join(', ')}`
      : '',
    ctx.serpCompetitors.length
      ? `Articles currently ranking for this keyword (differentiate the angle and craft a stronger title; never copy them):\n${ctx.serpCompetitors
          .map((r) => `${r.rank ?? '-'}. ${r.title ?? r.domain}${r.url ? ` (${r.url})` : ''}`)
          .join('\n')}`
      : '',
    canLink
      ? `Internal link candidates — already-published pages of this business. Pick at most ${ctx.maxInternalLinks}, and ONLY ones genuinely related to this article; pick none if none fit. Copy the URL exactly into "internal_links":\n${ctx.linkCandidates
          .map((c) => {
            const sameCluster = c.topic_cluster_id === topic?.topic_cluster_id;
            const relationship = sameCluster
              ? ` [same-cluster${c.topic_role ? ` ${c.topic_role}` : ''}]`
              : '';
            return `${c.title}${relationship} — ${c.url}`;
          })
          .join('\n')}`
      : 'There are no internal link candidates: "internal_links" must be an empty array.',
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

/**
 * Parse the outline and reduce `internal_links` to targets we can vouch for:
 * each must match a supplied candidate, appear once, and fit under the ceiling.
 * Selections are rewritten to OUR canonical URL, so a trailing-slash variant
 * from the model still resolves (#186).
 */
export function parseOutline(text: string, ctx: GenerationContext): Outline {
  const parsed = OutlineSchema.parse(parseJsonObject(text));
  const cta = parsed.cta.trim();
  if (ctx.includeCta && cta.length === 0) throw new Error('outline CTA is required');
  const approved = new Map(ctx.linkCandidates.map((c) => [normalizeUrl(c.url), c.url]));
  const internal_links: string[] = [];
  for (const selected of parsed.internal_links) {
    const canonical = approved.get(normalizeUrl(selected));
    if (!canonical || internal_links.includes(canonical)) continue;
    if (internal_links.length >= ctx.maxInternalLinks) break;
    internal_links.push(canonical);
  }
  return { ...parsed, cta: ctx.includeCta ? cta : '', internal_links };
}
