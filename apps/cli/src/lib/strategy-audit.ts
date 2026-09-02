/**
 * `db strategy-audit` (#211) — pure report builder and text renderer for the
 * read-only strategy diagnostics. Deliberately Mongo-free so every statistic is
 * unit-testable from plain arrays; `strategyAudit` in ./db.ts does the reads.
 */
import { type Candidate, type Keyword, normalizeKeyword, type Org } from '@shared/schemas';
import type {
  AuditDiagnostics,
  AuditPlanRow,
  AuditPool,
  Bucket,
  BucketCount,
  NumericStats,
  StrategyAuditData,
} from '../types';

/** Key used for the "not rejected" / "unset" slot in a count-by histogram. */
const NONE = '(none)';

/**
 * Linear-interpolated percentile over an ascending-sorted array.
 * Empty -> null; a single element is its own every-percentile.
 */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0] as number;
  const idx = (sortedAsc.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loV = sortedAsc[lo] as number;
  if (lo === hi) return loV;
  return loV + ((sortedAsc[hi] as number) - loV) * (idx - lo);
}

/** min/p25/median/p75/max over the non-null values, plus how many were null. */
export function numericStats(values: (number | null | undefined)[]): NumericStats {
  const present = values.filter((v): v is number => typeof v === 'number');
  const sorted = [...present].sort((a, b) => a - b);
  return {
    count: sorted.length,
    nulls: values.length - sorted.length,
    min: percentile(sorted, 0),
    p25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    max: percentile(sorted, 1),
  };
}

/** Count items by a derived key. Keys with zero hits never appear. */
export function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Count values into half-open `[min, max)` buckets. Values outside every bucket are dropped. */
export function bucketize(values: number[], buckets: Bucket[]): BucketCount[] {
  const counts = buckets.map((b) => ({ label: b.label, count: 0 }));
  for (const v of values) {
    const i = buckets.findIndex((b) => v >= b.min && v < b.max);
    if (i !== -1) (counts[i] as BucketCount).count += 1;
  }
  return counts;
}

/** Ten 0.1-wide buckets over [0, 1]; 1.0 lands in the last one. */
export function relevanceHistogram(values: (number | null | undefined)[]): BucketCount[] {
  const buckets: Bucket[] = Array.from({ length: 10 }, (_, i) => ({
    label: `${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}`,
    min: i / 10,
    max: i === 9 ? Number.POSITIVE_INFINITY : (i + 1) / 10,
  }));
  return bucketize(
    values.filter((v): v is number => typeof v === 'number'),
    buckets,
  );
}

/** Case-insensitive substring match against `normalized_keyword`. */
export function matchCandidates(candidates: Candidate[], needles: string[]): Candidate[] {
  const terms = needles.map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (terms.length === 0) return [];
  return candidates.filter((c) => terms.some((t) => c.normalized_keyword.includes(t)));
}

/** Convert counts to fractions of their own total (0 when the total is 0). */
function shares(counts: Record<string, number>): Record<string, number> {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) out[k] = total === 0 ? 0 : v / total;
  return out;
}

function buildPool(candidates: Candidate[]): AuditPool {
  const relevance = candidates.map((c) => c.relevance_score);
  const difficulty = candidates.map((c) => c.difficulty);
  const volume = candidates.map((c) => c.search_volume);
  const present = (vs: (number | null)[]) => vs.filter((v): v is number => v !== null);

  return {
    total: candidates.length,
    by_source: countBy(candidates, (c) => c.source),
    by_status: countBy(candidates, (c) => c.status),
    by_rejection_reason: countBy(candidates, (c) => c.rejection_reason ?? NONE),
    relevance_score: {
      nulls: relevance.filter((v) => v === null).length,
      exact_zero: relevance.filter((v) => v === 0).length,
      stats: numericStats(relevance),
      histogram: relevanceHistogram(relevance),
    },
    opportunity_score: numericStats(candidates.map((c) => c.opportunity_score)),
    difficulty: {
      nulls: difficulty.filter((v) => v === null).length,
      exact_zero: difficulty.filter((v) => v === 0).length,
      one_to_45: present(difficulty).filter((v) => v >= 1 && v <= 45).length,
      above_45: present(difficulty).filter((v) => v > 45).length,
    },
    search_volume: {
      nulls: volume.filter((v) => v === null).length,
      zero: volume.filter((v) => v === 0).length,
      buckets: bucketize(present(volume), [
        { label: '1–100', min: 1, max: 101 },
        { label: '101–1000', min: 101, max: 1001 },
        { label: '1001–10000', min: 1001, max: 10001 },
        { label: '>10000', min: 10001, max: Number.POSITIVE_INFINITY },
      ]),
    },
    serp_validated: candidates.filter((c) => c.serp_competitors !== null).length,
  };
}

