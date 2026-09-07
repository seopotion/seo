# Member-Added Notification Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an owner adds a teammate via `POST /core/members`, the API sends the teammate one plain-text "you've been added" email through AWS SES, without ever failing the add.

**Architecture:** A single `sendEmail` function in `apps/api/src/clients/ses.ts` wraps the SES v2 SDK and no-ops when `MAIL_FROM` is unset. A tiny builder in `apps/api/src/lib/member-added-email.ts` produces the subject/body. The add-member route calls both after the `org_members` insert, inside a try/catch. CDK adds an SES domain identity, grants `ses:SendEmail` to the API Lambda only, and passes `MAIL_FROM`.

**Tech Stack:** Hono + `@hono/zod-openapi` (API), `@aws-sdk/client-sesv2`, Vitest (`vi.mock` / `vi.hoisted`), AWS CDK `aws-cdk-lib/aws-ses` (`EmailIdentity`, `Identity`), Biome.

Spec: `docs/superpowers/specs/2026-09-07-member-added-email-design.md`. Issue: #336.

## Global Constraints

- Only the API Lambda may send mail; the worker and Step Functions Lambdas get no SES grant and no `MAIL_FROM`.
- `MAIL_FROM` empty (local dev, tests) ⇒ `sendEmail` logs and returns; never touches the network.
- A mail failure never changes the HTTP response of `POST /core/members` (still 201 with the member row).
- Sender display: `SEOPotion <no-reply@staging.seopotion.co>` on staging, `SEOPotion <no-reply@seopotion.co>` on prod. Reply-To: the owner (caller) email.
- Email is plain text, English only, no HTML.
- Subject: `You've been added to <website_url> on SEOPotion`.
- Biome style: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` after writing new code.
- Use `import type` for type-only imports (`verbatimModuleSyntax`).
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and reference the issue with `Part of #336`.
- Worktree gotcha: root `node_modules` exists but `infra/node_modules` does not. Run `cd infra && npm install` before typechecking CDK code. `infra` is standalone (not a workspace).
- Lockfile gotcha: after any `npm install` on macOS, check `git diff package-lock.json` for removed `@emnapi/*` optional entries and restore them (`git checkout origin/dev -- package-lock.json` then re-apply only the additions) — otherwise CI `npm ci` fails on Linux.
- Verification before claiming done: `npm run lint`, `npm run check:all`, `npm test`. One known local failure is expected: `wordpress-plugin-behavior.test.ts` (`spawnSync php ENOENT`) — it passes in CI.

---

## File map

| File | Responsibility |
| --- | --- |
| `apps/api/src/config.ts` (modify) | Add `MAIL_FROM` env read. |
| `apps/api/src/clients/ses.ts` (create) | `sendEmail` over SES v2; no-op when unconfigured. |
| `apps/api/tests/ses.test.ts` (create) | Unit test for the no-op path and the SDK call shape. |
| `apps/api/src/lib/member-added-email.ts` (create) | Pure builder for subject + body. |
| `apps/api/tests/member-added-email.test.ts` (create) | Snapshot-free assertions on subject/body. |
| `apps/api/src/routes/members.ts` (modify, POST handler) | Call the builder + `sendEmail` after insert, try/catch, log. |
| `apps/api/tests/members.test.ts` (modify) | Mock `../src/clients/ses`; three new cases. |
| `apps/api/package.json` + `package-lock.json` (modify) | Add `@aws-sdk/client-sesv2`. |
| `.env.example` (modify) | Commented `MAIL_FROM=`. |
| `apps/web/messages/en.json`, `tr.json` (modify) | Team tab description mentions the email. |
| `infra/lib/config.ts` (modify) | `StageConfig.mailFrom` per stage. |
| `infra/lib/api-stack.ts` (modify) | `EmailIdentity`, `grantSendEmail(apiFn)`, `MAIL_FROM` in `authEnv`, DKIM outputs. |
| `infra/ENVIRONMENTS.md` (modify) | "Transactional email (SES)" runbook section. |
| `PROGRESS.md` (modify) | Flip the #336 pointer. |

