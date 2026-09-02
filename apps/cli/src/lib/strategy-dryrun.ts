/**
 * `db strategy-dryrun` (#211) — pure report builder and text renderer for a
 * pipeline run that persists nothing. Mongo-free and provider-free so the
 * sectioning, the plan simulation and the relevance arithmetic are unit-testable
 * from plain arrays; `strategyDryRun` in ./db.ts does the reads and the run.
 */
import {
  type EnrichedCandidate,
  type PipelineStats,
  type ResolvedConfig,
  selectTopicCandidateTargets,
  stampScheduledDates,
  type TopicCandidateTarget,
} from '@shared/keywords';
import { normalizeKeyword, type Org } from '@shared/schemas';
import type { DryRunCandidateRow, DryRunPlanRow, StrategyDryRunData } from '../types';

/** Mirrors PLAN_DAYS in apps/worker/src/strategy.ts. */
export const PLAN_DAYS = 30;

/**
 * What the strategy Lambda actually gets: its 15-minute timeout less the
 * DEADLINE_BUFFER_MS it reserves to mark the org failed (apps/worker/src/strategy.ts).
 * A dry run slower than this would be killed in production.
 */
export const LAMBDA_BUDGET_MS = 15 * 60_000 - 20_000;

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
 * The plan strategy.ts would build — same semantic filter and selector order.
 * Simulated as a FIRST run for the org (full 30-day
 * budget, nothing already on the planner), so two dry runs of different code are
 * comparable regardless of what the org's planner currently holds. Under-fills
 * rather than padding when fewer than PLAN_DAYS candidates qualify.
 */
