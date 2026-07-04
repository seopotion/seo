# Backend environments

Two stacks, one AWS account (`personal` / 859998284061 / us-east-1):

- `SeoApiStack-staging` — deployed on merge to `dev`.
- `SeoApiStack-prod` — deployed on merge to `master`.

Config lives in `infra/lib/config.ts` (non-secret values + SSM parameter NAMES).
Secret values are provisioned out-of-band and resolved at Lambda runtime.

## One-time prerequisites (per account)

1. **Two Atlas clusters** (staging, prod) → two connection strings.
2. **SSM SecureStrings** (values never enter CloudFormation):

   ```sh
   aws ssm put-parameter --name /seo/staging/mongo-uri  --type SecureString --value '<staging-conn-str>'
   aws ssm put-parameter --name /seo/staging/jwt-secret --type SecureString --value '<staging-secret>'
   aws ssm put-parameter --name /seo/prod/mongo-uri     --type SecureString --value '<prod-conn-str>'
   aws ssm put-parameter --name /seo/prod/jwt-secret    --type SecureString --value '<prod-secret>'
   ```

3. **Two Google OAuth client IDs** (staging vs prod). Set them as GitHub Actions
   repo **variables** `GOOGLE_CLIENT_ID_STAGING` and `GOOGLE_CLIENT_ID_PROD`
   (they are public, not secrets). Authorized JavaScript origins are filled in
   during the frontend-hosting sub-project once hostnames exist.
4. **GitHub OIDC provider + deploy role** in the account; store its ARN as the
   `AWS_DEPLOY_ROLE_ARN` secret and the account id as the `AWS_ACCOUNT_ID`
   secret. The role's trust policy must allow this repo's `dev` and `master`
   refs; its permissions must allow `cdk deploy` for the two stacks.

## First deploy

```sh
cd infra && npm ci
CDK_DEFAULT_ACCOUNT=859998284061 CDK_DEFAULT_REGION=us-east-1 \
  npx cdk deploy SeoApiStack-staging
```

## Migration note

The pre-split single `SeoApiStack` (if it was ever deployed) is superseded by
these two. After confirming staging is healthy, remove the old stack manually:
`npx cdk deploy` will not delete it because it is no longer in `bin/app.ts`.
Run `aws cloudformation delete-stack --stack-name SeoApiStack` once you are sure
nothing depends on it.
