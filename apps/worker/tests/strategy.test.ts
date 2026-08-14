import { beforeEach, describe, expect, test, vi } from 'vitest';

const { executeStage, getStrategyClients, markRunFailed } = vi.hoisted(() => ({
  executeStage: vi.fn(async () => {}),
  getStrategyClients: vi.fn(async () => ({ dataForSeo: {}, llm: {} })),
  markRunFailed: vi.fn(async () => {}),
}));
vi.mock('@shared/strategy', () => ({ executeStage, getStrategyClients, markRunFailed }));

import { handler } from '../src/strategy';

describe('strategy stage adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  test('routes a stage event to executeStage after resolving clients', async () => {
    const clients = { dataForSeo: {}, llm: {} };
    getStrategyClients.mockResolvedValueOnce(clients);

    await handler({ run_id: 'r1', org_id: 'o1', stage: 'gather' });

    expect(getStrategyClients).toHaveBeenCalledTimes(1);
    expect(executeStage).toHaveBeenCalledWith('r1', 'gather', clients);
    expect(markRunFailed).not.toHaveBeenCalled();
  });

  test('routes an EventBridge execution-failed event to markRunFailed, not executeStage', async () => {
    const event = {
      'detail-type': 'Step Functions Execution Status Change',
      detail: {
        status: 'FAILED',
        input: JSON.stringify({ run_id: 'r1', org_id: 'o1' }),
      },
    };

    await handler(event);

    expect(markRunFailed).toHaveBeenCalledWith('r1', 'o1');
    expect(executeStage).not.toHaveBeenCalled();
    expect(getStrategyClients).not.toHaveBeenCalled();
  });

  test('throws on a malformed stage event (bad stage name)', async () => {
    await expect(
      handler({ run_id: 'r1', org_id: 'o1', stage: 'not_a_real_stage' }),
    ).rejects.toThrow();

    expect(executeStage).not.toHaveBeenCalled();
    expect(markRunFailed).not.toHaveBeenCalled();
  });

  test('propagates an executeStage rejection', async () => {
    executeStage.mockRejectedValueOnce(new Error('stage blew up'));

    await expect(handler({ run_id: 'r1', org_id: 'o1', stage: 'enrich' })).rejects.toThrow(
      'stage blew up',
    );
  });

  test('logs and returns without throwing when detail.input is unreadable', async () => {
    const event = {
      'detail-type': 'Step Functions Execution Status Change',
      detail: { status: 'FAILED', input: JSON.stringify({ foo: 'bar' }) },
    };

    await expect(handler(event)).resolves.toBeUndefined();

    expect(markRunFailed).not.toHaveBeenCalled();
    expect(executeStage).not.toHaveBeenCalled();
  });
});
