import type {
  ArticleRunWorking,
  CreateArticleRunInput,
  CreateStrategyRunInput,
  StageState,
  WorkingCandidate,
} from '@shared/schemas';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { ensureIndexes } from '../src/ensure-indexes';
import { ArticleRunRepo } from '../src/repositories/article-run.repo';
import { StrategyRunRepo } from '../src/repositories/strategy-run.repo';

/**
 * Real-MongoDB round-trip. Run with `npm run test:integration` after
 * `docker compose up -d mongo`.
 */
describe('StrategyRunRepo (integration)', () => {
  const presets = {
    business: {
      name: 'Acme',
      language: 'en',
      country: 'US',
      description: 'Widgets',
    },
    audience: { target: [], competitors: [] },
    blog: {
      sitemap_url: 'https://acme.example/sitemap.xml',
      main_blog_url: 'https://acme.example/blog',
      best_articles: [],
    },
    article_preferences: {
      content_seo: {
        article_style: 'informative',
        llm_instructions: 'Be concise.',
      },
      engagement: { image_style: 'photo' },
    },
  };

  function makeInput(orgId: string): CreateStrategyRunInput {
    return {
      org_id: orgId,
      status: 'running',
      input: {
        website_url: 'https://acme.example',
        presets,
        existing_keywords: [],
      },
    };
  }

  const workingCandidate: WorkingCandidate = {
    keyword: 'best seo tools',
    normalized: 'best seo tools',
    source: 'manual',
    source_context: null,
    core_keyword: null,
    category_ids: [],
    topic_cluster_id: null,
    topic_cluster_label: null,
    topic_role: null,
    topic_content_focus: null,
    topic_primary_keyword: null,
    search_volume: null,
    difficulty: null,
    cpc: null,
    competition: null,
    trend: null,
    intent: null,
    relevance_score: null,
    opportunity_score: null,
    article_type: null,
    rejection_reason: null,
    status: 'candidate',
    serp_competitors: [],
    serp_validated: false,
  };

  beforeAll(async () => {
    const db = await getDb();
    await db.collection('strategy_runs').deleteMany({});
    await ensureIndexes();
  });

  afterAll(async () => {
    await closeDb();
  });

  test('create + findById round-trip through Zod', async () => {
    const created = await StrategyRunRepo.create(makeInput('org_strategy_run'));
    expect(created.id).toMatch(/^[a-f0-9]{24}$/);
    expect(created.org_id).toBe('org_strategy_run');
    expect(created.status).toBe('running');
    expect(created.candidates).toEqual([]);
    expect(created.stages).toEqual({});
    expect(created.created_at).toBeInstanceOf(Date);

    const found = await StrategyRunRepo.findById(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.input.website_url).toBe('https://acme.example');
    expect(await StrategyRunRepo.findById('not-an-object-id')).toBeNull();
    expect(await StrategyRunRepo.findById('ffffffffffffffffffffffff')).toBeNull();
  });

  test('saveStageResult persists working state + stage meta', async () => {
    const run = await StrategyRunRepo.create(makeInput('org_strategy_run'));
    const startedAt = new Date();
    const finishedAt = new Date();

    await StrategyRunRepo.saveStageResult(
      run.id,
      'gather',
      {
        candidates: [workingCandidate],
        below_n: [],
        rejected: [],
        seeds: ['seo'],
        stats: { total_found: 1 },
      },
      {
        status: 'completed',
        started_at: startedAt,
        finished_at: finishedAt,
        stats: {},
        error: null,
      },
    );

    const reloaded = await StrategyRunRepo.findById(run.id);
    expect(reloaded!.candidates).toHaveLength(1);
    expect(reloaded!.candidates[0]!.keyword).toBe('best seo tools');
    expect(reloaded!.seeds).toEqual(['seo']);
    expect(reloaded!.stats).toEqual({ total_found: 1 });
    expect(reloaded!.stages.gather).toEqual({
      status: 'completed',
      started_at: startedAt,
      finished_at: finishedAt,
      stats: {},
      error: null,
    });
    expect(reloaded!.updated_at.getTime()).toBeGreaterThanOrEqual(run.updated_at.getTime());
  });

  test('saveStageResult on an already-completed stage is fenced and leaves the doc unchanged (final-review finding 2)', async () => {
    const run = await StrategyRunRepo.create(makeInput('org_strategy_run'));
    const startedAt = new Date();
    const finishedAt = new Date();

    await StrategyRunRepo.saveStageResult(
      run.id,
      'gather',
      {
        candidates: [workingCandidate],
        below_n: [],
        rejected: [],
        seeds: ['seo'],
        stats: { total_found: 1 },
      },
      {
        status: 'completed',
        started_at: startedAt,
        finished_at: finishedAt,
        stats: {},
        error: null,
      },
    );
    const completed = await StrategyRunRepo.findById(run.id);

    // A stale writer (e.g. a zombie Lambda whose SFN taskTimeout already fired,
    // still running to completion after a retry already succeeded) tries to
    // overwrite the already-completed stage with different working state.
    await StrategyRunRepo.saveStageResult(
      run.id,
      'gather',
      {
        candidates: [],
        below_n: [],
        rejected: [],
        seeds: ['stale-writer'],
        stats: { total_found: 999 },
      },
      {
        status: 'completed',
        started_at: new Date(),
        finished_at: new Date(),
        stats: { stale: true },
        error: null,
      },
    );

    const reloaded = await StrategyRunRepo.findById(run.id);
    expect(reloaded).toEqual(completed);
  });

  test('markStageFailed stamps stage meta without touching working state', async () => {
    const run = await StrategyRunRepo.create(makeInput('org_strategy_run'));
    await StrategyRunRepo.saveStageResult(
      run.id,
      'gather',
      {
        candidates: [workingCandidate],
        below_n: [],
        rejected: [],
        seeds: ['seo'],
        stats: { total_found: 1 },
      },
      {
        status: 'completed',
        started_at: new Date(),
        finished_at: new Date(),
        stats: {},
        error: null,
      },
    );

    const startedAt = new Date();
    const finishedAt = new Date();
    await StrategyRunRepo.markStageFailed(run.id, 'enrich', {
      status: 'failed',
      started_at: startedAt,
      finished_at: finishedAt,
      stats: {},
      error: 'boom',
    });

    const reloaded = await StrategyRunRepo.findById(run.id);
    expect(reloaded!.stages.enrich).toEqual({
      status: 'failed',
      started_at: startedAt,
      finished_at: finishedAt,
      stats: {},
      error: 'boom',
    });
    // Working state from the earlier successful stage is untouched.
    expect(reloaded!.candidates).toHaveLength(1);
    expect(reloaded!.seeds).toEqual(['seo']);
    expect(reloaded!.stages.gather?.status).toBe('completed');
  });

  test('setStatus flips status', async () => {
    const run = await StrategyRunRepo.create(makeInput('org_strategy_run'));
    await StrategyRunRepo.setStatus(run.id, 'completed');
    const reloaded = await StrategyRunRepo.findById(run.id);
    expect(reloaded!.status).toBe('completed');
  });

  test('latestByOrg returns the newest of two runs', async () => {
    const orgId = 'org_strategy_run_latest';
    const first = await StrategyRunRepo.create(makeInput(orgId));
    await new Promise((r) => setTimeout(r, 5));
    const second = await StrategyRunRepo.create(makeInput(orgId));

    const latest = await StrategyRunRepo.latestByOrg(orgId);
    expect(latest!.id).toBe(second.id);
    expect(latest!.id).not.toBe(first.id);
    expect(await StrategyRunRepo.latestByOrg('org_with_no_runs')).toBeNull();
  });

  test('mutators are a silent no-op for an invalid id', async () => {
    const invalidId = 'not-an-object-id';
    const meta: StageState = {
      status: 'failed',
      started_at: new Date(),
      finished_at: new Date(),
      stats: {},
      error: 'boom',
    };
    await expect(
      StrategyRunRepo.saveStageResult(
        invalidId,
        'gather',
        { candidates: [], below_n: [], rejected: [], seeds: [], stats: {} },
        meta,
      ),
    ).resolves.toBeUndefined();
    await expect(
      StrategyRunRepo.markStageFailed(invalidId, 'gather', meta),
    ).resolves.toBeUndefined();
    await expect(StrategyRunRepo.setStatus(invalidId, 'completed')).resolves.toBeUndefined();
  });
});