---

### Task 1: SES client with unconfigured no-op

**Files:**
- Modify: `apps/api/package.json` (dependencies)
- Modify: `apps/api/src/config.ts`
- Create: `apps/api/src/clients/ses.ts`
- Test: `apps/api/tests/ses.test.ts`

**Interfaces:**
- Consumes: `config` from `apps/api/src/config.ts`, `logger` from `apps/api/src/logger.ts` (a Powertools `Logger`; `logger.info(msg, extra)` / `logger.warn(msg, extra)`).
- Produces:
  ```ts
  export type OutgoingEmail = { to: string; replyTo: string; subject: string; text: string };
  export async function sendEmail(mail: OutgoingEmail): Promise<void>;
  ```
  Later tasks mock the module path `../src/clients/ses` and assert on `sendEmail`.

- [ ] **Step 1: Install the SES v2 SDK into the api workspace**

Run from the repo root:

```bash
npm install -w apps/api @aws-sdk/client-sesv2@^3.1075.0
```

Then check the lockfile for the macOS prune:

```bash
git diff --stat package-lock.json && git diff package-lock.json | grep -c '^-.*@emnapi' || true
```

Expected: the second command prints `0`. If it prints anything else, run `git checkout origin/dev -- package-lock.json` and re-run the `npm install` line; repeat the check. Do not commit a lockfile that removes `@emnapi` entries.

- [ ] **Step 2: Add `MAIL_FROM` to the API config**

In `apps/api/src/config.ts`, add after the `WEB_ORIGIN` entry:

```ts
  /** Verified SES sender address for transactional mail (#336), e.g.
   * `no-reply@seopotion.co`. Empty locally and in tests: `clients/ses.ts` then
   * logs the would-be message instead of sending. */
  MAIL_FROM: process.env.MAIL_FROM ?? '',
```

- [ ] **Step 3: Write the failing tests**

Create `apps/api/tests/ses.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { send, SendEmailCommand } = vi.hoisted(() => ({
  send: vi.fn(async () => ({})),
  SendEmailCommand: vi.fn((input: unknown) => ({ input })),
}));
vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: vi.fn(() => ({ send })),
  SendEmailCommand,
}));

const { config } = vi.hoisted(() => ({ config: { MAIL_FROM: '' } }));
vi.mock('../src/config', () => ({ config }));

import { sendEmail } from '../src/clients/ses';

const mail = {
  to: 'new@example.com',
  replyTo: 'owner@example.com',
  subject: 'Hi',
  text: 'Body',
};

beforeEach(() => {
  vi.clearAllMocks();
  config.MAIL_FROM = '';
});

describe('sendEmail', () => {
  test('is a no-op when MAIL_FROM is unset', async () => {
    await sendEmail(mail);
    expect(send).not.toHaveBeenCalled();
    expect(SendEmailCommand).not.toHaveBeenCalled();
  });

  test('sends a simple text email with From display name and Reply-To', async () => {
    config.MAIL_FROM = 'no-reply@seopotion.co';
    await sendEmail(mail);
    expect(SendEmailCommand).toHaveBeenCalledWith({
      FromEmailAddress: 'SEOPotion <no-reply@seopotion.co>',
      Destination: { ToAddresses: ['new@example.com'] },
      ReplyToAddresses: ['owner@example.com'],
      Content: {
        Simple: {
          Subject: { Data: 'Hi', Charset: 'UTF-8' },
          Body: { Text: { Data: 'Body', Charset: 'UTF-8' } },
        },
      },
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('propagates SDK errors to the caller', async () => {
    config.MAIL_FROM = 'no-reply@seopotion.co';
    send.mockRejectedValueOnce(new Error('MessageRejected'));
    await expect(sendEmail(mail)).rejects.toThrow('MessageRejected');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
npm test -- ses.test
```

Expected: FAIL — `Failed to resolve import "../src/clients/ses"`.

- [ ] **Step 5: Implement the client**

Create `apps/api/src/clients/ses.ts`:

