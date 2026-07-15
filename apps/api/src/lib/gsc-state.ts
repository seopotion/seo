import { sign, verify } from 'hono/jwt';
import { getJwtSecret } from '../auth/secret';

/**
 * OAuth `state` for the GSC connect flow (#12): a short-lived signed JWT tying
 * the Google callback to the org/user that started it (CSRF protection).
 * Reuses the session-JWT secret; the `purpose` claim stops a session token
 * from doubling as state (and vice versa).
 */
const STATE_TTL_SECONDS = 600;

export interface GscState {
  org_id: string;
  user_id: string;
}

export async function signGscState(state: GscState): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;
  return sign({ ...state, purpose: 'gsc-state', exp }, await getJwtSecret());
}

/** Throws on an invalid, expired, or wrong-purpose token. */
export async function verifyGscState(token: string): Promise<GscState> {
  const payload = await verify(token, await getJwtSecret(), 'HS256');
  if (payload.purpose !== 'gsc-state') throw new Error('Invalid GSC state token');
  return { org_id: String(payload.org_id), user_id: String(payload.user_id) };
}
