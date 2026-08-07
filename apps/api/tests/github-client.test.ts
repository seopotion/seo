import { createVerify, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// A real PKCS#1 key pair — the format GitHub issues, and the reason the client
// signs with node:crypto instead of hono/jwt (design/github-app.md).
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

vi.mock('../src/lib/secrets', () => ({ getGithubAppKey: vi.fn(async () => privateKey) }));

import {
  commitFiles,
  GithubError,
  getInstallation,
  listInstallationRepos,
  verifyRepoAccess,
} from '../src/clients/github';
import { config } from '../src/config';

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
  auth: string;
}

let calls: Call[] = [];
/** `${method} ${path}` -> the responses to serve, in order. */
let routes = new Map<string, Array<{ status: number; body?: unknown }>>();

function serve(
  table: Record<
    string,
    { status: number; body?: unknown } | Array<{ status: number; body?: unknown }>
  >,
) {
  routes = new Map(
    Object.entries(table).map(([key, value]) => [key, Array.isArray(value) ? value : [value]]),
  );
}

const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
  const call: Call = {
    method: init.method ?? 'GET',
    path: String(url).replace('https://api.github.com', ''),
    body: init.body ? JSON.parse(String(init.body)) : undefined,
    auth: String((init.headers as Record<string, string>).Authorization),
  };
  calls.push(call);

  const queued = routes.get(`${call.method} ${call.path}`);
  if (!queued || queued.length === 0)
    throw new Error(`Unstubbed GitHub call: ${call.method} ${call.path}`);
  const res =
    queued.length > 1 ? (queued.shift() as { status: number; body?: unknown }) : queued[0]!;
  return {
    status: res.status,
    text: async () => (res.body === undefined ? '' : JSON.stringify(res.body)),
  };
});

/** Module-scope token cache: a fresh installation id per test keeps them apart. */
let nextInstallationId = 1000;
const freshInstallation = () => ++nextInstallationId;

const TOKEN = {
  status: 201,
  body: { token: 'ghs_installation', expires_at: '2099-01-01T00:00:00Z' },
};

beforeEach(() => {
  calls = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  config.GITHUB_APP_CLIENT_ID = 'Iv1.testclientid';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App JWT', () => {
  test('is RS256 over the App client id and verifies against the private key', async () => {
    const id = freshInstallation();
    serve({
      [`POST /app/installations/${id}/access_tokens`]: TOKEN,
      'GET /repos/o/r/branches/main': { status: 200 },
    });
    await verifyRepoAccess(id, 'o/r', 'main');

    const mint = calls[0]!;
    const jwt = mint.auth.replace('Bearer ', '');
    const [header, payload, signature] = jwt.split('.') as [string, string, string];

    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(claims.iss).toBe('Iv1.testclientid');
    // GitHub rejects a lifetime over 10 minutes, and `iat` is backdated for drift.
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    expect(claims.iat).toBeLessThan(Math.floor(Date.now() / 1000));

    expect(
      createVerify('RSA-SHA256')
        .update(`${header}.${payload}`)
        .verify(publicKey, Buffer.from(signature, 'base64url')),
    ).toBe(true);
  });
});

