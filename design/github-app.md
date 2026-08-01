# GitHub App (static-site publishing credentials)

**Status: built 2026-07-30, still unregistered.** The code is in
[`clients/github.ts`](../apps/api/src/clients/github.ts),
[`lib/github-state.ts`](../apps/api/src/lib/github-state.ts) and
[`routes/integrations.ts`](../apps/api/src/routes/integrations.ts); **creating the three
Apps remains a human action** and nothing works until it happens (see
[Registration](#registration)). This is the auth half of the static-site integration:
[`static-site-integration.md`](static-site-integration.md) froze the *bytes* we commit,
[`integrations-model.md`](integrations-model.md) froze *where the connection is stored*,
and this doc covers how a client grants us write access in the first place — registration,
permission scoping, the installation flow that yields a trustworthy `installation_id`, and
how a publish mints a token from it.

One thing here **amends the design as written**: the state alone did not close the
installation-claim hole, and a third check was added. See
[Why `state` is not optional here](#why-state-is-not-optional-here).

## Why an App

| Option | Why not |
| --- | --- |
| Fine-grained PAT | The client pastes a long-lived secret that we then hold and must encrypt, rotate and breach-notify on. It also expires on GitHub's schedule, so the integration silently dies and the fix is "paste it again". |
| Deploy key (SSH) | Per-repo write with no REST surface. The atomic-commit sequence is the Git Data API over HTTPS; a deploy key would mean running `git` over SSH from a Lambda. |
| **GitHub App** | The client installs it, picks the repositories, and revokes it from their own settings without asking us. We hold **one** private key for all clients and mint ~1-hour tokens from it — no per-client secret at rest, which is what makes 2.3's `static-site` member secretless. |

## Registration

One App **per environment**. The Setup URL is a single field on the App, so staging and
prod cannot share one, and per-env credentials already follow this pattern everywhere else
(`/seo/staging/*`, `/seo/prod/*` in [`infra/lib/config.ts`](../infra/lib/config.ts)). Local
dev gets a third; GitHub accepts an `http://localhost` Setup URL.

| Field | Value | Why |
| --- | --- | --- |
| Owner | The **`seopotion` organization**, not a personal account | The App outlives any one person's account and can be handed over without a re-install by every client |
| Name | `SeoPotion` / `SeoPotion (staging)` / `SeoPotion (dev)` | Globally unique on GitHub; the slug derives from it and appears in the install URL |
| Homepage URL | The marketing site | Shown on the public install page — clients read this before granting write access |
| Setup URL | `<WEB_ORIGIN>/dashboard/integrations/github/callback` | Where GitHub returns after install |
| Redirect on update | **On** | Reconfiguring an existing installation comes back through the same flow instead of dead-ending on github.com |
| Request user authorization (OAuth) during installation | **Off** | We never act as the user. Leaving it off also keeps the Setup URL live — with it on, GitHub redirects to the Callback URL instead and the consent screen grows an account-identity ask we have no use for |
| Webhook | **Inactive** | See [Webhooks](#webhooks-not-in-v1) |
| Repository permissions | **Contents: Read and write**. Metadata: Read-only (mandatory, auto-selected) | `contents` is the one permission that covers blobs, trees, commits and moving a ref |
| Where can this be installed | **Any account** for prod; **Only on this account** for staging and dev | See below |

### Public, but only the prod App

Visibility governs *who may install* — i.e. who may point the registration at their
repositories — not what the App can do. Only the prod registration is ever installed by a
customer, so only it needs "Any account". Staging and dev stay private, which is both
tighter and reversible: **a public App cannot be made private again once it is installed on
another account**, so the one-way door is confined to the one registration where going back
would mean exiting the business.

Public is not a preference; every private alternative reintroduces a per-customer secret at
rest, which is the exact property the App was chosen to avoid:

| Alternative | What we would hold per customer |
| --- | --- |
| The customer registers their *own* App and hands us its key | A **private key per customer** — worse than the PAT above, since it mints tokens for everything that App is granted |
| Fine-grained PAT | A long-lived token that expires on GitHub's clock and is re-pasted by hand |
| Deploy key | An SSH private key, plus abandoning the Git Data API for shelling out to `git` |

They also move the registration work onto the customer, which is where self-serve
onboarding dies. Worth doing before the first customer sees the consent screen: **verify
the org's domain** (a DNS TXT record) so the install page carries a verified badge next to
the org name — cheap, and the ask is write access to someone's production site repo.

Registering is a human action, done three times. **Everything else on this page is built and
merged; this list is the entire remaining gap** — until it is done,
`GET /dashboard/integrations/github/install-url` answers `503 github_app_not_configured`
rather than linking to a github.com 404:

1. Create the App with the table above; save.
2. Note the **App slug** (from the URL) and **Client ID** (from the settings page) — both
   public. Set them as GitHub Actions repo *variables* `GITHUB_APP_SLUG_<STAGE>` /
   `GITHUB_APP_CLIENT_ID_<STAGE>`, which [`deploy-backend.yml`](../.github/workflows/deploy-backend.yml)
   already passes to synth, and in the root `.env` for local dev.
3. **Generate a private key.** GitHub shows the `.pem` once and keeps only a fingerprint.
4. Put it in SSM (see [The private key](#the-private-key)).
5. Add `/seo/<stage>/github-app-key` to the SSM list in
   [`cli/src/lib/preflight.ts`](../apps/cli/src/lib/preflight.ts). **Deliberately not done
   yet:** preflight is a hard deploy gate (`process.exit(… ready ? 0 : INFRA_DOWN)`), so
   asserting a parameter that cannot exist until step 4 would red-line every unrelated
   backend deploy. It belongs in the same change that creates the parameter.
6. Install it on one test repo and confirm the callback lands.

### The permissions we deliberately don't take

**`workflows: write`.** Without it GitHub rejects — 422, at commit time — any push that
creates or modifies a file under `.github/workflows/`. That is a feature, not a limitation:
**our publisher provably cannot alter a client's CI**, which is the strongest thing we can
say to someone being asked for write access to their site's repository. The price is that
the deploy workflow in task 3.7 is installed once, by hand, by the repo owner — it can
never arrive in one of our commits.

**`pull_requests`, `actions`, `administration`.** We commit straight to a branch and the
client's existing push trigger does the rest. Nothing in the contract needs them.

## The install flow

Two steps, mirroring the GSC connect flow ([`routes/gsc.ts`](../apps/api/src/routes/gsc.ts)),
because the problem is the same shape: an off-site consent screen, then a resource the user
must choose before the connection means anything.

| # | Actor | What happens |
| --- | --- | --- |
| 1 | `GET /dashboard/integrations/github/install-url?org_id=` | Verify org ownership, sign a state, return `https://github.com/apps/<slug>/installations/new?state=<jwt>` |
| 2 | github.com | The client picks the account and the repositories, and installs |
| 3 | GitHub → web | `GET <WEB_ORIGIN>/dashboard/integrations/github/callback?installation_id=…&setup_action=install&state=<jwt>` |
| 4 | `POST /dashboard/integrations/github/installation` | Body `{ installation_id, state }`. Verify state → mint a token → `GET /installation/repositories` → return `{ repos, grant }`. **Nothing is persisted yet** |
| 5 | `POST /dashboard/integrations/static-site` | Body `{ grant, repo, branch, content_path? }`. Verify grant, verify the App can read `repo` at `branch`, then insert the integration |

Because the static-site provider has no secret to stash, step 4 can genuinely defer the
write to step 5 — unlike GSC, which must persist the refresh token before the user picks a
property. No partial rows.

### Why `state` is not optional here

**The installation-claim hole.** `installation_id` is a small sequential integer and is not
a secret — it sits in the URL bar of whoever installed the App. If the connect endpoint
accepted a bare `installation_id`, any authenticated customer could bind *someone else's*
installation to their own org and publish articles into a stranger's repository. Three
locks, the third added while building:

1. An `installation_id` is trusted only when it arrives alongside a `state` **we** signed
   for that org minutes earlier — the [`lib/gsc-state.ts`](../apps/api/src/lib/gsc-state.ts)
   pattern with `purpose: 'github-install'`.
2. **The installation must be fresh.** Step 4 reads `GET /app/installations/{id}` and
   refuses anything created or reconfigured more than 15 minutes ago.
3. One installation binds to exactly one org, enforced in the database rather than in a
   handler:

```ts
await db.collection('integrations').createIndex(
  { installation_id: 1 },
  { unique: true, partialFilterExpression: { provider: 'static-site' } },
);
```

A second claimant gets a 409 instead of silent co-tenancy.

**Why lock 2 had to be added.** The two original locks did not actually close the hole,
and the claim above that "the finalize endpoint never reads a client-supplied
`installation_id`" was only ever true of step 5. GitHub does not sign the Setup URL
redirect, so at step 4 the id is still a number the browser typed — and our own state, not
a victim's, is what accompanies it. The attack needed no race: start a connect flow, never
install anything, and POST a *guessed* id instead. Ids are sequential, so guessing a live
one is enumeration, not luck. Lock 3 only helps if the victim connected first; a
never-connected victim would be silently bound to the attacker's org.

The freshness check removes the guessing: an installation that was not created in the last
few minutes is not the one this flow produced. Deliberately looser than the state's own
10-minute TTL — the state is the tighter bound, and this only needs to exclude
installations that predate the flow. `updated_at` counts as well as `created_at`, because
reconfiguring an existing installation legitimately comes back through the same callback.

What it costs: a user who bookmarks the callback URL and returns to it an hour later gets
"start again" rather than a connection. That is the correct answer to an ambiguous request,
and the reconnect path is one click.

**Why a separate grant.** The state's 10-minute TTL is sized for GSC, which redeems it the
instant the callback fires. Here the user still has to choose a branch and read a paths
screen, which easily runs longer. Step 4 therefore verifies the state once and re-issues a
`grant` — same helper, `purpose: 'github-install-grant'`, carrying `{ org_id,
installation_id }` for ~15 minutes. The finalize endpoint then never reads a
client-supplied `installation_id` or `org_id` at all: both come out of a token we signed.
*This amends [`integrations-model.md`](integrations-model.md#api-surface), which listed the
connect body as `{ org_id, installation_id, … }`.*

**`setup_action`.** `install` is the happy path. A user without admin rights on the target
organization produces `request` instead — the install is pending an owner's approval and
**there is no `installation_id` yet**. The callback page must render "waiting for your
organization's approval" rather than an error; GitHub sends them back through the same
Setup URL once an owner approves.

**Locale.** The Setup URL is one fixed string per App, but the web app is locale-prefixed
(`localePrefix: 'as-needed'`, [`i18n/routing.ts`](../apps/web/i18n/routing.ts)), so a
Turkish user returns to the English callback. Either carry the locale in the state and
redirect after step 4, or accept it — it is one screen, and cheap to fix later.

## Minting a token

Built in [`clients/github.ts`](../apps/api/src/clients/github.ts) alongside the commit
sequence, mirroring [`clients/wordpress.ts`](../apps/api/src/clients/wordpress.ts) in shape.
`installationToken` ended up **module-private** — `verifyRepoAccess` and `commitFiles` are
its only callers, and exporting an unused function is dead API:

```ts
/** App JWT: RS256, `iss` = the App's client id, `iat` backdated 60s for clock
 *  drift, `exp` <= 10 minutes out (GitHub rejects anything longer). */
async function appJwt(): Promise<string>;

/** POST /app/installations/{id}/access_tokens with `Authorization: Bearer <appJwt>`.
 *  Scope the token DOWN at mint time — even if the client installed us on twenty
 *  repos, this token reaches exactly one:
 *    { repositories: [name], permissions: { contents: 'write' } }  */
async function installationToken(installationId: number, repo: string): Promise<string>;
```

Installation tokens last one hour. Cache them at module scope keyed by
`${installationId}:${repo}` and expire five minutes early — Lambda warm reuse then makes a
repeat publish skip the mint entirely, the same reasoning as the cached Mongo client in
[`data-layer.md`](data-layer.md).

**Signing, concretely.** GitHub hands you a **PKCS#1** PEM (`-----BEGIN RSA PRIVATE
KEY-----`). `hono/jwt` does support RS256, but it signs through WebCrypto, which imports
**PKCS#8 only** — so the obvious reuse of the existing JWT helper fails at *runtime*, not at
compile time. Use `node:crypto` directly (`createSign('RSA-SHA256')` over the two base64url
segments): it takes PKCS#1 as-is, adds no dependency, and we never verify this JWT
ourselves.

**Failure mapping**, into the `last_error` field 2.3 put on the integration:

| Response | Meaning | Integration state |
| --- | --- | --- |
| 404 on token mint | The client uninstalled us | Disconnected — the UI offers "reconnect", not "retry" |
| 403 on token mint | Installation suspended | Connected but broken |
| 404 on repo read | Repo renamed, or dropped from the installation's selection | Connected but broken |
| 422 on commit | Protected branch, or a path under `.github/workflows/` | Connected but broken, with a distinct message — these two are our bug, not the client's |

Two wrinkles the table did not anticipate:

- **422 on token mint is overloaded.** Asking for `repositories: [name]` *and*
  `permissions: { contents: 'write' }` means one status covers both "that repo is not in
  this installation" and "you never had that permission" — and the fixes differ (re-select a
  repo vs. re-install). Only GitHub's prose separates them, so the client matches
  `/permission/i` on the message and falls back to `repo_not_found`. Brittle by nature;
  the fallback is the commoner case, so a message change degrades to a slightly wrong label
  rather than a wrong outcome.
- **422 on the ref update is two different things.** `Update is not a fast forward` means a
  concurrent publish won and we retry on the new head; anything else is permanent and
  retrying is just three times the latency before the same failure. The client tells them
  apart before deciding to retry.

## The private key

- **SSM SecureString, out of band, API Lambda only** — the same rule and the same shell as
  the JWT secret:

  ```sh
  aws ssm put-parameter --name /seo/<stage>/github-app-key --type SecureString \
    --value file://seopotion.<stage>.private-key.pem
  ```

  `file://` is not incidental: the PEM's newlines have to survive, and a mangled key fails
  at the first publish, not at deploy.
- It fits comfortably — a 2048-bit PKCS#1 PEM is ~1.7 KB against SSM Standard's 4 KB
  ceiling, so no Advanced tier and no per-parameter charge.
- **Not granted to the worker**, matching the JWT-secret boundary. If publishing later
  moves out of the API Lambda (a large image set against API Gateway's 29-second ceiling),
  the grant moves with it — one line in [`api-stack.ts`](../infra/lib/api-stack.ts).
- Rotation: generate a second key in the App settings, `put-parameter --overwrite`, then
  delete the old key on GitHub. Both are valid in between, so there is no window where
  publishing is down.
- Explicitly **not** the [`WORDPRESS_ROUTE_SECRET`](../apps/api/src/config.ts#L17)
  pattern — a plaintext literal in `config.ts`, in git forever, shared by every install.

### Config

Four entries in [`config.ts`](../apps/api/src/config.ts), following the established
public-value + `*_PARAM` name + local-fallback trio:

```ts
GITHUB_APP_SLUG      // public, per-env — builds the install URL
GITHUB_APP_CLIENT_ID // public, per-env — the JWT `iss`
GITHUB_APP_KEY_PARAM // SSM SecureString NAME (not the value)
GITHUB_APP_KEY       // local-dev PEM from the root .env; unset in deployed envs
```

Then `getGithubAppKey()` in [`lib/secrets.ts`](../apps/api/src/lib/secrets.ts) beside
`getGscTokenKey`, three per-stage fields in `infra/lib/config.ts`, three `authEnv` entries
and one `grantRead(apiFn)` in `api-stack.ts`.

## Webhooks: not in v1

Two events would matter — `installation` (`deleted`, `suspend`) and
`installation_repositories` (`removed`). Both only tell us *earlier* about a state the
publish path already handles: the failure table above turns each into `last_error` on the
next attempt. Against that, a webhook is a public unauthenticated route, an HMAC signature
check, and a fourth secret to provision per environment.

Register with the webhook inactive. Turn it on when the actual cost bites — **a client who
uninstalls us keeps seeing "Connected" until their next publish attempt** — rather than
building the receiver for a status badge.

## Deliberately out of scope

- ~~**The commit sequence.**~~ Built with the rest of 3.2: `commitFiles()` takes a list of
  `{ path, content }` (a `null` content deletes in the same commit) and returns the sha.
  Choosing *which* files to write — rendering the frontmatter and rebuilding
  `manifest.json` — belongs to the publish route (3.5), not to this client.
- **Non-GitHub hosts.** GitLab's nearest equivalent is a group access token and Bitbucket's
  is an OAuth consumer; neither maps onto an installation flow. That asymmetry is exactly
  why `host` is a *field* on the integration rather than an assumption baked through it.
- **Acting as the user.** No OAuth-during-install, no user tokens. Commits are authored by
  the App's own bot identity, which is what keeps them filterable in the client's history.
- **A Marketplace listing.** Public visibility is enough to install from a URL; listing is a
  distribution decision with a verification process attached, not a technical prerequisite.
  Note for whenever it is revisited: an install started from a Marketplace page **cannot
  carry our `state`**, so it arrives with an `installation_id` and no proof of whose it is.
  Listing therefore needs its own binding path — land the user on the callback, require a
  logged-in session, and bind the installation to the org they pick there. Billing is a
  separate reason to defer: LemonSqueezy already owns that ([`billing.ts`](../apps/api/src/clients/billing.ts)).
