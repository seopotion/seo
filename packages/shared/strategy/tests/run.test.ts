import type { DataForSeoClient, LlmClient } from '@shared/providers';
import type { StageState, StrategyRun } from '@shared/schemas';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  runRepoFindById,
  runRepoSaveStageResult,
  runRepoMarkStageFailed,
  runRepoSetStatus,
  orgSetStrategyStatus,
  stageGatherMock,
  stageEnrichMock,
  stageTriageMock,
  stageSerpFetchMock,
  stagePlanMock,
  persistScheduleMock,
} = vi.hoisted(() => ({
  runRepoFindById: vi.fn(),
  runRepoSaveStageResult: vi.fn(async () => {}),
  runRepoMarkStageFailed: vi.fn(async () => {}),
  runRepoSetStatus: vi.fn(async () => {}),
  orgSetStrategyStatus: vi.fn(async () => {}),
  stageGatherMock: vi.fn(async (state: unknown) => state),
  stageEnrichMock: vi.fn(async (state: unknown) => state),
  stageTriageMock: vi.fn(async (state: unknown) => state),
  stageSerpFetchMock: vi.fn(async (state: unknown) => state),
  stagePlanMock: vi.fn(async (state: unknown) => state),
  persistScheduleMock: vi.fn(async (state: unknown) => state),
}));

vi.mock('@shared/db', () => ({
  StrategyRunRepo: {
    findById: runRepoFindById,
    saveStageResult: runRepoSaveStageResult,
    markStageFailed: runRepoMarkStageFailed,
    setStatus: runRepoSetStatus,
  },
  OrgRepo: { setStrategyStatus: orgSetStrategyStatus },
}));

vi.mock('@shared/keywords', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/keywords')>();
  return {
    ...actual,
    stageGather: stageGatherMock,
    stageEnrich: stageEnrichMock,
    stageTriage: stageTriageMock,
    stageSerpFetch: stageSerpFetchMock,
    stagePlan: stagePlanMock,
  };
});

vi.mock('../src/persist', () => ({
  stagePersistSchedule: persistScheduleMock,
}));

import { executeStage, markRunFailed, runLocalStrategy } from '../src/run';

const clients = {
  dataForSeo: {} as unknown as DataForSeoClient,
  llm: {} as unknown as LlmClient,
};

const presets = {
  business: { name: 'Acme', language: 'English', country: 'United States', description: 'x' },
  audience: { target: ['devs'], competitors: ['competitor.com'] },
  blog: {
    sitemap_url: 'https://acme.com/sitemap.xml',
    main_blog_url: 'https://acme.com/blog',
    best_articles: [],
  },
  article_preferences: {
    content_seo: {
      article_style: 'howto',
      internal_links_count: 1,
      table_of_contents: true,
      llm_instructions: '',
    },
    engagement: { image_style: 'photo', youtube_videos: true },
    publishing: { auto_publish: false },
  },
};

function makeRun(overrides: Partial<StrategyRun> = {}): StrategyRun {
  const now = new Date();
  return {
    id: 'run1',
    org_id: 'org1',
    status: 'running',
    input: { website_url: 'https://acme.com', presets, existing_keywords: [] },
    stages: {},
    candidates: [],
    below_n: [],
    rejected: [],
    seeds: [],
    stats: {},
    created_at: now,
    updated_at: now,
    ...overrides,
  } as StrategyRun;
}

function completedStage(): StageState {
  return {
    status: 'completed',
    started_at: new Date(),
    finished_at: new Date(),
    stats: {},
    error: null,
  };
}

