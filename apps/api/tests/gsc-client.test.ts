import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { generateAuthUrl, getToken, verifyIdToken, getAccessToken, setCredentials } = vi.hoisted(
  () => ({
    generateAuthUrl: vi.fn(),
    getToken: vi.fn(),
    verifyIdToken: vi.fn(),
    getAccessToken: vi.fn(),
    setCredentials: vi.fn(),
  }),
);

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    generateAuthUrl = generateAuthUrl;
    getToken = getToken;
    verifyIdToken = verifyIdToken;
    getAccessToken = getAccessToken;
    setCredentials = setCredentials;
  },
}));

import {
  buildAuthUrl,
  exchangeCode,
  GscAuthRevokedError,
  listSites,
  querySearchAnalytics,
} from '../src/clients/gsc';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildAuthUrl', () => {
  test('requests offline access with the webmasters scope and state', async () => {
    generateAuthUrl.mockReturnValue('https://accounts.google.com/consent?x=1');

    expect(await buildAuthUrl('state-token')).toBe('https://accounts.google.com/consent?x=1');

    expect(generateAuthUrl).toHaveBeenCalledWith({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['openid', 'email', 'https://www.googleapis.com/auth/webmasters.readonly'],
      state: 'state-token',
    });
  });
});

describe('exchangeCode', () => {
  test('returns the refresh token and verified email', async () => {
    getToken.mockResolvedValue({ tokens: { refresh_token: 'rt-1', id_token: 'idt' } });
    verifyIdToken.mockResolvedValue({ getPayload: () => ({ email: 'owner@x.com' }) });

    expect(await exchangeCode('auth-code')).toEqual({ refreshToken: 'rt-1', email: 'owner@x.com' });
    expect(getToken).toHaveBeenCalledWith('auth-code');
  });

  test('throws when Google returns no refresh token', async () => {
    getToken.mockResolvedValue({ tokens: { access_token: 'at-only' } });
    await expect(exchangeCode('auth-code')).rejects.toThrow(/refresh token/);
  });
});

describe('listSites', () => {
  test('mints an access token and maps site entries', async () => {
    getAccessToken.mockResolvedValue({ token: 'at-1' });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          siteEntry: [
            { siteUrl: 'sc-domain:clewas.com', permissionLevel: 'siteOwner' },
            { siteUrl: 'https://blog.clewas.com/', permissionLevel: 'siteFullUser' },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const sites = await listSites('rt-1');

    expect(setCredentials).toHaveBeenCalledWith({ refresh_token: 'rt-1' });
    expect(sites).toEqual([
      { site_url: 'sc-domain:clewas.com', permission_level: 'siteOwner' },
      { site_url: 'https://blog.clewas.com/', permission_level: 'siteFullUser' },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://www.googleapis.com/webmasters/v3/sites');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer at-1');
  });

  test('maps invalid_grant refresh failures to GscAuthRevokedError', async () => {
    getAccessToken.mockRejectedValue(new Error('invalid_grant: token revoked'));
    await expect(listSites('rt-revoked')).rejects.toBeInstanceOf(GscAuthRevokedError);
  });
});

describe('querySearchAnalytics', () => {
  test('POSTs the window to the encoded site and maps rows', async () => {
    getAccessToken.mockResolvedValue({ token: 'at-1' });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          rows: [
            {
              keys: ['https://clewas.com/blog/a'],
              clicks: 12,
              impressions: 300,
              ctr: 0.04,
              position: 8.2,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const rows = await querySearchAnalytics('rt-1', 'sc-domain:clewas.com', {
      startDate: '2026-06-17',
      endDate: '2026-07-15',
      dimensions: ['page'],
      rowLimit: 10,
    });

    expect(rows).toEqual([
      {
        keys: ['https://clewas.com/blog/a'],
        clicks: 12,
        impressions: 300,
        ctr: 0.04,
        position: 8.2,
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aclewas.com/searchAnalytics/query',
    );
    expect(JSON.parse(init.body as string)).toEqual({
      startDate: '2026-06-17',
      endDate: '2026-07-15',
      dimensions: ['page'],
      rowLimit: 10,
    });
  });

  test('returns [] when GSC has no rows', async () => {
    getAccessToken.mockResolvedValue({ token: 'at-1' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    expect(
      await querySearchAnalytics('rt-1', 'x', { startDate: '2026-06-17', endDate: '2026-07-15' }),
    ).toEqual([]);
  });

  test('throws on a non-OK response', async () => {
    getAccessToken.mockResolvedValue({ token: 'at-1' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    await expect(
      querySearchAnalytics('rt-1', 'x', { startDate: '2026-06-17', endDate: '2026-07-15' }),
    ).rejects.toThrow(/500/);
  });
});
