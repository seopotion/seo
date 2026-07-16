# Google Search Console Integration Implementation Plan (PR 2 of issue #12)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GSC OAuth (authorization-code + offline refresh token) per org, with live Search Analytics reads that ungate the dashboard's Best Articles and (new) Search Performance cards.

**Architecture:** New `gsc_connections` collection (one per org, unique index) stores an AES-256-GCM-encrypted refresh token; `site_url` stays null until the user picks a property. OAuth flow: API builds the consent URL (signed-JWT `state`), Google redirects to a web callback page, which POSTs the code to the API for a server-side exchange. Data endpoints mint access tokens from the refresh token and query the Search Analytics REST API live — no sync jobs. A failed refresh (revoked) closes the gate until reconnect.

**Tech Stack:** `@hono/zod-openapi` routes + typed RPC client, `google-auth-library` (already an api dependency) for token exchange/refresh, plain `fetch` for the two GSC REST calls, Node built-in `crypto` for AES-256-GCM, Zod + official mongodb driver, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-domain-rating-gsc-design.md` (Part 2).

## Global Constraints

- Branch: `ozykhan/gsc-integration` off `dev` **after PR 1 (`ozykhan/domain-rating`) merges**. PR into `dev`, body includes `Closes #12`. Never commit to `dev` directly.
- Biome formatting: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` on new code.
- `verbatimModuleSyntax`: `import type` for type-only imports; `export type` when re-exporting types.
- Every `.openapi(...)` route stays **chained** so `AppType` captures it. New routers use `OpenAPIHono<AuthEnv>`, never plain `Hono`.
- Zod API schemas use `.openapi('Name')`.
- Only the API Lambda gets GSC secrets — never the worker.
- Before claiming done: `npm run lint`, `npm run check:all`, `npm test` must all pass. `npm run test:integration` needs `docker compose up -d mongo`.
- All commands run from the repo root unless stated otherwise.
- GSC gate definition (used everywhere): a row exists AND `site_url !== null` AND `last_refresh_failed_at === null`.

---

### Task 1: `GscConnectionSchema` + `isGscConnected` gate helper

**Files:**
- Create: `packages/shared/schemas/src/gsc.ts`
- Modify: `packages/shared/schemas/src/index.ts`
- Test: `packages/shared/schemas/tests/gsc.test.ts`

**Interfaces:**
- Produces: `GscConnection` entity type `{ id, org_id, refresh_token_enc, site_url: string | null, google_email, connected_at: Date, last_refresh_failed_at: Date | null }` and `isGscConnected(conn: GscConnection | null): conn is GscConnection & { site_url: string }` — both exported from `@shared/schemas`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/schemas/tests/gsc.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { GscConnectionSchema, isGscConnected } from '../src/gsc';

const base = {
  id: 'c1',
  org_id: 'org_1',
  refresh_token_enc: 'ZW5j',
  site_url: 'sc-domain:clewas.com',
  google_email: 'owner@clewas.com',
  connected_at: new Date(),
  last_refresh_failed_at: null,
};

describe('GscConnectionSchema', () => {
  test('parses a complete connection', () => {
    expect(GscConnectionSchema.parse(base).site_url).toBe('sc-domain:clewas.com');
  });

  test('site_url and last_refresh_failed_at are nullable, not optional', () => {
    expect(GscConnectionSchema.parse({ ...base, site_url: null }).site_url).toBeNull();
    expect(() => GscConnectionSchema.parse({ ...base, site_url: undefined })).toThrow();
  });
});

describe('isGscConnected', () => {
  test('true only for a complete, healthy connection', () => {
    expect(isGscConnected(GscConnectionSchema.parse(base))).toBe(true);
  });

  test('false for null, pending site pick, or failed refresh', () => {
    expect(isGscConnected(null)).toBe(false);
    expect(isGscConnected(GscConnectionSchema.parse({ ...base, site_url: null }))).toBe(false);
    expect(
      isGscConnected(GscConnectionSchema.parse({ ...base, last_refresh_failed_at: new Date() })),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- gsc`
Expected: FAIL — cannot resolve `../src/gsc`.

- [ ] **Step 3: Implement**

Create `packages/shared/schemas/src/gsc.ts`:

```ts
import { z } from 'zod';

/**
 * Google Search Console connection — one per org (#12). The refresh token is
 * stored AES-256-GCM-encrypted (apps/api/src/lib/crypto.ts); `site_url` is
 * null between the OAuth code exchange and the user's property pick.
 */
export const GscConnectionSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  refresh_token_enc: z.string(),
  site_url: z.string().nullable(),
  google_email: z.string(),
  connected_at: z.date(),
  last_refresh_failed_at: z.date().nullable(),
});
export type GscConnection = z.infer<typeof GscConnectionSchema>;

/**
 * The GSC gate (#12): connected iff the property is chosen and the last token
 * refresh didn't fail. Gates the Home Best Articles / Search Performance cards.
 */
export function isGscConnected(
  conn: GscConnection | null,
): conn is GscConnection & { site_url: string } {
  return conn !== null && conn.site_url !== null && conn.last_refresh_failed_at === null;
}
```

Add to `packages/shared/schemas/src/index.ts` (alphabetical, after `./candidate`):

```ts
export * from './gsc';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- gsc`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/schemas/src/gsc.ts packages/shared/schemas/src/index.ts packages/shared/schemas/tests/gsc.test.ts
git commit -m "[backend] GscConnection schema + isGscConnected gate (#12)"
```

---

### Task 2: `GscConnectionRepo` + unique index

**Files:**
- Create: `packages/shared/db/src/repositories/gsc-connection.repo.ts`
- Modify: `packages/shared/db/src/index.ts`
- Modify: `packages/shared/db/src/ensure-indexes.ts`
- Test: `packages/shared/db/tests/gsc-connection.repo.integration.test.ts`

**Interfaces:**
- Consumes: `GscConnection`/`GscConnectionSchema` from Task 1; `getDb` from `../client`.
- Produces (exported from `@shared/db` as `GscConnectionRepo`):
  - `findByOrgId(orgId: string): Promise<GscConnection | null>`
  - `upsertToken(orgId: string, refreshTokenEnc: string, googleEmail: string): Promise<void>` — resets `site_url: null`, `last_refresh_failed_at: null`, stamps `connected_at`
  - `setSiteUrl(orgId: string, siteUrl: string): Promise<void>`
  - `markRefreshFailed(orgId: string): Promise<void>`
  - `deleteByOrgId(orgId: string): Promise<boolean>`

- [ ] **Step 1: Write the failing integration test**

Create `packages/shared/db/tests/gsc-connection.repo.integration.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { GscConnectionRepo } from '../src/repositories/gsc-connection.repo';

/**
 * Real-MongoDB round-trip for GscConnectionRepo. Run with
 * `npm run test:integration` after `docker compose up -d mongo`.
 */
