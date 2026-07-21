import { sign } from 'hono/jwt';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { signGscState, verifyGscState } from '../src/lib/gsc-state';

afterEach(() => {
  vi.useRealTimers();
});

describe('GSC OAuth state', () => {
  test('round-trips org and user ids', async () => {
    const token = await signGscState({ org_id: 'org_1', user_id: 'user_1' });
    expect(await verifyGscState(token)).toEqual({ org_id: 'org_1', user_id: 'user_1' });
  });

  test('rejects a token without the gsc-state purpose (e.g. a session JWT)', async () => {
    // Signed with the same secret but no purpose claim — must not pass as state.
    const sessionLike = await sign(
      { sub: 'user_1', email: 'u@x.com', exp: Math.floor(Date.now() / 1000) + 600 },
      'dev-secret-change-me',
    );
    await expect(verifyGscState(sessionLike)).rejects.toThrow();
  });

  test('rejects garbage', async () => {
    await expect(verifyGscState('not-a-jwt')).rejects.toThrow();
  });

  test('expires after 10 minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T10:00:00Z'));
    const token = await signGscState({ org_id: 'org_1', user_id: 'user_1' });
    vi.setSystemTime(new Date('2026-07-15T10:11:00Z'));
    await expect(verifyGscState(token)).rejects.toThrow();
  });
});
