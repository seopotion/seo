import type { LlmMessage } from '@shared/providers';
import { normalizeUrl } from './links';
import type { GenerationContext, Outline } from './types';

export function buildArticlePrompt(ctx: GenerationContext, outline: Outline): LlmMessage[] {
  // Resolved at the outline step and already filtered to approved targets (#186);
  // the model receives concrete URLs or none, never a topic to invent an href for.
  const linkLines = outline.internal_links
    .map((url) => {
      const candidate = ctx.linkCandidates.find((c) => normalizeUrl(c.url) === normalizeUrl(url));
      return candidate ? `${candidate.title} — ${candidate.url}` : null;
    })
    .filter((line): line is string => line !== null);

  const system = [
    'You are an expert long-form SEO writer.',
    'Write a complete, publish-ready blog article in GitHub-flavored Markdown.',
    'Start with a single H1 (# ...), then H2 (## ...) sections following the outline.',
    'Include an engaging introduction before the first H2 and a concluding section.',
    'Use the target keyword naturally; never keyword-stuff.',
    'Do not invent unverifiable facts about the business. Never promote competitors.',
    `Write the entire article in ${ctx.language}.`,
    linkLines.length
      ? 'Link to the internal pages listed below, at most once each, using descriptive anchor text. Use those exact URLs verbatim — never invent, shorten, or alter one — and include no other links of any kind.'
      : 'Do not include any hyperlinks.',
  ]
    .filter(Boolean)
    .join('\n');

  const user = [
    `Target keyword: ${ctx.keyword}`,
    `H1: ${outline.h1}`,
    `Sections: ${outline.sections.map((s) => s.heading).join(' | ')}`,
    outline.faqs.length ? `FAQs to answer: ${outline.faqs.map((f) => f.question).join(' | ')}` : '',
    linkLines.length ? `Internal links you may use (title — URL):\n${linkLines.join('\n')}` : '',
    outline.cta ? `Call to action: ${outline.cta}` : '',
    ctx.articleStyle ? `Style: ${ctx.articleStyle}` : '',
    ctx.llmInstructions ? `Extra instructions: ${ctx.llmInstructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
