import type { LlmMessage } from '@shared/providers';
import type { GenerationContext, Outline } from './types';

export function buildArticlePrompt(ctx: GenerationContext, outline: Outline): LlmMessage[] {
  const system = [
    'You are an expert long-form SEO writer.',
    'Write a complete, publish-ready blog article in GitHub-flavored Markdown.',
    'Start with a single H1 (# ...), then H2 (## ...) sections following the outline.',
    'Include an engaging introduction before the first H2 and a concluding section.',
    'Use the target keyword naturally; never keyword-stuff.',
    'Do not invent unverifiable facts about the business. Never promote competitors.',
    `Write the entire article in ${ctx.language}.`,
    ctx.maxInternalLinks > 0 && outline.internal_links.length
      ? 'Where natural, weave in the suggested internal-link topics as descriptive anchor text.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const user = [
    `Target keyword: ${ctx.keyword}`,
    `H1: ${outline.h1}`,
    `Sections: ${outline.sections.map((s) => s.heading).join(' | ')}`,
    outline.faqs.length ? `FAQs to answer: ${outline.faqs.map((f) => f.question).join(' | ')}` : '',
    outline.internal_links.length
      ? `Internal-link topics: ${outline.internal_links.join(' | ')}`
      : '',
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