describe('installation tokens', () => {
  test('scopes the token down to one repository and asks for contents: write', async () => {
    const id = freshInstallation();
    serve({
      [`POST /app/installations/${id}/access_tokens`]: TOKEN,
      'GET /repos/acme/site/branches/main': { status: 200 },
    });
    await verifyRepoAccess(id, 'acme/site', 'main');

    // Bare repository name, not owner/name — that is what the mint API takes.
    expect(calls[0]!.body).toEqual({
      repositories: ['site'],
      permissions: { contents: 'write' },
    });
    expect(calls[1]!.auth).toBe('Bearer ghs_installation');
  });

  test('reuses a cached token for the same installation and repo', async () => {
    const id = freshInstallation();
    serve({
      [`POST /app/installations/${id}/access_tokens`]: TOKEN,
      'GET /repos/o/r/branches/main': { status: 200 },
    });
    await verifyRepoAccess(id, 'o/r', 'main');
    await verifyRepoAccess(id, 'o/r', 'main');

    expect(calls.filter((c) => c.path.endsWith('/access_tokens'))).toHaveLength(1);
  });

  test('a token expiring inside the safety margin is re-minted', async () => {
    const id = freshInstallation();
    serve({
      [`POST /app/installations/${id}/access_tokens`]: [
        {
          status: 201,
          body: { token: 'ghs_old', expires_at: new Date(Date.now() + 60_000).toISOString() },
        },
        { status: 201, body: { token: 'ghs_new', expires_at: '2099-01-01T00:00:00Z' } },
      ],
      'GET /repos/o/r/branches/main': { status: 200 },
    });
    await verifyRepoAccess(id, 'o/r', 'main');
    await verifyRepoAccess(id, 'o/r', 'main');

    expect(calls.filter((c) => c.path.endsWith('/access_tokens'))).toHaveLength(2);
    expect(calls.at(-1)!.auth).toBe('Bearer ghs_new');
  });

  test('maps GitHub refusals to actionable codes', async () => {
    const gone = freshInstallation();
    serve({
      [`POST /app/installations/${gone}/access_tokens`]: {
        status: 404,
        body: { message: 'Not Found' },
      },
    });
    await expect(verifyRepoAccess(gone, 'o/r', 'main')).rejects.toMatchObject({
      code: 'installation_not_found',
    });

    const suspended = freshInstallation();
    serve({
      [`POST /app/installations/${suspended}/access_tokens`]: {
        status: 403,
        body: { message: 'Suspended' },
      },
    });
    await expect(verifyRepoAccess(suspended, 'o/r', 'main')).rejects.toMatchObject({
      code: 'installation_suspended',
    });

    // 422 is overloaded; only the message separates "no write permission" from
    // "that repo is not in this installation", and the two need different fixes.
    const unprivileged = freshInstallation();
    serve({
      [`POST /app/installations/${unprivileged}/access_tokens`]: {
        status: 422,
        body: { message: 'The permissions requested are not granted to this installation.' },
      },
    });
    await expect(verifyRepoAccess(unprivileged, 'o/r', 'main')).rejects.toMatchObject({
      code: 'missing_write_permission',
    });

    const unselected = freshInstallation();
    serve({
      [`POST /app/installations/${unselected}/access_tokens`]: {
        status: 422,
        body: {
          message: 'There is at least one repository that does not exist or is not accessible',
        },
      },
    });
    await expect(verifyRepoAccess(unselected, 'o/r', 'main')).rejects.toMatchObject({
      code: 'repo_not_found',
    });
  });
});

describe('verifyRepoAccess', () => {
  test('rejects a branch the installation cannot read', async () => {
    const id = freshInstallation();
    serve({
      [`POST /app/installations/${id}/access_tokens`]: TOKEN,
      'GET /repos/o/r/branches/nope': { status: 404, body: { message: 'Branch not found' } },
    });
    await expect(verifyRepoAccess(id, 'o/r', 'nope')).rejects.toMatchObject({
      code: 'repo_not_found',
    });
  });

  test('does not encode slashes in a branch name', async () => {
    const id = freshInstallation();
    serve({
      [`POST /app/installations/${id}/access_tokens`]: TOKEN,
      'GET /repos/o/r/branches/release/2026-08': { status: 200 },
    });
    await expect(verifyRepoAccess(id, 'o/r', 'release/2026-08')).resolves.toBeUndefined();
  });
});

describe('getInstallation', () => {
  test('returns the timestamps the callback freshness check reads', async () => {
    const id = freshInstallation();
    serve({
      [`GET /app/installations/${id}`]: {
        status: 200,
        body: { created_at: '2026-07-30T10:00:00Z', updated_at: '2026-07-30T10:05:00Z' },
      },
    });
    await expect(getInstallation(id)).resolves.toEqual({
      created_at: new Date('2026-07-30T10:00:00Z'),
      updated_at: new Date('2026-07-30T10:05:00Z'),
    });
    // Read with the App JWT, not an installation token — no mint happened.
    expect(calls).toHaveLength(1);
  });

  test('404 means the installation never existed or was removed', async () => {
    const id = freshInstallation();
    serve({ [`GET /app/installations/${id}`]: { status: 404, body: { message: 'Not Found' } } });
    await expect(getInstallation(id)).rejects.toMatchObject({ code: 'installation_not_found' });
  });
});

