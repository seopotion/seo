/**
 * `db strategy-dryrun` (#211) — pure report builder and text renderer for a
 * pipeline run that persists nothing. Mongo-free and provider-free so the
 * sectioning, the plan simulation and the relevance arithmetic are unit-testable
 * from plain arrays; `strategyDryRun` in ./db.ts does the reads and the run.
 */
import {
  clusterSpreadSchedule,
  type EnrichedCandidate,
  type PipelineStats,
  type ResolvedConfig,
} from '@shared/keywords';
import { normalizeKeyword, type Org } from '@shared/schemas';
import type { DryRunCandidateRow, DryRunPlanRow, StrategyDryRunData } from '../types';

/** Mirrors PLAN_DAYS in apps/worker/src/strategy.ts. */
export const PLAN_DAYS = 30;

function toRow(c: EnrichedCandidate): DryRunCandidateRow {
  return {
    keyword: c.keyword,
    source: c.source,
    search_volume: c.search_volume,
    difficulty: c.difficulty,
    relevance_score: c.relevance_score,
    opportunity_score: c.opportunity_score,
    article_type: c.article_type,
    rejection_reason: c.rejection_reason,
  };
}

const byOpportunity = (a: EnrichedCandidate, b: EnrichedCandidate): number =>
  (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0) ||
  normalizeKeyword(a.keyword).localeCompare(normalizeKeyword(b.keyword));

/**
 * A survivor that never went through SERP validation — the below-serpTopN tier:
 * scored, unvalidated, unclassified. No longer schedulable as of #211.
 */
const isBelowN = (c: EnrichedCandidate): boolean =>
  c.rejection_reason === null && !c.serp_validated;

/** Split the pipeline output into the three tiers the report prints. */
export function splitSections(candidates: EnrichedCandidate[]): StrategyDryRunData['sections'] {
  const survivors = candidates.filter((c) => c.rejection_reason === null).sort(byOpportunity);
  const byReason = new Map<string, DryRunCandidateRow[]>();
  for (const c of [...candidates].sort(byOpportunity)) {
    if (c.rejection_reason === null) continue;
    const rows = byReason.get(c.rejection_reason) ?? [];
    rows.push(toRow(c));
    byReason.set(c.rejection_reason, rows);
  }
  return {
    accepted: survivors.filter((c) => !isBelowN(c)).map(toRow),
    below_n: survivors.filter(isBelowN).map(toRow),
    rejected: [...byReason.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([reason, rows]) => ({ reason, candidates: rows })),
  };
}

/**
 * The plan strategy.ts would build — same filter, same ranking, same
 * clusterSpreadSchedule. Simulated as a FIRST run for the org (full 30-day
 * budget, nothing already on the planner), so two dry runs of different code are
 * comparable regardless of what the org's planner currently holds. Under-fills
 * rather than padding when fewer than PLAN_DAYS candidates qualify.
 */
export function simulatePlan(candidates: EnrichedCandidate[], startDate: Date): DryRunPlanRow[] {
  const selectable = candidates
    .filter(
      (c) =>
        c.serp_validated &&
        c.rejection_reason === null &&
        c.search_volume !== null &&
        c.difficulty !== null,
    )
    .sort(byOpportunity)
    .slice(0, PLAN_DAYS);
  return clusterSpreadSchedule(selectable, startDate, PLAN_DAYS).map((c) => ({
    ...toRow(c),
    scheduled_date: c.scheduled_date,
    from_below_n: isBelowN(c),
  }));
}

/**
 * Relevance histogram over the candidates the LLM actually scored, in buckets
 * of the same shape as the floor test (`score <= floor` rejects). `cumulative`
 * is therefore exactly how many candidates a `relevanceFloor` of that bucket's
 * `max` would reject — the number to read when tuning the floor (#211).
 */
export function relevanceDistribution(
  candidates: EnrichedCandidate[],
): StrategyDryRunData['relevance']['distribution'] {
  const scores = candidates
    .filter((c) => c.relevance_score !== null)
    .map((c) => c.relevance_score as number);
  const buckets = [
    { label: '= 0.00', max: 0, count: scores.filter((s) => s <= 0).length },
    ...Array.from({ length: 10 }, (_, i) => {
      const lo = i / 10;
      const hi = (i + 1) / 10;
      return {
        label: `${lo.toFixed(2)} < r <= ${hi.toFixed(2)}`,
        max: hi,
        count: scores.filter((s) => s > lo && s <= hi).length,
      };
    }),
  ];
  let running = 0;
  return buckets.map((b) => {
    running += b.count;
    return { ...b, cumulative: running };
  });
}