/**
 * Join each planner entry to its candidate. `candidate_id` is authoritative,
 * but pre-#99 entries have none — those fall back to the normalized keyword
 * (unique per org), which is the only way to recover relevance/source for a
 * legacy plan. The row records which path was used so neither is mistaken for
 * the other.
 */
function buildPlan(keywords: Keyword[], candidates: Candidate[]): AuditPlanRow[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const byNormalized = new Map(candidates.map((c) => [c.normalized_keyword, c]));
  return [...keywords]
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
    .map((k) => {
      const linked = k.candidate_id ? (byId.get(k.candidate_id) ?? null) : null;
      const candidate = linked ?? byNormalized.get(normalizeKeyword(k.keyword)) ?? null;
      return {
        scheduled_date: k.scheduled_date,
        keyword: k.keyword,
        search_volume: k.search_volume,
        difficulty: k.difficulty,
        opportunity_score: k.opportunity_score,
        article_type: k.article_type,
        relevance_score: candidate?.relevance_score ?? null,
        source: candidate?.source ?? null,
        candidate_join: linked ? 'candidate_id' : candidate ? 'normalized_keyword' : 'none',
        serp_validated: k.serp_competitors !== null,
      };
    });
}

export function buildStrategyAudit(input: {
  org: Org;
  candidates: Candidate[];
  keywords: Keyword[];
  needles: string[];
  /** Latest `strategy_runs` doc, for the plan-stage stats it carries. */
  run?: { stats?: Record<string, unknown> } | null;
}): StrategyAuditData {
  const { org, candidates, keywords, needles, run } = input;
  const pool = buildPool(candidates);
  const plan = buildPlan(keywords, candidates);

  const scored = candidates.filter((c) => c.relevance_score !== null).length;
  const backfill = plan.filter((r) => !r.serp_validated).length;
  const scheduledBySource = countBy(plan, (r) => r.source ?? NONE);
  const planStats = run?.stats?.plan as { pillars?: unknown; supports?: unknown } | undefined;
  const planTargets =
    typeof planStats?.pillars === 'number' && typeof planStats?.supports === 'number'
      ? { pillars: planStats.pillars, supports: planStats.supports }
      : null;

  const diagnostics: AuditDiagnostics = {
    backfill_count: backfill,
    backfill_fraction: plan.length === 0 ? 0 : backfill / plan.length,
    relevance_exact_zero: {
      scored,
      exact_zero: pool.relevance_score.exact_zero,
      fraction: scored === 0 ? 0 : pool.relevance_score.exact_zero / scored,
    },
    kd_zero_scheduled: plan.filter((r) => r.difficulty === 0).length,
    plan_targets: planTargets,
    scheduled_by_source: scheduledBySource,
    pool_source_share: shares(pool.by_source),
    scheduled_source_share: shares(scheduledBySource),
  };

  const competitors = org.presets?.audience.competitors ?? [];
  const notes = [
    'The candidate pool is the union of every strategy run for this org — if the job was re-run, the histograms are approximate.',
  ];
  if (!org.presets) notes.push('Org has no presets: the strategy job would have skipped entirely.');
  else if (competitors.length === 0) {
    notes.push(
      'presets.audience.competitors is EMPTY — the ranked_keywords branch of gather.ts is disabled, so no competitor-derived candidates exist.',
    );
  }
  const fallbackJoins = plan.filter((r) => r.candidate_join === 'normalized_keyword').length;
  if (fallbackJoins > 0) {
    notes.push(
      `${fallbackJoins} planner entr(ies) have no candidate_id (pre-#99) — their relevance_score/source came from a normalized-keyword match, shown as candidate_join=normalized_keyword.`,
    );
  }

  return {
    org: {
      id: org.id,
      website_url: org.website_url,
      plan: org.plan,
      strategy_status: org.strategy_status,
      setup_status: org.setup_status,
      business: org.presets
        ? {
            name: org.presets.business.name,
            country: org.presets.business.country,
            language: org.presets.business.language,
          }
        : null,
      audience_target: org.presets?.audience.target ?? [],
      competitors,
      competitors_empty: competitors.length === 0,
    },
    pool,
    plan,
    diagnostics,
    keyword_matches: matchCandidates(candidates, needles),
    notes,
  };
}

