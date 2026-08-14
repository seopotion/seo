import type { LlmMessage } from '@shared/providers';
import {
  ARTICLE_TYPES,
  type ArticleType,
  normalizeKeyword,
  type SetupPresets,
} from '@shared/schemas';
import { parseJsonResponse } from './json-response';

const ARTICLE_TYPE_SET = new Set<string>(ARTICLE_TYPES);

function businessContext(presets: SetupPresets): string {
  return [
    `Business: ${presets.business.name}`,
    `Description: ${presets.business.description}`,
    `Target audience: ${presets.audience.target.join(', ')}`,
    `Country: ${presets.business.country}`,
    `Language: ${presets.business.language}`,
  ].join('\n');
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

// ---- seeds ----
/**
 * Seeds are expanded by `keyword_suggestions`, which returns long-tail phrases
 * CONTAINING the seed verbatim — so the seed's vocabulary decides the whole
 * pool, and its LENGTH decides whether there is a pool at all. Two forces pull
 * against each other, both measured on clewas (#211):
 *  - too generic ("water treatment", the pre-#211 wording's output) expands into
 *    the consumer market sitting next to a niche B2B;
 *  - too long ("SWRO energy recovery", "high RO energy consumption") matches
 *    nothing — those seeds returned 0 suggestions each, while the two-word
 *    "antiscalant dosing" and "membrane fouling" returned 20 and 60.
 * Hence: industry vocabulary, but the SHORT head of it.
 */
export function buildSeedPrompt(presets: SetupPresets, competitorWins: string[]): LlmMessage[] {
  const wins =
    competitorWins.length > 0
      ? `\n\nKeywords competitors already rank for:\n${JSON.stringify(competitorWins)}`
      : '';
  return [
    {
      role: 'system',
      content:
        'You generate SEO seed keywords for a content strategy. Respond ONLY with JSON: ' +
        '{"seeds": string[]}. Return 15-20 seeds written in the technical vocabulary a ' +
        'qualified buyer or practitioner in this field would actually type — the words used ' +
        'inside the industry, not the words an outsider would use to describe it. Draw them ' +
        'from: the processes, equipment, materials and methods the business deals with; the ' +
        'operational problems, symptoms and failure modes its customers hit; and the ' +
        'measurements, standards or specifications they work to. Aim for roughly half core ' +
        'domain/process terms and half problem or symptom terms. ' +
        'Each seed MUST be a noun phrase of exactly 2 or 3 words that appears verbatim ' +
        'inside real search queries — a named thing, process or fault, not a description ' +
        'of one. Longer compound phrases match nothing and are wasted. ' +
        'Each seed must also stand alone unambiguously: single words and terms that would ' +
        'mean something else in another industry pull in unrelated markets, so include the ' +
        'word that anchors the term to this field. Never return a broad category or ' +
        'umbrella term. No brand names.',
    },
    { role: 'user', content: `${businessContext(presets)}${wins}` },
  ];
}

export function parseSeeds(text: string): string[] {
  const parsed = parseJsonResponse(text) as { seeds?: unknown } | null;
  const seeds = parsed?.seeds;
  if (!Array.isArray(seeds)) return [];
  return seeds.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
}

// ---- relevance ----
/**
 * Score a batch of keywords. The SCORING CRITERION is carried over verbatim from
 * the single-call prompt; what changed is the addressing. Echoing 400+ keywords
 * back was the single largest output of any stage — 60-68 chars per keyword,
 * measured — and output tokens are what the classify call exhausted before
 * returning an empty body. Rows are answered by INDEX instead (#211).
 */
export function buildRelevancePrompt(keywords: string[], presets: SetupPresets): LlmMessage[] {
  const list = keywords.map((k, i) => `${i}. ${k}`).join('\n');
  return [
    {
      role: 'system',
      content:
        'Score each keyword 0..1 for how relevant it is to the business and audience. ' +
        'Each keyword is numbered; answer by that index and do not repeat the keyword text. ' +
        'Return one entry for every index. Respond ONLY with JSON: ' +
        '{"scores":[{"index":number,"relevance":number}]}.',
    },
    { role: 'user', content: `${businessContext(presets)}\n\nKeywords:\n${list}` },
  ];
}

/**
 * Scores for the keywords the model actually answered — and ONLY those. An
 * absent keyword is deliberately absent rather than seeded to 0: the seed made
 * "never judged" indistinguishable from "judged irrelevant", and since the
 * relevance floor rejects at 0, one empty response rejected the entire pool and
 * shipped a 30-day plan with nothing in it (#211). `parsed === false` marks a
 * body that yielded nothing at all, so a dead batch is countable.
 */
export function parseRelevance(
  text: string,
  keywords: string[],
): { scores: Map<string, number>; parsed: boolean } {
  const out = new Map<string, number>();
  const byNormalized = new Map(keywords.map((k) => [normalizeKeyword(k), k]));
  const parsed = parseJsonResponse(text) as {
    scores?: Array<{ index?: unknown; keyword?: unknown; relevance?: unknown }>;
  } | null;
  for (const row of parsed?.scores ?? []) {
    if (typeof row.relevance !== 'number' || !Number.isFinite(row.relevance)) continue;
    // Index is the contract; an echoed keyword is still honoured so a model that
    // ignores it degrades to the old behaviour rather than to silence.
    const keyword =
      typeof row.index === 'number' && Number.isInteger(row.index)
        ? keywords[row.index]
        : typeof row.keyword === 'string'
          ? byNormalized.get(normalizeKeyword(row.keyword))
          : undefined;
    if (keyword === undefined) continue;
    out.set(keyword, clamp01(row.relevance));
  }
  return { scores: out, parsed: out.size > 0 };
}

// ---- article type ----
/**
 * Resolve a model-written type to an enum member. Models routinely return
 * "How-To Guide" or "how to guide" for `how_to_guide`, and the old exact-match
 * check dropped every one of those to `other` without a trace (#211).
 */
export function toArticleType(raw: string): ArticleType | null {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return ARTICLE_TYPE_SET.has(normalized) ? (normalized as ArticleType) : null;
}