```ts
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { config } from '../config';
import { logger } from '../logger';

export type OutgoingEmail = {
  to: string;
  replyTo: string;
  subject: string;
  text: string;
};

// Region + credentials come from the Lambda execution role, like the SQS
// client. Constructed lazily so unconfigured envs (local dev, tests) never
// instantiate the SDK.
let client: SESv2Client | undefined;

/**
 * Send one plain-text transactional email via SES (#336). When `MAIL_FROM` is
 * unset the message is logged and dropped — local dev and tests need no AWS.
 * Errors are NOT swallowed: callers decide whether a failed send matters.
 */
export async function sendEmail(mail: OutgoingEmail): Promise<void> {
  if (!config.MAIL_FROM) {
    logger.info('MAIL_FROM unset — email not sent', { to: mail.to, subject: mail.subject });
    return;
  }
  client ??= new SESv2Client({});
  await client.send(
    new SendEmailCommand({
      FromEmailAddress: `SEOPotion <${config.MAIL_FROM}>`,
      Destination: { ToAddresses: [mail.to] },
      ReplyToAddresses: [mail.replyTo],
      Content: {
        Simple: {
          Subject: { Data: mail.subject, Charset: 'UTF-8' },
          Body: { Text: { Data: mail.text, Charset: 'UTF-8' } },
        },
      },
    }),
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npm test -- ses.test
```

Expected: 3 passed.

- [ ] **Step 7: Lint and commit**

```bash
npm run lint:fix
git add apps/api/package.json package-lock.json apps/api/src/config.ts apps/api/src/clients/ses.ts apps/api/tests/ses.test.ts
git commit -m "api: SES v2 sendEmail client, no-op without MAIL_FROM

Part of #336

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Member-added email builder

**Files:**
- Create: `apps/api/src/lib/member-added-email.ts`
- Test: `apps/api/tests/member-added-email.test.ts`

**Interfaces:**
- Consumes: `config.WEB_ORIGIN` from `apps/api/src/config.ts` (defaults to `http://localhost:3000`).
- Produces:
  ```ts
  export function memberAddedEmail(input: {
    ownerEmail: string;
    recipient: string;
    websiteUrl: string;
  }): { subject: string; text: string };
  ```

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/member-added-email.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';

vi.mock('../src/config', () => ({ config: { WEB_ORIGIN: 'https://app.example' } }));

import { memberAddedEmail } from '../src/lib/member-added-email';

