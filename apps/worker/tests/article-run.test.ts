import { beforeEach, describe, expect, test, vi } from 'vitest';

const { executeArticleStage, getArticleStageClients, markArticleRunFailed } = vi.hoisted(() => ({
  executeArticleStage: vi.fn(async () => undefined as { readability_ok: boolean } | undefined),
  getArticleStageClients: vi.fn(async () => ({ llm: {}, youtube: {}, image: {} })),
  markArticleRunFailed: vi.fn(async () => {}),
}));
vi.mock('@shared/articles', () => ({
  executeArticleStage,
  getArticleStageClients,
  markArticleRunFailed,
}));

import { handler } from '../src/article-run';

describe('article stage adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  test('routes a stage event to executeArticleStage after resolving clients', async () => {
    const clients = { llm: {}, youtube: {}, image: {} };
    getArticleStageClients.mockResolvedValueOnce(clients);

    await handler({ run_id: 'r1', org_id: 'o1', stage: 'draft' });

    expect(getArticleStageClients).toHaveBeenCalledTimes(1);
    expect(executeArticleStage).toHaveBeenCalledWith('r1', 'draft', clients);
    expect(markArticleRunFailed).not.toHaveBeenCalled();
  });

  test('returns the stage result so Step Functions can read $.Payload.readability_ok', async () => {
    executeArticleStage.mockResolvedValueOnce({ readability_ok: false });

    const result = await handler({ run_id: 'r1', org_id: 'o1', stage: 'humanize' });

    expect(result).toEqual({ readability_ok: false });
  });

  test('routes an EventBridge execution-failed event to markArticleRunFailed, not executeArticleStage', async () => {
    const event = {
      'detail-type': 'Step Functions Execution Status Change',
      detail: {
        status: 'FAILED',
        input: JSON.stringify({ run_id: 'r1', org_id: 'o1' }),
      },
    };

    await handler(event);

    expect(markArticleRunFailed).toHaveBeenCalledWith('r1');
    expect(executeArticleStage).not.toHaveBeenCalled();
    expect(getArticleStageClients).not.toHaveBeenCalled();
  });

  test('throws on a malformed stage event (bad stage name)', async () => {
    await expect(
      handler({ run_id: 'r1', org_id: 'o1', stage: 'not_a_real_stage' }),
    ).rejects.toThrow();

    expect(executeArticleStage).not.toHaveBeenCalled();
    expect(markArticleRunFailed).not.toHaveBeenCalled();
  });

  test('propagates an executeArticleStage rejection', async () => {
    executeArticleStage.mockRejectedValueOnce(new Error('stage blew up'));

    await expect(handler({ run_id: 'r1', org_id: 'o1', stage: 'outline' })).rejects.toThrow(
      'stage blew up',
    );
  });

  test('logs and returns without throwing when detail.input is unreadable', async () => {
    const event = {
      'detail-type': 'Step Functions Execution Status Change',
      detail: { status: 'FAILED', input: JSON.stringify({ foo: 'bar' }) },
    };

    await expect(handler(event)).resolves.toBeUndefined();

    expect(markArticleRunFailed).not.toHaveBeenCalled();
    expect(executeArticleStage).not.toHaveBeenCalled();
  });
});
