# Automatic local admin session

The local Vite admin app can open directly against staging without a Google login
or an admin login form. Run `npm run dev:staging -w admin -- --port 3000` and set
`ADMIN_LOCAL_OPERATOR_EMAIL` in the gitignored `apps/admin/.env.staging.local` to
your existing allowlisted operator email. The local AWS CLI profile defaults to
`seo-staging`; override it with `ADMIN_LOCAL_AWS_PROFILE` in the same file.

The Vite dev server exposes a same-origin, loopback-only POST endpoint at
`/__admin/local-session`. It verifies that the AWS profile belongs to staging,
checks the configured email against `/seo/staging/admin/operators`, then uses
AWS-authorized access to the staging admin JWT secret to mint a one-hour session.
The secret stays in the Vite server process; only the normal admin JWT reaches
the browser. No anonymous login endpoint is added to the admin API.

A valid stored admin session is reused. When it expires, the app obtains another
session automatically. An expired AWS login still requires
`aws sso login --profile seo-staging`; AWS authorization cannot be replaced by a local
frontend flag. After refreshing AWS credentials, click Retry connection.

This option exists only in Vite development mode, on localhost, and for the
known staging admin API. Production builds, preview servers, remote hosts,
other API targets, cross-origin requests, and non-loopback connections cannot
use it. Deployed admin APIs keep their existing authentication and authorization.
