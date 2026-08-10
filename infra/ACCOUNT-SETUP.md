# AWS account setup

One-time foundation for the AWS organization that replaces the current single
personal account (`859998284061`). Run this once, in order. Migrating the
workload itself is **not** part of this document — see [Follow-on work](#follow-on-work).

Human access is via **IAM Identity Center**: users `alper` and `faruk`, both in
an `Administrators` group holding `AdministratorAccess` on all three accounts.
No IAM users, no long-lived access keys.

## Provisioned values

As built. Account IDs are not secrets, but the portal URL is the sign-in
entry point — treat it as internal.

| Account | ID | Root email | Purpose |
| ------- | -- | ---------- | ------- |
| `clewas` (management) | `849445096310` | `alperyazagan@clewas.com` | Org management, billing, identity. **No workloads.** |
| `seo-staging` | `977476318001` | `aws-staging@clewas.com` | `SeoApiStack-staging` |
| `seo-prod` | `672093561569` | `aws-prod@clewas.com` | `SeoApiStack-prod` |

Member accounts have no root credentials and cannot perform root password
recovery. Only the management account has a root user.

| Resource | Value |
| -------- | ----- |
| Organization | `o-snqpg05rx9` (all features) |
| Org root | `r-dk83` |
| `Workloads` OU | `ou-dk83-s7pgj1xb` |
| Identity Center instance | `arn:aws:sso:::instance/ssoins-7223ea23c7fac212` |
| Identity store | `d-90667b5695` |
| Access portal | `https://d-90667b5695.awsapps.com/start` |
| `AdministratorAccess` permission set | `ps-7223eab484e622ea` (12h sessions) |
| `Administrators` group | `b4e83418-c031-70f2-3147-efa275d5b772` |

Region is `us-east-1` throughout — it matches the existing stacks, and Identity
Center is a single-region service whose region can't be changed later without
deleting the instance.

## Phase ordering

Root is used **once**, in Phase 0, and then never again. By the end of Phase 0
both admins can sign in, so Phases 1–3 run as an Identity Center admin.

Phase 0 is written as console steps because several of them — assigning root
MFA, the billing toggle in 0.3, and enabling Identity Center — have no API and
can only be done in the console. The rest could be scripted: `aws login` issues
temporary credentials for the **root** user as well, so driving root over the
CLI does **not** require creating root access keys. Given it is a handful of
one-time steps and you are already signed in to the console to do the
console-only ones, doing all of Phase 0 there is simplest.

---

## Phase 0 — Root-only bootstrap

**Who:** signed in as the root user of the fresh account.
**Where:** AWS console.

### 0.1 Secure the root user

1. Set a strong, unique password and store it in a password manager.
2. **IAM → Security credentials → Multi-factor authentication → Assign MFA
   device.** A hardware key or an authenticator app both work.
3. In the same page, check **Access keys**. It should be empty. If any root
   access key exists, delete it.

### 0.2 Account contacts

**Billing console → Account.** Set an account alias, and fill in the
**Alternate contacts** for Billing, Operations and Security. Use addresses both
of you can read — these are where AWS sends account-recovery and abuse notices.

### 0.3 Activate IAM access to billing

This is the step that actually grants the billing access, and it is easy to miss.

1. Go to <https://console.aws.amazon.com/billing/home?#/account>.
2. Under **IAM user and role access to Billing information**, choose **Edit**.
3. Tick **Activate IAM access**, then **Update**.

It is **off by default**, can only be changed by root, and applies to federated
(Identity Center) identities as well as IAM users. Until it is on,
`AdministratorAccess` still cannot open the Billing console — the policy is not
the gate, this toggle is.

### 0.4 Create the organization

**AWS Organizations console → Create an organization**, with **All features**
enabled (not consolidated-billing-only). All features is a prerequisite for
centralized root access in Phase 1.2, and downgrading later is not possible.

### 0.5 Enable IAM Identity Center

**IAM Identity Center console**, with the region selector on `us-east-1` →
**Enable**. Record three values from the **Settings** page — later phases need them:

- **AWS access portal URL** — `https://d-xxxxxxxxxx.awsapps.com/start`
- **Instance ARN** — `arn:aws:sso:::instance/ssoins-xxxxxxxxxxxx`
- **Identity store ID** — `d-xxxxxxxxxx`

Optionally set a friendlier portal subdomain under **Settings → Customize** now;
it cannot be changed once anyone has bookmarked it.

### 0.6 Create the two admin users

**Identity Center → Users → Add user**, twice. Create these in the console
rather than via `identitystore create-user`: the console sends the "Invitation
to join AWS IAM Identity Center" email, and the API does not.

| Username | Email | Notes |
| -------- | ----- | ----- |
| `alper` | `alperyazagan@gmail.com` | |
| `faruk` | `fcanozkan@gmail.com` | |

- **Username** is what you type at sign-in and **cannot be changed later**.
- **Email** is only an attribute — where the invite lands. Any address works,
  including plain Gmail; there is no corporate-domain requirement. The only
  constraint is that each user's email must be **unique within the directory**.
- Choose **Send an email to this user with password setup instructions**. The
  invite expires after 7 days; re-send via **Reset password** if it lapses.
- Mail arrives from `no-reply@signin.aws` or `no-reply@login.awsapps.com` —
  allowlist those, they land in spam otherwise.

### 0.7 Group, permission set, and first assignment

1. **Groups → Create group** named `Administrators`. Add both users.
2. **Permission sets → Create permission set → Predefined → `AdministratorAccess`.**
   Set **Session duration to 12 hours** (the maximum).
3. **AWS accounts →** select the management account **→ Assign users or groups →**
   the `Administrators` group **→** the `AdministratorAccess` permission set.

### 0.8 Require MFA

**Identity Center → Settings → Authentication → Multi-factor authentication → Configure:**

- Prompt for MFA: **Every time they sign in** (always-on)
- If a user does not yet have a device: **Require them to register an MFA device
  at sign-in**

### 0.9 Verify, then stop using root

Both of you: accept the emailed invitation, set a password, register an MFA
device, and sign in at the portal URL. Confirm you can open the management
account's **Billing** console — that proves 0.3 and 0.7 both took effect.

Once confirmed, **sign out of root and do not use it again.** From here on,
everything runs as an Identity Center admin.

---

## Phase 1 — Accounts

**Who:** either admin, via CLI.

Authenticate first (Phase 3 covers profile setup in full; the short version):

```bash
aws configure sso
```

### 1.1 Create the OU and member accounts

Every AWS account needs a **globally unique root email address**. Gmail
plus-addressing (`alperyazagan+aws-staging@gmail.com`) satisfies this without creating
new mailboxes — the mail still lands in Alper's inbox.

```bash
ROOT_ID=$(aws organizations list-roots --query 'Roots[0].Id' --output text)
```

```bash
OU_ID=$(aws organizations create-organizational-unit --parent-id "$ROOT_ID" --name Workloads --query 'OrganizationalUnit.Id' --output text)
```

```bash
aws organizations create-account --account-name seopotion-staging --email 'alperyazagan+aws-staging@gmail.com'
```

```bash
aws organizations create-account --account-name seopotion-prod --email 'alperyazagan+aws-prod@gmail.com'
```

`create-account` is **asynchronous**. Poll until both report `SUCCEEDED`, and
collect the new account IDs:

```bash
aws organizations list-create-account-status --query 'CreateAccountStatuses[].{Name:AccountName,State:State,Id:AccountId}' --output table
```

Move both into the `Workloads` OU — new accounts land at the org root, so
`--source-parent-id` is `$ROOT_ID`. Run once per account:

```bash
aws organizations move-account --account-id <new-account-id> --source-parent-id "$ROOT_ID" --destination-parent-id "$OU_ID"
```

Each account created this way automatically gets an `OrganizationAccountAccessRole`
assumable from the management account. That is the break-glass path if Identity
Center is ever misconfigured — leave it in place.

### 1.2 Centralize root access

This removes root credentials from the two member accounts entirely, so there is
no member-account root user to secure, leak, or MFA-protect.

Trusted access for IAM must be enabled **first**, or the next command fails with
`ServiceAccessNotEnabledException`:

```bash
aws organizations enable-aws-service-access --service-principal iam.amazonaws.com
```

```bash
aws iam enable-organizations-root-credentials-management
```

Expected output:

```json
{ "EnabledFeatures": ["RootCredentialsManagement"], "OrganizationId": "o-snqpg05rx9" }
```

Accounts created through Organizations have **no root credentials by default** —
this holds whether they were created before or after enabling the feature, so
there is nothing to clean up for accounts created in 1.1. Only accounts
*invited* into the organization, having existed standalone first, carry root
credentials worth deleting from **IAM → Root access management**.

With the feature on, member accounts also cannot perform root password recovery,
so no root user can be resurrected behind your back.

Recovery is still available if ever needed: the management account can run the
**Allow password recovery** privileged task, after which whoever controls that
account's root email can reset the password. Delete the credentials again
afterwards.

---

## Phase 2 — Grant admin access to the new accounts

```bash
INSTANCE_ARN=$(aws sso-admin list-instances --query 'Instances[0].InstanceArn' --output text)
```

```bash
IDENTITY_STORE_ID=$(aws sso-admin list-instances --query 'Instances[0].IdentityStoreId' --output text)
```

`--alternate-identifier` must be **JSON**. The CLI's shorthand syntax fails here
with `Shorthand syntax does not support document types`, because `AttributeValue`
is a document type:

```bash
GROUP_ID=$(aws identitystore get-group-id --identity-store-id "$IDENTITY_STORE_ID" --alternate-identifier '{"UniqueAttribute":{"AttributePath":"displayName","AttributeValue":"Administrators"}}' --query GroupId --output text)
```

```bash
PS_ARN=$(aws sso-admin list-permission-sets --instance-arn "$INSTANCE_ARN" --query 'PermissionSets[0]' --output text)
```

`list-permission-sets` returns ARNs only. With more than one permission set,
confirm which is which via
`aws sso-admin describe-permission-set --instance-arn "$INSTANCE_ARN" --permission-set-arn <arn>`.

Assign the group to each new account (repeat for staging and prod):

```bash
aws sso-admin create-account-assignment --instance-arn "$INSTANCE_ARN" --target-id <account-id> --target-type AWS_ACCOUNT --permission-set-arn "$PS_ARN" --principal-type GROUP --principal-id "$GROUP_ID"
```

Assignment is asynchronous; check with
`aws sso-admin list-account-assignment-creation-status --instance-arn "$INSTANCE_ARN"`.

### Billing in member accounts

Billing is **consolidated to the management account**, so cost and usage for all
three accounts is visible there — which is what 0.3 unlocked. The per-account
billing toggle only governs viewing an individual member account's own billing
console, and is not needed for day-to-day cost work.

---

## Phase 3 — CLI access

Once per machine:

```bash
aws configure sso
```

Answer with the **AWS access portal URL** from 0.5 and region `us-east-1`. The
wizard lists every account you have access to; run it once per account to end up
with three profiles named `seo-mgmt`, `seo-staging`, `seo-prod`.

Then, per session (credentials last up to 12 hours):

```bash
aws sso login --profile seo-staging
```

```bash
aws sts get-caller-identity --profile seo-staging
```

Use `--profile`, or export `AWS_PROFILE`, for CDK commands. Note this is
`aws sso login`, not `aws login` — the latter is for root and IAM users, which
this setup deliberately does not have.

---

## Verification checklist

State as of the initial build:

- [ ] **Management account root has MFA** — *outstanding.*
      `aws iam get-account-summary` reports `AccountMFAEnabled: 0` and no MFA
      device is registered. This root user controls the whole organization and
      is currently password-only. Fix in **IAM → Security credentials** while
      signed in as root.
- [x] Root has no access keys (`AccountAccessKeysPresent: 0`)
- [x] No IAM users in the management account (`Users: 0`)
- [x] Organization created with **all features** (`o-snqpg05rx9`)
- [x] Three accounts; staging and prod in the `Workloads` OU
- [x] Trusted access for IAM enabled
- [x] Centralized root access enabled (`RootCredentialsManagement`)
- [x] `Administrators` group assigned `AdministratorAccess` on all three accounts
- [x] `alper` and `faruk` both in the `Administrators` group
- [x] `aws sso login` verified for the management account

Still to confirm by hand:

- [ ] `IAM user and role access to Billing information` is **activated** — no
      API exposes this; confirm by opening the Billing console as an
      Identity Center admin
- [ ] Alternate contacts set
- [ ] Both admins sign in with MFA enforced
- [ ] `aws sso login` works for the staging and prod profiles
- [ ] Root not used for anything after Phase 0

## Follow-on work

Not covered here; each needs its own issue:

- `cdk bootstrap` in the staging and prod accounts
- Re-provisioning SSM SecureStrings per [`ENVIRONMENTS.md`](ENVIRONMENTS.md) in the new accounts
- New MongoDB Atlas clusters, or migrating the existing ones
- GitHub Actions deploy roles via **OIDC** (per account — do not create IAM users with access keys for CI)
- DNS / CloudFront / ACM certificate migration
- Decommissioning `859998284061`

Consider a **budget alert** on the management account before migrating anything —
a fresh organization has no cost history, so nothing will flag a runaway spend.

`AWS Control Tower` was considered and deliberately skipped: the service is free,
but it provisions two additional accounts (Log Archive, Audit) and enables AWS
Config across all regions, which is the real recurring cost. An existing
organization can be enrolled into Control Tower later if the team outgrows this.
