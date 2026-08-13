import type { ConnectedIntegration } from './integrations';

export const PUBLISHING_PROVIDERS = ['wordpress', 'static-site'] as const;

export type PublishingProvider = (typeof PUBLISHING_PROVIDERS)[number];
export type AutoPublishAttemptStatus =
  | 'queued'
  | 'publishing'
  | 'retrying'
  | 'failed'
  | 'published'
  | 'cancelled';
export type AutoPublishAggregateStatus =
  | 'needs_attention'
  | 'retrying'
  | 'publishing'
  | 'queued'
  | 'published'
  | 'not_queued';

export type PublishingError = {
  code: string;
  kind: 'transient' | 'permanent';
  message: string;
  at: string;
};

export type ArticlePublication = {
  provider: PublishingProvider;
  ref: string;
  slug: string;
  remote_url: string | null;
  published_at: string;
  updated_at: string | null;
};

export type AutoPublishAttempt = {
  provider: PublishingProvider;
  status: AutoPublishAttemptStatus;
  attempt_count: number;
  requested_at: string;
  last_attempt_at: string | null;
  last_error: PublishingError | null;
};

export type ArticlePublishingState = {
  publications: ArticlePublication[];
  auto_publish_error: PublishingError | null;
  auto_publish_attempts: AutoPublishAttempt[];
};

export type ProviderPublishingState = {
  provider: PublishingProvider;
  attempt: AutoPublishAttempt | null;
  publication: ArticlePublication | null;
};

export type AutoPublishAggregateState = {
  status: AutoPublishAggregateStatus;
  partialSuccess: boolean;
};

export type PublishingErrorAction =
  | 'article_settings'
  | 'billing'
  | 'edit_slug'
  | 'integrations'
  | 'wordpress_docs'
  | null;

export type PublishingErrorMessageKey =
  | 'publishing.errors.articleNotFound'
  | 'publishing.errors.autoPublishDisabled'
  | 'publishing.errors.commitRejected'
  | 'publishing.errors.githubRequestFailed'
  | 'publishing.errors.imageGenerationFailed'
  | 'publishing.errors.imagesIncomplete'
  | 'publishing.errors.installationNotFound'
  | 'publishing.errors.installationSuspended'
  | 'publishing.errors.invalidArticlePayload'
  | 'publishing.errors.invalidCredentials'
  | 'publishing.errors.invalidProviderResponse'
  | 'publishing.errors.missingWritePermission'
  | 'publishing.errors.networkError'
  | 'publishing.errors.notConnected'
  | 'publishing.errors.pluginUpgradeRequired'
  | 'publishing.errors.queueSendFailed'
  | 'publishing.errors.recordFailed'
  | 'publishing.errors.refConflict'
  | 'publishing.errors.repoNotFound'
  | 'publishing.errors.slugConflict'
  | 'publishing.errors.staticPublishInProgress'
  | 'publishing.errors.subscriptionRequired'
  | 'publishing.errors.unknown'
  | 'publishing.errors.wordpressAuthFailed'
  | 'publishing.errors.wordpressPublishInProgress'
  | 'publishing.errors.wordpressRequestFailed';

export type PublishingErrorPresentation = {
  action: PublishingErrorAction;
  messageKey: PublishingErrorMessageKey;
};

export type AutoPublishRetryFeedback =
  | { kind: 'already_published' }
  | { kind: 'error'; error: PublishingErrorPresentation }
  | { kind: 'queued'; providers: PublishingProvider[] }
  | null;

export type AutoPublishRetryState = {
  feedback: AutoPublishRetryFeedback;
  phase: 'awaiting_authoritative' | 'idle' | 'submitting';
  publishingStateVersion: string | null;
  scope: string | null;
};

export type ManualWordPressErrorState =
  | { kind: 'plugin'; error: string }
  | { kind: 'request' }
  | null;

export type ManualPublishRefreshTarget = {
  provider: PublishingProvider;
  ref: string;
  scope: string;
};

