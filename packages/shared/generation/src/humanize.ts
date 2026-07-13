import type { LlmMessage } from '@shared/providers';
import type { GenerationContext } from './types';

export function buildHumanizePrompt(ctx: GenerationContext, markdown: string): LlmMessage[] {
  const system = [
    'You are an editor improving readability and natural human tone.',
    'Rewrite the article to read naturally and engagingly while preserving meaning,',
    'the Markdown structure (same headings, same order), all facts, and keyword usage.',
    'Return ONLY the revised Markdown, with no commentary.',
    `Keep it written in ${ctx.language}.`,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: markdown },
  ];
}
