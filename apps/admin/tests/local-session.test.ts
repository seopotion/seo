import type { IncomingMessage } from 'node:http';
import { verify } from 'hono/jwt';
import type { ViteDevServer } from 'vite';
import { beforeEach, expect, test, vi } from 'vitest';

const runAws = vi.hoisted(() => vi.fn());
vi.mock('node:util', () => ({ promisify: () => runAws }));

import {
  createLocalSession,
  localSessionPlugin,
  localSessionRequestAllowed,
  STAGING_ADMIN_API_URL,
} from '../dev/local-session';

beforeEach(() => {
  vi.clearAllMocks();
  runAws.mockImplementation(async (_command, args: string[]) => {
    const value = args.includes('get-caller-identity')
      ? '977476318001'
      : args.includes('/seo/staging/admin/operators')
        ? 'operator@example.com,second@example.com'
        : 'test-admin-secret';
    return { stdout: JSON.stringify(value) };
  });
});

test('uses AWS permissions to issue an allowlisted staging operator session', async () => {
  const token = await createLocalSession(' Operator@Example.com ', 'seo-staging');
  const claims = await verify(token, 'test-admin-secret', 'HS256');
  expect(claims).toMatchObject({
    sub: 'operator@example.com',
    email: 'operator@example.com',
    role: 'operator',
  });
  expect(Number(claims.exp) - Math.floor(Date.now() / 1000)).toBeGreaterThan(3500);
  expect(runAws).toHaveBeenCalledTimes(3);
  expect(runAws).toHaveBeenLastCalledWith(
    'aws',
    expect.arrayContaining([
      '--with-decryption',
      '/seo/staging/admin/jwt-secret',
      '--profile',
      'seo-staging',
    ]),
    expect.any(Object),
  );
});

test('rejects the wrong AWS account before reading any parameters', async () => {
  runAws.mockResolvedValueOnce({ stdout: JSON.stringify('672093561569') });
  await expect(createLocalSession('operator@example.com', 'seo-staging')).rejects.toMatchObject({
    code: 'wrong_aws_account',
  });
  expect(runAws).toHaveBeenCalledTimes(1);
});

test('requires a configured, allowlisted identity and never reads the secret for other emails', async () => {
  await expect(createLocalSession('', 'seo-staging')).rejects.toMatchObject({
    code: 'local_operator_not_configured',
  });
  expect(runAws).not.toHaveBeenCalled();
  await expect(createLocalSession('intruder@example.com', 'seo-staging')).rejects.toMatchObject({
    code: 'not_an_operator',
  });
  expect(runAws).toHaveBeenCalledTimes(2);
});

test('does not issue a token when the AWS session expires', async () => {
  runAws.mockRejectedValueOnce(new Error('Session expired'));
  await expect(createLocalSession('operator@example.com', 'seo-staging')).rejects.toThrow(
    'Session expired',
  );
  expect(runAws).toHaveBeenCalledTimes(1);
});

function request(
  overrides: {
    method?: string;
    origin?: string;
    host?: string;
    marker?: string;
    address?: string;
  } = {},
) {
  return {
    method: overrides.method ?? 'POST',
    headers: {
      origin: overrides.origin ?? 'http://localhost:3000',
      host: overrides.host ?? 'localhost:3000',
      'x-admin-local-session': overrides.marker ?? '1',
    },
    socket: { remoteAddress: overrides.address ?? '127.0.0.1' },
  } as unknown as IncomingMessage;
}

test('accepts same-origin loopback POSTs on ports 3000 and 5173', () => {
  expect(localSessionRequestAllowed(request())).toBe(true);
  expect(
    localSessionRequestAllowed(
      request({ origin: 'http://127.0.0.1:5173', host: '127.0.0.1:5173' }),
    ),
  ).toBe(true);
});

test.each([
  { method: 'GET' },
  { marker: '' },
  { address: '192.168.1.20' },
  { origin: 'https://attacker.example' },
  { origin: 'null' },
  { origin: 'http://localhost:5173' },
  { origin: 'http://attacker.example:3000', host: 'attacker.example:3000' },
])('rejects cross-origin and nonlocal session requests: %j', (overrides) => {
  expect(localSessionRequestAllowed(request(overrides))).toBe(false);
});

test('registers the endpoint only for the staging API and only in the Vite dev server', () => {
  for (const apiUrl of [
    STAGING_ADMIN_API_URL,
    'https://hob5t9w1i7.execute-api.us-east-1.amazonaws.com',
    'http://localhost:8788',
  ]) {
    const plugin = localSessionPlugin(apiUrl, 'operator@example.com');
    expect(plugin.apply).toBe('serve');
    expect(plugin.configurePreviewServer).toBeUndefined();
    const use = vi.fn();
    const hook = plugin.configureServer;
    if (typeof hook !== 'function') throw new Error('Missing dev hook');
    hook.call({} as never, { middlewares: { use } } as unknown as ViteDevServer);
    expect(use).toHaveBeenCalledTimes(apiUrl === STAGING_ADMIN_API_URL ? 1 : 0);
  }
});
