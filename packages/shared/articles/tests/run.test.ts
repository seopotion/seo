import type { StageState } from '@shared/schemas';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ArticleStageClients } from '../src/clients';

const {
  runRepoFindById,
  runRepoSaveStageResult,
  runRepoPatchWorking,
  runRepoMarkStageFailed,
  runRepoSetStatus,
  keywordFailGeneration,
  stagePrepareMock,
  stageOutlineMock,
  stageDraftMock,
  stageHumanizeMock,
  stageFinalizeMock,
  stageImagesPlanMock,
  stageImagesRenderMock,
  stageHandoffPublishMock,
} = vi.hoisted(() => ({
  runRepoFindById: vi.fn(),
  runRepoSaveStageResult: vi.fn(async () => {}),
  runRepoPatchWorking: vi.fn(async () => {}),
  runRepoMarkStageFailed: vi.fn(async () => {}),
  runRepoSetStatus: vi.fn(async () => {}),
  keywordFailGeneration: vi.fn(async () => {}),
  stagePrepareMock: vi.fn(),
  stageOutlineMock: vi.fn(),
  stageDraftMock: vi.fn(),
  stageHumanizeMock: vi.fn(),
  stageFinalizeMock: vi.fn(),
  stageImagesPlanMock: vi.fn(),
  stageImagesRenderMock: vi.fn(),
  stageHandoffPublishMock: vi.fn(),
}));

vi.mock('@shared/db', () => ({
  ArticleRunRepo: {
    findById: runRepoFindById,
    saveStageResult: runRepoSaveStageResult,
    patchWorking: runRepoPatchWorking,
    markStageFailed: runRepoMarkStageFailed,
    setStatus: runRepoSetStatus,
  },
  KeywordRepo: { failGeneration: keywordFailGeneration },
}));

vi.mock('../src/stages/prepare', () => ({ stagePrepare: stagePrepareMock }));
vi.mock('../src/stages/outline', () => ({ stageOutline: stageOutlineMock }));
vi.mock('../src/stages/draft', () => ({ stageDraft: stageDraftMock }));
vi.mock('../src/stages/humanize', () => ({ stageHumanize: stageHumanizeMock }));
vi.mock('../src/stages/finalize', () => ({ stageFinalize: stageFinalizeMock }));
vi.mock('../src/stages/images', () => ({
  stageImagesPlan: stageImagesPlanMock,
  stageImagesRender: stageImagesRenderMock,
}));
vi.mock('../src/stages/handoff', () => ({ stageHandoffPublish: stageHandoffPublishMock }));

import { ArticleFatalError, ArticleRetryableError } from '../src/errors';
import { executeArticleStage, markArticleRunFailed, runLocalArticleRun } from '../src/run';
import { makeRun } from './fixtures';

const clients = { llm: {}, youtube: {}, image: {} } as unknown as ArticleStageClients;

function completedStage(error: string | null = null): StageState {
  return { status: 'completed', started_at: new Date(), finished_at: new Date(), stats: {}, error };
}

function failedStage(error: string | null): StageState {
  return { status: 'failed', started_at: new Date(), finished_at: new Date(), stats: {}, error };
}

describe('executeArticleStage', () => {
  beforeEach(() => vi.clearAllMocks());

  test('run not found throws ArticleFatalError', async () => {
    runRepoFindById.mockResolvedValue(null);

    await expect(executeArticleStage('missing', 'prepare', clients)).rejects.toBeInstanceOf(
      ArticleFatalError,
    );
    expect(stagePrepareMock).not.toHaveBeenCalled();
  });

  test('a completed RUN short-circuits: humanize returns readability_ok true, outline returns undefined', async () => {
    runRepoFindById.mockResolvedValue(makeRun({ status: 'completed' }));

    await expect(executeArticleStage('run1', 'humanize', clients)).resolves.toEqual({
      readability_ok: true,
    });
    await expect(executeArticleStage('run1', 'outline', clients)).resolves.toBeUndefined();

    expect(stageHumanizeMock).not.toHaveBeenCalled();
    expect(stageOutlineMock).not.toHaveBeenCalled();
  });

  test('a stage already completed in run.stages short-circuits the same way', async () => {
    runRepoFindById.mockResolvedValue(makeRun({ stages: { humanize: completedStage() } }));

    await expect(executeArticleStage('run1', 'humanize', clients)).resolves.toEqual({
      readability_ok: true,
    });
    expect(stageHumanizeMock).not.toHaveBeenCalled();
  });

  test('a completed outcome saves the stage result with the working patch and completed meta', async () => {
    runRepoFindById.mockResolvedValue(makeRun());
    stageOutlineMock.mockResolvedValue({ completed: true, working: { outline: { h1: 'x' } } });

    await executeArticleStage('run1', 'outline', clients);

    expect(runRepoSaveStageResult).toHaveBeenCalledWith(
      'run1',
      'outline',
      { outline: { h1: 'x' } },
      expect.objectContaining({ status: 'completed', error: null }),
    );
    expect(runRepoPatchWorking).not.toHaveBeenCalled();
  });

  test('a humanize completed:false outcome patches working (not saveStageResult) and returns readability_ok false', async () => {
    runRepoFindById.mockResolvedValue(makeRun());
    stageHumanizeMock.mockResolvedValue({
      completed: false,
      working: { humanize_attempts: [{ attempt: 1, grade: 12, content: 'x' }] },
      output: { readability_ok: false },
    });

    const result = await executeArticleStage('run1', 'humanize', clients);

    expect(result).toEqual({ readability_ok: false });
    expect(runRepoPatchWorking).toHaveBeenCalledWith('run1', {
      humanize_attempts: [{ attempt: 1, grade: 12, content: 'x' }],
    });
    expect(runRepoSaveStageResult).not.toHaveBeenCalled();
  });

  test('a fatal provider error (retryable: false) marks the stage failed and rethrows ArticleFatalError', async () => {
    runRepoFindById.mockResolvedValue(makeRun());
    stageOutlineMock.mockRejectedValue(
      Object.assign(new Error('bad outline'), { retryable: false }),
    );

    await expect(executeArticleStage('run1', 'outline', clients)).rejects.toMatchObject({
      name: 'ArticleFatalError',
      message: 'bad outline',
    });
    expect(runRepoMarkStageFailed).toHaveBeenCalledWith(
      'run1',
      'outline',
      expect.objectContaining({ status: 'failed', error: 'bad outline' }),
    );
  });

  test('a generic error rethrows ArticleRetryableError', async () => {
    runRepoFindById.mockResolvedValue(makeRun());
    stageDraftMock.mockRejectedValue(new Error('network blip'));

    await expect(executeArticleStage('run1', 'draft', clients)).rejects.toBeInstanceOf(
      ArticleRetryableError,
    );
    expect(runRepoMarkStageFailed).toHaveBeenCalledWith(
      'run1',
      'draft',
      expect.objectContaining({ status: 'failed', error: 'network blip' }),
    );
  });

  test('a completed handoff_publish stage also sets the run status to completed', async () => {
    runRepoFindById.mockResolvedValue(makeRun());
    stageHandoffPublishMock.mockResolvedValue({ completed: true, working: {} });

    await executeArticleStage('run1', 'handoff_publish', clients);

    expect(runRepoSetStatus).toHaveBeenCalledWith('run1', 'completed');
  });

  test('a completed non-handoff stage does not set run status', async () => {
    runRepoFindById.mockResolvedValue(makeRun());
    stagePrepareMock.mockResolvedValue({ completed: true, working: {} });

    await executeArticleStage('run1', 'prepare', clients);

    expect(runRepoSetStatus).not.toHaveBeenCalled();
  });
});

