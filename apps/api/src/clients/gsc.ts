import { OAuth2Client } from 'google-auth-library';
import { config } from '../config';
import { getGoogleClientSecret } from '../lib/secrets';

/**
 * Google Search Console client (#12). OAuth2Client handles the code exchange
 * and refresh-token -> access-token minting; the two REST calls (sites list,
 * Search Analytics query) go over plain fetch — no googleapis dependency.
 */
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/webmasters.readonly'];
const GSC_API = 'https://www.googleapis.com/webmasters/v3';

/** Thrown when Google reports the grant revoked — callers close the GSC gate. */
export class GscAuthRevokedError extends Error {}

async function oauthClient(): Promise<OAuth2Client> {
  return new OAuth2Client(
    config.GOOGLE_CLIENT_ID,
    await getGoogleClientSecret(),
    `${config.WEB_ORIGIN}/dashboard/gsc/callback`,
  );
}

export async function buildAuthUrl(state: string): Promise<string> {
  const client = await oauthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });
}

export interface GscTokens {
  refreshToken: string;
  email: string;
}

/** Exchange the callback code server-side; the client secret never leaves the API. */
export async function exchangeCode(code: string): Promise<GscTokens> {
  const client = await oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token || !tokens.id_token) {
    throw new Error('Google token exchange returned no refresh token');
  }
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: config.GOOGLE_CLIENT_ID,
  });
  return { refreshToken: tokens.refresh_token, email: ticket.getPayload()?.email ?? '' };
}

/**
 * One OAuth2Client per refresh token, kept at module scope for Lambda warm
 * reuse (#102). OAuth2Client caches the access token it mints and only
 * re-mints when that token is expiring, so the reads behind one dashboard
 * render share a single refresh grant instead of each minting their own.
 * Bounded at one entry per connected org; oldest evicted past the cap.
 */
const clientsByRefreshToken = new Map<string, OAuth2Client>();
const MAX_CACHED_CLIENTS = 500;

async function clientFor(refreshToken: string): Promise<OAuth2Client> {
  const cached = clientsByRefreshToken.get(refreshToken);
  if (cached) return cached;
  const client = await oauthClient();
  client.setCredentials({ refresh_token: refreshToken });
  if (clientsByRefreshToken.size >= MAX_CACHED_CLIENTS) {
    const oldest = clientsByRefreshToken.keys().next().value;
    if (oldest !== undefined) clientsByRefreshToken.delete(oldest);
  }
  clientsByRefreshToken.set(refreshToken, client);
  return client;
}

async function accessToken(refreshToken: string): Promise<string> {
  const client = await clientFor(refreshToken);
  try {
    const { token } = await client.getAccessToken();
    if (!token) throw new Error('Google returned no access token');
    return token;
  } catch (err) {
    // Drop the client so a reconnect with a new grant doesn't hit a dead entry.
    clientsByRefreshToken.delete(refreshToken);
    if (String(err).includes('invalid_grant')) {
      throw new GscAuthRevokedError('GSC access revoked');
    }
    throw err;
  }
}

export interface GscSite {
  site_url: string;
  permission_level: string;
}

export async function listSites(refreshToken: string): Promise<GscSite[]> {
  const token = await accessToken(refreshToken);
  const res = await fetch(`${GSC_API}/sites`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GSC sites list failed (${res.status})`);
  const body = (await res.json()) as {
    siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }>;
  };
  return (body.siteEntry ?? []).map((s) => ({
    site_url: String(s.siteUrl ?? ''),
    permission_level: String(s.permissionLevel ?? ''),
  }));
}

export interface SearchAnalyticsParams {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  rowLimit?: number;
  // Pass-through filter groups (issue #208: per-article `page equals <url>`).
  dimensionFilterGroups?: Array<{
    groupType?: string;
    filters: Array<{ dimension: string; operator: string; expression: string }>;
  }>;
}

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export async function querySearchAnalytics(
  refreshToken: string,
  siteUrl: string,
  params: SearchAnalyticsParams,
): Promise<SearchAnalyticsRow[]> {
  const token = await accessToken(refreshToken);
  const res = await fetch(`${GSC_API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`GSC search analytics failed (${res.status})`);
  const body = (await res.json()) as { rows?: Array<Record<string, unknown>> };
  return (body.rows ?? []).map((r) => ({
    keys: Array.isArray(r.keys) ? r.keys.map(String) : [],
    clicks: Number(r.clicks ?? 0),
    impressions: Number(r.impressions ?? 0),
    ctr: Number(r.ctr ?? 0),
    position: Number(r.position ?? 0),
  }));
}
