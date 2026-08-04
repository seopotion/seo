import { sign } from 'hono/jwt';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  signInstallGrant,
  signInstallState,
  verifyInstallGrant,
  verifyInstallState,
} from '../src/lib/github-state';

afterEach(() => {
  vi.useRealTimers();
});

describe('GitHub install state', () => {
  test('round-trips org and user ids', async () => {
    const token = await signInstallState({ org_id: 'org_1', user_id: 'user_1' });
    expect(await verifyInstallState(token)).toEqual({ org_id: 'org_1', user_id: 'user_1' });
  });

  test('rejects a token without the github-install purpose (e.g. a session JWT)', async () => {
    const sessionLike = await sign(
      { sub: 'user_1', email: 'u@x.com', exp: Math.floor(Date.now() / 1000) + 600 },
      'dev-secret-change-me',
    );
    await expect(verifyInstallState(sessionLike)).rejects.toThrow();
  });

  test('rejects garbage', async () => {
    await expect(verifyInstallState('not-a-jwt')).rejects.toThrow();
  });

  test('expires after 10 minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T10:00:00Z'));
    const token = await signInstallState({ org_id: 'org_1', user_id: 'user_1' });
    vi.setSystemTime(new Date('2026-07-30T10:11:00Z'));
    await expect(verifyInstallState(token)).rejects.toThrow();
  });
});

describe('GitHub install grant', () => {
  test('round-trips the installation id alongside the org and user', async () => {
    const token = await signInstallGrant({
      org_id: 'org_1',
      user_id: 'user_1',
      installation_id: 4242,
    });
    expect(await verifyInstallGrant(token)).toEqual({
      org_id: 'org_1',
      user_id: 'user_1',
      installation_id: 4242,
    });
  });

  test('state and grant do not substitute for each other', async () => {
    // Both are signed with the session secret, so only `purpose` keeps the
    // install step (which trusts a client-supplied installation id) from being
    // replayed as the connect step (which must not).
    const state = await signInstallState({ org_id: 'org_1', user_id: 'user_1' });
    await expect(verifyInstallGrant(state)).rejects.toThrow();

    const grant = await signInstallGrant({
      org_id: 'org_1',
      user_id: 'user_1',
      installation_id: 4242,
    });
    await expect(verifyInstallState(grant)).rejects.toThrow();
  });

  test('outlives the state, because the user still has a repo and branch to pick', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T10:00:00Z'));
    const grant = await signInstallGrant({
      org_id: 'org_1',
      user_id: 'user_1',
      installation_id: 4242,
    });

    vi.setSystemTime(new Date('2026-07-30T10:11:00Z'));
    await expect(verifyInstallGrant(grant)).resolves.toMatchObject({ installation_id: 4242 });

    vi.setSystemTime(new Date('2026-07-30T10:16:00Z'));
    await expect(verifyInstallGrant(grant)).rejects.toThrow();
  });
});
