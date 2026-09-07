import { beforeEach, describe, expect, test, vi } from 'vitest';

const { verifyIdToken } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = verifyIdToken;
  },
}));

import { verifyGoogleIdToken } from '../src/clients/google';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('verifyGoogleIdToken', () => {
  test('returns the identity when the email is verified', async () => {
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: 'g-sub-1',
        email: 'u@example.com',
        email_verified: true,
        name: 'U',
      }),
    });

    await expect(verifyGoogleIdToken('token')).resolves.toEqual({
      sub: 'g-sub-1',
      email: 'u@example.com',
      name: 'U',
    });
  });

  test('rejects when email_verified is false', async () => {
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: 'g-sub-1',
        email: 'u@example.com',
        email_verified: false,
        name: 'U',
      }),
    });

    await expect(verifyGoogleIdToken('token')).rejects.toThrow('Invalid Google ID token');
  });

  test('rejects when email_verified is absent', async () => {
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: 'g-sub-1', email: 'u@example.com', name: 'U' }),
    });

    await expect(verifyGoogleIdToken('token')).rejects.toThrow('Invalid Google ID token');
  });
});