export function buildDryRunReport(input: {
  org: Org;
  candidates: EnrichedCandidate[];
  stats: PipelineStats;
  config: ResolvedConfig;
  mode: 'live' | 'replay';
  startDate: Date;
  snapshot: StrategyDryRunData['snapshot'];
}): StrategyDryRunData {
  const { org, candidates, stats, config, mode, snapshot } = input;
  const presets = org.presets;
  const sections = splitSections(candidates);
  const plan = simulatePlan(candidates, input.startDate);

  const { sent, returned, zero } = stats.relevance;
  const notes = [
    'Nothing was persisted: no candidates, no planner entries, no strategy_status change.',
    'The plan below is simulated as a FIRST run for this org — full 30-day budget, no existing planner entries excluded and no cannibalization penalty — so runs stay comparable across code changes.',
  ];
  if (mode === 'replay') {
    notes.push('Replay mode: every provider response came from the snapshot; no network calls.');
  }
  if (snapshot.config_drift.length > 0) {
    notes.push(
      `Pipeline config differs from the snapshot's in ${snapshot.config_drift.length} key(s) — the replay may no longer represent the recorded run.`,
    );
  }
  if (sent > returned) {
    notes.push(
      `Relevance: the LLM scored ${returned} of ${sent} keywords; the other ${sent - returned} kept parseRelevance's 0 seed without ever being judged.`,
    );
  }
  const backfill = plan.filter((r) => r.from_below_n).length;
  if (backfill > 0) {
    notes.push(
      `BUG: ${backfill} of ${plan.length} planned entries come from the belowN tier — never SERP-validated, never classified. Selection is supposed to require serp_validated.`,
    );
  }
  if (plan.length < PLAN_DAYS) {
    notes.push(
      `Plan is under-filled: ${plan.length} of ${PLAN_DAYS} days. Expected when fewer candidates survive SERP validation — the worker schedules fewer rather than padding from the unvalidated tier.`,
    );
  }

  return {
    mode,
    org: {
      id: org.id,
      website_url: org.website_url,
      business: {
        name: presets?.business.name ?? '',
        country: presets?.business.country ?? '',
        language: presets?.business.language ?? '',
      },
      competitors: presets?.audience.competitors ?? [],
    },
    config,
    stats,
    relevance: {
      sent,
      returned,
      missing: sent - returned,
      zero,
      zero_fraction: sent === 0 ? 0 : zero / sent,
      distribution: relevanceDistribution(candidates),
      plan_min: plan.length === 0 ? null : Math.min(...plan.map((r) => r.relevance_score ?? 0)),
    },
    sections,
    plan,
    snapshot,
    notes,
  };
}

// ---- text rendering ----

const num = (v: number | null, digits = 2): string => (v === null ? '—' : v.toFixed(digits));
const int = (v: number | null): string => (v === null ? '—' : String(v));
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

/** Left-aligned fixed-width table; `right` marks columns padded on the left. */
function table(headers: string[], rows: string[][], right: Set<number> = new Set()): string[] {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length), 0),
  );
  const line = (cells: string[]) =>
    cells
      .map((c, i) =>
        right.has(i) ? c.padStart(widths[i] as number) : c.padEnd(widths[i] as number),
      )
      .join('  ')
      .trimEnd();
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)];
}

const CANDIDATE_HEADERS = [
  'keyword',
  'source',
  'vol',
  'kd',
  'rel',
  'opp',
  'article_type',
  'reason',
];
const CANDIDATE_RIGHT = new Set([2, 3, 4, 5]);

function candidateRows(rows: DryRunCandidateRow[]): string[][] {
  return rows.map((r) => [
    r.keyword,
    r.source,
    int(r.search_volume),
    int(r.difficulty),
    num(r.relevance_score),
    int(r.opportunity_score),
    r.article_type ?? '—',
    r.rejection_reason ?? '—',
  ]);
}

function section(title: string, rows: DryRunCandidateRow[], empty: string): string[] {
  const out = [title];
  if (rows.length === 0) return [...out, `  ${empty}`];
  return [
    ...out,
    ...table(CANDIDATE_HEADERS, candidateRows(rows), CANDIDATE_RIGHT).map((l) => `  ${l}`),
  ];
}

