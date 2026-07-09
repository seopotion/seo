import { api } from './api';

type AuthorizedWorkspaceStatus = {
  ok: true;
  path: '/home' | '/onboarding';
  setupComplete: boolean;
};

export type WorkspaceStatus =
  | AuthorizedWorkspaceStatus
  | {
      ok: false;
      reason: 'unauthorized' | 'unavailable';
    };

let cachedWorkspaceStatus: AuthorizedWorkspaceStatus | null = null;
let pendingWorkspaceStatus: Promise<WorkspaceStatus> | null = null;
let workspaceStatusCacheRevision = 0;

function buildWorkspaceStatus(setupComplete: boolean): AuthorizedWorkspaceStatus {
  return {
    ok: true,
    path: setupComplete ? '/home' : '/onboarding',
    setupComplete,
  };
}

export function getCachedWorkspaceStatus(): AuthorizedWorkspaceStatus | null {
  return cachedWorkspaceStatus;
}

export function setWorkspaceStatusCache(setupComplete: boolean): AuthorizedWorkspaceStatus {
  workspaceStatusCacheRevision += 1;
  cachedWorkspaceStatus = buildWorkspaceStatus(setupComplete);
  return cachedWorkspaceStatus;
}

export function clearWorkspaceStatusCache(): void {
  workspaceStatusCacheRevision += 1;
  cachedWorkspaceStatus = null;
  pendingWorkspaceStatus = null;
}

async function requestWorkspaceStatus(): Promise<WorkspaceStatus> {
  const requestRevision = workspaceStatusCacheRevision;

  try {
    const statusRes = await api.api.v0.core.status.$get();
    const statusCode = statusRes.status as number;

    if (statusCode === 401) {
      clearWorkspaceStatusCache();
      return { ok: false, reason: 'unauthorized' };
    }

    if (!statusRes.ok) {
      return { ok: false, reason: 'unavailable' };
    }

    const { setup_complete } = await statusRes.json();
    const status = buildWorkspaceStatus(setup_complete);

    if (requestRevision === workspaceStatusCacheRevision) {
      cachedWorkspaceStatus = status;
    }

    return status;
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export async function getWorkspaceStatus(
  options: { useCache?: boolean } = {},
): Promise<WorkspaceStatus> {
  const shouldUseCache = options.useCache !== false;

  if (shouldUseCache) {
    if (cachedWorkspaceStatus) return cachedWorkspaceStatus;
    if (pendingWorkspaceStatus) return pendingWorkspaceStatus;
  }

  const request = requestWorkspaceStatus();

  if (!shouldUseCache) return request;

  pendingWorkspaceStatus = request;

  try {
    return await request;
  } finally {
    if (pendingWorkspaceStatus === request) {
      pendingWorkspaceStatus = null;
    }
  }
}

export async function getPostLoginPath(): Promise<'/home' | '/onboarding' | null> {
  const status = await getWorkspaceStatus();
  return status.ok ? status.path : null;
}
