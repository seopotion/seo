/**
 * `db strategy-dryrun` (#211). Providers are faked the way
 * packages/shared/keywords/tests/pipeline.test.ts does, so the real pipeline
 * runs end to end without touching a network or a database.
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EnrichedCandidate } from '@shared/keywords';
import type { DataForSeoClient, KeywordMetric, LlmClient, SerpResult } from '@shared/providers';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  renderStrategyDryRun,
  simulatePlan,
  sourceFunnel,
  splitSections,
} from '../src/lib/strategy-dryrun';
import type { StrategyDryRunData } from '../src/types';

const metric = (keyword: string, over: Partial<KeywordMetric> = {}): KeywordMetric => ({
  keyword,
  core_keyword: null,
  category_ids: [],
  search_volume: 100,
  difficulty: 20,
  cpc: null,
  competition: null,
  trend: null,
  intent: null,
  ...over,
});

const serp = (domains: string[]): SerpResult[] =>
  domains.map((d, i) => ({ rank: i + 1, url: `https://${d}/p${i}`, domain: d, title: `t${i}` }));

const org = {
  id: 'org_1',
  user_id: 'u_1',
  website_url: 'https://acme.io',
  setup_status: 'setup_complete',
  plan: 'paid',
  strategy_status: 'completed',
  presets: {
    business: {
      name: 'Acme',
      language: 'English',
      country: 'United States',
      description: 'pet food',
    },
    audience: { target: ['dog owners'], competitors: ['comp.com'] },
    blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
    article_preferences: {
      content_seo: {
        article_style: '',
        internal_links_count: 0,
        table_of_contents: true,
        llm_instructions: '',
      },
      engagement: { image_style: '', include_cta: true, youtube_videos: true },
      publishing: { auto_publish: false },
    },
  },
  created_at: new Date(),
};

const { db, providerCalls, findById } = vi.hoisted(() => {
  const providerCalls = { dataforseo: 0, llm: 0 };
  const noop = async () => {};
  return {
    providerCalls,
    findById: vi.fn(async (): Promise<unknown> => null),
    db: {
      // Reads the dry run is allowed to make.
      closeDb: vi.fn(noop),
      // Everything that writes. None of these may be called.
      ensureIndexes: vi.fn(noop),
      runMigrations: vi.fn(noop),
      addCandidates: vi.fn(async () => []),
      scheduleCandidate: vi.fn(async () => ({ ok: false })),
      setPlan: vi.fn(async () => true),
      setStrategyStatus: vi.fn(noop),
      claimStrategy: vi.fn(async () => true),
      deleteByOrgId: vi.fn(async () => 0),
      deleteById: vi.fn(async () => true),
    },
  };
});

vi.mock('@shared/db', () => {
  const orgRepo = {
    findById,
    setPlan: db.setPlan,
    setStrategyStatus: db.setStrategyStatus,
    claimStrategy: db.claimStrategy,
    findByUserId: vi.fn(async () => []),
    deleteById: db.deleteById,
  };
  const collection = {
    listByOrg: vi.fn(async () => ({ candidates: [], articles: [] })),
    deleteByOrgId: db.deleteByOrgId,
  };
  return {
    closeDb: db.closeDb,
    ensureIndexes: db.ensureIndexes,
    runMigrations: db.runMigrations,
    addCandidates: db.addCandidates,
    scheduleCandidate: db.scheduleCandidate,
    OrgRepo: orgRepo,
    UserRepo: { findByEmail: vi.fn(async () => null), deleteById: db.deleteById },
    CandidateRepo: collection,
    KeywordRepo: { ...collection, listByOrg: vi.fn(async () => []) },
    ArticleRepo: collection,
    GscConnectionRepo: { deleteByOrgId: vi.fn(async () => true) },
    SubscriptionRepo: { ...collection, listActiveByOrg: vi.fn(async () => []) },
  };
});

vi.mock('@shared/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/providers')>()),
  resolveProviderSecret: vi.fn(async () => 'secret'),
  createDataForSeoClient: (): DataForSeoClient =>
    ({
      keywordsForSite: async () => {
        providerCalls.dataforseo++;
        return [metric('cheap dog food', { search_volume: 900 })];
      },
      rankedKeywords: async () => {
        providerCalls.dataforseo++;
        return [metric('dog food delivery', { search_volume: 400 })];
      },
      // Retired from gather in #211 — present only to satisfy the client type.
      keywordIdeas: async () => [],
      keywordSuggestions: async () => {
        providerCalls.dataforseo++;
        return [
          metric('acme login', { difficulty: 5 }),
          metric('premium dog food', { difficulty: 90 }),
          metric('dog food storage', { search_volume: 10 }),
        ];
      },
      bulkKeywordDifficulty: async () => {
        providerCalls.dataforseo++;
        return [];
      },
      serpGoogleOrganic: async ({ keyword }) => {
        providerCalls.dataforseo++;
        const slug = keyword.replace(/\s/g, '');
        return serp([`${slug}-a.com`, `${slug}-b.com`, `${slug}-c.com`]);
      },
      backlinksSummary: async () => {
        providerCalls.dataforseo++;
        return { rank: null };
      },
    }) as DataForSeoClient,
  createOpenRouterClient: (): LlmClient => ({
    complete: async ({ messages }) => {
      providerCalls.llm++;
      const sys = messages[0]?.content ?? '';
      let text = '{}';
      if (sys.includes('seed keywords')) text = '{"seeds":["dog food"]}';
      // Deliberately partial: "dog food storage" is never scored, so it keeps
      // parseRelevance's 0 seed — the failure this command exists to measure.
      else if (sys.includes('Score each keyword'))
        text =
          '{"scores":[{"keyword":"cheap dog food","relevance":0.9},{"keyword":"dog food delivery","relevance":0.8}]}';
      else if (sys.includes('building a content plan')) {
        // The single plan call (#56): judges intent/locality/article-type and
        // groups accepted candidates into targets in one response. One verdict
        // per finalist index, all grouped into a single cluster with the first
        // index as the pillar — mirrors the old SERP-judge + classify +
        // topic-cluster mocks this replaces.
        const indices = (messages.at(-1)?.content ?? '')
          .split('\n')
          .filter((line) => line.startsWith('{"index":'))
          .map((line) => (JSON.parse(line) as { index: number }).index);
        text = JSON.stringify({
          verdicts: indices.map((index) => ({
            index,
            intent_ok: true,
            locality_ok: true,
            article_type: 'listicle',
          })),
          targets: indices.map((index, i) => ({
            cluster: 'Dog food',
            member_indices: [index],
            content_focus: `Dog food target ${index}`,
            is_pillar: i === 0,
          })),
        });
      }
      return {
        text,
        model: 'm',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
      };
    },
  }),
}));

const { strategyDryRun } = await import('../src/lib/db');

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'strategy-dryrun-'));
  providerCalls.dataforseo = 0;
  providerCalls.llm = 0;
  findById.mockResolvedValue(org);
});

afterEach(() => {
  vi.clearAllMocks();
});

/** The parts of two runs that must match; mode/notes/paths differ by design. */
const substance = (d: StrategyDryRunData) => ({
  stats: d.stats,
  relevance: d.relevance,
  sections: d.sections,
  config: d.config,
  // scheduled_date is stamped from "today", which is not part of the pipeline's output.
  plan: d.plan.map(({ scheduled_date: _date, ...rest }) => rest),
});

