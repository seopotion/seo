import type { Context, Next } from 'hono';
import { testClient } from 'hono/testing';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  signInstallGrant,
  signInstallState,
  verifyInstallGrant,
  verifyInstallState,
} from '../src/lib/github-state';
import type { AuthEnv } from '../src/middlewares/auth';

const { GithubError, getInstallation, listInstallationRepos, verifyRepoAccess } = vi.hoisted(() => {
  class GithubError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    GithubError,
    getInstallation: vi.fn(),
    listInstallationRepos: vi.fn(),
    verifyRepoAccess: vi.fn(),
  };
});
vi.mock('../src/clients/github', () => ({
  GithubError,
  getInstallation,
  listInstallationRepos,
  verifyRepoAccess,
}));

const { findById, connectStaticSite } = vi.hoisted(() => {
  const now = new Date('2026-07-30T09:00:00.000Z');
  const orgs = new Map<string, Record<string, unknown>>([
    ['org_1', { id: 'org_1', user_id: 'u1', website_url: 'https://clewas.com', created_at: now }],
    ['org_3', { id: 'org_3', user_id: 'u2', website_url: 'https://other.com', created_at: now }],
  ]);
  return {
    findById: vi.fn(async (id: string) => orgs.get(id) ?? null),
    connectStaticSite: vi.fn(async () => true),
  };
});
vi.mock('@shared/db', () => ({
  OrgRepo: { findById },
  OrgMemberRepo: { findByOrgAndEmail: vi.fn(async () => null) },
  IntegrationRepo: { connectStaticSite },
}));

vi.mock('../src/middlewares/auth', async (orig) => {
  const actual = await orig<typeof import('../src/middlewares/auth')>();
  return {
    ...actual,
    authMiddleware: async (c: Context<AuthEnv>, next: Next) => {
      c.set('auth', { userId: 'u1', email: 'u1@example.com' });
      await next();
    },
  };
});

import { config } from '../src/config';
import app from '../src/routes/integrations';

const client = testClient(app);

const REPOS = [{ full_name: 'acme/site', default_branch: 'main', private: false }];

/** A grant for org_1/u1 — what the callback route hands the connect route. */
const grantFor = (installationId = 4242) =>
  signInstallGrant({ org_id: 'org_1', user_id: 'u1', installation_id: installationId });

beforeEach(() => {
  vi.clearAllMocks();
  config.GITHUB_APP_SLUG = 'seopotion-dev';
  getInstallation.mockResolvedValue({ created_at: new Date(), updated_at: new Date() });
  listInstallationRepos.mockResolvedValue(REPOS);
  verifyRepoAccess.mockResolvedValue(undefined);
  connectStaticSite.mockResolvedValue(true);
});

describe('GET /github/install-url', () => {
  test('points at the App and carries a state we can verify', async () => {
    const res = await client.github['install-url'].$get({ query: { org_id: 'org_1' } });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;

    const { url } = await res.json();
    expect(url).toMatch('https://github.com/apps/seopotion-dev/installations/new?state=');
    const state = decodeURIComponent(new URL(url).searchParams.get('state') as string);
    expect(await verifyInstallState(state)).toEqual({ org_id: 'org_1', user_id: 'u1' });
  });

  test('404s for an org the caller does not own', async () => {
    const res = await client.github['install-url'].$get({ query: { org_id: 'org_3' } });
    expect(res.status).toBe(404);
  });

  test('503s rather than linking to a github.com 404 when no App is registered', async () => {
    config.GITHUB_APP_SLUG = '';
    const res = await client.github['install-url'].$get({ query: { org_id: 'org_1' } });
    expect(res.status).toBe(503);
    if (res.status === 503) expect((await res.json()).code).toBe('github_app_not_configured');
  });
});