const PUBLISHING_ERROR_PRESENTATIONS: Record<string, PublishingErrorPresentation> = {
  article_not_found: {
    action: null,
    messageKey: 'publishing.errors.articleNotFound',
  },
  auto_publish_disabled: {
    action: 'article_settings',
    messageKey: 'publishing.errors.autoPublishDisabled',
  },
  commit_rejected: {
    action: 'integrations',
    messageKey: 'publishing.errors.commitRejected',
  },
  github_request_failed: {
    action: null,
    messageKey: 'publishing.errors.githubRequestFailed',
  },
  image_generation_failed: {
    action: null,
    messageKey: 'publishing.errors.imageGenerationFailed',
  },
  images_incomplete: {
    action: null,
    messageKey: 'publishing.errors.imagesIncomplete',
  },
  installation_not_found: {
    action: 'integrations',
    messageKey: 'publishing.errors.installationNotFound',
  },
  installation_suspended: {
    action: 'integrations',
    messageKey: 'publishing.errors.installationSuspended',
  },
  invalid_article_payload: {
    action: null,
    messageKey: 'publishing.errors.invalidArticlePayload',
  },
  invalid_credentials: {
    action: 'integrations',
    messageKey: 'publishing.errors.invalidCredentials',
  },
  invalid_provider_response: {
    action: null,
    messageKey: 'publishing.errors.invalidProviderResponse',
  },
  missing_write_permission: {
    action: 'integrations',
    messageKey: 'publishing.errors.missingWritePermission',
  },
  network_error: {
    action: null,
    messageKey: 'publishing.errors.networkError',
  },
  not_connected: {
    action: 'integrations',
    messageKey: 'publishing.errors.notConnected',
  },
  plugin_upgrade_required: {
    action: 'wordpress_docs',
    messageKey: 'publishing.errors.pluginUpgradeRequired',
  },
  queue_send_failed: {
    action: null,
    messageKey: 'publishing.errors.queueSendFailed',
  },
  record_failed: {
    action: null,
    messageKey: 'publishing.errors.recordFailed',
  },
  ref_conflict: {
    action: null,
    messageKey: 'publishing.errors.refConflict',
  },
  repo_not_found: {
    action: 'integrations',
    messageKey: 'publishing.errors.repoNotFound',
  },
  slug_conflict: {
    action: 'edit_slug',
    messageKey: 'publishing.errors.slugConflict',
  },
  static_publish_in_progress: {
    action: null,
    messageKey: 'publishing.errors.staticPublishInProgress',
  },
  subscription_required: {
    action: 'billing',
    messageKey: 'publishing.errors.subscriptionRequired',
  },
  wordpress_auth_failed: {
    action: 'integrations',
    messageKey: 'publishing.errors.wordpressAuthFailed',
  },
  wordpress_publish_in_progress: {
    action: null,
    messageKey: 'publishing.errors.wordpressPublishInProgress',
  },
  source_publish_in_progress: {
    action: null,
    messageKey: 'publishing.errors.wordpressPublishInProgress',
  },
  wordpress_request_failed: {
    action: null,
    messageKey: 'publishing.errors.wordpressRequestFailed',
  },
};

export type AutoPublishDestinationState = 'error' | 'loading' | 'ready';

export type AutoPublishReadinessBlocker =
  | 'destination_check_failed'
  | 'destination_check_pending'
  | 'entitlement_required'
  | 'no_destination';

export type AutoPublishReadiness = {
  allDestinationsHaveErrors: boolean;
  blockers: AutoPublishReadinessBlocker[];
  canActivate: boolean;
};

type AutoPublishReadinessInput = {
  destinationState: AutoPublishDestinationState;
  destinations: Pick<ConnectedIntegration, 'last_error' | 'provider'>[];
  hasEntitlement: boolean;
};

