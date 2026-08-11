import type { LlmMessage, SerpResult } from '@shared/providers';
import {
  ARTICLE_TYPES,
  type ArticleType,
  normalizeKeyword,
  type SetupPresets,
} from '@shared/schemas';
import type { ClassificationCoverage } from './types';

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
export interface SerpJudgment {
  intentSuitable: boolean;
  localitySuitable: boolean;
  reason: string | null;
}

/** What an unanswered keyword gets: the long-standing fail-OPEN policy (#211). */
export const FAIL_OPEN_JUDGMENT: SerpJudgment = {
  intentSuitable: true,
  localitySuitable: true,
  reason: null,
};

export interface SerpJudgmentItem {
  keyword: string;
  serp: SerpResult[];
}

/**
 * Judge N keywords in one call. The per-keyword round trip was ~30s regardless
 * of how little it had to say, which made the judge ~10m30s of an 11m33s run —
 * the cost is the trip, not the tokens, so the fix is fewer trips (#211).
 *
 * The CRITERIA below are carried over verbatim from the per-keyword prompt: this
 * changes how many keywords one call covers, never what the judge decides. Rows
 * are addressed by index so nothing depends on the model echoing keyword text.
 */
export function buildSerpJudgmentPrompt(
  items: SerpJudgmentItem[],
  presets: SetupPresets,
): LlmMessage[] {
  const blocks = items.map((item, i) => {
    const results = item.serp.map((r) => `${r.rank}. ${r.title} — ${r.domain}`).join('\n');
    return `Keyword ${i}: ${item.keyword}\nResults:\n${results}`;
  });
  return [
    {
      role: 'system',
      content:
        'Given keywords and their Google results, decide for each if a blog article we write ' +
        'could rank. ' +
        'intentSuitable=false if results are product/navigational pages, not informational articles. ' +
        'localitySuitable=false if results are dominated by local businesses/directories for a ' +
        'location that does not match the business country. ' +
        'Judge each keyword independently, on its own results only. ' +
        'Each keyword is numbered; answer by that index and return one entry for every index. ' +
        'Respond ONLY with JSON: {"judgments":[{"index":number,"intentSuitable":boolean,' +
        '"localitySuitable":boolean,"reason":string}]}.',
    },
    { role: 'user', content: `${businessContext(presets)}\n\n${blocks.join('\n\n')}` },
  ];
}

/**
 * One verdict per input, in input order. A row the model omitted or mangled
 * degrades to the fail-open default for THAT keyword only — a single malformed
 * body must not decide the whole batch. `unparseable` counts them, and
 * `parsed === false` marks a body that yielded nothing at all.
 */
export function parseSerpJudgments(
  text: string,
  count: number,
): { judgments: SerpJudgment[]; unparseable: number; parsed: boolean } {
  const out = new Array<SerpJudgment>(count).fill(FAIL_OPEN_JUDGMENT);
  const seen = new Set<number>();
  const parsed = tryParse(text) as {
    judgments?: Array<{
      index?: unknown;
      intentSuitable?: unknown;
      localitySuitable?: unknown;
      reason?: unknown;
    }>;
  } | null;
  for (const row of parsed?.judgments ?? []) {
    if (
      typeof row.index !== 'number' ||
      !Number.isInteger(row.index) ||
      row.index < 0 ||
      row.index >= count ||
      typeof row.intentSuitable !== 'boolean' ||
      typeof row.localitySuitable !== 'boolean'
    ) {
      continue;
    }
    out[row.index] = {
      intentSuitable: row.intentSuitable,
      localitySuitable: row.localitySuitable,
      reason: typeof row.reason === 'string' ? row.reason : null,
    };
    seen.add(row.index);
  }
  return { judgments: out, unparseable: count - seen.size, parsed: seen.size > 0 };
}

// ---- classification ----
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

/**
 * Classify a batch of keywords. Answers are addressed by INDEX rather than by
 * echoing the keyword back: the echo was pure output cost, and on the clewas run
 * asking for 78 of them contributed to the model exhausting its 65k-token output
 * budget mid-reasoning and returning an empty body. The allowed values are
 * spelled as exact literals because the response is matched against them (#211).
 */
export function buildClassifyPrompt(keywords: string[], presets: SetupPresets): LlmMessage[] {
  const list = keywords.map((k, i) => `${i}. ${k}`).join('\n');
  return [
    {
      role: 'system',
      content:
        'Classify each keyword into exactly one article_type. The allowed values are exactly: ' +
        `${ARTICLE_TYPES.map((t) => `"${t}"`).join(', ')}. Copy one of those strings verbatim — ` +
        'do not reword, capitalize or hyphenate it. Use "other" only if none of the others fit. ' +
        'Each keyword is numbered; answer by that index and do not repeat the keyword text. ' +
        'Return one entry for every index. Respond ONLY with JSON: ' +
        '{"types":[{"index":number,"article_type":string}]}.',
    },
    { role: 'user', content: `${businessContext(presets)}\n\nKeywords:\n${list}` },
  ];
}

/**
 * Type every keyword, seeding `other` for the ones the model did not answer.
 * Rows are read by `index`; a row that echoes a `keyword` instead is still
 * honoured via normalizeKeyword, so a model that ignores the index contract
 * degrades to the old behaviour rather than to silence. The coverage counts are
 * the point: `assigned` well below `sent` is the signal that used to be
 * invisible.
 */
export function parseClassification(
  text: string,
  keywords: string[],
): { types: Map<string, ArticleType>; coverage: Omit<ClassificationCoverage, 'batches'> } {
  const out = new Map<string, ArticleType>(keywords.map((k) => [k, 'other']));
  const byNormalized = new Map(keywords.map((k) => [normalizeKeyword(k), k]));
  const assigned = new Set<string>();
  let returned = 0;
  let matched = 0;
  let typed = 0;

  const parsed = tryParse(text) as {
    types?: Array<{ index?: unknown; keyword?: unknown; article_type?: unknown }>;
  } | null;

  for (const row of parsed?.types ?? []) {
    returned++;
    const keyword =
      typeof row.index === 'number' && Number.isInteger(row.index)
        ? keywords[row.index]
        : typeof row.keyword === 'string'
          ? byNormalized.get(normalizeKeyword(row.keyword))
          : undefined;
    if (keyword !== undefined) matched++;

    const articleType =
      typeof row.article_type === 'string' ? toArticleType(row.article_type) : null;
    if (articleType !== null) typed++;

    if (keyword === undefined || articleType === null) continue;
    out.set(keyword, articleType);
    assigned.add(keyword);
  }

  return {
    types: out,
    coverage: {
      sent: keywords.length,
      returned,
      matched,
      typed,
      assigned: assigned.size,
      failedBatches: returned === 0 ? 1 : 0,
    },
  };
}
