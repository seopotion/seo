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
    ctx.internalLinks && outline.internal_link_opportunities.length
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
    // Same guard as the system line above. The outline step always emits
    // `internal_link_opportunities`, so gating only on its length leaked the
    // topic list into the prompt even with internal_links_count = 0 — a list
    // headed "Internal-link topics" is an instruction to link whether or not
    // one is spelled out, and with no URLs supplied the model invents them.
    ctx.internalLinks && outline.internal_link_opportunities.length
      ? `Internal-link topics: ${outline.internal_link_opportunities.join(' | ')}`
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