describe('listInstallationRepos', () => {
  test('mints an unscoped token and follows pages', async () => {
    const id = freshInstallation();
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      full_name: `acme/repo-${i}`,
      default_branch: 'main',
      private: false,
    }));
    serve({
      [`POST /app/installations/${id}/access_tokens`]: TOKEN,
      'GET /installation/repositories?per_page=100&page=1': {
        status: 200,
        body: { repositories: page1 },
      },
      'GET /installation/repositories?per_page=100&page=2': {
        status: 200,
        body: {
          repositories: [{ full_name: 'acme/site', default_branch: 'trunk', private: true }],
        },
      },
    });

    const repos = await listInstallationRepos(id);
    expect(repos).toHaveLength(101);
    expect(repos.at(-1)).toEqual({
      full_name: 'acme/site',
      default_branch: 'trunk',
      private: true,
    });
    // Unscoped: we do not know which repo the user wants yet.
    expect(calls[0]!.body).toBeUndefined();
  });
});

describe('commitFiles', () => {
  const headRefs = (repo: string, branch: string) => ({
    [`GET /repos/${repo}/git/ref/heads/${branch}`]: {
      status: 200,
      body: { object: { sha: 'base-commit' } },
    },
    [`GET /repos/${repo}/git/commits/base-commit`]: {
      status: 200,
      body: { tree: { sha: 'base-tree' } },
    },
  });

  test('writes one commit carrying every file, and moves the branch to it', async () => {
    const id = freshInstallation();
    serve({
      [`POST /app/installations/${id}/access_tokens`]: TOKEN,
      ...headRefs('acme/site', 'main'),
      'POST /repos/acme/site/git/blobs': [
        { status: 201, body: { sha: 'blob-md' } },
        { status: 201, body: { sha: 'blob-manifest' } },
      ],
      'POST /repos/acme/site/git/trees': { status: 201, body: { sha: 'new-tree' } },
      'POST /repos/acme/site/git/commits': { status: 201, body: { sha: 'new-commit' } },
      'PATCH /repos/acme/site/git/refs/heads/main': { status: 200 },
    });

    const sha = await commitFiles({
      installationId: id,
      repo: 'acme/site',
      branch: 'main',
      message: 'Publish: widget guide',
      files: [
        { path: 'seopotion/articles/widget-guide.md', content: '## Body' },
        { path: 'seopotion/manifest.json', content: '{}' },
        // A rename leaves the old file behind unless the same commit removes it.
        { path: 'seopotion/articles/old-slug.md', content: null },
      ],
    });
    expect(sha).toBe('new-commit');

    // Two blobs, not three — a deletion has no content to upload.
    expect(calls.filter((c) => c.path.endsWith('/git/blobs'))).toHaveLength(2);

    const tree = calls.find((c) => c.path.endsWith('/git/trees'))!;
    expect(tree.body).toEqual({
      base_tree: 'base-tree',
      tree: [
        {
          path: 'seopotion/articles/widget-guide.md',
          mode: '100644',
          type: 'blob',
          sha: 'blob-md',
        },
        { path: 'seopotion/manifest.json', mode: '100644', type: 'blob', sha: 'blob-manifest' },
        // Null sha is how the tree API spells "delete".
        { path: 'seopotion/articles/old-slug.md', mode: '100644', type: 'blob', sha: null },
      ],
    });

    const commit = calls.find((c) => c.path.endsWith('/git/commits') && c.method === 'POST')!;
    expect(commit.body).toEqual({
      message: 'Publish: widget guide',
      tree: 'new-tree',
      parents: ['base-commit'],
    });
    // No force flag: losing a race must fail, not overwrite.
    expect(calls.at(-1)!.body).toEqual({ sha: 'new-commit' });
  });

  test('rebuilds on the new head when a concurrent publish wins the ref', async () => {
    const id = freshInstallation();
    serve({
      [`POST /app/installations/${id}/access_tokens`]: TOKEN,
      'GET /repos/acme/site/git/ref/heads/main': [
        { status: 200, body: { object: { sha: 'base-commit' } } },
        { status: 200, body: { object: { sha: 'their-commit' } } },
      ],
      'GET /repos/acme/site/git/commits/base-commit': {
        status: 200,
        body: { tree: { sha: 'base-tree' } },
      },
      'GET /repos/acme/site/git/commits/their-commit': {
        status: 200,
        body: { tree: { sha: 'their-tree' } },
      },
      'POST /repos/acme/site/git/blobs': { status: 201, body: { sha: 'blob-md' } },
      'POST /repos/acme/site/git/trees': { status: 201, body: { sha: 'new-tree' } },
      'POST /repos/acme/site/git/commits': { status: 201, body: { sha: 'new-commit' } },
      'PATCH /repos/acme/site/git/refs/heads/main': [
        { status: 422, body: { message: 'Update is not a fast forward' } },
        { status: 200 },
      ],
    });

    await expect(
      commitFiles({
        installationId: id,
        repo: 'acme/site',
        branch: 'main',
        message: 'Publish',
        files: [{ path: 'a.md', content: 'x' }],
      }),
    ).resolves.toBe('new-commit');

    // The retry re-read the head and layered onto THEIR tree, not the stale one.
    const trees = calls.filter((c) => c.path.endsWith('/git/trees'));
    expect(trees).toHaveLength(2);
    expect((trees[1]!.body as { base_tree: string }).base_tree).toBe('their-tree');
  });

  test('gives up as ref_conflict when every attempt loses the race', async () => {
    const id = freshInstallation();
    serve({
      [`POST /app/installations/${id}/access_tokens`]: TOKEN,
      ...headRefs('acme/site', 'main'),
      'POST /repos/acme/site/git/blobs': { status: 201, body: { sha: 'blob-md' } },
      'POST /repos/acme/site/git/trees': { status: 201, body: { sha: 'new-tree' } },
      'POST /repos/acme/site/git/commits': { status: 201, body: { sha: 'new-commit' } },
      'PATCH /repos/acme/site/git/refs/heads/main': {
        status: 422,
        body: { message: 'Update is not a fast forward' },
      },
    });

    await expect(
      commitFiles({
        installationId: id,
        repo: 'acme/site',
        branch: 'main',
        message: 'Publish',
        files: [{ path: 'a.md', content: 'x' }],
      }),
    ).rejects.toMatchObject({ code: 'ref_conflict' });
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(3);
  });

  test('a 422 that is not a race is permanent — protected branch, or a workflows path', async () => {
    const id = freshInstallation();
    serve({
      [`POST /app/installations/${id}/access_tokens`]: TOKEN,
      ...headRefs('acme/site', 'main'),
      'POST /repos/acme/site/git/blobs': { status: 201, body: { sha: 'blob-md' } },
      'POST /repos/acme/site/git/trees': { status: 201, body: { sha: 'new-tree' } },
      'POST /repos/acme/site/git/commits': { status: 201, body: { sha: 'new-commit' } },
      'PATCH /repos/acme/site/git/refs/heads/main': {
        status: 422,
        body: {
          message:
            'refusing to allow a GitHub App to create or update workflow `.github/workflows/deploy.yml` without `workflows` permission',
        },
      },
    });

    const failure = await commitFiles({
      installationId: id,
      repo: 'acme/site',
      branch: 'main',
      message: 'Publish',
      files: [{ path: '.github/workflows/deploy.yml', content: 'on: push' }],
    }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(GithubError);
    expect(failure).toMatchObject({ code: 'commit_rejected' });
    // One attempt, not three: this is never going to succeed on a retry.
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  test('a missing branch fails before anything is written', async () => {
    const id = freshInstallation();
    serve({
      [`POST /app/installations/${id}/access_tokens`]: TOKEN,
      'GET /repos/acme/site/git/ref/heads/gone': { status: 404, body: { message: 'Not Found' } },
    });

    await expect(
      commitFiles({
        installationId: id,
        repo: 'acme/site',
        branch: 'gone',
        message: 'Publish',
        files: [{ path: 'a.md', content: 'x' }],
      }),
    ).rejects.toMatchObject({ code: 'repo_not_found' });
    expect(calls.some((c) => c.path.endsWith('/git/blobs'))).toBe(false);
  });
});