describe('runLocalArticleRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runRepoFindById.mockResolvedValue(makeRun());
    stagePrepareMock.mockResolvedValue({ completed: true, working: {} });
    stageOutlineMock.mockResolvedValue({ completed: true, working: {} });
    stageDraftMock.mockResolvedValue({ completed: true, working: {} });
    stageFinalizeMock.mockResolvedValue({ completed: true, working: {} });
    stageImagesPlanMock.mockResolvedValue({ completed: true, working: {} });
    stageImagesRenderMock.mockResolvedValue({ completed: true, working: {} });
    stageHandoffPublishMock.mockResolvedValue({ completed: true, working: {} });
  });

  test('humanize loops on readability_ok: false until it passes; all 8 stages complete in order', async () => {
    stageHumanizeMock
      .mockResolvedValueOnce({
        completed: false,
        working: {},
        output: { readability_ok: false },
      })
      .mockResolvedValueOnce({
        completed: false,
        working: {},
        output: { readability_ok: false },
      })
      .mockResolvedValueOnce({
        completed: true,
        working: {},
        output: { readability_ok: true },
      });

    await runLocalArticleRun('run1', clients);

    expect(stageHumanizeMock).toHaveBeenCalledTimes(3);
    expect(stagePrepareMock).toHaveBeenCalledTimes(1);
    expect(stageOutlineMock).toHaveBeenCalledTimes(1);
    expect(stageDraftMock).toHaveBeenCalledTimes(1);
    expect(stageFinalizeMock).toHaveBeenCalledTimes(1);
    expect(stageImagesPlanMock).toHaveBeenCalledTimes(1);
    expect(stageImagesRenderMock).toHaveBeenCalledTimes(1);
    expect(stageHandoffPublishMock).toHaveBeenCalledTimes(1);

    // 8 distinct stages complete: prepare, outline, draft, humanize (3rd
    // attempt only), finalize, images_plan, images_render, handoff_publish.
    expect(runRepoSaveStageResult).toHaveBeenCalledTimes(8);
    const order = [
      stagePrepareMock,
      stageOutlineMock,
      stageDraftMock,
      stageHumanizeMock,
      stageFinalizeMock,
      stageImagesPlanMock,
      stageImagesRenderMock,
      stageHandoffPublishMock,
    ].map((fn) => fn.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });
});

describe('markArticleRunFailed', () => {
  beforeEach(() => vi.clearAllMocks());

  test('fails the keyword with the failed stage error and sets run status failed', async () => {
    runRepoFindById.mockResolvedValue(makeRun({ stages: { draft: failedStage('draft blew up') } }));

    await markArticleRunFailed('run1');

    expect(keywordFailGeneration).toHaveBeenCalledWith('k1', 'draft blew up');
    expect(runRepoSetStatus).toHaveBeenCalledWith('run1', 'failed');
  });

  test('falls back to a generic message when no stage recorded an error', async () => {
    runRepoFindById.mockResolvedValue(makeRun());

    await markArticleRunFailed('run1');

    expect(keywordFailGeneration).toHaveBeenCalledWith('k1', 'execution failed');
    expect(runRepoSetStatus).toHaveBeenCalledWith('run1', 'failed');
  });

  test('is a no-op when the run does not exist', async () => {
    runRepoFindById.mockResolvedValue(null);

    await markArticleRunFailed('missing');

    expect(keywordFailGeneration).not.toHaveBeenCalled();
    expect(runRepoSetStatus).not.toHaveBeenCalled();
  });
});
