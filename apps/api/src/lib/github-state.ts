import { sign, verify } from 'hono/jwt';
import { getJwtSecret } from '../auth/secret';

/**
 * Signed tokens for the GitHub App install flow (#7, design/github-app.md).
 * Same shape and secret as lib/gsc-state.ts, distinguished by `purpose`.
 *
 * Why both exist: `installation_id` is a small sequential integer sitting in the
 * URL bar of whoever installed the App — not a secret. A connect endpoint that
 * accepted a bare one would let any customer bind someone else's installation to
 * their org and publish into a stranger's repository. So:
 *
 *  - `state` rides the install URL and proves the callback belongs to the org
 *    that started it.
 *  - `grant` is re-issued at the callback and carries the installation id we
 *    just verified, so the connect route never reads either id from the client.
 *
 * The grant exists because the state's TTL is sized for an instant redemption,
 * and here the user still has to pick a repo and a branch first.
 */
const STATE_TTL_SECONDS = 600;
const GRANT_TTL_SECONDS = 900;

export interface GithubInstallState {
  org_id: string;
  user_id: string;
}

export interface GithubInstallGrant extends GithubInstallState {
  installation_id: number;
}

export async function signInstallState(state: GithubInstallState): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;
  return sign({ ...state, purpose: 'github-install', exp }, await getJwtSecret());
}

/** Throws on an invalid, expired, or wrong-purpose token. */
export async function verifyInstallState(token: string): Promise<GithubInstallState> {
  const payload = await verify(token, await getJwtSecret(), 'HS256');
  if (payload.purpose !== 'github-install') throw new Error('Invalid GitHub install state');
  return { org_id: String(payload.org_id), user_id: String(payload.user_id) };
}

export async function signInstallGrant(grant: GithubInstallGrant): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + GRANT_TTL_SECONDS;
  return sign({ ...grant, purpose: 'github-install-grant', exp }, await getJwtSecret());
}

/** Throws on an invalid, expired, or wrong-purpose token. */
export async function verifyInstallGrant(token: string): Promise<GithubInstallGrant> {
  const payload = await verify(token, await getJwtSecret(), 'HS256');
  if (payload.purpose !== 'github-install-grant') throw new Error('Invalid GitHub install grant');
  return {
    org_id: String(payload.org_id),
    user_id: String(payload.user_id),
    installation_id: Number(payload.installation_id),
  };
}
