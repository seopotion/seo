import { beforeEach, describe, expect, test, vi } from 'vitest';

const { listDueForGeneration } = vi.hoisted(() => ({
  listDueForGeneration: vi.fn(),
}));
vi.mock('@shared/db', () => ({ KeywordRepo: { listDueForGeneration } }));

const { launchGeneration } = vi.hoisted(() => ({
  launchGeneration: vi.fn(async (): Promise<{ run_id: string } | null> => ({ run_id: 'run_1' })),
}));
vi.mock('@shared/articles', () => ({ launchGeneration }));

import { runScheduler } from '../src/generation-scheduler';

describe('generation scheduler', () => {
  beforeEach(() => vi.clearAllMocks());

  test('launches one generation run per due keyword and returns the count', async () => {
    listDueForGeneration.mockResolvedValue([
      { id: 'k1', org_id: 'o1' },
      { id: 'k2', org_id: 'o2' },
    ]);
    const n = await runScheduler();
    expect(n).toBe(2);
    expect(launchGeneration).toHaveBeenCalledTimes(2);
    expect(launchGeneration).toHaveBeenCalledWith('o1', 'k1', { wait: true });
    expect(launchGeneration).toHaveBeenCalledWith('o2', 'k2', { wait: true });
  });

  test('a claim-lost (null) result does not throw', async () => {
    listDueForGeneration.mockResolvedValue([{ id: 'k1', org_id: 'o1' }]);
    launchGeneration.mockResolvedValueOnce(null);
    await expect(runScheduler()).resolves.toBe(1);
  });

  test('one keyword throwing does not abort the rest of the sweep', async () => {
    listDueForGeneration.mockResolvedValue([
      { id: 'k1', org_id: 'o1' },
      { id: 'k2', org_id: 'o2' },
    ]);
    launchGeneration.mockRejectedValueOnce(new Error('org missing presets'));
    await expect(runScheduler()).resolves.toBe(2);
    expect(launchGeneration).toHaveBeenCalledTimes(2);
    expect(launchGeneration).toHaveBeenCalledWith('o1', 'k1', { wait: true });
    expect(launchGeneration).toHaveBeenCalledWith('o2', 'k2', { wait: true });
  });

  test('passes today (yyyy-mm-dd) and the attempt cap to the repo', async () => {
    listDueForGeneration.mockResolvedValue([]);
    await runScheduler();
    const [today, cap] = listDueForGeneration.mock.calls[0]!;
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cap).toBe(3);
  });
});
