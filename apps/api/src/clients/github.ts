import { createSign } from 'node:crypto';
import { config } from '../config';
import { getGithubAppKey } from '../lib/secrets';

/**
 * GitHub App client for static-site publishing (#7). Two halves, both designed
 * in design/github-app.md and design/static-site-integration.md:
 *
 *  - Auth: an App JWT signs a per-installation token, scoped down at mint time
 *    to the single repo we are about to write to and cached for warm reuse.
 *  - Writes: one commit per publish (blobs -> tree -> commit -> ref), so the
 *    Markdown and the manifest can never land in separate builds.
 */
const GITHUB_API = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';

/** Installation tokens live an hour; retire them early rather than mid-publish. */
const TOKEN_MARGIN_MS = 5 * 60_000;
/** GitHub rejects an App JWT whose lifetime exceeds 10 minutes. */
const APP_JWT_TTL_SECONDS = 480;
const APP_JWT_BACKDATE_SECONDS = 60;

const REPOS_PER_PAGE = 100;
/** A client with more repositories than this is not one we can usefully list. */
const REPOS_MAX_PAGES = 5;

/** A racing publish is the expected reason to retry; three losses is a real jam. */
const REF_ATTEMPTS = 3;
const REF_BACKOFF_MS = 150;

/** Failure modes the callers map onto `integration.last_error` / an HTTP status. */
export type GithubErrorCode =
  /** The client uninstalled the App — offer "reconnect", not "retry". */
  | 'installation_not_found'
  /** The installation is suspended: connected, but broken. */
  | 'installation_suspended'
  /** The installation does not grant `contents: write`. */
  | 'missing_write_permission'
  /** Repo renamed, dropped from the installation's selection, or no such branch. */
  | 'repo_not_found'
  /** Protected branch, or a path under `.github/workflows/` — our bug, not theirs. */
  | 'commit_rejected'
  /** Concurrent publishes kept moving the branch out from under us. */
  | 'ref_conflict'
  | 'github_request_failed';

export class GithubError extends Error {
  constructor(
    readonly code: GithubErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GithubError';
  }
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * App JWT, RS256. Signed with node:crypto rather than `hono/jwt`: GitHub issues
 * a PKCS#1 PEM and hono signs through WebCrypto, which imports PKCS#8 only — so
 * the obvious reuse fails at runtime, not at compile time.
 */
async function appJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  // `iat` is backdated so a fast clock on our side is not read as a future token.
  const payload = base64url(
    JSON.stringify({
      iat: now - APP_JWT_BACKDATE_SECONDS,
      exp: now + APP_JWT_TTL_SECONDS,
      iss: config.GITHUB_APP_CLIENT_ID,
    }),
  );
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${payload}`)
    .sign(await getGithubAppKey());
  return `${header}.${payload}.${base64url(signature)}`;
}

async function request<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    if (text) data = JSON.parse(text);
  } catch {
    // A gateway HTML page during an outage: the status is the signal, not the body.
  }
  return { status: res.status, data: data as T };
}

function githubMessage(data: unknown): string {
  return typeof data === 'object' && data !== null && 'message' in data
    ? String((data as { message: unknown }).message)
    : '';
}

/** `owner/name` -> `name`: the token mint scopes by bare repository name. */
function repoName(repo: string): string {
  const name = repo.split('/')[1];
  if (!name)
    throw new GithubError('repo_not_found', `Repository must be "owner/name", got "${repo}"`);
  return name;
}

interface InstallationToken {
  token: string;
  expires_at: number;
}

/** Keyed `${installationId}:${repo ?? '*'}` — a warm Lambda skips the mint entirely. */
const tokenCache = new Map<string, InstallationToken>();

/**
 * Mint (or reuse) an installation token. Passing `repo` scopes the token DOWN to
 * that one repository even when the client installed us on twenty, and asks for
 * `contents: write` explicitly — so a missing permission fails here, at connect
 * time, rather than at the first commit.
 */
async function installationToken(installationId: number, repo?: string): Promise<string> {
  const cacheKey = `${installationId}:${repo ?? '*'}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expires_at - TOKEN_MARGIN_MS > Date.now()) return cached.token;

  const { status, data } = await request<{ token?: string; expires_at?: string }>(
    await appJwt(),
    'POST',
    `/app/installations/${installationId}/access_tokens`,
    repo ? { repositories: [repoName(repo)], permissions: { contents: 'write' } } : undefined,
  );

  if (status === 404) {
    throw new GithubError(
      'installation_not_found',
      `Installation ${installationId} no longer exists`,
    );
  }
  if (status === 403) {
    throw new GithubError('installation_suspended', `Installation ${installationId} is suspended`);
  }
  if (status === 422) {
    // GitHub returns 422 for both "you asked for a permission you don't have"
    // and "that repository isn't in this installation". Only the message tells
    // them apart, and the difference matters: one is fixable by re-selecting a
    // repo, the other by re-installing with wider permissions.
    const message = githubMessage(data);
    if (/permission/i.test(message)) throw new GithubError('missing_write_permission', message);
    throw new GithubError(
      'repo_not_found',
      message || `${repo} is not in installation ${installationId}`,
    );
  }
  if (status !== 201 || !data.token) {
    throw new GithubError('github_request_failed', `Installation token mint failed (${status})`);
  }

  const token = data.token;
  tokenCache.set(cacheKey, {
    token,
    expires_at: data.expires_at ? Date.parse(data.expires_at) : Date.now() + 3600_000,
  });
  return token;
}