describe('POST /github/installation', () => {
  test('returns the repos to pick from plus a grant carrying the installation id', async () => {
    const state = await signInstallState({ org_id: 'org_1', user_id: 'u1' });
    const res = await client.github.installation.$post({
      json: { installation_id: 4242, state },
    });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;

    const body = await res.json();
    expect(body.repos).toEqual(REPOS);
    expect(await verifyInstallGrant(body.grant)).toEqual({
      org_id: 'org_1',
      user_id: 'u1',
      installation_id: 4242,
    });
  });

  test('nothing is persisted at this step', async () => {
    const state = await signInstallState({ org_id: 'org_1', user_id: 'u1' });
    await client.github.installation.$post({ json: { installation_id: 4242, state } });
    expect(connectStaticSite).not.toHaveBeenCalled();
  });

  test('rejects an installation that predates this connect flow', async () => {
    // The installation-claim hole: installation ids are small sequential
    // integers, so a signed state alone would let anyone enumerate one and bind
    // a stranger's installation to their own org.
    const old = new Date(Date.now() - 60 * 60_000);
    getInstallation.mockResolvedValue({ created_at: old, updated_at: old });

    const state = await signInstallState({ org_id: 'org_1', user_id: 'u1' });
    const res = await client.github.installation.$post({
      json: { installation_id: 7, state },
    });
    expect(res.status).toBe(400);
    if (res.status === 400) expect((await res.json()).code).toBe('stale_installation');
    expect(listInstallationRepos).not.toHaveBeenCalled();
  });

  test('accepts an installation reconfigured just now, not just a fresh one', async () => {
    getInstallation.mockResolvedValue({
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date(),
    });
    const state = await signInstallState({ org_id: 'org_1', user_id: 'u1' });
    const res = await client.github.installation.$post({
      json: { installation_id: 4242, state },
    });
    expect(res.status).toBe(200);
  });

  test('400s on a forged state, and on one minted for another session', async () => {
    const bad = await client.github.installation.$post({
      json: { installation_id: 4242, state: 'not-a-jwt' },
    });
    expect(bad.status).toBe(400);

    const someoneElse = await signInstallState({ org_id: 'org_1', user_id: 'u2' });
    const stolen = await client.github.installation.$post({
      json: { installation_id: 4242, state: someoneElse },
    });
    expect(stolen.status).toBe(400);
  });

  test('404s when the state names an org the caller does not own', async () => {
    const state = await signInstallState({ org_id: 'org_3', user_id: 'u1' });
    const res = await client.github.installation.$post({
      json: { installation_id: 4242, state },
    });
    expect(res.status).toBe(404);
  });

  test('422 when GitHub says the installation is gone; 502 when the call itself failed', async () => {
    const state = await signInstallState({ org_id: 'org_1', user_id: 'u1' });

    getInstallation.mockRejectedValueOnce(new GithubError('installation_not_found', 'gone'));
    const gone = await client.github.installation.$post({
      json: { installation_id: 4242, state },
    });
    expect(gone.status).toBe(422);
    if (gone.status === 422) expect((await gone.json()).code).toBe('installation_not_found');

    getInstallation.mockRejectedValueOnce(new GithubError('github_request_failed', 'boom'));
    const down = await client.github.installation.$post({
      json: { installation_id: 4242, state },
    });
    expect(down.status).toBe(502);
  });
});