describe('GscConnectionRepo (integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('gsc_connections').deleteMany({});
  });

  afterAll(async () => {
    await closeDb();
  });

  test('upsertToken creates a pending connection (site_url null)', async () => {
    await GscConnectionRepo.upsertToken('org_a', 'enc-1', 'a@x.com');

    const conn = await GscConnectionRepo.findByOrgId('org_a');
    expect(conn?.refresh_token_enc).toBe('enc-1');
    expect(conn?.site_url).toBeNull();
    expect(conn?.last_refresh_failed_at).toBeNull();
  });

  test('upsertToken replaces the token and resets state on reconnect', async () => {
    await GscConnectionRepo.setSiteUrl('org_a', 'sc-domain:a.com');
    await GscConnectionRepo.markRefreshFailed('org_a');

    await GscConnectionRepo.upsertToken('org_a', 'enc-2', 'a@x.com');

    const conn = await GscConnectionRepo.findByOrgId('org_a');
    expect(conn?.refresh_token_enc).toBe('enc-2');
    expect(conn?.site_url).toBeNull();
    expect(conn?.last_refresh_failed_at).toBeNull();
  });

  test('setSiteUrl finalizes and markRefreshFailed stamps a date', async () => {
    await GscConnectionRepo.setSiteUrl('org_a', 'sc-domain:a.com');
    expect((await GscConnectionRepo.findByOrgId('org_a'))?.site_url).toBe('sc-domain:a.com');

    await GscConnectionRepo.markRefreshFailed('org_a');
    expect(
      (await GscConnectionRepo.findByOrgId('org_a'))?.last_refresh_failed_at,
    ).toBeInstanceOf(Date);
  });

  test('deleteByOrgId removes the row and reports it', async () => {
    expect(await GscConnectionRepo.deleteByOrgId('org_a')).toBe(true);
    expect(await GscConnectionRepo.findByOrgId('org_a')).toBeNull();
    expect(await GscConnectionRepo.deleteByOrgId('org_a')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose up -d mongo && npm run test:integration -- gsc-connection`
Expected: FAIL — cannot resolve `../src/repositories/gsc-connection.repo`. (If Docker is unavailable, note it in the task report; the repo code still lands and typechecks.)

- [ ] **Step 3: Implement**

Create `packages/shared/db/src/repositories/gsc-connection.repo.ts`:

```ts
import { type GscConnection, GscConnectionSchema } from '@shared/schemas';
import type { Document, WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('gsc_connections');

/** Map a Mongo document to a validated entity (`_id` -> string `id`). */
function toEntity(doc: WithId<Document>): GscConnection {
  const { _id, ...rest } = doc;
  return GscConnectionSchema.parse({ id: _id.toString(), ...rest });
}

export const GscConnectionRepo = {
  async findByOrgId(orgId: string): Promise<GscConnection | null> {
    const doc = await (await collection()).findOne({ org_id: orgId });
    return doc ? toEntity(doc) : null;
  },

  /**
   * Store a freshly exchanged (encrypted) refresh token, resetting the row to
   * the "property not yet chosen" state. Upsert: reconnecting replaces the old
   * token and clears any standing refresh failure.
   */
  async upsertToken(orgId: string, refreshTokenEnc: string, googleEmail: string): Promise<void> {
    await (await collection()).updateOne(
      { org_id: orgId },
      {
        $set: {
          refresh_token_enc: refreshTokenEnc,
          google_email: googleEmail,
          site_url: null,
          connected_at: new Date(),
          last_refresh_failed_at: null,
        },
      },
      { upsert: true },
    );
  },

  /** Finalize the connection with the user-chosen GSC property. */
  async setSiteUrl(orgId: string, siteUrl: string): Promise<void> {
    await (await collection()).updateOne({ org_id: orgId }, { $set: { site_url: siteUrl } });
  },

  /** Record a failed token refresh (revoked access) — closes the gate. */
  async markRefreshFailed(orgId: string): Promise<void> {
    await (await collection()).updateOne(
      { org_id: orgId },
      { $set: { last_refresh_failed_at: new Date() } },
    );
  },

  /** Disconnect (used by DELETE /dashboard/gsc). Returns true when a row matched. */
  async deleteByOrgId(orgId: string): Promise<boolean> {
    const res = await (await collection()).deleteOne({ org_id: orgId });
    return res.deletedCount === 1;
  },
};
```

Add to `packages/shared/db/src/index.ts` (alphabetical, after `CandidateRepo`):

```ts
export { GscConnectionRepo } from './repositories/gsc-connection.repo';
```

Add to `packages/shared/db/src/ensure-indexes.ts` (end of `ensureIndexes`, before the closing brace):

```ts
  // One GSC connection per org (#12); the unique index makes upsertToken safe
  // under concurrent connect callbacks.
  await db.collection('gsc_connections').createIndex({ org_id: 1 }, { unique: true });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:integration -- gsc-connection`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/db/src/repositories/gsc-connection.repo.ts packages/shared/db/src/index.ts packages/shared/db/src/ensure-indexes.ts packages/shared/db/tests/gsc-connection.repo.integration.test.ts
git commit -m "[backend] GscConnectionRepo + unique org_id index (#12)"
```

---

### Task 3: Token crypto + config + secret resolution

**Files:**
- Create: `apps/api/src/lib/crypto.ts`
- Create: `apps/api/src/lib/secrets.ts`
- Modify: `apps/api/src/config.ts`
- Test: `apps/api/tests/crypto.test.ts`

**Interfaces:**
- Consumes: `getParameter` from `@aws-lambda-powertools/parameters/ssm` (same pattern as `apps/api/src/auth/secret.ts`).
- Produces:
  - `encryptSecret(plaintext: string, key: Buffer): string` / `decryptSecret(payload: string, key: Buffer): string` — AES-256-GCM, payload = `base64( iv(12) | authTag(16) | ciphertext )`
  - `getGoogleClientSecret(): Promise<string>` and `getGscTokenKey(): Promise<Buffer>` (32-byte key, stored base64) from `../lib/secrets`
  - New `config` fields: `GOOGLE_CLIENT_SECRET_PARAM`, `GOOGLE_CLIENT_SECRET`, `GSC_TOKEN_KEY_PARAM`, `GSC_TOKEN_KEY`, `WEB_ORIGIN` (default `http://localhost:3000`)

- [ ] **Step 1: Write the failing crypto test**

Create `apps/api/tests/crypto.test.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/lib/crypto';

describe('secret crypto (AES-256-GCM)', () => {
  const key = randomBytes(32);

  test('round-trips a refresh token', () => {
    const payload = encryptSecret('1//refresh-token-value', key);
    expect(payload).not.toContain('refresh-token-value');
    expect(decryptSecret(payload, key)).toBe('1//refresh-token-value');
  });

  test('unique IV per call: same plaintext, different ciphertext', () => {
    expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key));
  });

  test('rejects the wrong key', () => {
    const payload = encryptSecret('secret', key);
    expect(() => decryptSecret(payload, randomBytes(32))).toThrow();
  });

  test('rejects a tampered payload', () => {
    const buf = Buffer.from(encryptSecret('secret', key), 'base64');
    buf[buf.length - 1] ^= 0xff;
    expect(() => decryptSecret(buf.toString('base64'), key)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- crypto`
Expected: FAIL — cannot resolve `../src/lib/crypto`.

- [ ] **Step 3: Implement crypto**

Create `apps/api/src/lib/crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for secrets at rest (GSC refresh tokens, #12). Payload layout:
 * base64( iv(12) | authTag(16) | ciphertext ). The 32-byte key comes from
 * getGscTokenKey() (lib/secrets.ts).
 */
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/** Throws on a wrong key or tampered payload (GCM auth failure). */
export function decryptSecret(payload: string, key: Buffer): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- crypto`
Expected: PASS (4 tests).

- [ ] **Step 5: Add config fields + secret resolution**

In `apps/api/src/config.ts`, add to the `config` object after `GOOGLE_CLIENT_ID`:

```ts
  /** Name of the SSM SecureString holding the Google OAuth client secret in
   * deployed envs. Unset locally — GOOGLE_CLIENT_SECRET below is used directly. */
  GOOGLE_CLIENT_SECRET_PARAM: process.env.GOOGLE_CLIENT_SECRET_PARAM ?? '',
  /** Local-dev Google OAuth client secret (GSC authorization-code flow, #12). */
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? '',
  /** Name of the SSM SecureString holding the GSC token encryption key. */
  GSC_TOKEN_KEY_PARAM: process.env.GSC_TOKEN_KEY_PARAM ?? '',
  /** Local-dev GSC token key: 32 bytes, base64 (`openssl rand -base64 32`). */
  GSC_TOKEN_KEY: process.env.GSC_TOKEN_KEY ?? '',
  /** Web app origin — builds the GSC OAuth redirect URI (<origin>/dashboard/gsc/callback). */
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
```

Create `apps/api/src/lib/secrets.ts`:

```ts
import { getParameter } from '@aws-lambda-powertools/parameters/ssm';
import { config } from '../config';

/**
 * GSC-flow secrets (#12), resolved with the same pattern as auth/secret.ts:
 * deployed envs read an SSM SecureString named by the *_PARAM env var (fetched
 * + decrypted via Powertools, cached ~1h); locally the plain env var is used
 * directly so no AWS access is needed.
 */
const SECRET_MAX_AGE_SECONDS = 3600;

async function resolve(paramName: string, fallback: string, label: string): Promise<string> {
  if (!paramName) return fallback;
  const value = await getParameter(paramName, { decrypt: true, maxAge: SECRET_MAX_AGE_SECONDS });
  if (!value) throw new Error(`SSM parameter ${paramName} (${label}) is missing or empty`);
  return value;
}

export async function getGoogleClientSecret(): Promise<string> {
  return resolve(
    config.GOOGLE_CLIENT_SECRET_PARAM,
    config.GOOGLE_CLIENT_SECRET,
    'google client secret',
  );
}

/** The 32-byte AES key for refresh-token encryption, stored base64-encoded. */
export async function getGscTokenKey(): Promise<Buffer> {
  const raw = await resolve(config.GSC_TOKEN_KEY_PARAM, config.GSC_TOKEN_KEY, 'gsc token key');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('GSC token key must decode to exactly 32 bytes (openssl rand -base64 32)');
  }
  return key;
}
```

- [ ] **Step 6: Verify typecheck**

Run: `npm run check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/crypto.ts apps/api/src/lib/secrets.ts apps/api/src/config.ts apps/api/tests/crypto.test.ts
git commit -m "[backend] AES-256-GCM secret crypto + GSC secret resolution (#12)"
```

---

### Task 4: Signed OAuth `state` helper

**Files:**
- Create: `apps/api/src/lib/gsc-state.ts`
- Test: `apps/api/tests/gsc-state.test.ts`

**Interfaces:**
- Consumes: `sign`/`verify` from `hono/jwt` (NOTE: this version requires the algorithm argument — `verify(token, secret, 'HS256')`), `getJwtSecret` from `../auth/secret` (falls back to the `JWT_SECRET` env default in tests, no AWS needed).
- Produces: `signGscState({ org_id, user_id }): Promise<string>` and `verifyGscState(token): Promise<GscState>` (throws on invalid/expired/wrong-purpose), type `GscState = { org_id: string; user_id: string }`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/gsc-state.test.ts`:

```ts
import { sign } from 'hono/jwt';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { signGscState, verifyGscState } from '../src/lib/gsc-state';

afterEach(() => {
  vi.useRealTimers();
});

describe('GSC OAuth state', () => {
  test('round-trips org and user ids', async () => {
    const token = await signGscState({ org_id: 'org_1', user_id: 'user_1' });
    expect(await verifyGscState(token)).toEqual({ org_id: 'org_1', user_id: 'user_1' });
  });

  test('rejects a token without the gsc-state purpose (e.g. a session JWT)', async () => {
    // Signed with the same secret but no purpose claim — must not pass as state.
    const sessionLike = await sign(
      { sub: 'user_1', email: 'u@x.com', exp: Math.floor(Date.now() / 1000) + 600 },
      'dev-secret-change-me',
    );
    await expect(verifyGscState(sessionLike)).rejects.toThrow();
  });

  test('rejects garbage', async () => {
    await expect(verifyGscState('not-a-jwt')).rejects.toThrow();
  });

  test('expires after 10 minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T10:00:00Z'));
    const token = await signGscState({ org_id: 'org_1', user_id: 'user_1' });
    vi.setSystemTime(new Date('2026-07-15T10:11:00Z'));
    await expect(verifyGscState(token)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- gsc-state`
Expected: FAIL — cannot resolve `../src/lib/gsc-state`.

- [ ] **Step 3: Implement**

Create `apps/api/src/lib/gsc-state.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- gsc-state`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/gsc-state.ts apps/api/tests/gsc-state.test.ts
git commit -m "[backend] Signed short-lived OAuth state for the GSC flow (#12)"
```

---

### Task 5: GSC Google client (`clients/gsc.ts`)

**Files:**
- Create: `apps/api/src/clients/gsc.ts`
- Test: `apps/api/tests/gsc-client.test.ts`

**Interfaces:**
- Consumes: `OAuth2Client` from `google-auth-library` (existing dependency), `config.GOOGLE_CLIENT_ID` / `config.WEB_ORIGIN`, `getGoogleClientSecret` from Task 3.
- Produces (all exported from `apps/api/src/clients/gsc.ts`):
  - `buildAuthUrl(state: string): Promise<string>`
  - `exchangeCode(code: string): Promise<{ refreshToken: string; email: string }>` — throws if Google returns no refresh token
  - `listSites(refreshToken: string): Promise<GscSite[]>` with `GscSite = { site_url: string; permission_level: string }`
  - `querySearchAnalytics(refreshToken: string, siteUrl: string, params: SearchAnalyticsParams): Promise<SearchAnalyticsRow[]>` with `SearchAnalyticsParams = { startDate: string; endDate: string; dimensions?: string[]; rowLimit?: number }` and `SearchAnalyticsRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }`
  - `class GscAuthRevokedError extends Error` — thrown when token refresh fails with `invalid_grant`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/gsc-client.test.ts`:

```ts
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
            { keys: ['https://clewas.com/blog/a'], clicks: 12, impressions: 300, ctr: 0.04, position: 8.2 },
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
      { keys: ['https://clewas.com/blog/a'], clicks: 12, impressions: 300, ctr: 0.04, position: 8.2 },
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- gsc-client`
Expected: FAIL — cannot resolve `../src/clients/gsc`.

- [ ] **Step 3: Implement**

Create `apps/api/src/clients/gsc.ts`:

```ts
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

async function accessToken(refreshToken: string): Promise<string> {
  const client = await oauthClient();
  client.setCredentials({ refresh_token: refreshToken });
  try {
    const { token } = await client.getAccessToken();
    if (!token) throw new Error('Google returned no access token');
    return token;
  } catch (err) {
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
  const res = await fetch(
    `${GSC_API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    },
  );
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- gsc-client`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/clients/gsc.ts apps/api/tests/gsc-client.test.ts
git commit -m "[backend] GSC Google client: consent URL, code exchange, sites, analytics (#12)"
```

---

### Task 6: OAuth routes — auth-url / connect / site / disconnect

**Files:**
- Create: `apps/api/src/schemas/gsc.ts`
- Create: `apps/api/src/routes/gsc.ts`
- Modify: `apps/api/src/routes/index.ts`
- Test: `apps/api/tests/gsc.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5 (`GscConnectionRepo`, `encryptSecret`/`decryptSecret`, `getGscTokenKey`, `signGscState`/`verifyGscState`, `clients/gsc`), `loadOwnedOrg`, `authMiddleware`/`AuthEnv`.
- Produces routes (mounted at `/api/v0/dashboard/gsc`, typed client `api.api.v0.dashboard.gsc.*`):
  - `GET /auth-url?org_id=` → `{ url: string }`
  - `POST /connect` `{ code, state }` → `{ org_id: string, sites: GscSite[] }` (org_id comes from the verified state, so the callback page doesn't need to carry it)
  - `POST /site` `{ org_id, site_url }` → `{ ok: true }`
  - `DELETE /?org_id=` → `{ ok: boolean }`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/gsc.test.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { testClient } from 'hono/testing';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { decryptSecret } from '../src/lib/crypto';
import { signGscState } from '../src/lib/gsc-state';

const key = randomBytes(32);
vi.mock('../src/lib/secrets', () => ({
  getGscTokenKey: vi.fn(async () => key),
  getGoogleClientSecret: vi.fn(async () => 'client-secret'),
}));

const { buildAuthUrl, exchangeCode, listSites } = vi.hoisted(() => ({
  buildAuthUrl: vi.fn(async (state: string) => `https://consent.example/?state=${state}`),
  exchangeCode: vi.fn(async () => ({ refreshToken: 'rt-1', email: 'owner@x.com' })),
  listSites: vi.fn(async () => [
    { site_url: 'sc-domain:clewas.com', permission_level: 'siteOwner' },
  ]),
}));
vi.mock('../src/clients/gsc', () => ({ buildAuthUrl, exchangeCode, listSites }));

const { findById, connections } = vi.hoisted(() => {
  const now = new Date();
  const orgs = new Map<string, Record<string, unknown>>([
    ['org_1', { id: 'org_1', user_id: 'u1', website_url: 'https://clewas.com', created_at: now }],
    ['org_3', { id: 'org_3', user_id: 'u2', website_url: 'https://other.com', created_at: now }],
  ]);
  return {
    findById: vi.fn(async (id: string) => orgs.get(id) ?? null),
    connections: new Map<string, Record<string, unknown>>(),
  };
});
vi.mock('@shared/db', () => ({
  OrgRepo: { findById },
  GscConnectionRepo: {
    findByOrgId: vi.fn(async (orgId: string) => connections.get(orgId) ?? null),
    upsertToken: vi.fn(async (orgId: string, enc: string, email: string) => {
      connections.set(orgId, {
        id: 'c1',
        org_id: orgId,
        refresh_token_enc: enc,
        google_email: email,
        site_url: null,
        connected_at: new Date(),
        last_refresh_failed_at: null,
      });
    }),
    setSiteUrl: vi.fn(async (orgId: string, siteUrl: string) => {
      const c = connections.get(orgId);
      if (c) c.site_url = siteUrl;
    }),
    deleteByOrgId: vi.fn(async (orgId: string) => connections.delete(orgId)),
  },
}));

// authMiddleware sets c.var.auth from the JWT; stub it to a fixed user.
vi.mock('../src/middlewares/auth', async (orig) => {
  const actual = await orig<typeof import('../src/middlewares/auth')>();
  return {
    ...actual,
    authMiddleware: async (c: any, next: any) => {
      c.set('auth', { userId: 'u1', email: 'u1@example.com' });
      await next();
    },
  };
});

import app from '../src/routes/gsc';

const client = testClient(app);

beforeEach(() => {
  vi.clearAllMocks();
  connections.clear();
});

describe('GET /auth-url', () => {
  test('returns a consent URL carrying a signed state', async () => {
    const res = await client['auth-url'].$get({ query: { org_id: 'org_1' } });
    expect(res.status).toBe(200);
    if (res.status === 200) {
      expect((await res.json()).url).toMatch(/^https:\/\/consent\.example\/\?state=/);
    }
  });

  test('404s for an org the caller does not own', async () => {
    const res = await client['auth-url'].$get({ query: { org_id: 'org_3' } });
    expect(res.status).toBe(404);
  });
});

describe('POST /connect', () => {
  test('exchanges the code, stores the encrypted token, returns org_id + sites', async () => {
    const state = await signGscState({ org_id: 'org_1', user_id: 'u1' });
    const res = await client.connect.$post({ json: { code: 'auth-code', state } });
    expect(res.status).toBe(200);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.org_id).toBe('org_1');
      expect(body.sites).toEqual([
        { site_url: 'sc-domain:clewas.com', permission_level: 'siteOwner' },
      ]);
    }
    // Stored token is encrypted — decrypting with the mocked key recovers it.
    const stored = connections.get('org_1');
    expect(stored?.refresh_token_enc).not.toBe('rt-1');
    expect(decryptSecret(stored?.refresh_token_enc as string, key)).toBe('rt-1');
    expect(stored?.site_url).toBeNull();
  });

  test('rejects a tampered state', async () => {
    const res = await client.connect.$post({ json: { code: 'c', state: 'garbage' } });
    expect(res.status).toBe(400);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  test("rejects a state minted for another user's session", async () => {
    const state = await signGscState({ org_id: 'org_1', user_id: 'u2' });
    const res = await client.connect.$post({ json: { code: 'c', state } });
    expect(res.status).toBe(400);
  });

  test('404s when the state org is not owned by the caller', async () => {
    const state = await signGscState({ org_id: 'org_3', user_id: 'u1' });
    const res = await client.connect.$post({ json: { code: 'c', state } });
    expect(res.status).toBe(404);
  });

  test('400s when the Google exchange fails', async () => {
    exchangeCode.mockRejectedValueOnce(new Error('invalid code'));
    const state = await signGscState({ org_id: 'org_1', user_id: 'u1' });
    const res = await client.connect.$post({ json: { code: 'bad', state } });
    expect(res.status).toBe(400);
  });
});

describe('POST /site', () => {
  async function connect() {
    const state = await signGscState({ org_id: 'org_1', user_id: 'u1' });
    await client.connect.$post({ json: { code: 'auth-code', state } });
  }

  test('finalizes with a site from the account list', async () => {
    await connect();
    const res = await client.site.$post({
      json: { org_id: 'org_1', site_url: 'sc-domain:clewas.com' },
    });
    expect(res.status).toBe(200);
    expect(connections.get('org_1')?.site_url).toBe('sc-domain:clewas.com');
    // Validation re-lists with the decrypted token.
    expect(listSites).toHaveBeenLastCalledWith('rt-1');
  });

  test('rejects a site not in the account', async () => {
    await connect();
    const res = await client.site.$post({
      json: { org_id: 'org_1', site_url: 'sc-domain:evil.com' },
    });
    expect(res.status).toBe(400);
    expect(connections.get('org_1')?.site_url).toBeNull();
  });

  test('400s when no connection is pending', async () => {
    const res = await client.site.$post({ json: { org_id: 'org_1', site_url: 'x' } });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /', () => {
  test('disconnects and reports whether a row existed', async () => {
    const state = await signGscState({ org_id: 'org_1', user_id: 'u1' });
    await client.connect.$post({ json: { code: 'auth-code', state } });

    const res = await client.index.$delete({ query: { org_id: 'org_1' } });
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).ok).toBe(true);
    expect(connections.has('org_1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- "tests/gsc.test"`
Expected: FAIL — cannot resolve `../src/routes/gsc`.

- [ ] **Step 3: Implement schemas**

Create `apps/api/src/schemas/gsc.ts`:

```ts
import { z } from '@hono/zod-openapi';

/**
 * GSC connect-flow schemas (#12). Flow: GET /auth-url -> Google consent ->
 * web callback POSTs the code to /connect -> user picks a property ->
 * POST /site finalizes. The connection gates the Home Best Articles /
 * Search Performance cards (see schemas/dashboard.ts).
 */
export const GscOrgQuery = z.object({
  org_id: z
    .string()
    .openapi({ param: { name: 'org_id', in: 'query' }, example: '6650f1a2b3c4d5e6f7a8b9c0' }),
});

export const GscNotFoundResponse = z
  .object({ error: z.string().openapi({ example: 'Not found' }) })
  .openapi('GscNotFoundResponse');

export const GscErrorResponse = z
  .object({ error: z.string().openapi({ example: 'Invalid state' }) })
  .openapi('GscErrorResponse');

export const GscAuthUrlResponse = z
  .object({ url: z.string() })
  .openapi('GscAuthUrlResponse');

// org_id deliberately absent: the server takes it from the verified state, so
// the callback page never has to carry (or be trusted with) it.
export const GscConnectBody = z
  .object({ code: z.string(), state: z.string() })
  .openapi('GscConnectBody');

const GscSite = z
  .object({ site_url: z.string(), permission_level: z.string() })
  .openapi('GscSite');

export const GscConnectResponse = z
  .object({ org_id: z.string(), sites: z.array(GscSite) })
  .openapi('GscConnectResponse');

export const GscSiteBody = z
  .object({ org_id: z.string(), site_url: z.string() })
  .openapi('GscSiteBody');

export const GscOkResponse = z.object({ ok: z.boolean() }).openapi('GscOkResponse');
```

- [ ] **Step 4: Implement routes**

Create `apps/api/src/routes/gsc.ts`:

```ts
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { GscConnectionRepo } from '@shared/db';
import * as gsc from '../clients/gsc';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { signGscState, verifyGscState } from '../lib/gsc-state';
import { loadOwnedOrg } from '../lib/load-owned-org';
import { getGscTokenKey } from '../lib/secrets';
import { type AuthEnv, authMiddleware } from '../middlewares/auth';
import * as schemas from '../schemas/gsc';

/**
 * Google Search Console connect flow (#12, design/product-flow.md §1 + §2.6).
 * Mounted at /dashboard/gsc. All routes require a Bearer JWT and org ownership.
 */
const gscRoutes = new OpenAPIHono<AuthEnv>()
  .openapi(
    createRoute({
      tags: ['gsc'],
      method: 'get',
      path: '/auth-url',
      summary: 'Google consent URL for connecting Search Console',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.GscOrgQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.GscAuthUrlResponse } },
          description: 'Consent URL (offline access, webmasters.readonly, signed state)',
        },
        404: {
          content: { 'application/json': { schema: schemas.GscNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);
      const state = await signGscState({ org_id, user_id: userId });
      return c.json({ url: await gsc.buildAuthUrl(state) }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['gsc'],
      method: 'post',
      path: '/connect',
      summary: 'Exchange the OAuth callback code; returns the account properties to pick from',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: {
          content: { 'application/json': { schema: schemas.GscConnectBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.GscConnectResponse } },
          description: 'Token stored (site pending); the GSC properties of the Google account',
        },
        400: {
          content: { 'application/json': { schema: schemas.GscErrorResponse } },
          description: 'Invalid/expired state or failed Google code exchange',
        },
        404: {
          content: { 'application/json': { schema: schemas.GscNotFoundResponse } },
          description: 'State org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { code, state } = c.req.valid('json');
      const { userId } = c.get('auth');

      let claims: { org_id: string; user_id: string };
      try {
        claims = await verifyGscState(state);
      } catch {
        return c.json({ error: 'Invalid state' }, 400);
      }
      // The state must have been minted by this same user's session.
      if (claims.user_id !== userId) return c.json({ error: 'Invalid state' }, 400);
      const org = await loadOwnedOrg(claims.org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);

      let tokens: { refreshToken: string; email: string };
      try {
        tokens = await gsc.exchangeCode(code);
      } catch {
        return c.json({ error: 'Google code exchange failed' }, 400);
      }

      const enc = encryptSecret(tokens.refreshToken, await getGscTokenKey());
      await GscConnectionRepo.upsertToken(claims.org_id, enc, tokens.email);
      const sites = await gsc.listSites(tokens.refreshToken);
      return c.json({ org_id: claims.org_id, sites }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['gsc'],
      method: 'post',
      path: '/site',
      summary: 'Finalize the connection with the chosen GSC property',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: {
          content: { 'application/json': { schema: schemas.GscSiteBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.GscOkResponse } },
          description: 'Connection complete — the GSC gate opens',
        },
        400: {
          content: { 'application/json': { schema: schemas.GscErrorResponse } },
          description: 'No pending connection, or the site is not in the Google account',
        },
        404: {
          content: { 'application/json': { schema: schemas.GscNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id, site_url } = c.req.valid('json');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);

      const conn = await GscConnectionRepo.findByOrgId(org_id);
      if (!conn) return c.json({ error: 'No pending connection' }, 400);

      // Validate against a fresh list so a forged site_url can't be stored.
      const refreshToken = decryptSecret(conn.refresh_token_enc, await getGscTokenKey());
      const sites = await gsc.listSites(refreshToken);
      if (!sites.some((s) => s.site_url === site_url)) {
        return c.json({ error: 'Site not in this Google account' }, 400);
      }

      await GscConnectionRepo.setSiteUrl(org_id, site_url);
      return c.json({ ok: true }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['gsc'],
      method: 'delete',
      path: '/',
      summary: 'Disconnect Search Console (deletes the stored token)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.GscOrgQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.GscOkResponse } },
          description: 'ok=true when a connection existed',
        },
        404: {
          content: { 'application/json': { schema: schemas.GscNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);
      const ok = await GscConnectionRepo.deleteByOrgId(org_id);
      return c.json({ ok }, 200);
    },
  );

export default gscRoutes;
```

- [ ] **Step 5: Mount the router**

In `apps/api/src/routes/index.ts`:

```ts
import gsc from './gsc';
```

and extend the chain (order matters for `AppType`; add after `dashboard`):

```ts
const routes = app
  .route(`/api/${API_VERSION}/core`, core)
  .route(`/api/${API_VERSION}/setup`, setup)
  .route(`/api/${API_VERSION}/keywords`, keywords)
  .route(`/api/${API_VERSION}/dashboard`, dashboard)
  .route(`/api/${API_VERSION}/dashboard/gsc`, gsc);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- "tests/gsc.test"` then `npm test` (full suite — the mount must not break existing route tests).
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/schemas/gsc.ts apps/api/src/routes/gsc.ts apps/api/src/routes/index.ts apps/api/tests/gsc.test.ts
git commit -m "[backend] GSC OAuth routes: auth-url, connect, site pick, disconnect (#12)"
```

---

### Task 7: Ungate Best Articles + add Search Performance

**Files:**
- Modify: `apps/api/src/schemas/dashboard.ts` (BestArticle shape, new SearchPerformanceResponse, best route gains OrgQuery)
- Modify: `apps/api/src/routes/dashboard.ts`
- Test: `apps/api/tests/dashboard.test.ts`

**Interfaces:**
- Consumes: `GscConnectionRepo` + `isGscConnected` (Tasks 1–2), `decryptSecret`/`getGscTokenKey` (Task 3), `querySearchAnalytics`/`GscAuthRevokedError` (Task 5), existing `ArticleRepo.listByOrg`.
- Produces:
  - `GET /dashboard/articles/best?org_id=` → `{ articles: Array<{ url: string; clicks: number; title: string | null }>, gated: boolean }` (**breaking**: now requires `org_id`; `BestArticle` loses `id`, gains nullable `title`)
  - `GET /dashboard/search-performance?org_id=` → `{ gated: boolean, clicks|impressions|ctr|position: number | null }` (nulls while gated)

- [ ] **Step 1: Update schemas**

In `apps/api/src/schemas/dashboard.ts`, replace the `BestArticle` object with:

```ts
const BestArticle = z
  .object({
    url: z.string(),
    clicks: z.number().int(),
    // Matched against our published articles by slug; null for other site pages.
    title: z.string().nullable(),
  })
  .openapi('BestArticle');
```

and add after `ConnectedIntegrationsResponse`:

```ts
export const SearchPerformanceResponse = z
  .object({
    // Gated until a healthy GSC connection exists; metrics are 28-day totals.
    gated: z.boolean(),
    clicks: z.number().nullable(),
    impressions: z.number().nullable(),
    ctr: z.number().nullable(),
    position: z.number().nullable(),
  })
  .openapi('SearchPerformanceResponse');
```

- [ ] **Step 2: Update the failing tests first**

In `apps/api/tests/dashboard.test.ts`:

1. Add mocks at module scope (near the existing google mock):

```ts
const { querySearchAnalytics, GscAuthRevokedError } = vi.hoisted(() => {
  class GscAuthRevokedError extends Error {}
  return { querySearchAnalytics: vi.fn(), GscAuthRevokedError };
});
vi.mock('../src/clients/gsc', () => ({ querySearchAnalytics, GscAuthRevokedError }));

const gscKey = vi.hoisted(() => Buffer.alloc(32, 7));
vi.mock('../src/lib/secrets', () => ({ getGscTokenKey: vi.fn(async () => gscKey) }));
```

2. Inside the `@shared/db` mock factory, add a connections map + repo (org_1 connected, org_2 not). The encrypted token must be real ciphertext under `gscKey`, so import the crypto helper inside the factory via a dynamic require-free path — instead, build it in `vi.hoisted`:

```ts
const { gscConnections, markRefreshFailed } = vi.hoisted(() => ({
  gscConnections: new Map<string, Record<string, unknown>>(),
  markRefreshFailed: vi.fn(async (orgId: string) => {
    const c = gscConnections.get(orgId);
    if (c) c.last_refresh_failed_at = new Date();
  }),
}));
```

and in the `@shared/db` factory return, add:

```ts
    GscConnectionRepo: {
      findByOrgId: vi.fn(async (orgId: string) => gscConnections.get(orgId) ?? null),
      markRefreshFailed,
    },
```

3. Seed the connected org in each GSC test (not globally — other tests expect org_1 gated). Add a new describe block; note `encryptSecret` is imported at top level:

```ts
import { encryptSecret } from '../src/lib/crypto';
```

```ts
describe('GSC-gated home cards', () => {
  async function auth() {
    const token = await login();
    return { headers: { Authorization: `Bearer ${token}` } };
  }

  function connectOrg1() {
    gscConnections.set('org_1', {
      id: 'c1',
      org_id: 'org_1',
      refresh_token_enc: encryptSecret('rt-live', Buffer.alloc(32, 7)),
      site_url: 'sc-domain:clewas.com',
      google_email: 'o@x.com',
      connected_at: new Date(),
      last_refresh_failed_at: null,
    });
  }

  beforeEach(() => {
    gscConnections.clear();
    querySearchAnalytics.mockReset();
  });

  test('best stays gated without a connection', async () => {
    const res = await client.api.v0.dashboard.articles.best.$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.gated).toBe(true);
      expect(body.articles).toHaveLength(0);
    }
  });

  test('best returns top pages with slug-matched titles when connected', async () => {
    connectOrg1();
    querySearchAnalytics.mockResolvedValueOnce([
      { keys: ['https://clewas.com/blog/notion-builder'], clicks: 41.2, impressions: 900, ctr: 0.04, position: 7 },
      { keys: ['https://clewas.com/pricing'], clicks: 12, impressions: 300, ctr: 0.04, position: 9 },
    ]);

    const res = await client.api.v0.dashboard.articles.best.$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.gated).toBe(false);
      expect(body.articles).toEqual([
        { url: 'https://clewas.com/blog/notion-builder', clicks: 41, title: 'Notion Builder' },
        { url: 'https://clewas.com/pricing', clicks: 12, title: null },
      ]);
    }
    // The stored token decrypts back to the raw refresh token for the query.
    expect(querySearchAnalytics).toHaveBeenCalledWith(
      'rt-live',
      'sc-domain:clewas.com',
      expect.objectContaining({ dimensions: ['page'], rowLimit: 10 }),
    );
  });

  test('revoked access re-gates and stamps the failure', async () => {
    connectOrg1();
    querySearchAnalytics.mockRejectedValueOnce(new GscAuthRevokedError('revoked'));

    const res = await client.api.v0.dashboard.articles.best.$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).gated).toBe(true);
    expect(markRefreshFailed).toHaveBeenCalledWith('org_1');
  });

  test('best 404s for an org the caller does not own', async () => {
    const res = await client.api.v0.dashboard.articles.best.$get(
      { query: { org_id: 'org_3' } },
      await auth(),
    );
    expect(res.status).toBe(404);
  });

  test('search-performance is gated without a connection, live with one', async () => {
    const gated = await client.api.v0.dashboard['search-performance'].$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );
    expect(gated.status).toBe(200);
    if (gated.status === 200) {
      expect(await gated.json()).toEqual({
        gated: true,
        clicks: null,
        impressions: null,
        ctr: null,
        position: null,
      });
    }

    connectOrg1();
    querySearchAnalytics.mockResolvedValueOnce([
      { keys: [], clicks: 120, impressions: 4000, ctr: 0.03, position: 12.4 },
    ]);
    const live = await client.api.v0.dashboard['search-performance'].$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );
    expect(live.status).toBe(200);
    if (live.status === 200) {
      expect(await live.json()).toEqual({
        gated: false,
        clicks: 120,
        impressions: 4000,
        ctr: 0.03,
        position: 12.4,
      });
    }
  });
});
```

4. Update the two pre-existing best-article tests (`'GET /articles/best is empty and gated…'` and `'static /articles/best still resolves…'`) to pass `{ query: { org_id: 'org_1' } }` as the first arg instead of `undefined` — their assertions (empty + gated) still hold since `org_1` has no GSC connection outside the new describe block.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- dashboard`
Expected: FAIL — best rejects the query arg shape / `search-performance` path missing.

- [ ] **Step 4: Implement the route changes**

In `apps/api/src/routes/dashboard.ts`:

1. Add imports:

```ts
import { ArticleRepo, GscConnectionRepo, KeywordRepo, OrgRepo } from '@shared/db';
import { type Article, isGscConnected } from '@shared/schemas';
import * as gsc from '../clients/gsc';
import { decryptSecret } from '../lib/crypto';
import { getGscTokenKey } from '../lib/secrets';
```

2. Add helpers after `toArticleDetail`:

```ts
/** Search Analytics window: the trailing 28 days, as yyyy-mm-dd bounds. */
function analyticsWindow(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 28 * 24 * 60 * 60 * 1000);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

/**
 * The GSC gate (#12): decrypt the org's refresh token when a healthy, finalized
 * connection exists; null keeps the caller on the gated response shape.
 */
async function gscAccess(org_id: string): Promise<{ token: string; siteUrl: string } | null> {
  const conn = await GscConnectionRepo.findByOrgId(org_id);
  if (!isGscConnected(conn)) return null;
  return {
    token: decryptSecret(conn.refresh_token_enc, await getGscTokenKey()),
    siteUrl: conn.site_url,
  };
}
```

3. Replace the `/articles/best` route definition + handler with:

```ts
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/articles/best',
      summary: 'Best-performing pages by Search Console clicks (gated until GSC is connected)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.OrgQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.BestArticlesResponse } },
          description: 'Top pages by clicks (28 days); empty + gated without a GSC connection',
        },
        404: {
          content: { 'application/json': { schema: schemas.OrgNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);

      const access = await gscAccess(org_id);
      if (!access) return c.json({ articles: [], gated: true }, 200);

      try {
        const rows = await gsc.querySearchAnalytics(access.token, access.siteUrl, {
          ...analyticsWindow(),
          dimensions: ['page'],
          rowLimit: 10,
        });
        const { articles: published } = await ArticleRepo.listByOrg(org_id, {
          status: 'published',
          limit: 100,
          offset: 0,
        });
        const articles = rows.map((row) => {
          const url = row.keys[0] ?? '';
          const match = published.find((a: Article) => url.includes(`/${a.slug}`));
          return { url, clicks: Math.round(row.clicks), title: match?.title ?? null };
        });
        return c.json({ articles, gated: false }, 200);
      } catch (err) {
        // Revoked access closes the gate until reconnect; transient provider
        // errors also degrade to the gated shape rather than a 500.
        if (err instanceof gsc.GscAuthRevokedError) {
          await GscConnectionRepo.markRefreshFailed(org_id);
        }
        return c.json({ articles: [], gated: true }, 200);
      }
    },
  )
```

4. Chain a new route directly after it:

```ts
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/search-performance',
      summary: '28-day Search Console totals (gated until GSC is connected)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.OrgQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.SearchPerformanceResponse } },
          description: 'Clicks/impressions/CTR/position totals; nulls while gated',
        },
        404: {
          content: { 'application/json': { schema: schemas.OrgNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);

      const gatedBody = {
        gated: true,
        clicks: null,
        impressions: null,
        ctr: null,
        position: null,
      };
      const access = await gscAccess(org_id);
      if (!access) return c.json(gatedBody, 200);

      try {
        const rows = await gsc.querySearchAnalytics(access.token, access.siteUrl, analyticsWindow());
        const row = rows[0];
        return c.json(
          {
            gated: false,
            clicks: row?.clicks ?? 0,
            impressions: row?.impressions ?? 0,
            ctr: row?.ctr ?? 0,
            position: row?.position ?? 0,
          },
          200,
        );
      } catch (err) {
        if (err instanceof gsc.GscAuthRevokedError) {
          await GscConnectionRepo.markRefreshFailed(org_id);
        }
        return c.json(gatedBody, 200);
      }
    },
  )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- dashboard` then `npm test` (full suite).
Expected: PASS. NOTE: the web app now fails `check:web` (best call shape changed) — that's Task 8; do not run `check:all` as a gate until then, use `npm run check` here.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/schemas/dashboard.ts apps/api/src/routes/dashboard.ts apps/api/tests/dashboard.test.ts
git commit -m "[backend] Live GSC reads ungate Best Articles + add Search Performance (#12)"
```

---

### Task 8: Web — callback page + connect buttons + cards

**Files:**
- Create: `apps/web/app/dashboard/gsc/callback/page.tsx`
- Modify: `apps/web/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `api.api.v0.dashboard.gsc['auth-url'].$get`, `.gsc.connect.$post`, `.gsc.site.$post`, updated `.articles.best.$get({ query })`, new `['search-performance'].$get({ query })`; `getToken` from `apps/web/lib/auth`.
- No web unit tests exist; verification is `npm run check:all` + manual flow.

- [ ] **Step 1: Create the callback page**

Create `apps/web/app/dashboard/gsc/callback/page.tsx`:

```tsx
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { getToken } from '../../../../lib/auth';

type Site = { site_url: string; permission_level: string };

/**
 * GSC OAuth callback (#12). Google redirects here with ?code&state; we exchange
 * the code server-side, then the user picks which GSC property backs this org.
 */
function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    const code = params.get('code');
    const state = params.get('state');
    if (params.get('error') || !code || !state) {
      setError('Google connection was cancelled or failed.');
      return;
    }
    void (async () => {
      const res = await api.api.v0.dashboard.gsc.connect.$post({ json: { code, state } });
      if (!res.ok) {
        setError('Could not complete the Google connection. Please try again.');
        return;
      }
      const body = await res.json();
      setOrgId(body.org_id);
      setSites(body.sites);
    })();
  }, [params, router]);

  async function pick(site_url: string) {
    if (!orgId) return;
    setSaving(true);
    const res = await api.api.v0.dashboard.gsc.site.$post({ json: { org_id: orgId, site_url } });
    if (res.ok) {
      router.replace('/dashboard');
    } else {
      setSaving(false);
      setError('Could not select that property. Please try again.');
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 560, margin: '0 auto' }}>
      <h1 style={{ fontSize: 18 }}>Connect Google Search Console</h1>
      {error && (
        <>
          <p style={{ color: '#c00' }}>{error}</p>
          <button type="button" onClick={() => router.replace('/dashboard')}>
            Back to dashboard
          </button>
        </>
      )}
      {!error && !sites && <p>Completing the Google connection…</p>}
      {!error && sites && sites.length === 0 && (
        <>
          <p>This Google account has no Search Console properties.</p>
          <button type="button" onClick={() => router.replace('/dashboard')}>
            Back to dashboard
          </button>
        </>
      )}
      {!error && sites && sites.length > 0 && (
        <>
          <p>Choose the property for this site:</p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {sites.map((s) => (
              <li key={s.site_url} style={{ marginBottom: 8 }}>
                <button type="button" disabled={saving} onClick={() => pick(s.site_url)}>
                  {s.site_url}
                </button>
                <span style={{ color: '#777', marginLeft: 8, fontSize: 13 }}>
                  {s.permission_level}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

// useSearchParams requires a Suspense boundary in the app router.
export default function GscCallbackPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading…</p>}>
      <CallbackInner />
    </Suspense>
  );
}
```

- [ ] **Step 2: Update the dashboard page**

In `apps/web/app/dashboard/page.tsx`:

1. Replace `HomeData` (keeping `domainRating` from PR 1):

```ts
type BestArticles = { gated: boolean; articles: { url: string; clicks: number; title: string | null }[] };
type SearchPerf = {
  gated: boolean;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
};

type HomeData = {
  published: number;
  planned: number;
  best: BestArticles;
  perf: SearchPerf;
  integrations: number;
  domainRating: number | null;
};
```

2. In the loader, best is now org-scoped and search-performance joins the batch:

```ts
      const [publishedRes, plannedRes, bestRes, perfRes, integrationsRes, domainRatingRes] =
        await Promise.all([
          activeOrg
            ? api.api.v0.dashboard.articles.published.$get({ query: { org_id: activeOrg.id } })
            : null,
          activeOrg
            ? api.api.v0.dashboard.articles.planned.$get({ query: { org_id: activeOrg.id } })
            : null,
          activeOrg
            ? api.api.v0.dashboard.articles.best.$get({ query: { org_id: activeOrg.id } })
            : null,
          activeOrg
            ? api.api.v0.dashboard['search-performance'].$get({ query: { org_id: activeOrg.id } })
            : null,
          api.api.v0.dashboard.integrations.connected.$get(),
          activeOrg
            ? api.api.v0.dashboard['domain-rating'].$get({ query: { org_id: activeOrg.id } })
            : null,
        ]);

      const gatedPerf: SearchPerf = {
        gated: true,
        clicks: null,
        impressions: null,
        ctr: null,
        position: null,
      };
      setData({
        published: publishedRes?.ok ? (await publishedRes.json()).count : 0,
        planned: plannedRes?.ok ? (await plannedRes.json()).count : 0,
        best:
          bestRes?.ok && bestRes.status === 200
            ? await bestRes.json()
            : { gated: true, articles: [] },
        perf: perfRes?.ok && perfRes.status === 200 ? await perfRes.json() : gatedPerf,
        integrations: integrationsRes.ok ? (await integrationsRes.json()).integrations.length : 0,
        domainRating: domainRatingRes?.ok ? (await domainRatingRes.json()).rating : null,
      });
```

3. Add a connect handler next to `logout`:

```ts
  async function connectGsc() {
    if (!org) return;
    const res = await api.api.v0.dashboard.gsc['auth-url'].$get({ query: { org_id: org.id } });
    if (res.ok) window.location.href = (await res.json()).url;
  }
```

4. Replace the Best Articles card and add a Search Performance card after it:

```tsx
        <section style={card}>
          <h2 style={cardTitle}>Best Articles</h2>
          {data?.best.gated ? (
            <>
              <p style={{ color: '#777' }}>Connect Google Search Console to unlock this block.</p>
              <button type="button" onClick={connectGsc}>
                Connect Google Search Console
              </button>
            </>
          ) : data?.best.articles.length ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {data.best.articles.map((a) => (
                <li key={a.url}>
                  {a.title ?? a.url} — {a.clicks} clicks
                </li>
              ))}
            </ul>
          ) : (
            <p>No article performance data yet.</p>
          )}
        </section>

        <section style={card}>
          <h2 style={cardTitle}>Search Performance</h2>
          {data?.perf.gated ? (
            <>
              <p style={{ color: '#777' }}>Connect Google Search Console to unlock this block.</p>
              <button type="button" onClick={connectGsc}>
                Connect Google Search Console
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 24 }}>
              <Stat label="Clicks" value={Math.round(data?.perf.clicks ?? 0)} />
              <Stat label="Impressions" value={Math.round(data?.perf.impressions ?? 0)} />
            </div>
          )}
        </section>
```

- [ ] **Step 3: Verify with the typechecker**

Run: `npm run check:all`
Expected: clean — this also re-verifies the Task 7 route/schema changes end-to-end through the typed client.

- [ ] **Step 4: Verify the flow in the running app (if local infra + a Google OAuth client are available)**

`docker compose up -d && npm run dev` with `GOOGLE_CLIENT_SECRET` + `GSC_TOKEN_KEY` (`openssl rand -base64 32`) in `.env`, and `http://localhost:3000/dashboard/gsc/callback` registered as a redirect URI on the Google OAuth client. Click **Connect Google Search Console** → consent → pick a property → cards populate. Without credentials, verify the gated state renders and the button 404s gracefully (no crash), and note the skip in the task report.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/dashboard/gsc/callback/page.tsx apps/web/app/dashboard/page.tsx
git commit -m "[frontend] GSC connect flow + Best Articles / Search Performance cards (#12)"
```

---

### Task 9: Infra, env docs, PROGRESS, PR

**Files:**
- Modify: `infra/lib/config.ts`
- Modify: `infra/lib/api-stack.ts` (param lookups + `authEnv` + grants, API Lambda only)
- Modify: `.env.example`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: `config.GOOGLE_CLIENT_SECRET_PARAM` / `GSC_TOKEN_KEY_PARAM` / `WEB_ORIGIN` from Task 3.

- [ ] **Step 1: Stage config**

In `infra/lib/config.ts`, extend `StageConfig`:

```ts
  googleClientSecretParam: string; // SSM SecureString NAME (not value)
  gscTokenKeyParam: string; // SSM SecureString NAME (not value)
  webOrigin: string; // web app origin — GSC OAuth redirect URI base
```

and both stages:

```ts
  staging: {
    // ...existing fields...
    googleClientSecretParam: '/seo/staging/google-client-secret',
    gscTokenKeyParam: '/seo/staging/gsc-token-key',
    webOrigin: process.env.WEB_ORIGIN_STAGING ?? '',
  },
  prod: {
    // ...existing fields...
    googleClientSecretParam: '/seo/prod/google-client-secret',
    gscTokenKeyParam: '/seo/prod/gsc-token-key',
    webOrigin: process.env.WEB_ORIGIN_PROD ?? '',
  },
```

- [ ] **Step 2: Stack wiring (API Lambda ONLY — never the worker)**

In `infra/lib/api-stack.ts`:

1. After the `jwtSecretParam` lookup, add:

```ts
    // GSC secrets (#12): OAuth client secret + refresh-token encryption key.
    // Same out-of-band SecureString pattern as the JWT secret:
    //   aws ssm put-parameter --name /seo/<stage>/google-client-secret --type SecureString --value <secret>
    //   aws ssm put-parameter --name /seo/<stage>/gsc-token-key --type SecureString --value "$(openssl rand -base64 32)"
    const googleClientSecretParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      'GoogleClientSecretParam',
      { parameterName: cfg.googleClientSecretParam },
    );
    const gscTokenKeyParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      'GscTokenKeyParam',
      { parameterName: cfg.gscTokenKeyParam },
    );
```

2. Extend `authEnv`:

```ts
    const authEnv = {
      JWT_SECRET_PARAM: cfg.jwtSecretParam,
      GOOGLE_CLIENT_ID: cfg.googleClientId,
      GOOGLE_CLIENT_SECRET_PARAM: cfg.googleClientSecretParam,
      GSC_TOKEN_KEY_PARAM: cfg.gscTokenKeyParam,
      WEB_ORIGIN: cfg.webOrigin,
    };
```

3. After `jwtSecretParam.grantRead(apiFn);` add:

```ts
    googleClientSecretParam.grantRead(apiFn);
    gscTokenKeyParam.grantRead(apiFn);
```

4. Verify: `cd infra && npm install && npx tsc --noEmit && cd ..` (synth additionally if credentials allow).

- [ ] **Step 3: `.env.example`**

In the root `.env.example`, extend the Auth block after `GOOGLE_CLIENT_ID=`:

```bash
# Google OAuth client secret — the GSC connect flow's code exchange (#12).
# Same OAuth client as GOOGLE_CLIENT_ID. Deployed envs use an SSM SecureString
# named by GOOGLE_CLIENT_SECRET_PARAM instead (see infra).
GOOGLE_CLIENT_SECRET=
# GOOGLE_CLIENT_SECRET_PARAM=
# GSC refresh-token encryption key: 32 bytes base64 (`openssl rand -base64 32`).
# Deployed envs use an SSM SecureString named by GSC_TOKEN_KEY_PARAM instead.
GSC_TOKEN_KEY=
# GSC_TOKEN_KEY_PARAM=
# Web app origin — builds the GSC OAuth redirect URI. Defaults to
# http://localhost:3000; deployed envs set the real web origin.
# WEB_ORIGIN=
```

- [ ] **Step 4: PROGRESS.md**

Update the two #12 lines (41–42):
- Line 41: drop the GSC gating mention for `best` (it's live now); keep the integrations gap pointing at #7.
- Line 42: `- ✅ Domain Rating + Google Search Console — [#12](https://github.com/seopotion/seo/issues/12) (deploy needs human-gated SSM params + Google redirect URIs — see PR)`

Adjust to match the file's current wording — PR 1 already edited line 42; keep one line per fact.

- [ ] **Step 5: Full check suite**

Run: `npm run lint && npm run check:all && npm test`
Expected: all pass (`npm run lint:fix` first if formatting complains).

- [ ] **Step 6: Commit, push, PR**

```bash
git add infra/lib/config.ts infra/lib/api-stack.ts .env.example PROGRESS.md
git commit -m "[infra] GSC secrets (SSM) + WEB_ORIGIN for the API Lambda (#12)"
git push -u origin ozykhan/gsc-integration
gh pr create --base dev --title "[backend] Google Search Console integration (#12)" --body "$(cat <<'EOF'
## Summary
Part 2 of #12 — GSC OAuth + live Search Analytics reads (spec: docs/superpowers/specs/2026-07-15-domain-rating-gsc-design.md).

- `gsc_connections` collection (unique per org) with AES-256-GCM-encrypted refresh tokens
- OAuth flow: `GET /dashboard/gsc/auth-url` (signed-JWT state) → web callback → `POST /connect` (server-side exchange) → user picks a property → `POST /site`; `DELETE /dashboard/gsc` disconnects
- `GET /dashboard/articles/best` now live: top pages by 28-day clicks, slug-matched titles; new `GET /dashboard/search-performance` totals; both re-gate on revoked access
- Web: callback/property-picker page, Connect buttons, Search Performance card

## Human-gated deploy steps (staging)
- [ ] `aws ssm put-parameter --name /seo/staging/google-client-secret --type SecureString --value <oauth client secret>`
- [ ] `aws ssm put-parameter --name /seo/staging/gsc-token-key --type SecureString --value "$(openssl rand -base64 32)"`
- [ ] Add `<web origin>/dashboard/gsc/callback` to the OAuth client's authorized redirect URIs (Google console)
- [ ] Set `WEB_ORIGIN_STAGING` in the deploy environment

Closes #12

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens against `dev`; CI must pass. Leave #12 open until merge (the `Closes` keyword handles it); the human-gated deploy steps live in the PR checklist.
