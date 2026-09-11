# Member-added notification email — design

_Issue: [#336](https://github.com/seopotion/seo/issues/336). Date: 2026-09-07.
Follow-up to [#333](https://github.com/seopotion/seo/issues/333) / the
[org membership spec](2026-09-05-org-membership-design.md)._

## Goal

When an owner adds a teammate in Settings → Team, the teammate receives an
email saying they were added and telling them to sign in with Google using
that address. Today the owner has to tell them out of band.

## Decisions

- **Notification only, not an invite flow.** Access already comes from the
  `org_members` row: whoever logs in with the matching Google email sees the
  org. An invite token, expiry, accept endpoint and accept page would add
  nothing to access control, so #336's second bullet is dropped. The email
  is a courtesy; the row is the source of truth, as #336's third bullet asks.
- **AWS SES, not Zoho.** The team's Zoho Mail is a free-tier account with a
  low daily send cap that is reserved for customer outreach. SES is already
  in the stack, needs no API key (IAM grant on the Lambda role), costs
  nothing at this volume, and CDK owns the domain identity. ZeptoMail and
  Resend were considered and rejected as extra vendors with the same DNS
  work and no benefit over SES.
- **Sender and reply-to.** From `SEOPotion <no-reply@seopotion.co>` on prod
  and `SEOPotion <no-reply@staging.seopotion.co>` on staging. Reply-To is
  the owner's email, so a confused teammate replies to the person who added
  them. Replies to `no-reply@` land in Zoho (MX unchanged) or bounce.
- **No custom MAIL FROM domain.** The envelope sender stays on
  `amazonses.com`, so the existing Zoho SPF record is untouched; DKIM
  alignment on the From domain satisfies DMARC.
- **Send failure never fails the add.** The member row is written first;
  the send is awaited in a try/catch and a failure is logged with org id and
  recipient. The API response and the Team tab are unchanged — no "email
  sent" claim anywhere.
- **Unconfigured means no-op.** When `MAIL_FROM` is empty (local dev,
  tests) the mail client logs the would-be message and returns. No AWS
  credentials or network are needed locally.
- **Plain text only.** One short message; no HTML template, no i18n of the
  email body (the product UI is localized, the email is not — English only,
  matching the Google login screen the recipient lands on).
- **No resend, no UI change beyond copy.** Re-adding an existing member
  still returns 409 and sends nothing. The Team tab description gains a
  sentence saying the teammate receives an email (English + Turkish).

## Email

- **Subject:** `You've been added to <website_url> on SEOPotion`
- **Body:**

  ```
  <owner email> added you to the SEOPotion workspace for <website_url>.

  Sign in with Google using this address (<recipient email>) and the
  workspace will appear in your account:

  <WEB_ORIGIN>/

  If you weren't expecting this, you can ignore this email.
  ```

  `<WEB_ORIGIN>/` is the app home, where unauthenticated users already land
  and sign in.

## Code (API only)

- `apps/api/src/clients/ses.ts` — `sendEmail({ to, replyTo, subject, text })`
  over `@aws-sdk/client-sesv2` `SendEmailCommand` (Simple content). Reads
  `config.MAIL_FROM`; when empty, logs at info and returns without sending.
  Sits next to the SQS client and follows its "SDK uses the execution role"
  pattern.
- `apps/api/src/config.ts` — `MAIL_FROM: process.env.MAIL_FROM ?? ''`
  (verified sender address, empty locally).
- `apps/api/src/lib/member-added-email.ts` — builds `{ subject, text }` from
  `{ ownerEmail, recipient, websiteUrl }` using `config.WEB_ORIGIN`. Tiny,
  single-use, kept out of the route for testability.
- `apps/api/src/routes/members.ts` POST handler — after a successful
  `OrgMemberRepo.add`, await `sendEmail(...)` in try/catch; log failures via
  the existing `logger`; return 201 as before.
- Root `.env.example` — commented `MAIL_FROM=` with a one-line note.
- `apps/web/messages/{en,tr}.json` — extend the Team tab `description`.

## Infra (`infra/`)

- `lib/config.ts` — `StageConfig.mailFrom`: `no-reply@staging.seopotion.co`
  / `no-reply@seopotion.co`. The identity domain is the part after `@`.
- `lib/api-stack.ts`:
  - `new EmailIdentity(this, 'MailIdentity', { identity: Identity.domain(<domain>) })`
    (`aws-cdk-lib/aws-ses`), Easy DKIM.
  - `identity.grantSendEmail(apiFn)` — API Lambda only; the worker and
    Step Functions Lambdas get nothing.
  - `MAIL_FROM: cfg.mailFrom` added to `authEnv` (the API-only env block).
  - Three `CfnOutput`s with the DKIM CNAME name/value pairs
    (`identity.dkimRecords`) for pasting into Cloudflare.
- `ENVIRONMENTS.md` — new "Transactional email (SES)" section under the
  per-account prerequisites: add the three DKIM CNAMEs in Cloudflare after
  the first deploy; staging stays in the SES sandbox, so verify each team
  test address by hand (`aws sesv2 create-email-identity --email-identity
  <addr> --profile seo-staging`); prod needs the one-time production-access
  request (`aws sesv2 put-account-details` or the console form). Until
  those are done, sends fail and are logged — the feature degrades to
  today's behaviour.

## Testing

- `apps/api/tests/members.test.ts` — mock `../src/clients/ses`. New cases:
  - successful add calls `sendEmail` once with `to` = new member,
    `replyTo` = caller email, subject containing the website URL;
  - `sendEmail` rejecting still returns 201 and the row;
  - 409 (already a member) does not call `sendEmail`.
- `apps/api/tests/ses.test.ts` — with `MAIL_FROM` empty, `sendEmail`
  resolves without constructing/sending an SDK command (mock the SDK
  client).
- Manual, on staging after merge: verify one team address in the staging
  SES account, add it via the Team tab, confirm the email arrives with the
  expected From/Reply-To, DKIM pass, and a working link. This is also the
  first staging exercise of the #333 member flow (PR #338 is on `dev`
  only at the time of writing).

## Out of scope

- Invite tokens / accept page (dropped, see Decisions).
- HTML templates, localization of the email, resend button.
- Custom MAIL FROM domain, bounce/complaint handling (SNS), send metrics.
- Any other transactional email; `sendEmail` is generic enough to reuse but
  nothing else calls it yet.