export function getAutoPublishReadiness({
  destinationState,
  destinations,
  hasEntitlement,
}: AutoPublishReadinessInput): AutoPublishReadiness {
  const blockers: AutoPublishReadinessBlocker[] = [];

  if (!hasEntitlement) {
    blockers.push('entitlement_required');
  }

  if (destinationState === 'loading') {
    blockers.push('destination_check_pending');
  } else if (destinationState === 'error') {
    blockers.push('destination_check_failed');
  } else if (destinations.length === 0) {
    blockers.push('no_destination');
  }

  return {
    allDestinationsHaveErrors:
      destinationState === 'ready' &&
      destinations.length > 0 &&
      destinations.every((destination) => destination.last_error !== null),
    blockers,
    canActivate: blockers.length === 0,
  };
}

export function isAutoPublishChangeAllowed(
  currentValue: boolean,
  nextValue: boolean,
  readiness: AutoPublishReadiness,
): boolean {
  if (currentValue === nextValue || !nextValue) return true;
  return readiness.canActivate;
}

export function joinPublishingProviders(
  attempts: AutoPublishAttempt[],
  publications: ArticlePublication[],
): ProviderPublishingState[] {
  return PUBLISHING_PROVIDERS.flatMap((provider) => {
    const attempt = attempts.find((entry) => entry.provider === provider) ?? null;
    const publication = publications.find((entry) => entry.provider === provider) ?? null;

    return attempt || publication ? [{ provider, attempt, publication }] : [];
  });
}

export function isAutoPublishAttemptActive(attempt: AutoPublishAttempt): boolean {
  return (
    attempt.status === 'queued' || attempt.status === 'publishing' || attempt.status === 'retrying'
  );
}

export function hasActiveAutoPublishAttempts(attempts: AutoPublishAttempt[]): boolean {
  return attempts.some(isAutoPublishAttemptActive);
}

export function shouldPollArticlePublishing(
  attempts: AutoPublishAttempt[],
  forceAuthoritativeRefresh: boolean,
): boolean {
  return forceAuthoritativeRefresh || hasActiveAutoPublishAttempts(attempts);
}

export function getAutoPublishAggregateState({
  autoPublishError,
  attempts,
  publications,
}: {
  autoPublishError: PublishingError | null;
  attempts: AutoPublishAttempt[];
  publications: ArticlePublication[];
}): AutoPublishAggregateState {
  let status: AutoPublishAggregateStatus = 'not_queued';

  if (autoPublishError || attempts.some((attempt) => isTerminalFailedAttempt(attempt))) {
    status = 'needs_attention';
  } else if (attempts.some((attempt) => attempt.status === 'retrying')) {
    status = 'retrying';
  } else if (attempts.some((attempt) => attempt.status === 'publishing')) {
    status = 'publishing';
  } else if (attempts.some((attempt) => attempt.status === 'queued')) {
    status = 'queued';
  } else if (attempts.length > 0 && attempts.every((attempt) => attempt.status === 'published')) {
    status = 'published';
  }

  return {
    status,
    partialSuccess: status === 'needs_attention' && publications.length > 0,
  };
}

export function getRetryableAutoPublishProviders(
  attempts: AutoPublishAttempt[],
  publications: ArticlePublication[],
): PublishingProvider[] {
  const publishedProviders = new Set(publications.map((publication) => publication.provider));

  return attempts
    .filter(
      (attempt) => isTerminalFailedAttempt(attempt) && !publishedProviders.has(attempt.provider),
    )
    .map((attempt) => attempt.provider);
}

export function shouldOfferAutoPublishRetry({
  autoPublishError,
  attempts,
  publications,
}: {
  autoPublishError: PublishingError | null;
  attempts: AutoPublishAttempt[];
  publications: ArticlePublication[];
}): boolean {
  return Boolean(
    autoPublishError || getRetryableAutoPublishProviders(attempts, publications).length > 0,
  );
}

export function getPublishingErrorPresentation(code: string): PublishingErrorPresentation {
  return (
    PUBLISHING_ERROR_PRESENTATIONS[code] ?? {
      action: null,
      messageKey: 'publishing.errors.unknown',
    }
  );
}

