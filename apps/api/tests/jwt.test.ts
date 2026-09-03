import { describe, expect, test } from 'vitest';
import { signToken, verifyToken } from '../src/auth/jwt';
import { signGscState } from '../src/lib/gsc-state';

describe('verifyToken', () => {
  test('round-trips a session token', async () => {
    const token = await signToken({ sub: 'user_1', email: 'u@example.com' });
    expect(await verifyToken(token)).toEqual({ sub: 'user_1', email: 'u@example.com' });
  });

  // #101: the GSC OAuth `state` is signed with the same secret and exposed to
  // the browser as a query param; it must not pass as a session.
  test('rejects a purpose-scoped token (gsc-state) signed with the same secret', async () => {
    const state = await signGscState({ org_id: 'org_1', user_id: 'u1' });
    await expect(verifyToken(state)).rejects.toThrow(/session/);
  });
});