describe('executeStage', () => {
  beforeEach(() => vi.clearAllMocks());

  test('a completed RUN is a no-op regardless of stage', async () => {
    runRepoFindById.mockResolvedValue(makeRun({ status: 'completed' }));

    await executeStage('run1', 'gather', clients);

    expect(stageGatherMock).not.toHaveBeenCalled();
    expect(runRepoSaveStageResult).not.toHaveBeenCalled();
  });

  test('duplicate invocation of an already-completed stage is a no-op', async () => {
    runRepoFindById.mockResolvedValue(makeRun({ stages: { gather: completedStage() } }));

    await executeStage('run1', 'gather', clients);

    expect(stageGatherMock).not.toHaveBeenCalled();
    expect(runRepoSaveStageResult).not.toHaveBeenCalled();
  });

  test('runs a compute stage and saves the result as completed', async () => {
    runRepoFindById.mockResolvedValue(makeRun());

    await executeStage('run1', 'gather', clients);

    expect(stageGatherMock).toHaveBeenCalledTimes(1);
    expect(runRepoSaveStageResult).toHaveBeenCalledWith(
      'run1',
      'gather',
      expect.objectContaining({ candidates: [], rejected: [], seeds: [], stats: {} }),
      expect.objectContaining({ status: 'completed' }),
    );
    expect(runRepoSetStatus).not.toHaveBeenCalled();
  });

  test('persist_schedule uses stagePersistSchedule with {orgId} context', async () => {
    runRepoFindById.mockResolvedValue(makeRun());

    await executeStage('run1', 'persist_schedule', clients);

    expect(persistScheduleMock).toHaveBeenCalledWith(expect.anything(), { orgId: 'org1' });
  });

  test("executeStage('persist_schedule') sets run status completed AFTER the stage result is saved", async () => {
    const calls: string[] = [];
    runRepoFindById.mockResolvedValue(makeRun());
    runRepoSaveStageResult.mockImplementationOnce(async () => {
      calls.push('saveStageResult');
    });
    runRepoSetStatus.mockImplementationOnce(async () => {
      calls.push('setStatus');
    });

    await executeStage('run1', 'persist_schedule', clients);

    expect(calls).toEqual(['saveStageResult', 'setStatus']);
  });

  test('a fatal stage failure stamps the stage failed and rethrows the typed error', async () => {
    runRepoFindById.mockResolvedValue(makeRun());
    stagePlanMock.mockRejectedValueOnce(Object.assign(new Error('bad plan'), { retryable: false }));

    await expect(executeStage('run1', 'plan', clients)).rejects.toMatchObject({
      name: 'StrategyFatalError',
      message: 'bad plan',
    });

    expect(runRepoMarkStageFailed).toHaveBeenCalledWith(
      'run1',
      'plan',
      expect.objectContaining({ status: 'failed', error: 'bad plan' }),
    );
    expect(runRepoSetStatus).not.toHaveBeenCalled();
  });
});

describe('runLocalStrategy', () => {
  beforeEach(() => vi.clearAllMocks());

  test('happy path: runs all six stages in order and completes', async () => {
    runRepoFindById.mockResolvedValue(makeRun());

    await runLocalStrategy('run1', clients);

    expect(stageGatherMock).toHaveBeenCalledTimes(1);
    expect(stageEnrichMock).toHaveBeenCalledTimes(1);
    expect(stageTriageMock).toHaveBeenCalledTimes(1);
    expect(stageSerpFetchMock).toHaveBeenCalledTimes(1);
    expect(stagePlanMock).toHaveBeenCalledTimes(1);
    expect(persistScheduleMock).toHaveBeenCalledTimes(1);
    expect(runRepoSaveStageResult).toHaveBeenCalledTimes(6);
    expect(runRepoSetStatus).toHaveBeenCalledWith('run1', 'completed');

    const order = [
      stageGatherMock,
      stageEnrichMock,
      stageTriageMock,
      stageSerpFetchMock,
      stagePlanMock,
      persistScheduleMock,
    ].map((fn) => fn.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });

  test('resume: only stages without a completed stamp execute, in STRATEGY_STAGES order', async () => {
    runRepoFindById.mockResolvedValue(
      makeRun({
        stages: {
          gather: completedStage(),
          enrich: completedStage(),
          triage: completedStage(),
        },
      }),
    );

    await runLocalStrategy('run1', clients);

    expect(stageGatherMock).not.toHaveBeenCalled();
    expect(stageEnrichMock).not.toHaveBeenCalled();
    expect(stageTriageMock).not.toHaveBeenCalled();
    expect(stageSerpFetchMock).toHaveBeenCalledTimes(1);
    expect(stagePlanMock).toHaveBeenCalledTimes(1);
    expect(persistScheduleMock).toHaveBeenCalledTimes(1);
  });

  test('later stages do not run after a failure', async () => {
    runRepoFindById.mockResolvedValue(makeRun());
    stageTriageMock.mockRejectedValueOnce(
      Object.assign(new Error('triage exploded'), { retryable: false }),
    );

    await expect(runLocalStrategy('run1', clients)).rejects.toMatchObject({
      name: 'StrategyFatalError',
    });

    expect(stageGatherMock).toHaveBeenCalledTimes(1);
    expect(stageEnrichMock).toHaveBeenCalledTimes(1);
    expect(stageTriageMock).toHaveBeenCalledTimes(1);
    expect(stageSerpFetchMock).not.toHaveBeenCalled();
    expect(stagePlanMock).not.toHaveBeenCalled();
    expect(persistScheduleMock).not.toHaveBeenCalled();
  });
});

describe('markRunFailed', () => {
  beforeEach(() => vi.clearAllMocks());

  test('sets org strategy_status failed AND run status failed', async () => {
    await markRunFailed('run1', 'org1');

    expect(orgSetStrategyStatus).toHaveBeenCalledWith('org1', 'failed');
    expect(runRepoSetStatus).toHaveBeenCalledWith('run1', 'failed');
  });
});
