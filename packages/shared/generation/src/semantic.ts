import type { LlmMessage } from '@shared/providers';
import { toStrictJsonSchema } from '@shared/schemas';
import { z } from 'zod';
import { parseJsonObject } from './json';
import { completeTopicBrief } from './topic';
import type { GenerationContext } from './types';

/**
 * One verdict per rule instead of a free-form `{pass, reasons}` (#277). The
 * judge used to decide six rules in one breath and could fail an article on a
 * reason whose own text argued no rule was broken ("Piper is not listed in the
 * Competitors list") — so `pass` is computed here, from the rules the judge
 * actually marked, and is never taken from the model.
 */
const RuleVerdictSchema = z.object({
  violated: z.boolean(),
  detail: z.string(),
});

/**
 * `competitor` is the business the judge says was promoted. It is the field
 * that closes #277: a name outside the org's competitor list is discarded
 * below, so the judge cannot fail an article for recommending the very
 * business the article is written for — which `includeCta` requires it to do.
 */
export const SemanticVerdictSchema = z.object({
  unsupported_claims: RuleVerdictSchema,
  competitor_promotion: RuleVerdictSchema.extend({ competitor: z.string() }),
  keyword_use: RuleVerdictSchema,
  call_to_action: RuleVerdictSchema,
  topic_scope: RuleVerdictSchema,
  language: RuleVerdictSchema,
});
export type SemanticVerdict = z.infer<typeof SemanticVerdictSchema>;

export const SEMANTIC_RESPONSE_SCHEMA = toStrictJsonSchema(SemanticVerdictSchema, 'semantic_check');

export function buildSemanticCheckPrompt(ctx: GenerationContext, markdown: string): LlmMessage[] {
  const topic = completeTopicBrief(ctx);
  const system = [
    'You are a strict content compliance reviewer.',
    `This article is written FOR ${ctx.businessName}: recommending, linking to, or favourably`,
    `comparing ${ctx.businessName} is the article's purpose, never a violation, even when the`,
    'target keyword is a rival product. Only a business in the Competitors list is a competitor.',
    'Judge each rule separately and answer every field. Set violated=true only for a rule the',
    'article actually breaks, and put one short sentence in its detail. A rule you are unsure',
    'about, or merely have a suggestion about, is violated=false.',
    '- unsupported_claims: the article makes unsupported or unverifiable claims about the business;',
    '- competitor_promotion: it promotes, recommends, or links to a business in the Competitors',
    '  list. Put in the competitor field the business the article promotes, spelled as the',
    '  ARTICLE names it — never copy a different name from the Competitors list to fill the',
    '  field. If the business you are objecting to is not in the Competitors list, this rule is',
    '  not violated;',
    '- keyword_use: the target keyword is stuffed unnaturally or is entirely absent;',
    ctx.includeCta
      ? '- call_to_action: it lacks one concise, relevant call to action near the end;'
      : '- call_to_action: it contains a call to action, including an invitation to contact, subscribe, buy, book, download, sign up, or take another next step;',
    topic
      ? '- topic_scope: the article materially ignores its assigned content focus or violates its pillar/support scope;'
      : '- topic_scope: not applicable to this article — always violated=false;',
    `- language: the article is not written in ${ctx.language}.`,
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

/** `rival.com`, `https://www.rival.com/pricing` and `Rival` all reduce to `rival`. */
function registrableName(value: string): string {
  const host = value
    .toLowerCase()
    .trim()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '');
  return (host.split(/[/?#]/)[0] as string).split('.')[0] as string;
}

/** Whether the business the judge named is one of the org's listed competitors. */
function isListedCompetitor(named: string, competitors: string[]): boolean {
  const name = registrableName(named);
  if (name === '') return false;
  return competitors.some((competitor) => registrableName(competitor) === name);
}

/**
 * Collapse the per-rule verdict into the pass/reasons pair the finalize stage
 * records. Two rules are gated by the run's own facts rather than the judge's
 * word: competitor promotion needs a business from the org's list (#277), and
 * topic scope only applies to an article that actually has a complete brief.
 */
export function parseSemanticResult(
  text: string,
  ctx: GenerationContext,
): { pass: boolean; reasons: string[] } {
  const verdict = SemanticVerdictSchema.parse(parseJsonObject(text));
  const applies: Record<keyof SemanticVerdict, boolean> = {
    unsupported_claims: true,
    competitor_promotion: isListedCompetitor(
      verdict.competitor_promotion.competitor,
      ctx.competitors,
    ),
    keyword_use: true,
    call_to_action: true,
    topic_scope: completeTopicBrief(ctx) !== null,
    language: true,
  };
  const reasons = Object.entries(verdict).flatMap(([rule, result]) =>
    result.violated && applies[rule as keyof SemanticVerdict]
      ? [`${rule}: ${result.detail.trim() || 'violated'}`]
      : [],
  );
  return { pass: reasons.length === 0, reasons };
}
