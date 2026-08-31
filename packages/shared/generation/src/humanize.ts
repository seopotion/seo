import type { LlmMessage } from '@shared/providers';
import type { GenerationContext } from './types';

export interface HumanizeFeedback {
  attempt: number;
  /** Present only when the previous attempt failed the readability target. */
  grade?: number;
  target?: number;
  /** The previous attempt removed every mention of the business name (#266). */
  droppedBusinessName?: boolean;
}

export function buildHumanizePrompt(
  ctx: GenerationContext,
  markdown: string,
  feedback?: HumanizeFeedback,
): LlmMessage[] {
  const businessName = ctx.businessName.trim();
  const system = [
    'You are an editor improving readability and natural human tone.',
    'Rewrite the article to read naturally and engagingly while preserving meaning,',
    'the Markdown structure (same headings, same order), all facts, and keyword usage.',
    'Return ONLY the revised Markdown, with no commentary.',
    `Keep it written in ${ctx.language}.`,
    ctx.includeCta
      ? 'Preserve the call to action near the end, and do not add a second one.'
      : 'Remove any call to action from the article, and do not add one.',
    // Simplification pressure deletes the brand's one mention in the CTA (#266).
    ctx.includeCta && businessName.length > 0
      ? `Keep every mention of ${businessName} exactly as written; never remove, rename, or generalize the business.`
      : '',
    ctx.language === 'English'
      ? 'Aim for Flesch-Kincaid grade level 8 or lower. Prefer familiar words and direct sentences. Use active voice and short paragraphs. Explain necessary technical terms. Do not sacrifice factual accuracy, useful detail, required keywords, or meaning.'
      : '',
    feedback?.grade !== undefined
      ? `Your previous attempt (attempt ${feedback.attempt}) scored Flesch-Kincaid grade level ${feedback.grade}, above the target of grade level ${feedback.target}. Simplify further: shorter sentences, fewer syllables per word, one idea per sentence — without dropping facts, keywords, or meaning.`
      : '',
    feedback?.droppedBusinessName
      ? `Your previous attempt (attempt ${feedback.attempt}) removed every mention of ${businessName}. This rewrite must keep the business name.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: markdown },
  ];
}