describe('memberAddedEmail', () => {
  const mail = memberAddedEmail({
    ownerEmail: 'owner@example.com',
    recipient: 'new@example.com',
    websiteUrl: 'https://clewas.com',
  });

  test('subject names the website', () => {
    expect(mail.subject).toBe("You've been added to https://clewas.com on SEOPotion");
  });

  test('body says who added them, which address to sign in with, and links home', () => {
    expect(mail.text).toBe(
      [
        'owner@example.com added you to the SEOPotion workspace for https://clewas.com.',
        '',
        'Sign in with Google using this address (new@example.com) and the',
        'workspace will appear in your account:',
        '',
        'https://app.example/',
        '',
        "If you weren't expecting this, you can ignore this email.",
        '',
      ].join('\n'),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- member-added-email
```

Expected: FAIL — `Failed to resolve import "../src/lib/member-added-email"`.

- [ ] **Step 3: Implement the builder**

Create `apps/api/src/lib/member-added-email.ts`:

```ts
import { config } from '../config';

/**
 * The one transactional email the app sends today (#336): "you were added to
 * a workspace". Plain text, English only — the recipient has not logged in yet,
 * so there is no locale to honour. Access does not depend on this mail.
 */
export function memberAddedEmail(input: {
  ownerEmail: string;
  recipient: string;
  websiteUrl: string;
}): { subject: string; text: string } {
  const { ownerEmail, recipient, websiteUrl } = input;
  return {
    subject: `You've been added to ${websiteUrl} on SEOPotion`,
    text: [
      `${ownerEmail} added you to the SEOPotion workspace for ${websiteUrl}.`,
      '',
      `Sign in with Google using this address (${recipient}) and the`,
      'workspace will appear in your account:',
      '',
      `${config.WEB_ORIGIN}/`,
      '',
      "If you weren't expecting this, you can ignore this email.",
      '',
    ].join('\n'),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- member-added-email
```

Expected: 2 passed.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint:fix
git add apps/api/src/lib/member-added-email.ts apps/api/tests/member-added-email.test.ts
git commit -m "api: member-added email subject/body builder

Part of #336

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Send from the add-member route, never failing the add

**Files:**
- Modify: `apps/api/src/routes/members.ts` (imports + POST handler, currently lines 94–111)
- Modify: `apps/api/tests/members.test.ts` (mocks at top + `POST /core/members` describe block)

**Interfaces:**
- Consumes: `sendEmail` from `../clients/ses` (Task 1), `memberAddedEmail` from `../lib/member-added-email` (Task 2), `logger` from `../logger`. The route already has `access.org` (`Org`, with `website_url: string`) and `auth.email` (caller).
- Produces: no new exports; `POST /core/members` response is unchanged.

- [ ] **Step 1: Add the mail mock and failing tests**

In `apps/api/tests/members.test.ts`, add directly after the `vi.mock('@shared/db', ...)` block (before the `caller` declaration):

```ts
const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn(async () => {}) }));
vi.mock('../src/clients/ses', () => ({ sendEmail }));
```

Inside `describe('POST /core/members', ...)`, add these three tests after the existing `'owner adds a member (201, lowercased)'` test:

```ts
  test('emails the new member, Reply-To the owner', async () => {
    members.add.mockResolvedValueOnce({ ...mateRow, email: 'new@example.com' });
    const res = await client.members.$post({ json: { org_id: 'o1', email: 'new@example.com' } });
    expect(res.status).toBe(201);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'new@example.com',
        replyTo: 'owner@example.com',
        subject: "You've been added to https://example.com on SEOPotion",
      }),
    );
  });

  test('still 201 when the email fails', async () => {
    members.add.mockResolvedValueOnce({ ...mateRow, email: 'new@example.com' });
    sendEmail.mockRejectedValueOnce(new Error('MessageRejected'));
    const res = await client.members.$post({ json: { org_id: 'o1', email: 'new@example.com' } });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      email: 'new@example.com',
      role: 'member',
      created_at: now.toISOString(),
    });
  });

  test('sends nothing on 409', async () => {
    members.add.mockResolvedValueOnce(null);
    const res = await client.members.$post({ json: { org_id: 'o1', email: 'mate@example.com' } });
    expect(res.status).toBe(409);
    expect(sendEmail).not.toHaveBeenCalled();
  });
```

Note: `vi.clearAllMocks()` in the existing `beforeEach` resets `sendEmail`'s call count but keeps its `async () => {}` implementation, so the other POST tests keep passing.

- [ ] **Step 2: Run the tests to verify the new ones fail**

```bash
npm test -- members.test
```

Expected: exactly 1 failure — `'emails the new member, Reply-To the owner'` (`sendEmail` called 0 times). The other two new cases pass trivially before the wiring exists; they guard the behaviour once it does.

- [ ] **Step 3: Wire the send into the route**

In `apps/api/src/routes/members.ts`, add the imports (keep Biome's import ordering — `lint:fix` will sort them):

```ts
import { sendEmail } from '../clients/ses';
import { memberAddedEmail } from '../lib/member-added-email';
import { logger } from '../logger';
```

Replace the tail of the POST handler, from `const row = await OrgMemberRepo.add(...)` through the `return c.json(..., 201)`, with:

```ts
      const row = await OrgMemberRepo.add({ org_id, email: normalized, invited_by: auth.userId });
      if (!row) return c.json({ error: 'already_member' as const }, 409);
      // Courtesy notification (#336). Access comes from the row above, so a
      // failed send must not fail the add — log and move on.
      try {
        await sendEmail({
          to: row.email,
          replyTo: auth.email,
          ...memberAddedEmail({
            ownerEmail: auth.email,
            recipient: row.email,
            websiteUrl: access.org.website_url,
          }),
        });
      } catch (err) {
        logger.warn('member-added email failed', { org_id, to: row.email, err });
      }
      return c.json(
        { email: row.email, role: 'member' as const, created_at: row.created_at.toISOString() },
        201,
      );
