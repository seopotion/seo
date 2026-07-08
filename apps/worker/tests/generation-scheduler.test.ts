import { beforeEach, describe, expect, test, vi } from 'vitest';

const { listDueForGeneration, enqueueGenerateTask } = vi.hoisted(() => ({
  listDueForGeneration: vi.fn(),
  enqueueGenerateTask: vi.fn(async () => {}),
}));
vi.mock('@shared/db', () => ({ KeywordRepo: { listDueForGeneration } }));
vi.mock('../src/queue', () => ({ enqueueGenerateTask }));

import { runScheduler } from '../src/generation-scheduler';

describe('generation scheduler', () => {
  beforeEach(() => vi.clearAllMocks());

  test('enqueues one task per due keyword and returns the count', async () => {
    listDueForGeneration.mockResolvedValue([
      { id: 'k1', org_id: 'o1' },
      { id: 'k2', org_id: 'o2' },
    ]);
    const n = await runScheduler();
    expect(n).toBe(2);
    expect(enqueueGenerateTask).toHaveBeenCalledTimes(2);
    expect(enqueueGenerateTask).toHaveBeenCalledWith({ org_id: 'o1', keyword_id: 'k1' });
    expect(enqueueGenerateTask).toHaveBeenCalledWith({ org_id: 'o2', keyword_id: 'k2' });
  });

  test('passes today (yyyy-mm-dd) and the attempt cap to the repo', async () => {
    listDueForGeneration.mockResolvedValue([]);
    await runScheduler();
    const [today, cap] = listDueForGeneration.mock.calls[0]!;
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cap).toBe(3);
  });
});