export function simulatePlan(candidates: EnrichedCandidate[], startDate: Date): DryRunPlanRow[] {
  // Mirrors persist.ts's semanticTargetPool: unknown difficulty stays
  // plannable (#294).
  const selectable = candidates.filter(
    (c) => c.serp_validated && c.rejection_reason === null && c.search_volume !== null,
  ) as Array<EnrichedCandidate & TopicCandidateTarget>;
  const selected = selectTopicCandidateTargets(selectable, PLAN_DAYS);
  return stampScheduledDates(selected, startDate, PLAN_DAYS).map(({ item, scheduled_date }) => ({
    ...toRow(item),
    scheduled_date,
    from_below_n: isBelowN(item),
    topic_cluster_id: item.topic_cluster_id,
    topic_cluster_label: item.topic_cluster_label,
    topic_role: item.topic_role,
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

/**
 * Gathered-vs-surviving per source. The pipeline output holds every candidate
 * that survived dedupe (rejects included), so counting it by source gives the
 * post-dedupe half without threading another counter through the pipeline.
 */
export function sourceFunnel(
  candidates: EnrichedCandidate[],
  gatheredBySource: PipelineStats['gatheredBySource'],
): StrategyDryRunData['sources'] {
  const surviving = new Map<string, number>();
  for (const c of candidates) surviving.set(c.source, (surviving.get(c.source) ?? 0) + 1);
  const names = new Set([...Object.keys(gatheredBySource), ...surviving.keys()]);
  return [...names]
    .map((source) => ({
      source,
      gathered: gatheredBySource[source as keyof typeof gatheredBySource] ?? 0,
      after_dedupe: surviving.get(source) ?? 0,
    }))
    .filter((r) => r.gathered > 0 || r.after_dedupe > 0)
    .sort((a, b) => b.gathered - a.gathered || a.source.localeCompare(b.source));
}

/** article_type histogram over the accepted pool, commonest first. */
export function articleTypeDistribution(
  accepted: DryRunCandidateRow[],
): StrategyDryRunData['article_types'] {
  const counts = new Map<string, number>();
  for (const c of accepted) {
    const key = c.article_type ?? '(null)';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([article_type, count]) => ({ article_type, count }))
    .sort((a, b) => b.count - a.count || a.article_type.localeCompare(b.article_type));
}

export function buildDryRunReport(input: {
  org: Org;
  candidates: EnrichedCandidate[];
  stats: PipelineStats;
  config: ResolvedConfig;
  mode: 'live' | 'replay';
  startDate: Date;
  timing: StrategyDryRunData['timing'];
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
      `Relevance: the LLM scored ${returned} of ${sent} keywords${
        stats.relevance.failedBatches > 0
          ? ` (${stats.relevance.failedBatches} of ${stats.relevance.batches} batch bodies were unparseable)`
          : ''
      }; the other ${sent - returned} carry a NULL relevance_score — never judged, so the floor leaves them alone and they simply rank lower.`,
    );
  }
  const planCoverage = stats.plan;
  if (planCoverage.unjudged > 0) {
    notes.push(
      `Plan: ${planCoverage.unjudged} of ${planCoverage.finalists} finalists got no verdict from the plan call — NOT fail-opened into accepted; they land in the below-N tier, unschedulable.`,
    );
  }
  const repairedTotal = Object.values(planCoverage.repaired).reduce((a, b) => a + b, 0);
  if (repairedTotal > 0) {
    notes.push(
      `Plan: the materializer repaired ${repairedTotal} structural issue(s) in the model's response (${Object.entries(
        planCoverage.repaired,
      )
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')})${planCoverage.repairRetried ? ' after a repair retry' : ''}.`,
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
    timing: input.timing,
    sources: sourceFunnel(candidates, stats.gatheredBySource),
    article_types: articleTypeDistribution(sections.accepted),
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
    `  serpTopN ${d.config.serpTopN}   difficultyCeiling ${d.config.difficultyCeiling}   relevanceFloor ${d.config.relevanceFloor}   volumeCap ${d.config.volumeCap}`,
  );
  out.push(
    `  weights  ${Object.entries(d.config.weights)
      .map(([k, v]) => `${k} ${v}`)
      .join('  ')}`,
  );
  out.push(
    `  gather   minSearchVolume ${d.config.minSearchVolume}   limits ${Object.entries(
      d.config.endpointLimits,
    )
      .map(([k, v]) => `${k} ${v}`)
      .join('  ')}`,
  );
  out.push(`  geo      ${d.config.locationName ?? '—'} / ${d.config.languageName ?? '—'}`);
  out.push(
    `  guards   minLlmCoverage ${d.config.minLlmCoverage} (relevance + SERP judge below this ABORT the run)`,
  );
  const modelOverrides = Object.entries(d.config.models).filter(([, m]) => !!m);
  out.push(
    `  models   ${
      modelOverrides.length === 0
        ? '(client default for every stage)'
        : modelOverrides.map(([stage, model]) => `${stage} ${model}`).join('  ')
    }`,
  );
  out.push(
    `  seeds    ${
      d.config.seeds.length > 0
        ? `PINNED (${d.config.seeds.length}) — the seed LLM call was skipped`
        : 'LLM-generated (non-deterministic; pin with --seeds for a comparable run)'
    }`,
  );
  out.push(
    ...(d.stats.seeds.length === 0
      ? ['    (none)']
      : d.stats.seeds.map((seed, i) => `    ${i}. ${seed}`)),
  );
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
    `  gathered ${s.gathered} → dedupe ${s.afterDedupe} → brand/nav ${s.afterBrandNav} → ceiling ${s.afterCeiling} → scored ${s.scored} → relevanceFloor ${s.afterRelevanceFloor}`,
  );
  out.push(
    `  SERP checked ${s.serpChecked}   validated ${s.serpValidated}   accepted targets ${s.accepted}`,
  );
  out.push(
    `  plan        finalists ${s.plan.finalists}  verdicts ${s.plan.verdicts}  UNJUDGED ${s.plan.unjudged}  accepted ${s.plan.accepted}`,
  );
  out.push(
    `  plan targets ${s.plan.targets}   clusters ${s.plan.clusters}   singletons ${s.plan.singletons}   duplicates ${s.plan.duplicates}   pillars ${s.plan.pillars}   supports ${s.plan.supports}`,
  );
  out.push(
    `  plan repaired ${
      Object.entries(s.plan.repaired)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k} ${v}`)
        .join('  ') || '(none)'
    }   repairRetried ${s.plan.repairRetried}`,
  );
  out.push(
    `  rejectedByReason  ${Object.entries(s.rejectedByReason)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k} ${v}`)
      .join('  ')}`,
  );
  out.push(
    `  relevance   sent ${s.relevance.sent}  scored ${s.relevance.returned}  UNSCORED ${s.relevance.sent - s.relevance.returned} (null, not 0)  batches ${s.relevance.batches}  dead ${s.relevance.failedBatches}`,
  );
  out.push('');

  out.push('ARTICLE TYPES  (accepted-pool classification diagnostic only)');
  out.push(
    ...table(
      ['article_type', 'count'],
      d.article_types.map((r) => [r.article_type, String(r.count)]),
      new Set([1]),
    ).map((l) => `  ${l}`),
  );
  out.push('');

  const t = d.timing;
  const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  out.push(
    `TIMING  ${secs(t.total_ms)} of the strategy Lambda's ${secs(t.budget_ms)} budget (${pct(
      t.total_ms / t.budget_ms,
    )})${t.total_ms > t.budget_ms ? ' — OVER BUDGET, the worker would abort' : ''}`,
  );
  if (d.mode === 'replay') out.push('  (replay: no network, so these are not real latencies)');
  out.push(`  ${t.stages.map((s) => `${s.stage} ${secs(s.ms)}`).join('   ')}`);
  out.push('');

  out.push('SOURCES  (dropped = collapsed into an earlier source by dedupe)');
  out.push(
    ...table(
      ['source', 'gathered', 'after_dedupe', 'dropped'],
      d.sources.map((r) => [
        r.source,
        String(r.gathered),
        String(r.after_dedupe),
        String(r.gathered - r.after_dedupe),
      ]),
      new Set([1, 2, 3]),
    ).map((l) => `  ${l}`),
  );
  out.push('');

  out.push('RELEVANCE');
  out.push(
    `  sent ${d.relevance.sent}   scored by LLM ${d.relevance.returned}   never judged ${d.relevance.missing}   scored exactly 0 ${d.relevance.zero} (${pct(d.relevance.zero_fraction)})`,
  );
  out.push(
    '      → relevance carries the largest scoring weight, so every keyword the LLM did not return ranks on volume + ease alone. It is NOT rejected by the floor — null is "never judged", not "irrelevant".',
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
        [
          'date',
          'keyword',
          'cluster',
          'role',
          'source',
          'vol',
          'kd',
          'rel',
          'opp',
          'article_type',
          'tier',
        ],
        d.plan.map((r) => [
          r.scheduled_date,
          r.keyword,
          r.topic_cluster_label || r.topic_cluster_id,
          r.topic_role,
          r.source,
          int(r.search_volume),
          int(r.difficulty),
          num(r.relevance_score),
          int(r.opportunity_score),
          r.article_type ?? '—',
          r.from_below_n ? 'BELOW-N' : 'accepted',
        ]),
        new Set([5, 6, 7, 8]),
      ).map((l) => `  ${l}`),
    );
  }

  return `${out.join('\n')}\n`;
}