export function getSafePublicationUrl(value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    const httpUrl = url.protocol === 'http:' || url.protocol === 'https:';
    return httpUrl && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function getAutoPublishRetryResult(
  queued: PublishingProvider[],
): { kind: 'already_published' } | { kind: 'queued'; providers: PublishingProvider[] } {
  return queued.length > 0 ? { kind: 'queued', providers: queued } : { kind: 'already_published' };
}

export function isArticlePublishingBlocked(editing: boolean, dirty: boolean): boolean {
  return editing || dirty;
}

export function createAutoPublishRetryState(scope: string | null): AutoPublishRetryState {
  return {
    feedback: null,
    phase: 'idle',
    publishingStateVersion: null,
    scope,
  };
}

export function beginAutoPublishRetry(
  state: AutoPublishRetryState,
  input: {
    publishBlocked: boolean;
    publishingStateVersion: string;
    retryAvailable: boolean;
    scope: string;
  },
): { shouldSubmit: boolean; state: AutoPublishRetryState } {
  const scopedState =
    state.scope === input.scope ? state : createAutoPublishRetryState(input.scope);

  if (input.publishBlocked || !input.retryAvailable || scopedState.phase !== 'idle') {
    return { shouldSubmit: false, state: scopedState };
  }

  return {
    shouldSubmit: true,
    state: {
      feedback: null,
      phase: 'submitting',
      publishingStateVersion: input.publishingStateVersion,
      scope: input.scope,
    },
  };
}

export function completeAutoPublishRetryRequest(
  state: AutoPublishRetryState,
  scope: string,
  feedback: Exclude<AutoPublishRetryFeedback, { kind: 'error' } | null>,
): AutoPublishRetryState {
  if (state.scope !== scope || state.phase !== 'submitting') return state;

  return {
    ...state,
    feedback,
    phase: 'awaiting_authoritative',
  };
}

export function failAutoPublishRetryRequest(
  state: AutoPublishRetryState,
  scope: string,
  error: PublishingErrorPresentation,
): AutoPublishRetryState {
  if (state.scope !== scope || state.phase !== 'submitting') return state;

  return {
    feedback: { kind: 'error', error },
    phase: 'idle',
    publishingStateVersion: null,
    scope,
  };
}

export function reconcileAutoPublishRetry(
  state: AutoPublishRetryState,
  scope: string,
  publishingStateVersion: string,
): AutoPublishRetryState {
  if (
    state.scope !== scope ||
    state.phase !== 'awaiting_authoritative' ||
    state.publishingStateVersion === publishingStateVersion
  ) {
    return state;
  }

  return {
    ...state,
    phase: 'idle',
    publishingStateVersion: null,
  };
}

export function getArticlePublishingStateVersion(state: ArticlePublishingState): string {
  return JSON.stringify({
    auto_publish_attempts: [...state.auto_publish_attempts].sort((a, b) =>
      a.provider.localeCompare(b.provider),
    ),
    auto_publish_error: state.auto_publish_error,
    publications: [...state.publications].sort((a, b) => a.provider.localeCompare(b.provider)),
  });
}

export function reduceManualWordPressError(
  _state: ManualWordPressErrorState,
  event: { body?: unknown; type: 'failed' | 'started' | 'succeeded' },
): ManualWordPressErrorState {
  if (event.type !== 'failed') return null;
  if (!event.body || typeof event.body !== 'object') return { kind: 'request' };

  const error = 'error' in event.body ? event.body.error : null;
  if (typeof error !== 'string' || !error.trim()) return { kind: 'request' };

  return { kind: 'plugin', error: error.trim().slice(0, 500) };
}

export function hasObservedManualPublishTarget(
  state: ArticlePublishingState,
  target: ManualPublishRefreshTarget,
): boolean {
  return state.publications.some(
    (publication) => publication.provider === target.provider && publication.ref === target.ref,
  );
}

function isTerminalFailedAttempt(attempt: AutoPublishAttempt): boolean {
  return attempt.status === 'failed' || attempt.status === 'cancelled';
}
