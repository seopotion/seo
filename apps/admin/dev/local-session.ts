import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import type { Plugin } from 'vite';

const exec = promisify(execFile);
export const STAGING_ADMIN_API_URL = 'https://s0plnqjsa4.execute-api.us-east-1.amazonaws.com';
const LOCAL_SESSION_PATH = '/__admin/local-session';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

class LocalSessionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function aws(args: string[], profile: string): Promise<unknown> {
  const { stdout } = await exec(
    'aws',
    [...args, '--profile', profile, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'],
    {
      timeout: 20_000,
      maxBuffer: 64 * 1024,
      env: { ...process.env, AWS_CLI_AUTO_PROMPT: 'off' },
    },
  );
  return JSON.parse(stdout);
}

export async function createLocalSession(email: string, profile: string): Promise<string> {
  const operator = email.trim().toLowerCase();
  if (!operator) throw new LocalSessionError(503, 'local_operator_not_configured');
  const account = await aws(['sts', 'get-caller-identity', '--query', 'Account'], profile);
  if (account !== '977476318001') throw new LocalSessionError(403, 'wrong_aws_account');
  const operators = await aws(
    [
      'ssm',
      'get-parameter',
      '--name',
      '/seo/staging/admin/operators',
      '--query',
      'Parameter.Value',
    ],
    profile,
  );
  if (
    typeof operators !== 'string' ||
    !operators
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .includes(operator)
  ) {
    throw new LocalSessionError(403, 'not_an_operator');
  }
  const secret = await aws(
    [
      'ssm',
      'get-parameter',
      '--name',
      '/seo/staging/admin/jwt-secret',
      '--with-decryption',
      '--query',
      'Parameter.Value',
    ],
    profile,
  );
  if (typeof secret !== 'string' || !secret)
    throw new LocalSessionError(503, 'local_session_unavailable');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: operator,
      email: operator,
      role: 'operator',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function localSessionRequestAllowed(req: IncomingMessage): boolean {
  if (
    req.method !== 'POST' ||
    req.headers['x-admin-local-session'] !== '1' ||
    !LOOPBACK_ADDRESSES.has(req.socket.remoteAddress ?? '')
  )
    return false;
  try {
    const origin = new URL(req.headers.origin ?? '');
    return (
      origin.protocol === 'http:' &&
      LOOPBACK_HOSTS.has(origin.hostname) &&
      origin.origin === `http://${req.headers.host}`
    );
  } catch {
    return false;
  }
}

function reply(res: ServerResponse, status: number, body: object) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function localSessionPlugin(apiUrl: string, email: string, profile = 'seo-staging'): Plugin {
  return {
    name: 'admin-local-session',
    apply: 'serve',
    configureServer(server) {
      if (apiUrl.replace(/\/$/, '') !== STAGING_ADMIN_API_URL) return;
      server.middlewares.use((req, res, next) => {
        if (req.url !== LOCAL_SESSION_PATH) {
          next();
          return;
        }
        if (!localSessionRequestAllowed(req)) {
          reply(res, 403, { error: 'local_session_forbidden' });
          return;
        }
        void createLocalSession(email, profile).then(
          (token) => reply(res, 200, { token }),
          (error: unknown) =>
            reply(res, error instanceof LocalSessionError ? error.status : 503, {
              error:
                error instanceof LocalSessionError ? error.code : 'local_aws_session_unavailable',
            }),
        );
      });
    },
  };
}
