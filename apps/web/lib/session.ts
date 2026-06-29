import { api } from './api';

export async function getPostLoginPath(): Promise<'/dashboard' | '/setup' | null> {
  const res = await api.api.v0.core.status.$get();
  if (!res.ok) return null;

  const { setup_complete } = await res.json();
  return setup_complete ? '/dashboard' : '/setup';
}
