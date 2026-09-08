import { setToken } from './auth';

export async function openLocalAdminSession(): Promise<void> {
  const response = await fetch('/__admin/local-session', {
    method: 'POST',
    headers: { 'X-Admin-Local-Session': '1' },
  });
  const body: unknown = await response.json();
  if (
    response.ok &&
    body &&
    typeof body === 'object' &&
    'token' in body &&
    typeof body.token === 'string'
  ) {
    setToken(body.token);
    return;
  }
  const code = body && typeof body === 'object' && 'error' in body ? body.error : '';
  if (code === 'not_an_operator')
    throw new Error('The configured local operator is not on the staging allowlist.');
  if (code === 'wrong_aws_account')
    throw new Error('The local AWS profile must belong to the staging account.');
  if (code === 'local_operator_not_configured')
    throw new Error('Set ADMIN_LOCAL_OPERATOR_EMAIL in apps/admin/.env.staging.local.');
  throw new Error(
    'The local AWS session is unavailable. Run aws sso login --profile seo-staging, then retry.',
  );
}