```

Also update the file's header comment so it no longer claims no mail is sent:

```ts
/**
 * Org roster (#333). Reads are open to owner and members; add/remove are
 * owner-only. Membership is by email: the teammate logs in with Google using
 * that address. Adding sends a courtesy notification email (#336) — access
 * never depends on it.
 */
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- members.test
```

Expected: all POST/GET/DELETE cases pass, including the three new ones.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint:fix && npm run check
git add apps/api/src/routes/members.ts apps/api/tests/members.test.ts
git commit -m "api: email the teammate when an owner adds them

Part of #336

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Env docs and Team tab copy

**Files:**
- Modify: `.env.example` (after the `# WEB_ORIGIN=` line)
- Modify: `apps/web/messages/en.json` (`description` under the team section, currently line 917)
- Modify: `apps/web/messages/tr.json` (same key, currently line 917)

**Interfaces:** none.

- [ ] **Step 1: Document `MAIL_FROM` in `.env.example`**

Insert after the `# WEB_ORIGIN=` line:

```
# Verified SES sender for transactional mail (#336). Leave unset locally: the
# API then logs the would-be email instead of sending. Deployed envs set
# no-reply@<stage domain> via CDK.
# MAIL_FROM=
```

- [ ] **Step 2: Update the English Team tab description**

In `apps/web/messages/en.json`, change the team `description` value to:

```
Teammates you add here can use everything in this workspace except billing and this team list. They get an email and sign in with Google using the address you enter.
```

- [ ] **Step 3: Update the Turkish Team tab description**

In `apps/web/messages/tr.json`, change the same key to:

```
Buraya eklediğiniz ekip arkadaşları, faturalandırma ve bu ekip listesi dışında bu çalışma alanındaki her şeyi kullanabilir. Bir e-posta alırlar ve girdiğiniz adresle Google üzerinden giriş yaparlar.
```

- [ ] **Step 4: Verify the web app still typechecks and its team test passes**

```bash
npm run check:web && npm test -- team-panel
```

Expected: typecheck clean, `team-panel.test.tsx` passes (it does not assert on the description string; if it does, update the expectation to the new copy).

- [ ] **Step 5: Commit**

```bash
git add .env.example apps/web/messages/en.json apps/web/messages/tr.json
git commit -m "web+env: note the member-added email in Team tab copy and .env.example

Part of #336

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: CDK — SES identity, grant, env, DKIM outputs

**Files:**
- Modify: `infra/lib/config.ts` (`StageConfig` interface + both stage objects)
- Modify: `infra/lib/api-stack.ts` (imports; `authEnv` block at ~line 139; grants after `apiFn` at ~line 260; outputs near line 624)

**Interfaces:**
- Consumes: `cfg` (a `StageConfig`) and `apiFn` (`NodejsFunction`) already in scope in `ApiStack`'s constructor.
- Produces: `MAIL_FROM` env on the API Lambda; `ses:SendEmail`/`ses:SendRawEmail` on its role scoped to the identity; three stack outputs `MailDkim1Name`/`MailDkim1Value` … `MailDkim3Value`.

- [ ] **Step 1: Install infra deps in the worktree and confirm a clean baseline**

```bash
cd infra && npm install && npx tsc --noEmit -p . && cd ..
```

Expected: no output from `tsc` (clean). `infra/node_modules` is gitignored.

- [ ] **Step 2: Add `mailFrom` to the stage config**

In `infra/lib/config.ts`, add to the `StageConfig` interface after `webOrigin`:

```ts
  mailFrom: string; // verified SES sender (#336) — the domain after `@` is the SES identity
```

Add to the `staging` object after `webOrigin`:

```ts
    mailFrom: 'no-reply@staging.seopotion.co',
```

Add to the `prod` object after `webOrigin`:

```ts
    mailFrom: 'no-reply@seopotion.co',