// ---- text rendering ----

const num = (v: number | null, digits = 2): string => (v === null ? '—' : v.toFixed(digits));
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

function counts(record: Record<string, number>, total: number): string[] {
  const entries = Object.entries(record).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return ['    (empty)'];
  return entries.map(
    ([k, v]) => `    ${k.padEnd(20)}${String(v).padStart(6)}  ${total === 0 ? '' : pct(v / total)}`,
  );
}

function statsLine(s: NumericStats, digits = 2): string {
  return `min ${num(s.min, digits)}  p25 ${num(s.p25, digits)}  median ${num(s.median, digits)}  p75 ${num(s.p75, digits)}  max ${num(s.max, digits)}`;
}

export function renderStrategyAudit(d: StrategyAuditData): string {
  const out: string[] = [];
  const rule = '─'.repeat(78);

  out.push(rule, `STRATEGY AUDIT — org ${d.org.id}`, rule, '');
  for (const note of d.notes) out.push(`! ${note}`);
  out.push('');

  out.push('ORG');
  out.push(`  website_url      ${d.org.website_url}`);
  out.push(`  plan             ${d.org.plan}`);
  out.push(`  strategy_status  ${d.org.strategy_status}`);
  out.push(`  setup_status     ${d.org.setup_status}`);
  if (d.org.business) {
    out.push(
      `  business         ${d.org.business.name} (${d.org.business.country} / ${d.org.business.language})`,
    );
  }
  out.push(
    `  audience.target  ${d.org.audience_target.length ? d.org.audience_target.join(' | ') : '(empty)'}`,
  );
  out.push(
    `  competitors      ${d.org.competitors_empty ? '(EMPTY — ranked_keywords branch disabled)' : d.org.competitors.join(' | ')}`,
  );
  out.push('');

  const p = d.pool;
  out.push(`CANDIDATE POOL — ${p.total} candidates, all statuses`);
  out.push('  by source');
  out.push(...counts(p.by_source, p.total));
  out.push('  by status');
  out.push(...counts(p.by_status, p.total));
  out.push('  by rejection_reason');
  out.push(...counts(p.by_rejection_reason, p.total));

  out.push('  relevance_score');
  out.push(
    `    null ${p.relevance_score.nulls}   exactly 0: ${p.relevance_score.exact_zero}   scored: ${p.relevance_score.stats.count}`,
  );
  out.push(`    ${statsLine(p.relevance_score.stats)}`);
  const maxBar = Math.max(1, ...p.relevance_score.histogram.map((b) => b.count));
  for (const b of p.relevance_score.histogram) {
    const bar = '#'.repeat(Math.round((b.count / maxBar) * 30));
    out.push(`    ${b.label.padEnd(10)}${String(b.count).padStart(6)}  ${bar}`);
  }

  out.push('  opportunity_score');
  out.push(`    null ${p.opportunity_score.nulls}   ${statsLine(p.opportunity_score)}`);

  out.push('  difficulty');
  out.push(
    `    null ${p.difficulty.nulls}   exactly 0: ${p.difficulty.exact_zero}   1–45: ${p.difficulty.one_to_45}   >45: ${p.difficulty.above_45}`,
  );

  out.push('  search_volume');
  out.push(
    `    null ${p.search_volume.nulls}   0: ${p.search_volume.zero}   ${p.search_volume.buckets
      .map((b) => `${b.label}: ${b.count}`)
      .join('   ')}`,
  );

  out.push(
    `  serp_competitors present: ${p.serp_validated} of ${p.total} (actually SERP-validated)`,
  );
  out.push('');

  out.push(`SCHEDULED PLAN — ${d.plan.length} entries`);
  if (d.plan.length === 0) {
    out.push('  (nothing scheduled)');
  } else {
    out.push(
      ...table(
        ['date', 'keyword', 'vol', 'kd', 'opp', 'article_type', 'rel', 'source', 'join', 'serp'],
        d.plan.map((r) => [
          r.scheduled_date,
          r.keyword,
          String(r.search_volume),
          String(r.difficulty),
          num(r.opportunity_score),
          r.article_type ?? '—',
          num(r.relevance_score),
          r.source ?? '—',
          r.candidate_join === 'candidate_id' ? 'id' : r.candidate_join === 'none' ? '—' : 'kw',
          r.serp_validated ? 'yes' : 'NO',
        ]),
        new Set([2, 3, 4, 6]),
      ).map((l) => `  ${l}`),
    );
  }
  out.push('');

  const g = d.diagnostics;
  out.push('DIAGNOSTICS');
  out.push(
    `  backfill_count                 ${g.backfill_count} of ${d.plan.length} (${pct(g.backfill_fraction)}) scheduled entries have serp_competitors == null`,
  );
  out.push(
    '      → these bypassed SERP validation entirely: the pipeline keeps below-top-N candidates with rejection_reason null, and strategy.ts schedules them when fewer than 30 validated candidates survive.',
  );
  out.push(
    `  relevance_exact_zero_fraction  ${g.relevance_exact_zero.exact_zero} of ${g.relevance_exact_zero.scored} scored (${pct(g.relevance_exact_zero.fraction)}) score EXACTLY 0`,
  );
  out.push(
    '      → parseRelevance seeds every keyword to 0 and only overwrites on an EXACT string match of the keyword the LLM echoes back, so a high fraction points at a truncated or re-cased LLM response rather than genuinely irrelevant keywords.',
  );
  out.push(`  kd_zero_scheduled              ${g.kd_zero_scheduled} of ${d.plan.length}`);
  out.push(
    `  plan_targets                   ${
      g.plan_targets
        ? `${g.plan_targets.pillars} pillars / ${g.plan_targets.supports} supports`
        : '(no strategy run)'
    }`,
  );
  if (g.plan_targets && g.plan_targets.supports === 0 && g.plan_targets.pillars > 0) {
    out.push(
      '      → 0 supports: the plan judge collapsed every cluster to a single article (#294).',
    );
  }
  out.push('  source distribution (pool vs scheduled plan)');
  const sources = [
    ...new Set([...Object.keys(g.pool_source_share), ...Object.keys(g.scheduled_source_share)]),
  ];
  out.push(
    ...table(
      ['source', 'pool', 'plan'],
      sources.map((s) => [
        s,
        pct(g.pool_source_share[s] ?? 0),
        pct(g.scheduled_source_share[s] ?? 0),
      ]),
      new Set([1, 2]),
    ).map((l) => `    ${l}`),
  );

  if (d.keyword_matches.length > 0) {
    out.push('', `KEYWORD MATCHES — ${d.keyword_matches.length} candidate(s)`);
    out.push(JSON.stringify(d.keyword_matches, null, 2));
  }

  return `${out.join('\n')}\n`;
}