describe('ArticleRunRepo (integration)', () => {
  const presets = {
    business: {
      name: 'Acme',
      language: 'en',
      country: 'US',
      description: 'Widgets',
    },
    audience: { target: [], competitors: [] },
    blog: {
      sitemap_url: 'https://acme.example/sitemap.xml',
      main_blog_url: 'https://acme.example/blog',
      best_articles: [],
    },
    article_preferences: {
      content_seo: {
        article_style: 'informative',
        llm_instructions: 'Be concise.',
      },
      engagement: { image_style: 'photo' },
    },
  };

  function makeInput(orgId: string, keywordId = 'kw_1'): CreateArticleRunInput {
    return {
      org_id: orgId,
      keyword_id: keywordId,
      status: 'running',
      input: {
        website_url: 'https://acme.example',
        presets,
        keyword: {
          id: keywordId,
          org_id: orgId,
          keyword: 'best seo tools',
          status: 'scheduled',
          scheduled_date: '2026-08-01',
          search_volume: 100,
          difficulty: 20,
          article_id: null,
          created_at: new Date(),
        },
      },
    };
  }

  beforeAll(async () => {
    const db = await getDb();
    await db.collection('article_runs').deleteMany({});
    await ensureIndexes();
  });

  afterAll(async () => {
    await closeDb();
  });

  test('create + findById round-trip through Zod', async () => {
    const created = await ArticleRunRepo.create(makeInput('org_article_run'));
    expect(created.id).toMatch(/^[a-f0-9]{24}$/);
    expect(created.org_id).toBe('org_article_run');
    expect(created.keyword_id).toBe('kw_1');
    expect(created.status).toBe('running');
    expect(created.stages).toEqual({});
    expect(created.working).toEqual({
      link_candidates: [],
      outline: null,
      draft: null,
      humanize_attempts: [],
      content: null,
      readability_grade: null,
      article_id: null,
    });
    expect(created.created_at).toBeInstanceOf(Date);

    const found = await ArticleRunRepo.findById(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.input.website_url).toBe('https://acme.example');
    expect(await ArticleRunRepo.findById('not-an-object-id')).toBeNull();
    expect(await ArticleRunRepo.findById('ffffffffffffffffffffffff')).toBeNull();
  });

  test('saveStageResult persists working state + stage meta', async () => {
    const run = await ArticleRunRepo.create(makeInput('org_article_run'));
    const startedAt = new Date();
    const finishedAt = new Date();

    await ArticleRunRepo.saveStageResult(
      run.id,
      'outline',
      {
        outline: {
          h1: 'Best SEO Tools',
          meta_title: 'Best SEO Tools',
          meta_description: 'A roundup of the best SEO tools.',
          slug: 'best-seo-tools',
          sections: [{ heading: 'Intro', intent: 'overview' }],
          faqs: [],
          internal_links: [],
          cta: '',
        },
      },
      {
        status: 'completed',
        started_at: startedAt,
        finished_at: finishedAt,
        stats: {},
        error: null,
      },
    );

    const reloaded = await ArticleRunRepo.findById(run.id);
    expect(reloaded!.working.outline?.h1).toBe('Best SEO Tools');
    expect(reloaded!.stages.outline).toEqual({
      status: 'completed',
      started_at: startedAt,
      finished_at: finishedAt,
      stats: {},
      error: null,
    });
    expect(reloaded!.updated_at.getTime()).toBeGreaterThanOrEqual(run.updated_at.getTime());
  });

  test('saveStageResult on an already-completed stage is fenced and leaves the doc unchanged', async () => {
    const run = await ArticleRunRepo.create(makeInput('org_article_run'));
    const startedAt = new Date();
    const finishedAt = new Date();

    await ArticleRunRepo.saveStageResult(
      run.id,
      'draft',
      { draft: 'first draft' },
      {
        status: 'completed',
        started_at: startedAt,
        finished_at: finishedAt,
        stats: {},
        error: null,
      },
    );
    const completed = await ArticleRunRepo.findById(run.id);

    // A stale writer (e.g. a zombie Lambda whose SFN taskTimeout already fired,
    // still running to completion after a retry already succeeded) tries to
    // overwrite the already-completed stage with different working state.
    await ArticleRunRepo.saveStageResult(
      run.id,
      'draft',
      { draft: 'stale draft' },
      {
        status: 'completed',
        started_at: new Date(),
        finished_at: new Date(),
        stats: { stale: true },
        error: null,
      },
    );

    const reloaded = await ArticleRunRepo.findById(run.id);
    expect(reloaded).toEqual(completed);
  });

  test('patchWorking is unfenced and applies even after the owning stage completed', async () => {
    const run = await ArticleRunRepo.create(makeInput('org_article_run'));
    await ArticleRunRepo.saveStageResult(
      run.id,
      'humanize',
      { humanize_attempts: [{ attempt: 1, grade: 9, content: 'attempt one' }] },
      {
        status: 'completed',
        started_at: new Date(),
        finished_at: new Date(),
        stats: {},
        error: null,
      },
    );

    const patch: Partial<ArticleRunWorking> = {
      humanize_attempts: [
        { attempt: 1, grade: 9, content: 'attempt one' },
        { attempt: 2, grade: 7, content: 'attempt two' },
      ],
    };
    await ArticleRunRepo.patchWorking(run.id, patch);

    const reloaded = await ArticleRunRepo.findById(run.id);
    expect(reloaded!.working.humanize_attempts).toHaveLength(2);
    expect(reloaded!.working.humanize_attempts[1]!.content).toBe('attempt two');
  });

  test('markStageFailed stamps stage meta without touching working state', async () => {
    const run = await ArticleRunRepo.create(makeInput('org_article_run'));
    await ArticleRunRepo.saveStageResult(
      run.id,
      'draft',
      { draft: 'first draft' },
      {
        status: 'completed',
        started_at: new Date(),
        finished_at: new Date(),
        stats: {},
        error: null,
      },
    );

    const startedAt = new Date();
    const finishedAt = new Date();
    await ArticleRunRepo.markStageFailed(run.id, 'humanize', {
      status: 'failed',
      started_at: startedAt,
      finished_at: finishedAt,
      stats: {},
      error: 'boom',
    });

    const reloaded = await ArticleRunRepo.findById(run.id);
    expect(reloaded!.stages.humanize).toEqual({
      status: 'failed',
      started_at: startedAt,
      finished_at: finishedAt,
      stats: {},
      error: 'boom',
    });
    // Working state from the earlier successful stage is untouched.
    expect(reloaded!.working.draft).toBe('first draft');
    expect(reloaded!.stages.draft?.status).toBe('completed');
  });

  test('setStatus flips status', async () => {
    const run = await ArticleRunRepo.create(makeInput('org_article_run'));
    await ArticleRunRepo.setStatus(run.id, 'completed');
    const reloaded = await ArticleRunRepo.findById(run.id);
    expect(reloaded!.status).toBe('completed');
  });

  test('mutators are a silent no-op for an invalid id', async () => {
    const invalidId = 'not-an-object-id';
    const meta: StageState = {
      status: 'failed',
      started_at: new Date(),
      finished_at: new Date(),
      stats: {},
      error: 'boom',
    };
    await expect(
      ArticleRunRepo.saveStageResult(invalidId, 'draft', { draft: 'x' }, meta),
    ).resolves.toBeUndefined();
    await expect(ArticleRunRepo.patchWorking(invalidId, { draft: 'x' })).resolves.toBeUndefined();
    await expect(ArticleRunRepo.markStageFailed(invalidId, 'draft', meta)).resolves.toBeUndefined();
    await expect(ArticleRunRepo.setStatus(invalidId, 'completed')).resolves.toBeUndefined();
  });
});
