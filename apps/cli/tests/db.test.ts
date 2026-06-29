import { afterEach, describe, expect, test, vi } from 'vitest';

const { ensureIndexes, closeDb } = vi.hoisted(() => ({
  ensureIndexes: vi.fn(async () => {}),
  closeDb: vi.fn(async () => {}),
}));

vi.mock('@shared/db', () => ({ ensureIndexes, closeDb }));

import { initDb } from '../src/lib/db';

afterEach(() => vi.clearAllMocks());

describe('initDb', () => {
  test('calls ensureIndexes and returns the collection list', async () => {
    const res = await initDb();
    expect(ensureIndexes).toHaveBeenCalledOnce();
    expect(closeDb).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.collections).toEqual(['users', 'orgs']);
  });

  test('maps a thrown error to a DB_INIT_FAILED Result', async () => {
    ensureIndexes.mockRejectedValueOnce(new Error('no mongo'));
    const res = await initDb();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('DB_INIT_FAILED');
    expect(res.error.message).toContain('no mongo');
    expect(closeDb).toHaveBeenCalledOnce();
  });
});
