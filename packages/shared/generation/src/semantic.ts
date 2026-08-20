import type { LlmMessage } from '@shared/providers';
import { z } from 'zod';
import { parseJsonObject } from './json';
import { completeTopicBrief } from './topic';
import type { GenerationContext } from './types';

export const SemanticResultSchema = z.object({
  pass: z.boolean(),
  reasons: z.array(z.string()).default([]),
});

export function buildSemanticCheckPrompt(ctx: GenerationContext, markdown: string): LlmMessage[] {
  const topic = completeTopicBrief(ctx);
  const system = [
    'You are a strict content compliance reviewer. Respond with ONLY JSON:',
    '{ "pass": boolean, "reasons": string[] }',
    'Set pass=false if ANY of these are true:',
    '- the article makes unsupported or unverifiable claims about the business;',
    '- it promotes, recommends, or links to a competitor;',
    '- the target keyword is stuffed unnaturally or is entirely absent;',
    ctx.includeCta
      ? '- it lacks one concise, relevant call to action near the end;'
      : '- it contains a call to action, including an invitation to contact, subscribe, buy, book, download, sign up, or take another next step;',
    topic
      ? '- the article materially ignores its assigned content focus or violates its pillar/support scope;'
      : '',
    `- the article is not written in ${ctx.language}.`,
    'Put one short sentence per problem in reasons. If none, pass=true and reasons=[].',
  ]
    .filter(Boolean)
    .join('\n');

  const user = [
    `Business: ${ctx.businessName}`,
    ctx.competitors.length ? `Competitors: ${ctx.competitors.join(', ')}` : 'Competitors: (none)',
    `Target keyword: ${ctx.keyword}`,
    `Required language: ${ctx.language}`,
    topic ? `Topic cluster: ${topic.topic_cluster_label}` : '',
    topic ? `Topic role: ${topic.topic_role}` : '',
    topic ? `Assigned content focus: ${topic.topic_content_focus}` : '',
    topic?.topic_role === 'pillar'
      ? 'Required topic scope: a broad, authoritative overview/hub that orients readers without exhaustively replacing narrower support articles.'
      : '',
    topic?.topic_role === 'support'
      ? 'Required topic scope: deep coverage of the assigned focus that remains distinct from the pillar and does not become another cluster overview.'
      : '',
    '--- ARTICLE ---',
    markdown,
  ]
    .filter(Boolean)
    .join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function parseSemanticResult(text: string): { pass: boolean; reasons: string[] } {
  return SemanticResultSchema.parse(parseJsonObject(text));
}
