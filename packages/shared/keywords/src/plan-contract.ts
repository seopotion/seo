import type { LlmMessage } from '@shared/providers';
import { ARTICLE_TYPES, type SetupPresets, type WorkingCandidate } from '@shared/schemas';
import { parseJsonResponse } from './json-response';
import { compareTopicSignals } from './topic-signals';

export const PLAN_MAX_CANDIDATES = 150;
export const PLAN_SERP_TOP = 5;
export const PLAN_SERP_NEIGHBORS = 3;

export interface PlanVerdict {
  index: number;
  intent_ok: boolean;
  locality_ok: boolean;
  article_type: string | null;
}

export interface PlanTargetProposal {
  cluster: string;
  member_indices: number[];
  content_focus: string;
  is_pillar: boolean;
}

export interface PlanResponse {
  verdicts: PlanVerdict[];
  targets: PlanTargetProposal[];
  /** Rows dropped for being structurally unusable — logged, never fatal. */
  droppedRows: number;
}

/** The plan response yielded nothing usable — triggers the repair retry. */
export class PlanParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanParseError';
  }
}

function businessContext(presets: SetupPresets): string {
  return [
    `Business: ${presets.business.name}`,
    `Description: ${presets.business.description}`,
    `Target audience: ${presets.audience.target.join(', ')}`,
    `Country: ${presets.business.country}`,
    `Language: ${presets.business.language}`,
  ].join('\n');
}

interface PairwisePromptEvidence {
  left_index: number;
  right_index: number;
  serp_url_overlap: number;
}

/**
 * Pairwise SERP-overlap evidence, top-N neighbors per candidate. Moved from the
 * deleted topic-clusters.ts (same selection logic, same output shape).
 */
function positivePairwiseEvidence(
  candidates: readonly WorkingCandidate[],
): PairwisePromptEvidence[] {
  const neighbors = Array.from({ length: candidates.length }, () => [] as PairwisePromptEvidence[]);
  for (let left = 0; left < candidates.length; left++) {
    for (let right = left + 1; right < candidates.length; right++) {
      const signals = compareTopicSignals(
        candidates[left] as WorkingCandidate,
        candidates[right] as WorkingCandidate,
      );
      if (signals.serp_url_overlap !== null && signals.serp_url_overlap > 0) {
        const row = {
          left_index: left,
          right_index: right,
          serp_url_overlap: signals.serp_url_overlap,
        };
        neighbors[left]?.push(row);
        neighbors[right]?.push(row);
      }
    }
  }

  const selected = new Map<string, PairwisePromptEvidence>();
  for (const [candidateIndex, candidateNeighbors] of neighbors.entries()) {
    candidateNeighbors
      .sort((left, right) => {
        if (left.serp_url_overlap !== right.serp_url_overlap) {
          return right.serp_url_overlap - left.serp_url_overlap;
        }
        const leftNeighbor =
          left.left_index === candidateIndex ? left.right_index : left.left_index;
        const rightNeighbor =
          right.left_index === candidateIndex ? right.right_index : right.left_index;
        return leftNeighbor - rightNeighbor;
      })
      .slice(0, PLAN_SERP_NEIGHBORS)
      .forEach((row) => {
        selected.set(`${row.left_index}:${row.right_index}`, row);
      });
  }

  return [...selected.values()].sort(
    (left, right) => left.left_index - right.left_index || left.right_index - right.right_index,
  );
}

/**
 * One call, whole finalist pool. The model does JUDGMENT (is this keyword
 * winnable, what type of article, which keywords are one page, what is the
 * pillar); all bookkeeping — index partitions, primary selection, cluster ids —
 * is constructed by materializePlan. Nothing here can make the run unbuildable.
 */