/**
 * The installation record, read with the App JWT rather than an installation
 * token. Only the timestamps are returned because only they are used: the
 * callback route checks that the installation it was handed was created (or
 * reconfigured) just now — see routes/integrations.ts.
 */
export async function getInstallation(
  installationId: number,
): Promise<{ created_at: Date; updated_at: Date }> {
  const { status, data } = await request<{ created_at?: string; updated_at?: string }>(
    await appJwt(),
    'GET',
    `/app/installations/${installationId}`,
  );
  if (status === 404) {
    throw new GithubError(
      'installation_not_found',
      `Installation ${installationId} does not exist`,
    );
  }
  if (status === 403) {
    throw new GithubError('installation_suspended', `Installation ${installationId} is suspended`);
  }
  if (status !== 200 || !data.created_at) {
    throw new GithubError('github_request_failed', `Installation read failed (${status})`);
  }
  return {
    created_at: new Date(data.created_at),
    updated_at: new Date(data.updated_at ?? data.created_at),
  };
}

export interface GithubRepo {
  full_name: string;
  default_branch: string;
  private: boolean;
}

/** The repositories the client selected when installing — the connect screen's picker. */
export async function listInstallationRepos(installationId: number): Promise<GithubRepo[]> {
  const token = await installationToken(installationId);
  const repos: GithubRepo[] = [];
  for (let page = 1; page <= REPOS_MAX_PAGES; page++) {
    const { status, data } = await request<{ repositories?: GithubRepo[] }>(
      token,
      'GET',
      `/installation/repositories?per_page=${REPOS_PER_PAGE}&page=${page}`,
    );
    if (status !== 200) {
      throw new GithubError(
        'github_request_failed',
        `Listing installation repos failed (${status})`,
      );
    }
    const batch = data.repositories ?? [];
    for (const r of batch) {
      repos.push({
        full_name: String(r.full_name),
        default_branch: String(r.default_branch),
        private: Boolean(r.private),
      });
    }
    if (batch.length < REPOS_PER_PAGE) break;
  }
  return repos;
}

/**
 * Connect-time check: can we actually write `repo` at `branch`? Minting the
 * scoped token covers uninstall, suspension, repo selection and the write
 * permission; the branch read covers the branch itself. Throws GithubError.
 */
export async function verifyRepoAccess(
  installationId: number,
  repo: string,
  branch: string,
): Promise<void> {
  const token = await installationToken(installationId, repo);
  // Branch names contain slashes (`release/2026-08`), which are meaningful in
  // this path — encoding them would 404 every non-trivial branch.
  const { status } = await request(token, 'GET', `/repos/${repo}/branches/${branch}`);
  if (status === 404) {
    throw new GithubError(
      'repo_not_found',
      `${repo}@${branch} is not readable by this installation`,
    );
  }
  if (status !== 200) {
    throw new GithubError('github_request_failed', `Branch read failed (${status})`);
  }
}

export interface CommitFile {
  /** Repo-root-relative path. */
  path: string;
  /** UTF-8 contents, or `null` to delete the file in the same commit. */
  content: string | null;
}

export interface CommitPreparationContext {
  headCommitSha: string;
  readFile(path: string): Promise<string | null>;
}

type CommitFilesOptions = {
  installationId: number;
  repo: string;
  branch: string;
  message: string;
} & (
  | { files: CommitFile[]; prepare?: never }
  | {
      files?: never;
      prepare(context: CommitPreparationContext): Promise<CommitFile[]>;
    }
);