const unwrap = <T>(r: { ok: true; data: T } | { ok: false; error: { message: string } }): T => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error.message}`);
  return r.data;
};

describe('strategyDryRun', () => {
  test('records a snapshot, then replays it to the same report with no network calls', async () => {
    const path = join(dir, 'snap.json');

    const live = unwrap(await strategyDryRun({ org: 'org_1', serpTopN: 1, snapshotPath: path }));
    expect(live.mode).toBe('live');
    expect(providerCalls.dataforseo).toBeGreaterThan(0);
    expect(providerCalls.llm).toBeGreaterThan(0);

    providerCalls.dataforseo = 0;
    providerCalls.llm = 0;
    const replayed = unwrap(await strategyDryRun({ org: 'org_1', serpTopN: 1, replayPath: path }));

    expect(replayed.mode).toBe('replay');
    expect(substance(replayed)).toEqual(substance(live));
    expect(providerCalls).toEqual({ dataforseo: 0, llm: 0 });
    expect(replayed.snapshot.config_drift).toEqual([]);
  });

  test('replays without --org: the snapshot names the org it was recorded for', async () => {
    const path = join(dir, 'snap.json');
    unwrap(await strategyDryRun({ org: 'org_1', serpTopN: 1, snapshotPath: path }));

    const replayed = unwrap(await strategyDryRun({ serpTopN: 1, replayPath: path }));
    expect(replayed.org.id).toBe('org_1');
    expect(findById).toHaveBeenLastCalledWith('org_1');
  });

  test('--allow-live-misses fetches only what the snapshot lacks and folds it back in', async () => {
    const path = join(dir, 'snap.json');
    unwrap(await strategyDryRun({ org: 'org_1', serpTopN: 1, snapshotPath: path }));

    // Drop one SERP call, standing in for a code change that sends a different
    // keyword to validation: replay must miss on exactly that call.
    const recorded = JSON.parse(await readFile(path, 'utf8'));
    const kept = recorded.dataforseo.filter(
      (c: { method: string }) => c.method !== 'serpGoogleOrganic',
    );
    const dropped = recorded.dataforseo.length - kept.length;
    expect(dropped).toBe(1);
    await writeFile(path, JSON.stringify({ ...recorded, dataforseo: kept }), 'utf8');

    providerCalls.dataforseo = 0;
    providerCalls.llm = 0;
    const topped = unwrap(
      await strategyDryRun({ serpTopN: 1, replayPath: path, allowLiveMisses: true }),
    );

    expect(topped.snapshot.live_misses).toEqual({ dataforseo: 1, llm: 0 });
    expect(providerCalls).toEqual({ dataforseo: 1, llm: 0 });

    // The enlarged snapshot is written back, so the next replay needs no network.
    const merged = JSON.parse(await readFile(path, 'utf8'));
    expect(merged.dataforseo).toHaveLength(recorded.dataforseo.length);
    providerCalls.dataforseo = 0;
    const clean = unwrap(await strategyDryRun({ serpTopN: 1, replayPath: path }));
    expect(providerCalls).toEqual({ dataforseo: 0, llm: 0 });
    expect(substance(clean)).toEqual(substance(topped));
  });

  test('rejects --allow-live-misses without --replay', async () => {
    const result = await strategyDryRun({ org: 'org_1', allowLiveMisses: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('BAD_ARGS');
  });

  test('reports relevance coverage, the below-N tier and an under-filled plan', async () => {
    const report = unwrap(await strategyDryRun({ org: 'org_1', serpTopN: 1 }));

    // Three candidates reach relevance; the LLM only scored two of them.
    expect(report.relevance).toMatchObject({ sent: 3, returned: 2, missing: 1 });
    // Nothing was scored 0 — the unscored one is null, which `zero` excludes.
    expect(report.stats.relevance.zero).toBe(0);
    expect(report.stats.relevance).toMatchObject({ batches: 1, failedBatches: 0 });

    expect(report.sections.accepted.map((c) => c.keyword)).toEqual(['cheap dog food']);
    // "dog food storage" was never scored, so it carries a NULL relevance and the
    // floor leaves it alone — it just ranks low and lands below serpTopN. Seeding
    // it to 0 instead is what let an empty response delete the whole pool (#211).
    expect(report.sections.below_n.map((c) => c.keyword)).toEqual([
      'dog food delivery',
      'dog food storage',
    ]);
    expect(
      report.sections.below_n.find((c) => c.keyword === 'dog food storage')?.relevance_score,
    ).toBeNull();
    expect(report.sections.rejected.map((g) => g.reason).sort()).toEqual([
      'brand_navigation',
      'difficulty_ceiling',
    ]);
    // Nothing unvalidated is planned; the plan is short rather than padded.
    expect(report.plan.map((r) => r.keyword)).toEqual(['cheap dog food']);
    expect(report.plan.filter((r) => r.from_below_n)).toEqual([]);
    expect(report.notes.join(' ')).toContain('under-filled');
  });

  test('shows semantic cluster and role in structured and rendered plan output', async () => {
    const report = unwrap(await strategyDryRun({ org: 'org_1', serpTopN: 1 }));

    expect(report.plan[0]).toMatchObject({
      keyword: 'cheap dog food',
      topic_cluster_id: 'topic:cheap dog food',
      topic_cluster_label: 'Dog food',
      topic_role: 'pillar',
    });
    const rendered = renderStrategyDryRun(report);
    expect(rendered).toContain('cluster');
    expect(rendered).toContain('Dog food');
    expect(rendered).toContain('pillar');
    expect(rendered).toContain('accepted-pool classification diagnostic only');
    expect(rendered).not.toContain('clusterSpreadSchedule');
  });

  // Uniform `other` was indistinguishable from a real judgement until these
  // counters existed — the clewas run's classify call returned an empty body and
  // silently typed all 78 accepts `other` (#211).
  test('reports plan coverage (verdicts, targets, clusters) and article_type diagnostics', async () => {
    const report = unwrap(await strategyDryRun({ org: 'org_1', serpTopN: 1 }));

    expect(report.stats.plan).toMatchObject({
      finalists: 1,
      verdicts: 1,
      unjudged: 0,
      accepted: 1,
      targets: 1,
      clusters: 1,
      singletons: 0,
      duplicates: 0,
      pillars: 1,
      supports: 0,
      repairRetried: false,
    });
    expect(report.stats).toMatchObject({
      serpChecked: 1,
      serpValidated: 1,
      accepted: 1,
    });
    expect(report.article_types).toEqual([{ article_type: 'listicle', count: 1 }]);
    // Full coverage, so neither degradation note fires.
    expect(report.notes.join(' ')).not.toContain('never got a verdict');
    expect(report.notes.join(' ')).not.toContain('repaired');
  });

  test('replay fails loudly when the snapshot is missing a call', async () => {
    const path = join(dir, 'snap.json');
    unwrap(await strategyDryRun({ org: 'org_1', serpTopN: 1, snapshotPath: path }));

    const snapshot = JSON.parse(await readFile(path, 'utf8'));
    snapshot.dataforseo = snapshot.dataforseo.filter(
      (c: { method: string }) => c.method !== 'serpGoogleOrganic',
    );
    await writeFile(path, JSON.stringify(snapshot), 'utf8');

    const result = await strategyDryRun({ org: 'org_1', serpTopN: 1, replayPath: path });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PIPELINE_FAILED');
    expect(result.error.message).toContain('no recorded DataForSEO serpGoogleOrganic call');
    expect(result.error.suggestion).toContain('re-record');
  });

  test('warns when the snapshot was recorded with a different config', async () => {
    const path = join(dir, 'snap.json');
    unwrap(await strategyDryRun({ org: 'org_1', serpTopN: 1, snapshotPath: path }));

    // Stand in for a config default changing under an otherwise valid snapshot:
    // the provider calls still match, but the run is no longer the recorded one.
    const snapshot = JSON.parse(await readFile(path, 'utf8'));
    snapshot.config.difficultyCeiling = 30;
    await writeFile(path, JSON.stringify(snapshot), 'utf8');

    const replayed = unwrap(await strategyDryRun({ org: 'org_1', serpTopN: 1, replayPath: path }));
    expect(replayed.snapshot.config_drift).toEqual(['difficultyCeiling: recorded 30 → now 45']);
    expect(replayed.notes.join(' ')).toContain('differs from the snapshot');
  });

  test('writes nothing to Mongo', async () => {
    unwrap(await strategyDryRun({ org: 'org_1', serpTopN: 1 }));

    for (const [name, spy] of Object.entries(db)) {
      if (name === 'closeDb') continue;
      expect(spy, `${name} must not be called by a dry run`).not.toHaveBeenCalled();
    }
    expect(findById).toHaveBeenCalledWith('org_1');
    expect(db.closeDb).toHaveBeenCalled();
  });

  // Item 4 of #211: without a pinned seed list the seed LLM swings `gathered`
  // +/-40% between identical runs, and no A/B on this pipeline is falsifiable.
  test('--seeds bypasses the seed LLM and records the seeds it actually used', async () => {
    const path = join(dir, 'snap.json');
    providerCalls.llm = 0;
    const report = unwrap(
      await strategyDryRun({
        org: 'org_1',
        serpTopN: 1,
        seeds: ['pinned seed'],
        snapshotPath: path,
      }),
    );

    expect(report.stats.seeds).toEqual(['pinned seed']);
    expect(report.config.seeds).toEqual(['pinned seed']);
    // Pinning removes the seed stage while leaving relevance, SERP, classify, and topic assignment.
    const unpinned = unwrap(await strategyDryRun({ org: 'org_1', serpTopN: 1 }));
    expect(unpinned.stats.seeds).toEqual(['dog food']);

    // The file documents its own inputs, so a recorded run stays interpretable.
    expect(JSON.parse(await readFile(path, 'utf8')).seeds).toEqual(['pinned seed']);
  });

  test('records the LLM-generated seeds in the snapshot too', async () => {
    const path = join(dir, 'snap.json');
    unwrap(await strategyDryRun({ org: 'org_1', serpTopN: 1, snapshotPath: path }));
    expect(JSON.parse(await readFile(path, 'utf8')).seeds).toEqual(['dog food']);
  });

  // The A/B would be meaningless otherwise: same prompt, different model, and
  // replay would hand back the first model's recorded answer as the second's.
  test('a per-stage model override is part of the snapshot cache key', async () => {
    const path = join(dir, 'snap.json');
    unwrap(await strategyDryRun({ org: 'org_1', serpTopN: 1, snapshotPath: path }));
    const baseline = JSON.parse(await readFile(path, 'utf8'));
    const baselinePlan = baseline.llm.find((c: { messages: { content: string }[] }) =>
      c.messages[0]!.content.includes('building a content plan'),
    );
    expect(baselinePlan.model).toBe('anthropic/claude-haiku-4.5');
    expect(
      baseline.llm
        .filter((c: { messages: { content: string }[] }) => c !== baselinePlan)
        .every((c: { model?: string }) => c.model === undefined),
    ).toBe(true);

    // Same org, same prompts, different plan model — the plan call must MISS
    // rather than replay Haiku's body.
    const result = await strategyDryRun({
      org: 'org_1',
      serpTopN: 1,
      replayPath: path,
      models: { plan: 'z-ai/glm-5.2' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('model z-ai/glm-5.2');

    // Recorded under the override, the two models' answers coexist in one file.
    const abPath = join(dir, 'ab.json');
    unwrap(
      await strategyDryRun({
        org: 'org_1',
        serpTopN: 1,
        snapshotPath: abPath,
        models: { plan: 'z-ai/glm-5.2' },
      }),
    );
    const ab = JSON.parse(await readFile(abPath, 'utf8'));
    const plan = ab.llm.filter((c: { model?: string }) => c.model === 'z-ai/glm-5.2');
    expect(plan).toHaveLength(1);
    expect(plan[0].key).not.toBe(baselinePlan.key);
  });

  test('rejects --snapshot together with --replay', async () => {
    const result = await strategyDryRun({ org: 'org_1', snapshotPath: 'a', replayPath: 'b' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('BAD_ARGS');
  });
});

// ---- pure helpers ----

const candidate = (over: Partial<EnrichedCandidate>): EnrichedCandidate => ({
  org_id: 'org_1',
  keyword: 'dog food',
  source: 'keyword_ideas',
  source_context: null,
  core_keyword: null,
  category_ids: [],
  topic_cluster_id: null,
  topic_cluster_label: null,
  topic_role: null,
  topic_content_focus: null,
  topic_primary_keyword: null,
  search_volume: 100,
  difficulty: 20,
  cpc: null,
  competition: null,
  trend: null,
  intent: null,
  relevance_score: 0.5,
  opportunity_score: 50,
  article_type: null,
  rejection_reason: null,
  status: 'candidate',
  serp_competitors: null,
  serp_validated: false,
  ...over,
});

describe('splitSections', () => {
  test('empty input yields three empty tiers', () => {
    expect(splitSections([])).toEqual({ accepted: [], below_n: [], rejected: [] });
  });

  test('separates validated accepts from the below-N tier and groups rejects', () => {
    const sections = splitSections([
      candidate({ keyword: 'a', serp_validated: true, opportunity_score: 90 }),
      candidate({ keyword: 'b', opportunity_score: 80 }),
      candidate({ keyword: 'c', rejection_reason: 'serp_intent' }),
      candidate({ keyword: 'd', rejection_reason: 'serp_intent' }),
      candidate({ keyword: 'e', rejection_reason: 'brand_navigation' }),
    ]);
    expect(sections.accepted.map((c) => c.keyword)).toEqual(['a']);
    expect(sections.below_n.map((c) => c.keyword)).toEqual(['b']);
    // Largest group first.
    expect(sections.rejected.map((g) => [g.reason, g.candidates.length])).toEqual([
      ['serp_intent', 2],
      ['brand_navigation', 1],
    ]);
  });
});

describe('sourceFunnel', () => {
  const empty = {
    keywords_for_site: 0,
    ranked_keywords: 0,
    keyword_ideas: 0,
    keyword_suggestions: 0,
    serp: 0,
    manual: 0,
    seed: 0,
  } as const;

  test('reports what dedupe dropped per source, busiest first', () => {
    const rows = sourceFunnel(
      [
        candidate({ keyword: 'a', source: 'keywords_for_site' }),
        candidate({ keyword: 'b', source: 'keyword_suggestions' }),
        candidate({ keyword: 'c', source: 'keyword_suggestions' }),
      ],
      { ...empty, keywords_for_site: 5, keyword_suggestions: 3 },
    );
    expect(rows).toEqual([
      { source: 'keywords_for_site', gathered: 5, after_dedupe: 1 },
      { source: 'keyword_suggestions', gathered: 3, after_dedupe: 2 },
    ]);
  });

  test('omits sources that contributed nothing', () => {
    expect(sourceFunnel([], empty)).toEqual([]);
  });
});

describe('simulatePlan', () => {
  const start = new Date('2026-08-11T00:00:00.000Z');

  test('empty input plans nothing', () => {
    expect(simulatePlan([], start)).toEqual([]);
  });

  const validated = (over: Partial<EnrichedCandidate>): EnrichedCandidate =>
    candidate({
      serp_validated: true,
      topic_cluster_id: `topic:${(over.keyword ?? 'dog food').trim().toLowerCase()}`,
      topic_cluster_label: `${over.keyword ?? 'dog food'} cluster`,
      topic_role: 'pillar',
      topic_content_focus: `${over.keyword ?? 'dog food'} focus`,
      topic_primary_keyword: over.keyword ?? 'dog food',
      ...over,
    });

  test('skips rejects and candidates missing metrics, ranks by opportunity', () => {
    const plan = simulatePlan(
      [
        validated({ keyword: 'low', opportunity_score: 10 }),
        validated({ keyword: 'high', opportunity_score: 90 }),
        validated({ keyword: 'rejected', opportunity_score: 99, rejection_reason: 'serp_intent' }),
        validated({ keyword: 'no volume', opportunity_score: 95, search_volume: null }),
        validated({ keyword: 'no kd', opportunity_score: 95, difficulty: null }),
      ],
      start,
    );
    expect(plan.map((r) => r.keyword)).toEqual(['high', 'low']);
    expect(plan.map((r) => r.scheduled_date)).toEqual(['2026-08-11', '2026-08-12']);
  });

  test('plans only SERP-validated candidates, under-filling rather than backfilling', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      i < 5
        ? validated({
            keyword: `k${String(i).padStart(2, '0')}`,
            opportunity_score: 100 - i,
          })
        : candidate({
            keyword: `k${String(i).padStart(2, '0')}`,
            opportunity_score: 100 - i,
          }),
    );
    const plan = simulatePlan(many, start);
    expect(plan.map((r) => r.keyword)).toEqual(['k00', 'k01', 'k02', 'k03', 'k04']);
    expect(plan.filter((r) => r.from_below_n)).toEqual([]);
  });

  test('caps at 30 days when more than PLAN_DAYS candidates qualify', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      validated({ keyword: `k${String(i).padStart(2, '0')}`, opportunity_score: 100 - i }),
    );
    expect(simulatePlan(many, start)).toHaveLength(30);
  });

  test('uses pillar-first, cluster-priority, round-robin order without article-type spreading', () => {
    const topic = (
      keyword: string,
      score: number,
      clusterId: string,
      role: 'pillar' | 'support',
      articleType: EnrichedCandidate['article_type'],
    ) =>
      validated({
        keyword,
        opportunity_score: score,
        topic_cluster_id: clusterId,
        topic_cluster_label: clusterId.toUpperCase(),
        topic_role: role,
        topic_content_focus: `${keyword} focus`,
        topic_primary_keyword: keyword,
        article_type: articleType,
      });
    const plan = simulatePlan(
      [
        topic('A support', 100, 'topic:a', 'support', 'how_to_guide'),
        topic('B support', 80, 'topic:b', 'support', 'listicle'),
        topic('A pillar', 10, 'topic:a', 'pillar', 'comparison'),
        topic('B pillar', 90, 'topic:b', 'pillar', 'comparison'),
      ],
      start,
    );

    expect(plan.map((row) => row.keyword)).toEqual([
      'A pillar',
      'B pillar',
      'A support',
      'B support',
    ]);
    expect(plan.map((row) => row.scheduled_date)).toEqual([
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
    ]);
    expect(plan.map((row) => row.topic_role)).toEqual(['pillar', 'pillar', 'support', 'support']);
  });

  test('excludes topic duplicates and below-N rows while preserving under-fill', () => {
    const primary = validated({ keyword: 'Primary' });
    const duplicate = candidate({
      keyword: 'Primary variant',
      serp_validated: true,
      rejection_reason: 'topic_duplicate',
      status: 'rejected',
      topic_cluster_id: primary.topic_cluster_id,
      topic_cluster_label: primary.topic_cluster_label,
      topic_role: primary.topic_role,
      topic_content_focus: primary.topic_content_focus,
      topic_primary_keyword: primary.keyword,
    });

    expect(simulatePlan([primary, duplicate, candidate({ keyword: 'Below N' })], start)).toEqual([
      expect.objectContaining({ keyword: 'Primary', topic_role: 'pillar' }),
    ]);
  });
});