describe('POST /static-site', () => {
  test('verifies the repo before storing, and defaults the content path', async () => {
    const res = await client['static-site'].$post({
      json: {
        grant: await grantFor(),
        repo: 'acme/site',
        branch: 'main',
        post_url_base: 'https://acme.com',
      },
    });
    expect(res.status).toBe(200);

    expect(verifyRepoAccess).toHaveBeenCalledWith(4242, 'acme/site', 'main');
    expect(connectStaticSite).toHaveBeenCalledWith('org_1', {
      installationId: 4242,
      repo: 'acme/site',
      branch: 'main',
      contentPath: 'seopotion/',
      postUrlBase: 'https://acme.com',
    });
    // Verification runs first: a connection that cannot publish is never stored.
    expect(verifyRepoAccess.mock.invocationCallOrder[0]).toBeLessThan(
      connectStaticSite.mock.invocationCallOrder[0] as number,
    );
  });

  test('stores an explicit content path verbatim', async () => {
    await client['static-site'].$post({
      json: {
        grant: await grantFor(),
        repo: 'acme/site',
        branch: 'main',
        content_path: 'content/blog/',
        post_url_base: 'https://acme.com',
      },
    });
    expect(connectStaticSite).toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({ contentPath: 'content/blog/' }),
    );
  });

  test('rejects a post base a post URL cannot be built from, before any GitHub call', async () => {
    for (const post_url_base of ['', 'not a url', 'ftp://a.com', 'https://a.com?page=2']) {
      const res = await client['static-site'].$post({
        json: { grant: await grantFor(), repo: 'acme/site', branch: 'main', post_url_base },
      });
      expect(res.status).toBe(400);
    }
    expect(verifyRepoAccess).not.toHaveBeenCalled();
    expect(connectStaticSite).not.toHaveBeenCalled();
  });

  test('the org and installation come from the grant, never from the body', async () => {
    // There is no org_id or installation_id field to send — the only way to name
    // either is a token we signed.
    const res = await client['static-site'].$post({
      json: {
        grant: 'not-a-jwt',
        repo: 'acme/site',
        branch: 'main',
        post_url_base: 'https://acme.com',
      },
    });
    expect(res.status).toBe(400);
    if (res.status === 400) expect((await res.json()).code).toBe('invalid_grant');

    const someoneElse = await signInstallGrant({
      org_id: 'org_1',
      user_id: 'u2',
      installation_id: 4242,
    });
    const stolen = await client['static-site'].$post({
      json: {
        grant: someoneElse,
        repo: 'acme/site',
        branch: 'main',
        post_url_base: 'https://acme.com',
      },
    });
    expect(stolen.status).toBe(400);
    expect(connectStaticSite).not.toHaveBeenCalled();
  });

  test('404s when the grant names an org the caller does not own', async () => {
    const grant = await signInstallGrant({
      org_id: 'org_3',
      user_id: 'u1',
      installation_id: 4242,
    });
    const res = await client['static-site'].$post({
      json: { grant, repo: 'acme/site', branch: 'main', post_url_base: 'https://acme.com' },
    });
    expect(res.status).toBe(404);
  });

  test('rejects a malformed repo before any GitHub call', async () => {
    const res = await client['static-site'].$post({
      json: {
        grant: await grantFor(),
        repo: 'site',
        branch: 'main',
        post_url_base: 'https://acme.com',
      },
    });
    expect(res.status).toBe(400);
    expect(verifyRepoAccess).not.toHaveBeenCalled();
  });

  test('422 when GitHub cannot reach the repo, and nothing is stored', async () => {
    verifyRepoAccess.mockRejectedValueOnce(new GithubError('repo_not_found', 'no such branch'));
    const res = await client['static-site'].$post({
      json: {
        grant: await grantFor(),
        repo: 'acme/site',
        branch: 'nope',
        post_url_base: 'https://acme.com',
      },
    });
    expect(res.status).toBe(422);
    if (res.status === 422) expect((await res.json()).code).toBe('repo_not_found');
    expect(connectStaticSite).not.toHaveBeenCalled();
  });

  test('409 when the installation is already bound to another org', async () => {
    // The partial unique index rejects it at the database, so this is a real
    // race-proof answer rather than a check-then-write.
    connectStaticSite.mockResolvedValueOnce(false);
    const res = await client['static-site'].$post({
      json: {
        grant: await grantFor(),
        repo: 'acme/site',
        branch: 'main',
        post_url_base: 'https://acme.com',
      },
    });
    expect(res.status).toBe(409);
    if (res.status === 409) expect((await res.json()).code).toBe('installation_claimed');
  });
});
