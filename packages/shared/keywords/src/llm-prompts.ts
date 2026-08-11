import type { LlmMessage, SerpResult } from '@shared/providers';
import { ARTICLE_TYPES, type ArticleType, type SetupPresets } from '@shared/schemas';

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

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
  const parsed = tryParse(text) as { seeds?: unknown } | null;
  const seeds = parsed?.seeds;
  if (!Array.isArray(seeds)) return [];
  return seeds.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
}

// ---- relevance ----
export function buildRelevancePrompt(keywords: string[], presets: SetupPresets): LlmMessage[] {
  return [
    {
      role: 'system',
      content:
        'Score each keyword 0..1 for how relevant it is to the business and audience. ' +
        'Respond ONLY with JSON: {"scores":[{"keyword":string,"relevance":number}]}.',
    },
    {
      role: 'user',
      content: `${businessContext(presets)}\n\nKeywords:\n${JSON.stringify(keywords)}`,
    },
  ];
}

/**
 * Score every keyword, seeding 0 for the ones the model did not echo back
 * verbatim. `returned` counts the ones it did: a large gap between it and
 * `keywords.length` means a truncated or re-cased response rather than
 * genuinely irrelevant keywords, which is otherwise indistinguishable from a
 * real 0 (#211).
 */
export function parseRelevance(
  text: string,
  keywords: string[],
): { scores: Map<string, number>; returned: number } {
  const out = new Map<string, number>(keywords.map((k) => [k, 0]));
  const matched = new Set<string>();
  const parsed = tryParse(text) as {
    scores?: Array<{ keyword?: unknown; relevance?: unknown }>;
  } | null;
  for (const row of parsed?.scores ?? []) {
    if (
      typeof row.keyword === 'string' &&
      typeof row.relevance === 'number' &&
      out.has(row.keyword)
    ) {
      out.set(row.keyword, clamp01(row.relevance));
      matched.add(row.keyword);
    }
  }
  return { scores: out, returned: matched.size };
}

// ---- SERP judgment ----
export function buildSerpJudgmentPrompt(
  keyword: string,
  serp: SerpResult[],
  presets: SetupPresets,
): LlmMessage[] {
  const results = serp.map((r) => `${r.rank}. ${r.title} — ${r.domain}`).join('\n');
  return [
    {
      role: 'system',
      content:
        'Given a keyword and its Google results, decide if a blog article we write could rank. ' +
        'intentSuitable=false if results are product/navigational pages, not informational articles. ' +
        'localitySuitable=false if results are dominated by local businesses/directories for a ' +
        'location that does not match the business country. ' +
        'Respond ONLY with JSON: {"intentSuitable":boolean,"localitySuitable":boolean,"reason":string}.',
    },
    {
      role: 'user',
      content: `${businessContext(presets)}\n\nKeyword: ${keyword}\n\nResults:\n${results}`,
    },
  ];
}

export function parseSerpJudgment(text: string): {
  intentSuitable: boolean;
  localitySuitable: boolean;
  reason: string | null;
} {
  const parsed = tryParse(text) as {
    intentSuitable?: unknown;
    localitySuitable?: unknown;
    reason?: unknown;
  } | null;
  if (
    !parsed ||
    typeof parsed.intentSuitable !== 'boolean' ||
    typeof parsed.localitySuitable !== 'boolean'
  ) {
    return { intentSuitable: true, localitySuitable: true, reason: null };
  }
  return {
    intentSuitable: parsed.intentSuitable,
    localitySuitable: parsed.localitySuitable,
    reason: typeof parsed.reason === 'string' ? parsed.reason : null,
  };
}

// ---- classification ----
export function buildClassifyPrompt(keywords: string[], presets: SetupPresets): LlmMessage[] {
  return [
    {
      role: 'system',
      content:
        `Classify each keyword into one article_type from: ${ARTICLE_TYPES.join(', ')}. ` +
        'Use "other" only if none fit. Respond ONLY with JSON: ' +
        '{"types":[{"keyword":string,"article_type":string}]}.',
    },
    {
      role: 'user',
      content: `${businessContext(presets)}\n\nKeywords:\n${JSON.stringify(keywords)}`,
    },
  ];
}

export function parseClassification(text: string, keywords: string[]): Map<string, ArticleType> {
  const out = new Map<string, ArticleType>(keywords.map((k) => [k, 'other']));
  const parsed = tryParse(text) as {
    types?: Array<{ keyword?: unknown; article_type?: unknown }>;
  } | null;
  for (const row of parsed?.types ?? []) {
    if (
      typeof row.keyword === 'string' &&
      typeof row.article_type === 'string' &&
      out.has(row.keyword) &&
      ARTICLE_TYPE_SET.has(row.article_type)
    ) {
      out.set(row.keyword, row.article_type as ArticleType);
    }
  }
  return out;
}
