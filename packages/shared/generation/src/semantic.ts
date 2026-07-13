import type { LlmMessage } from '@shared/providers';
import { z } from 'zod';
import { parseJsonObject } from './json';
import type { GenerationContext } from './types';

export const SemanticResultSchema = z.object({
  pass: z.boolean(),
  reasons: z.array(z.string()).default([]),
});

export function buildSemanticCheckPrompt(ctx: GenerationContext, markdown: string): LlmMessage[] {
  const system = [
    'You are a strict content compliance reviewer. Respond with ONLY JSON:',
    '{ "pass": boolean, "reasons": string[] }',
    'Set pass=false if ANY of these are true:',
    '- the article makes unsupported or unverifiable claims about the business;',
    '- it promotes, recommends, or links to a competitor;',
    '- the target keyword is stuffed unnaturally or is entirely absent;',
    `- the article is not written in ${ctx.language}.`,
    'Put one short sentence per problem in reasons. If none, pass=true and reasons=[].',
  ].join('\n');

  const user = [
    `Business: ${ctx.businessName}`,
    ctx.competitors.length ? `Competitors: ${ctx.competitors.join(', ')}` : 'Competitors: (none)',
    `Target keyword: ${ctx.keyword}`,
    `Required language: ${ctx.language}`,
    '--- ARTICLE ---',
    markdown,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function parseSemanticResult(text: string): { pass: boolean; reasons: string[] } {
  return SemanticResultSchema.parse(parseJsonObject(text));
}