async function headCommit(
  token: string,
  repo: string,
  branch: string,
): Promise<{ commit_sha: string; tree_sha: string }> {
  const ref = await request<{ object?: { sha?: string } }>(
    token,
    'GET',
    `/repos/${repo}/git/ref/heads/${branch}`,
  );
  if (ref.status === 404) throw new GithubError('repo_not_found', `${repo}@${branch} not found`);
  if (ref.status !== 200 || !ref.data.object?.sha) {
    throw new GithubError('github_request_failed', `Ref read failed (${ref.status})`);
  }
  const commit = await request<{ tree?: { sha?: string } }>(
    token,
    'GET',
    `/repos/${repo}/git/commits/${ref.data.object.sha}`,
  );
  if (commit.status !== 200 || !commit.data.tree?.sha) {
    throw new GithubError('github_request_failed', `Commit read failed (${commit.status})`);
  }
  return { commit_sha: ref.data.object.sha, tree_sha: commit.data.tree.sha };
}

function contentPath(path: string): string {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

async function readFileAtCommit(
  token: string,
  repo: string,
  commitSha: string,
  path: string,
): Promise<string | null> {
  const result = await request<{ content?: string; encoding?: string }>(
    token,
    'GET',
    `/repos/${repo}/contents/${contentPath(path)}?ref=${encodeURIComponent(commitSha)}`,
  );
  if (result.status === 404) return null;
  if (result.status !== 200 || result.data.encoding !== 'base64' || !result.data.content) {
    throw new GithubError('github_request_failed', `File read failed (${result.status})`);
  }
  return Buffer.from(result.data.content.replace(/\s/g, ''), 'base64').toString('utf8');
}

/** One tree carrying every write and delete, layered over the branch's current tree. */
async function buildTree(
  token: string,
  repo: string,
  baseTree: string,
  files: CommitFile[],
): Promise<string> {
  const entries: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string | null }> = [];
  for (const file of files) {
    if (file.content === null) {
      // A null sha is how the tree API expresses a deletion.
      entries.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const blob = await request<{ sha?: string }>(token, 'POST', `/repos/${repo}/git/blobs`, {
      content: file.content,
      encoding: 'utf-8',
    });
    if (blob.status !== 201 || !blob.data.sha) {
      throw new GithubError('github_request_failed', `Blob create failed (${blob.status})`);
    }
    entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.data.sha });
  }

  const tree = await request<{ sha?: string }>(token, 'POST', `/repos/${repo}/git/trees`, {
    base_tree: baseTree,
    tree: entries,
  });
  if (tree.status !== 201 || !tree.data.sha) {
    throw new GithubError('github_request_failed', `Tree create failed (${tree.status})`);
  }
  return tree.data.sha;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Commit every file at once and move the branch to it. Returns the commit sha,
 * which is what `article.publications[].ref` records for this provider.
 *
 * Never `PUT /contents/{path}` per file: that is N commits, N builds, and a race
 * between them.
 */
export async function commitFiles(opts: CommitFilesOptions): Promise<string> {
  const token = await installationToken(opts.installationId, opts.repo);

  for (let attempt = 0; attempt < REF_ATTEMPTS; attempt++) {
    const base = await headCommit(token, opts.repo, opts.branch);
    const files = opts.prepare
      ? await opts.prepare({
          headCommitSha: base.commit_sha,
          readFile: (path) => readFileAtCommit(token, opts.repo, base.commit_sha, path),
        })
      : opts.files;
    const tree = await buildTree(token, opts.repo, base.tree_sha, files);
    if (tree === base.tree_sha) return base.commit_sha;
    const created = await request<{ sha?: string }>(
      token,
      'POST',
      `/repos/${opts.repo}/git/commits`,
      {
        message: opts.message,
        tree,
        parents: [base.commit_sha],
      },
    );
    if (created.status !== 201 || !created.data.sha) {
      throw new GithubError('github_request_failed', `Commit create failed (${created.status})`);
    }

    // No `force`: a non-fast-forward here means someone else published while we
    // were building the tree, and losing that race is the correct outcome.
    const moved = await request<unknown>(
      token,
      'PATCH',
      `/repos/${opts.repo}/git/refs/heads/${opts.branch}`,
      { sha: created.data.sha },
    );
    if (moved.status === 200) return created.data.sha;

    const message = githubMessage(moved.data);
    if (moved.status === 422 && /fast forward/i.test(message)) {
      await sleep(REF_BACKOFF_MS * (attempt + 1));
      continue;
    }
    if (moved.status === 422) {
      // Protected branch, or a path under `.github/workflows/` — we hold no
      // `workflows: write` on purpose (design/github-app.md).
      throw new GithubError('commit_rejected', message);
    }
    throw new GithubError('github_request_failed', `Ref update failed (${moved.status})`);
  }

  throw new GithubError('ref_conflict', `${opts.repo}@${opts.branch} moved under every retry`);
}
