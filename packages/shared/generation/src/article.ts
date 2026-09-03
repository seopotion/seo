import type { LlmMessage } from '@shared/providers';
import { normalizeUrl } from './links';
import { completeTopicBrief } from './topic';
import type { GenerationContext, Outline } from './types';

export function buildArticlePrompt(ctx: GenerationContext, outline: Outline): LlmMessage[] {
  const topic = completeTopicBrief(ctx);
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
    ctx.includeCta
      ? 'Include the supplied call to action once, near the end of the article.'
      : 'Do not include a call to action.',
    topic?.topic_role === 'pillar'
      ? 'Topic scope: write a broad, authoritative cluster overview and hub that orients readers across the subject. Do not exhaustively replace the narrower support articles.'
      : '',
    topic?.topic_role === 'support'
      ? 'Topic scope: go deep on the assigned content focus. Do not broaden it into a second cluster overview, and keep it distinct from the pillar and other article targets.'
      : '',
    `Write the entire article in ${ctx.language}.`,
    ctx.language === 'English'
      ? `Aim for Flesch-Kincaid grade level ${ctx.readabilityGradeMax} or lower. Prefer familiar words and direct sentences. Use active voice and short paragraphs. Explain necessary technical terms. Do not sacrifice factual accuracy, useful detail, required keywords, or meaning.`
      : '',
    linkLines.length
      ? 'Link to the internal pages listed below, at most once each, using descriptive anchor text. Use those exact URLs verbatim — never invent, shorten, or alter one — and include no other links of any kind.'
      : 'Do not include any hyperlinks.',
  ]
    .filter(Boolean)
    .join('\n');

  const user = [
    `Target keyword: ${ctx.keyword}`,
    topic ? `Topic cluster: ${topic.topic_cluster_label}` : '',
    topic ? `Topic role: ${topic.topic_role}` : '',
    topic
      ? `Assigned content focus (the intended scope of this article): ${topic.topic_content_focus}`
      : '',
    `H1: ${outline.h1}`,
    `Sections: ${outline.sections.map((s) => s.heading).join(' | ')}`,
    outline.faqs.length ? `FAQs to answer: ${outline.faqs.map((f) => f.question).join(' | ')}` : '',
    linkLines.length ? `Internal links you may use (title — URL):\n${linkLines.join('\n')}` : '',
    ctx.includeCta && outline.cta ? `Call to action: ${outline.cta}` : '',
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