```

- [ ] **Step 3: Add the identity, grant, env and outputs to the API stack**

In `infra/lib/api-stack.ts`:

Add the import (alphabetical among the `aws-cdk-lib/*` imports, after `aws-s3`):

```ts
import { EmailIdentity, Identity } from 'aws-cdk-lib/aws-ses';
```

Add `MAIL_FROM` to the `authEnv` object (API-only env block), after `WEB_ORIGIN: cfg.webOrigin,`:

```ts
      MAIL_FROM: cfg.mailFrom,
```

Immediately after `githubAppKeyParam.grantRead(apiFn);` add:

```ts
    // Transactional email (#336): one SES domain identity per stage, Easy DKIM.
    // Only the API Lambda may send. DNS is Cloudflare, so the DKIM CNAMEs are
    // surfaced as outputs to paste by hand — see ENVIRONMENTS.md § Transactional
    // email. Until they're added (and prod leaves the SES sandbox) sends fail
    // and the API logs them; adding a member still succeeds.
    const mailIdentity = new EmailIdentity(this, 'MailIdentity', {
      identity: Identity.domain(cfg.mailFrom.split('@')[1]),
    });
    mailIdentity.grantSendEmail(apiFn);
    mailIdentity.dkimRecords.forEach((record, i) => {
      new CfnOutput(this, `MailDkim${i + 1}Name`, { value: record.name });
      new CfnOutput(this, `MailDkim${i + 1}Value`, { value: record.value });
    });
```

- [ ] **Step 4: Typecheck and synth the staging stack**

```bash
cd infra && npx tsc --noEmit -p . && npx cdk synth SeoApiStack-staging --quiet > /dev/null && cd ..
```

Expected: `tsc` clean; `cdk synth` exits 0 (`infra/bin/app.ts` declares both stage stacks from one app, so the stack name selects the stage; synth bundles the Lambdas with esbuild and takes a minute; a warning that `apps/web/.open-next` is missing is normal). Then confirm the template contains the identity and the outputs:

```bash
grep -c 'AWS::SES::EmailIdentity' infra/cdk.out/SeoApiStack-staging.template.json
grep -c 'MailDkim' infra/cdk.out/SeoApiStack-staging.template.json
```

Expected: `1` and `6` (three name + three value outputs).

- [ ] **Step 5: Commit**

```bash
git add infra/lib/config.ts infra/lib/api-stack.ts
git commit -m "infra: SES domain identity + send grant for the API Lambda, MAIL_FROM env

Part of #336

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Runbook and progress bookkeeping

**Files:**
- Modify: `infra/ENVIRONMENTS.md` (new section before `## Google OAuth clients`, currently line 175)
- Modify: `PROGRESS.md` (line 37, the org membership entry)

**Interfaces:** none.

- [ ] **Step 1: Add the SES runbook section**

Insert before `## Google OAuth clients` in `infra/ENVIRONMENTS.md`:

````markdown
## Transactional email (SES, #336)

The API sends one courtesy email today: "you've been added to a workspace"
(`POST /core/members`). CDK creates an SES **domain identity** per stage
(`staging.seopotion.co` / `seopotion.co`, Easy DKIM) and grants send to the
API Lambda only. Sends fail — logged, never blocking the add — until the two
manual steps below are done.

1. **DKIM CNAMEs in Cloudflare** (after the first deploy that includes the
   identity). Read the three name/value pairs from the stack outputs and add
   each as a CNAME, **DNS only** (grey cloud, not proxied):

   ```sh
   aws cloudformation describe-stacks --stack-name SeoApiStack-staging --profile seo-staging \
     --query "Stacks[0].Outputs[?starts_with(OutputKey,'MailDkim')].[OutputKey,OutputValue]" --output table
   ```

   SES flips the identity to *Verified* within minutes of the records
   resolving: `aws sesv2 get-email-identity --email-identity staging.seopotion.co --profile seo-staging`
   → `VerifiedForSendingStatus: true`.
2. **Sandbox.** New accounts can only deliver to verified recipients.
   - *Staging* stays in the sandbox. Verify each team test inbox once (a
     confirmation link is emailed to it):
     ```sh
     aws sesv2 create-email-identity --email-identity you@example.com --profile seo-staging
     ```
   - *Prod* needs production access once (form in the SES console →
     *Account dashboard* → *Request production access*, or
     `aws sesv2 put-account-details --production-access-enabled --mail-type TRANSACTIONAL --website-url https://www.seopotion.co --use-case-description '...' --profile seo-prod`).
     Approval takes up to 24h.

No custom MAIL FROM domain: the envelope sender stays on `amazonses.com`, so
the Zoho SPF record is untouched and DKIM alignment on the From domain
satisfies DMARC. The team's Zoho Mail is deliberately **not** used for app
mail — its free-tier send cap is reserved for customer outreach.
````

- [ ] **Step 2: Update `PROGRESS.md`**

Change line 37's tail so the #336 pointer reads as built. Replace:

```
(`org_members`, no invite mail)
```
with
```
(`org_members`, courtesy email on add via SES)
```
and replace:
```
Real invite emails: [#336](https://github.com/seopotion/seo/issues/336); finer roles:
```
with
```
Member-added email: ✅ [#336](https://github.com/seopotion/seo/issues/336) (DKIM + SES sandbox steps are per-env runbook items in `infra/ENVIRONMENTS.md`); finer roles:
```

- [ ] **Step 3: Commit**

```bash
git add infra/ENVIRONMENTS.md PROGRESS.md
git commit -m "docs: SES runbook (DKIM, sandbox) and PROGRESS pointer for #336

Part of #336

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Full verification and PR

**Files:** none new.

- [ ] **Step 1: Run the full check suite**

```bash
npm run lint && npm run check:all && npm test
```

Expected: lint clean, both typechecks clean, all tests pass except the known local `wordpress-plugin-behavior.test.ts` php failure. Paste the summary lines into the PR body.

- [ ] **Step 2: Confirm the lockfile is CI-safe**

```bash
git diff origin/dev -- package-lock.json | grep -c '^-.*@emnapi' || true
```

Expected: `0`.

- [ ] **Step 3: Push and open the PR against `dev`**

```bash
git push -u origin claude/issue-336-8b9312
gh pr create --base dev --title "[backend] Email teammates when an owner adds them (SES)" --body-file - <<'EOF'
Closes #336

Sends one plain-text courtesy email via SES when an owner adds a member in Settings → Team. Access still comes from the `org_members` row; a failed send is logged and never fails the add. No invite token / accept page — the spec explains why.

Spec: `docs/superpowers/specs/2026-09-07-member-added-email-design.md`.

**Code**
- `apps/api/src/clients/ses.ts` — `sendEmail` over SES v2, no-op when `MAIL_FROM` is unset.
- `apps/api/src/lib/member-added-email.ts` — subject/body.
- `POST /core/members` calls it after the insert in a try/catch.
- Team tab copy (en/tr) mentions the email.

**Infra**
- SES domain identity per stage (`staging.seopotion.co` / `seopotion.co`), `grantSendEmail` on the API Lambda only, `MAIL_FROM` env, DKIM CNAMEs as stack outputs.

**After merge to staging (manual, runbook in `infra/ENVIRONMENTS.md` § Transactional email)**
- [ ] Add the three DKIM CNAMEs in Cloudflare (DNS only).
- [ ] Verify a team inbox in the staging SES sandbox, add it via the Team tab, check From/Reply-To/DKIM and the link.
- [ ] Prod: DKIM CNAMEs + production-access request.

Checks: `npm run lint`, `npm run check:all`, `npm test` (only the known local php failure).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 4: Record the staging follow-up in memory**

Write `/Users/fco/.claude/projects/-Users-fco-Documents-projects-seopotion-seo/memory/member-email-pr-staging-pending.md` with a pointer to the PR and the three manual steps (DKIM CNAMEs, staging inbox verification, prod sandbox exit), and add a one-line entry to `MEMORY.md`. Keep it a pointer; the runbook lives in the repo.