export function renderStrategyDryRun(d: StrategyDryRunData): string {
  const out: string[] = [];
  const rule = '─'.repeat(78);

  out.push(rule, `STRATEGY DRY RUN (${d.mode}) — org ${d.org.id}`, rule, '');
  for (const note of d.notes) out.push(`! ${note}`);
  out.push('');

  out.push('ORG');
  out.push(`  website_url  ${d.org.website_url}`);
  out.push(
    `  business     ${d.org.business.name} (${d.org.business.country} / ${d.org.business.language})`,
  );
  out.push(
    `  competitors  ${d.org.competitors.length ? d.org.competitors.join(' | ') : '(EMPTY — ranked_keywords branch disabled)'}`,
  );
  out.push('');

  out.push('CONFIG');
  out.push(
    `  serpTopN ${d.config.serpTopN}   difficultyCeiling ${d.config.difficultyCeiling}   relevanceFloor ${d.config.relevanceFloor}   volumeCap ${d.config.volumeCap}   clusterJaccard ${d.config.clusterJaccard}`,
  );
  out.push(
    `  weights  ${Object.entries(d.config.weights)
      .map(([k, v]) => `${k} ${v}`)
      .join('  ')}`,
  );
  out.push(`  geo      ${d.config.locationName ?? '—'} / ${d.config.languageName ?? '—'}`);
  if (d.snapshot.replayed) out.push(`  snapshot replayed from ${d.snapshot.replayed}`);
  if (d.snapshot.wrote) out.push(`  snapshot written to ${d.snapshot.wrote}`);
  if (d.snapshot.live_misses) {
    const { dataforseo, llm } = d.snapshot.live_misses;
    out.push(
      `  live misses  ${dataforseo} DataForSEO + ${llm} LLM call(s) fetched live${
        dataforseo + llm > 0 ? ` and folded into ${d.snapshot.replayed}` : ''
      }`,
    );
  }
  for (const drift of d.snapshot.config_drift) out.push(`  drift! ${drift}`);
  out.push('');

  const s = d.stats;
  out.push('PIPELINE STATS');
  out.push(
    `  gathered ${s.gathered} → dedupe ${s.afterDedupe} → brand/nav ${s.afterBrandNav} → clustered -${s.clustered} → ceiling ${s.afterCeiling} → scored ${s.scored} → relevanceFloor ${s.afterRelevanceFloor}`,
  );
  out.push(`  serpValidated ${s.serpValidated}   accepted ${s.accepted}`);
  out.push(
    `  rejectedByReason  ${Object.entries(s.rejectedByReason)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k} ${v}`)
      .join('  ')}`,
  );
  out.push('');

  out.push('RELEVANCE');
  out.push(
    `  sent ${d.relevance.sent}   scored by LLM ${d.relevance.returned}   never judged ${d.relevance.missing}   exactly 0 ${d.relevance.zero} (${pct(d.relevance.zero_fraction)})`,
  );
  out.push(
    '      → relevance carries the largest scoring weight, so every keyword the LLM did not return keeps a 0 seed and ranking degenerates to volume + ease.',
  );
  out.push(
    `  lowest relevance in the plan: ${num(d.relevance.plan_min)} — a relevanceFloor at or above it starts emptying plan slots.`,
  );
  out.push('  distribution (cumulative = how many a floor at that bound would reject)');
  out.push(
    ...table(
      ['bucket', 'count', 'cumulative'],
      d.relevance.distribution.map((b) => [b.label, String(b.count), String(b.cumulative)]),
      new Set([1, 2]),
    ).map((l) => `    ${l}`),
  );
  out.push('');

  out.push(
    ...section(
      `1. SERP-VALIDATED ACCEPTS — ${d.sections.accepted.length}`,
      d.sections.accepted,
      '(none survived SERP validation)',
    ),
  );
  out.push('');
  out.push(
    ...section(
      `2. BELOW-N TIER — ${d.sections.below_n.length} (scored, never SERP-validated; not schedulable)`,
      d.sections.below_n,
      '(none)',
    ),
  );
  out.push('');

  out.push(`3. REJECTS — ${d.sections.rejected.reduce((n, g) => n + g.candidates.length, 0)}`);
  if (d.sections.rejected.length === 0) out.push('  (none)');
  for (const group of d.sections.rejected) {
    out.push(`  ${group.reason} — ${group.candidates.length}`);
    out.push(
      ...table(CANDIDATE_HEADERS, candidateRows(group.candidates), CANDIDATE_RIGHT).map(
        (l) => `    ${l}`,
      ),
    );
  }
  out.push('');

  out.push(`PLAN — ${d.plan.length} of ${PLAN_DAYS} days strategy.ts would schedule`);
  if (d.plan.length === 0) {
    out.push('  (nothing schedulable)');
  } else {
    out.push(
      ...table(
        ['date', 'keyword', 'source', 'vol', 'kd', 'rel', 'opp', 'article_type', 'tier'],
        d.plan.map((r) => [
          r.scheduled_date,
          r.keyword,
          r.source,
          int(r.search_volume),
          int(r.difficulty),
          num(r.relevance_score),
          int(r.opportunity_score),
          r.article_type ?? '—',
          r.from_below_n ? 'BELOW-N' : 'accepted',
        ]),
        new Set([3, 4, 5, 6]),
      ).map((l) => `  ${l}`),
    );
  }

  return `${out.join('\n')}\n`;
}