export function buildPlanPrompt(
  candidates: readonly WorkingCandidate[],
  presets: SetupPresets,
): LlmMessage[] {
  if (candidates.length > PLAN_MAX_CANDIDATES) {
    throw new Error(
      `plan call accepts at most ${PLAN_MAX_CANDIDATES} candidates; received ${candidates.length}`,
    );
  }
  const rows = candidates.map((c, index) => {
    const row: Record<string, unknown> = {
      index,
      keyword: c.keyword,
      intent: c.intent,
      search_volume: c.search_volume,
      difficulty: c.difficulty,
      opportunity_score: c.opportunity_score,
    };
    if (c.core_keyword) row.core_keyword = c.core_keyword;
    if (c.category_ids.length > 0) row.category_ids = c.category_ids;
    row.serp_top = (c.serp_competitors ?? [])
      .slice(0, PLAN_SERP_TOP)
      .map(({ domain, title }) => ({ domain, title }));
    return row;
  });
  const evidence = positivePairwiseEvidence(candidates);
  const numbered = candidates.map((c, i) => `${i}. ${c.keyword}`).join('\n');

  return [
    {
      role: 'system',
      content:
        'You are building a content plan from validated keyword candidates. Do THREE things ' +
        'in one response.\n' +
        '1) VERDICTS — for EVERY candidate index return one verdict. intent_ok=false if its ' +
        'Google results are product/navigational pages a blog article cannot outrank. ' +
        'locality_ok=false if results are dominated by local businesses or directories for a ' +
        'location that does not match the business country. article_type is exactly one of: ' +
        `${ARTICLE_TYPES.map((t) => `"${t}"`).join(', ')} — copy the string verbatim.\n` +
        '2) TARGETS — group accepted candidates that should become ONE article page into a ' +
        'target: singular/plural/synonymous/wording variants belong together; meaningfully ' +
        'distinct search intents stay separate targets. Give each target the broad topic ' +
        'cluster it belongs to (cluster: a short subject-family label, reused verbatim across ' +
        'targets of the same family) and a one-sentence content_focus. A candidate you leave ' +
        'out of every target becomes its own standalone article — omission is allowed and ' +
        'safe, never a discard. Never put one index in two targets.\n' +
        '3) PILLARS — mark is_pillar=true on the one broad, useful pillar target of each ' +
        'cluster.\n' +
        'Evidence rules: missing evidence is unknown, not disagreement; different provider ' +
        'core keywords do not prove different topics; zero measured SERP URL overlap does not ' +
        'by itself prove different topics; category evidence is supporting evidence only.\n' +
        'Respond ONLY with JSON matching: {"verdicts":[{"index":number,"intent_ok":boolean,' +
        '"locality_ok":boolean,"article_type":string}],"targets":[{"cluster":string,' +
        '"member_indices":number[],"content_focus":string,"is_pillar":boolean}]}.',
    },
    {
      role: 'user',
      content: [
        businessContext(presets),
        `Candidates:\n${numbered}`,
        `Candidate data:\n${rows.map((r) => JSON.stringify(r)).join('\n')}`,
        `Positive measured SERP-overlap evidence:\n${
          evidence.length > 0
            ? evidence.map((e) => JSON.stringify(e)).join('\n')
            : '(none available)'
        }`,
      ].join('\n\n'),
    },
  ];
}

export function parsePlanResponse(text: string): PlanResponse {
  const parsed = parseJsonResponse(text) as {
    verdicts?: unknown;
    targets?: unknown;
  } | null;
  if (parsed === null || typeof parsed !== 'object') {
    throw new PlanParseError('plan response is not valid JSON');
  }
  let droppedRows = 0;
  const verdicts: PlanVerdict[] = [];
  for (const row of Array.isArray(parsed.verdicts) ? parsed.verdicts : []) {
    // A literal `null` entry is a hole, not a malformed attempt — skip without counting it.
    if (row === null) continue;
    const r = row as Record<string, unknown>;
    if (
      typeof r !== 'object' ||
      typeof r.index !== 'number' ||
      !Number.isInteger(r.index) ||
      typeof r.intent_ok !== 'boolean' ||
      typeof r.locality_ok !== 'boolean'
    ) {
      droppedRows++;
      continue;
    }
    verdicts.push({
      index: r.index,
      intent_ok: r.intent_ok,
      locality_ok: r.locality_ok,
      article_type: typeof r.article_type === 'string' ? r.article_type : null,
    });
  }
  const targets: PlanTargetProposal[] = [];
  for (const row of Array.isArray(parsed.targets) ? parsed.targets : []) {
    // A literal `null` entry is a hole, not a malformed attempt — skip without counting it.
    if (row === null) continue;
    const r = row as Record<string, unknown>;
    if (
      typeof r !== 'object' ||
      typeof r.cluster !== 'string' ||
      !Array.isArray(r.member_indices)
    ) {
      droppedRows++;
      continue;
    }
    targets.push({
      cluster: r.cluster,
      member_indices: r.member_indices.filter(
        (i): i is number => typeof i === 'number' && Number.isInteger(i),
      ),
      content_focus: typeof r.content_focus === 'string' ? r.content_focus : '',
      is_pillar: r.is_pillar === true,
    });
  }
  if (verdicts.length === 0) {
    throw new PlanParseError('plan response contained zero usable verdicts');
  }
  return { verdicts, targets, droppedRows };
}
