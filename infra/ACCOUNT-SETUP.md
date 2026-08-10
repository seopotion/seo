# AWS account setup

One-time foundation for the AWS organization that replaces the current single
personal account (`859998284061`). Run this once, in order. Migrating the
workload itself is **not** part of this document — see [Follow-on work](#follow-on-work).

Target end state:

| Account | Purpose | Root user |
| ------- | ------- | --------- |
| `seopotion-mgmt` | Organization management. Billing + identity only, **no workloads**. | Alper's, MFA-protected |
| `seopotion-staging` | `SeoApiStack-staging` | none (removed) |
| `seopotion-prod` | `SeoApiStack-prod` | none (removed) |

Human access is via **IAM Identity Center**: users `alper` and `faruk`, both in
an `Administrators` group holding `AdministratorAccess` on all three accounts.
No IAM users, no long-lived access keys.

Region is `us-east-1` throughout — it matches the existing stacks, and Identity
Center is a single-region service whose region can't be changed later without
deleting the instance.

## Phase ordering

Root is used **once**, in Phase 0, and then never again. Phase 0 is
**console-only**: the root user would need access keys to use the CLI, and
creating those defeats the purpose. By the end of Phase 0 both admins can sign
in, so Phases 1–3 run as an Identity Center admin over the CLI.

---

## Phase 0 — Root-only bootstrap

**Who:** Alper, signed in as the root user of the fresh account.
**Where:** AWS console only.

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
| `alper` | Alper's address | |
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
plus-addressing (`alper+aws-staging@gmail.com`) satisfies this without creating
new mailboxes — the mail still lands in Alper's inbox.

```bash
ROOT_ID=$(aws organizations list-roots --query 'Roots[0].Id' --output text)
```

```bash
OU_ID=$(aws organizations create-organizational-unit --parent-id "$ROOT_ID" --name Workloads --query 'OrganizationalUnit.Id' --output text)
```

```bash
aws organizations create-account --account-name seopotion-staging --email 'alper+aws-staging@gmail.com'
```

```bash
aws organizations create-account --account-name seopotion-prod --email 'alper+aws-prod@gmail.com'
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

**IAM console (management account) → Root access management → Enable.** Or:

```bash
aws iam enable-organizations-root-credentials-management
```

Expected output:

```json
{ "EnabledFeatures": ["RootCredentialsManagement"], "OrganizationId": "o-aa111bb222" }
```

Accounts created through Organizations after this have **no root credentials by
default**. If either member account was created before you enabled this, delete
its root credentials explicitly from the same console page.

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

```bash
GROUP_ID=$(aws identitystore get-group-id --identity-store-id "$IDENTITY_STORE_ID" --alternate-identifier 'UniqueAttribute={AttributePath=displayName,AttributeValue=Administrators}' --query GroupId --output text)
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

- [ ] Root user has MFA and no access keys
- [ ] Root is not used for anything after Phase 0
- [ ] Alternate contacts set
- [ ] `IAM user and role access to Billing information` is **activated**
- [ ] Organization created with **all features**
- [ ] Three accounts, staging and prod in the `Workloads` OU
- [ ] Centralized root access enabled; member accounts have no root credentials
- [ ] `alper` and `faruk` both sign in with MFA
- [ ] Both reach `AdministratorAccess` on all three accounts
- [ ] Both can open the Billing console in the management account
- [ ] `aws sso login` works for all three profiles

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
