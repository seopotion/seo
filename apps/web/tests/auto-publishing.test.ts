import { describe, expect, test } from 'vitest';
import {
  type ArticlePublication,
  type AutoPublishAttempt,
  type AutoPublishAttemptStatus,
  beginAutoPublishRetry,
  completeAutoPublishRetryRequest,
  createAutoPublishRetryState,
  failAutoPublishRetryRequest,
  getArticlePublishingStateVersion,
  getAutoPublishAggregateState,
  getAutoPublishReadiness,
  getAutoPublishRetryResult,
  getPublishingErrorPresentation,
  getRetryableAutoPublishProviders,
  getSafePublicationUrl,
  hasActiveAutoPublishAttempts,
  hasObservedManualPublishTarget,
  isArticlePublishingBlocked,
  isAutoPublishAttemptActive,
  isAutoPublishChangeAllowed,
  joinPublishingProviders,
  reconcileAutoPublishRetry,
  reduceManualWordPressError,
  shouldOfferAutoPublishRetry,
  shouldPollArticlePublishing,
} from '../lib/auto-publishing';
import type { ConnectedIntegration } from '../lib/integrations';

function integration(
  provider: ConnectedIntegration['provider'],
  hasError = false,
): Pick<ConnectedIntegration, 'last_error' | 'provider'> {
  return {
    last_error: hasError ? { at: '2026-08-13T10:00:00.000Z', code: 'publish_failed' } : null,
    provider,
  };
}

function attempt(
  status: AutoPublishAttemptStatus,
  provider: AutoPublishAttempt['provider'] = 'wordpress',
): AutoPublishAttempt {
  return {
    attempt_count: 1,
    last_attempt_at: '2026-08-13T10:01:00.000Z',
    last_error:
      status === 'failed' || status === 'cancelled'
        ? {
            at: '2026-08-13T10:01:00.000Z',
            code: 'network_error',
            kind: 'transient',
            message: 'Provider failed',
          }
        : null,
    provider,
    requested_at: '2026-08-13T10:00:00.000Z',
    status,
  };
}

function publication(
  provider: ArticlePublication['provider'] = 'wordpress',
  updatedAt: string | null = null,
): ArticlePublication {
  return {
    provider,
    published_at: '2026-08-13T10:02:00.000Z',
    ref: provider === 'wordpress' ? '42' : 'abc123',
    remote_url:
      provider === 'wordpress'
        ? 'https://example.com/article'
        : 'https://github.com/example/site/commit/abc123',
    slug: 'article',
    updated_at: updatedAt,
  };
}

describe('auto-publish readiness', () => {
  test('allows a paid organization with a connected destination to activate', () => {
    const readiness = getAutoPublishReadiness({
      destinationState: 'ready',
      destinations: [integration('wordpress')],
      hasEntitlement: true,
    });

    expect(readiness).toEqual({
      allDestinationsHaveErrors: false,
      blockers: [],
      canActivate: true,
    });
    expect(isAutoPublishChangeAllowed(false, true, readiness)).toBe(true);
  });

  test('blocks a free organization even when a destination is connected', () => {
    const readiness = getAutoPublishReadiness({
      destinationState: 'ready',
      destinations: [integration('wordpress')],
      hasEntitlement: false,
    });

    expect(readiness.blockers).toEqual(['entitlement_required']);
    expect(isAutoPublishChangeAllowed(false, true, readiness)).toBe(false);
  });

  test('blocks a paid organization without a destination', () => {
    const readiness = getAutoPublishReadiness({
      destinationState: 'ready',
      destinations: [],
      hasEntitlement: true,
    });

    expect(readiness.blockers).toEqual(['no_destination']);
    expect(isAutoPublishChangeAllowed(false, true, readiness)).toBe(false);
  });

  test.each([
    'loading',
    'error',
  ] as const)('fails closed while the destination query is %s', (destinationState) => {
    const readiness = getAutoPublishReadiness({
      destinationState,
      destinations: [],
      hasEntitlement: true,
    });

    expect(readiness.canActivate).toBe(false);
    expect(readiness.blockers).toEqual([
      destinationState === 'loading' ? 'destination_check_pending' : 'destination_check_failed',
    ]);
  });

  test('always allows an existing enabled value to be disabled', () => {
    const blockedReadiness = getAutoPublishReadiness({
      destinationState: 'error',
      destinations: [],
      hasEntitlement: false,
    });

    expect(isAutoPublishChangeAllowed(true, false, blockedReadiness)).toBe(true);
  });

  test('counts an errored integration as connected and surfaces the warning', () => {
    const readiness = getAutoPublishReadiness({
      destinationState: 'ready',
      destinations: [integration('static-site', true)],
      hasEntitlement: true,
    });

    expect(readiness.canActivate).toBe(true);
    expect(readiness.allDestinationsHaveErrors).toBe(true);
  });

  test('recognizes multiple providers and warns only when every destination has an error', () => {
    const mixedReadiness = getAutoPublishReadiness({
      destinationState: 'ready',
      destinations: [integration('wordpress', true), integration('static-site')],
      hasEntitlement: true,
    });
    const erroredReadiness = getAutoPublishReadiness({
      destinationState: 'ready',
      destinations: [integration('wordpress', true), integration('static-site', true)],
      hasEntitlement: true,
    });

    expect(mixedReadiness.canActivate).toBe(true);
    expect(mixedReadiness.allDestinationsHaveErrors).toBe(false);
    expect(erroredReadiness.canActivate).toBe(true);
    expect(erroredReadiness.allDestinationsHaveErrors).toBe(true);
  });

  test('does not reuse readiness from a previously evaluated organization', () => {
    const firstOrganization = getAutoPublishReadiness({
      destinationState: 'ready',
      destinations: [integration('wordpress')],
      hasEntitlement: true,
    });
    const secondOrganization = getAutoPublishReadiness({
      destinationState: 'ready',
      destinations: [],
      hasEntitlement: true,
    });

    expect(firstOrganization.canActivate).toBe(true);
    expect(secondOrganization).toMatchObject({
      blockers: ['no_destination'],
      canActivate: false,
    });
  });
});

describe('automatic publishing state', () => {
  test.each([
    ['queued', true],
    ['publishing', true],
    ['retrying', true],
    ['failed', false],
    ['published', false],
    ['cancelled', false],
  ] as const)('identifies %s attempts as active: %s', (status, active) => {
    expect(isAutoPublishAttemptActive(attempt(status))).toBe(active);
    expect(hasActiveAutoPublishAttempts([attempt(status)])).toBe(active);
  });

  test.each([
    ['queued', 'queued'],
    ['publishing', 'publishing'],
    ['retrying', 'retrying'],
    ['failed', 'needs_attention'],
    ['published', 'published'],
    ['cancelled', 'needs_attention'],
  ] as const)('maps an individual %s attempt to %s', (attemptStatus, aggregateStatus) => {
    expect(
      getAutoPublishAggregateState({
        autoPublishError: null,
        attempts: [attempt(attemptStatus)],
        publications: attemptStatus === 'published' ? [publication()] : [],
      }).status,
    ).toBe(aggregateStatus);
  });

  test('uses the specified aggregate precedence', () => {
    expect(
      getAutoPublishAggregateState({
        autoPublishError: null,
        attempts: [attempt('queued', 'wordpress'), attempt('publishing', 'static-site')],
        publications: [],
      }).status,
    ).toBe('publishing');
    expect(
      getAutoPublishAggregateState({
        autoPublishError: null,
        attempts: [attempt('queued', 'wordpress'), attempt('retrying', 'static-site')],
        publications: [],
      }).status,
    ).toBe('retrying');
    expect(
      getAutoPublishAggregateState({
        autoPublishError: null,
        attempts: [attempt('retrying', 'wordpress'), attempt('failed', 'static-site')],
        publications: [],
      }).status,
    ).toBe('needs_attention');
    expect(
      getAutoPublishAggregateState({
        autoPublishError: {
          at: '2026-08-13T10:00:00.000Z',
          code: 'not_connected',
          kind: 'permanent',
          message: 'No connection',
        },
        attempts: [attempt('retrying')],
        publications: [],
      }).status,
    ).toBe('needs_attention');
  });

  test('keeps a successful provider plus a failed provider visible as partial success', () => {
    expect(
      getAutoPublishAggregateState({
        autoPublishError: null,
        attempts: [attempt('published', 'wordpress'), attempt('failed', 'static-site')],
        publications: [publication('wordpress')],
      }),
    ).toEqual({ partialSuccess: true, status: 'needs_attention' });
  });

  test('preflight error without attempts needs attention', () => {
    expect(
      getAutoPublishAggregateState({
        autoPublishError: {
          at: '2026-08-13T10:00:00.000Z',
          code: 'not_connected',
          kind: 'permanent',
          message: 'No connection',
        },
        attempts: [],
        publications: [],
      }).status,
    ).toBe('needs_attention');
  });

  test('a manual publication without an automatic attempt is not an automatic success', () => {
    expect(
      getAutoPublishAggregateState({
        autoPublishError: null,
        attempts: [],
        publications: [publication()],
      }),
    ).toEqual({ partialSuccess: false, status: 'not_queued' });
  });

  test('joins attempts and publications by provider in stable provider order', () => {
    expect(
      joinPublishingProviders(
        [attempt('failed', 'static-site'), attempt('published', 'wordpress')],
        [publication('wordpress'), publication('static-site', null)],
      ),
    ).toEqual([
      {
        attempt: attempt('published', 'wordpress'),
        provider: 'wordpress',
        publication: publication('wordpress'),
      },
      {
        attempt: attempt('failed', 'static-site'),
        provider: 'static-site',
        publication: publication('static-site', null),
      },
    ]);
  });

  test('preserves an explicit null publication updated_at', () => {
    const [joined] = joinPublishingProviders([], [publication('static-site', null)]);
    expect(joined?.publication?.updated_at).toBeNull();
  });
});

describe('automatic publishing retry helpers', () => {
  test('offers retry for a preflight error or an unpublished terminal attempt', () => {
    expect(
      shouldOfferAutoPublishRetry({
        autoPublishError: {
          at: '2026-08-13T10:00:00.000Z',
          code: 'not_connected',
          kind: 'permanent',
          message: 'No connection',
        },
        attempts: [],
        publications: [],
      }),
    ).toBe(true);
    expect(
      shouldOfferAutoPublishRetry({
        autoPublishError: null,
        attempts: [attempt('cancelled')],
        publications: [],
      }),
    ).toBe(true);
  });

  test('does not offer retry for active or successful attempts', () => {
    for (const status of ['queued', 'publishing', 'retrying', 'published'] as const) {
      expect(
        shouldOfferAutoPublishRetry({
          autoPublishError: null,
          attempts: [attempt(status)],
          publications: status === 'published' ? [publication()] : [],
        }),
      ).toBe(false);
    }
  });

  test('excludes providers already present in publications', () => {
    expect(
      getRetryableAutoPublishProviders(
        [attempt('failed', 'wordpress'), attempt('failed', 'static-site')],
        [publication('wordpress')],
      ),
    ).toEqual(['static-site']);
  });

  test('interprets an empty queued response as an already-published success', () => {
    expect(getAutoPublishRetryResult([])).toEqual({ kind: 'already_published' });
    expect(getAutoPublishRetryResult(['wordpress', 'static-site'])).toEqual({
      kind: 'queued',
      providers: ['wordpress', 'static-site'],
    });
  });

  test('a dirty draft blocks the guarded retry transition', () => {
    const blocked = isArticlePublishingBlocked(false, true);
    const result = beginAutoPublishRetry(createAutoPublishRetryState('org_1:art_1'), {
      publishBlocked: blocked,
      publishingStateVersion: 'failed-v1',
      retryAvailable: true,
      scope: 'org_1:art_1',
    });

    expect(blocked).toBe(true);
    expect(result.shouldSubmit).toBe(false);
    expect(result.state.phase).toBe('idle');
  });

  test('an open editor blocks retry before any field is dirty', () => {
    const blocked = isArticlePublishingBlocked(true, false);
    const result = beginAutoPublishRetry(createAutoPublishRetryState('org_1:art_1'), {
      publishBlocked: blocked,
      publishingStateVersion: 'failed-v1',
      retryAvailable: true,
      scope: 'org_1:art_1',
    });

    expect(blocked).toBe(true);
    expect(result.shouldSubmit).toBe(false);
  });

  test('retry can start again after changes are resolved and the editor closes', () => {
    const result = beginAutoPublishRetry(createAutoPublishRetryState('org_1:art_1'), {
      publishBlocked: isArticlePublishingBlocked(false, false),
      publishingStateVersion: 'failed-v1',
      retryAvailable: true,
      scope: 'org_1:art_1',
    });

    expect(result.shouldSubmit).toBe(true);
  });

  test('an in-flight retry cannot start a second submission', () => {
    const first = beginAutoPublishRetry(createAutoPublishRetryState('org_1:art_1'), {
      publishBlocked: false,
      publishingStateVersion: 'failed-v1',
      retryAvailable: true,
      scope: 'org_1:art_1',
    });
    const duplicate = beginAutoPublishRetry(first.state, {
      publishBlocked: false,
      publishingStateVersion: 'failed-v1',
      retryAvailable: true,
      scope: 'org_1:art_1',
    });

    expect(first.shouldSubmit).toBe(true);
    expect(first.state.phase).toBe('submitting');
    expect(duplicate.shouldSubmit).toBe(false);
    expect(duplicate.state).toBe(first.state);
  });

  test.each([
    [['wordpress'], { kind: 'queued', providers: ['wordpress'] }],
    [[], { kind: 'already_published' }],
  ] as const)('a successful response for %j stays locked over stale state', (queued, feedback) => {
    const initial = beginAutoPublishRetry(createAutoPublishRetryState('org_1:art_1'), {
      publishBlocked: false,
      publishingStateVersion: 'failed-v1',
      retryAvailable: true,
      scope: 'org_1:art_1',
    }).state;
    const waiting = completeAutoPublishRetryRequest(
      initial,
      'org_1:art_1',
      getAutoPublishRetryResult([...queued]),
    );
    const stale = reconcileAutoPublishRetry(waiting, 'org_1:art_1', 'failed-v1');
    const duplicate = beginAutoPublishRetry(stale, {
      publishBlocked: false,
      publishingStateVersion: 'failed-v1',
      retryAvailable: true,
      scope: 'org_1:art_1',
    });

    expect(waiting.feedback).toEqual(feedback);
    expect(stale.phase).toBe('awaiting_authoritative');
    expect(duplicate.shouldSubmit).toBe(false);
  });

  test('a failed request unlocks retry', () => {
    const submitting = beginAutoPublishRetry(createAutoPublishRetryState('org_1:art_1'), {
      publishBlocked: false,
      publishingStateVersion: 'failed-v1',
      retryAvailable: true,
      scope: 'org_1:art_1',
    }).state;
    const failed = failAutoPublishRetryRequest(
      submitting,
      'org_1:art_1',
      getPublishingErrorPresentation('queue_send_failed'),
    );
    const retry = beginAutoPublishRetry(failed, {
      publishBlocked: false,
      publishingStateVersion: 'failed-v1',
      retryAvailable: true,
      scope: 'org_1:art_1',
    });

    expect(failed.phase).toBe('idle');
    expect(failed.feedback?.kind).toBe('error');
    expect(retry.shouldSubmit).toBe(true);
  });

  test('a newly observed terminal attempt becomes retryable', () => {
    const scope = 'org_1:art_1';
    const oldState = {
      auto_publish_attempts: [attempt('failed')],
      auto_publish_error: null,
      publications: [],
    };
    const newAttempt = {
      ...attempt('failed'),
      attempt_count: 3,
      last_attempt_at: '2026-08-13T10:10:00.000Z',
      requested_at: '2026-08-13T10:05:00.000Z',
    };
    const newState = { ...oldState, auto_publish_attempts: [newAttempt] };
    const submitting = beginAutoPublishRetry(createAutoPublishRetryState(scope), {
      publishBlocked: false,
      publishingStateVersion: getArticlePublishingStateVersion(oldState),
      retryAvailable: true,
      scope,
    }).state;
    const waiting = completeAutoPublishRetryRequest(submitting, scope, {
      kind: 'queued',
      providers: ['wordpress'],
    });
    const reconciled = reconcileAutoPublishRetry(
      waiting,
      scope,
      getArticlePublishingStateVersion(newState),
    );

    expect(reconciled.phase).toBe('idle');
    expect(
      shouldOfferAutoPublishRetry({
        autoPublishError: null,
        attempts: newState.auto_publish_attempts,
        publications: [],
      }),
    ).toBe(true);
    expect(
      beginAutoPublishRetry(reconciled, {
        publishBlocked: false,
        publishingStateVersion: getArticlePublishingStateVersion(newState),
        retryAvailable: true,
        scope,
      }).shouldSubmit,
    ).toBe(true);
  });

  test('another article or organization gets clean scoped retry state', () => {
    const firstScope = completeAutoPublishRetryRequest(
      beginAutoPublishRetry(createAutoPublishRetryState('org_1:art_1'), {
        publishBlocked: false,
        publishingStateVersion: 'failed-v1',
        retryAvailable: true,
        scope: 'org_1:art_1',
      }).state,
      'org_1:art_1',
      { kind: 'queued', providers: ['wordpress'] },
    );
    const secondScope = createAutoPublishRetryState('org_2:art_2');

    expect(firstScope).toMatchObject({
      feedback: { kind: 'queued' },
      phase: 'awaiting_authoritative',
    });
    expect(secondScope).toEqual({
      feedback: null,
      phase: 'idle',
      publishingStateVersion: null,
      scope: 'org_2:art_2',
    });
  });

  test('terminal attempts stop polling unless an authoritative refresh is pending', () => {
    expect(shouldPollArticlePublishing([attempt('failed')], false)).toBe(false);
    expect(shouldPollArticlePublishing([attempt('failed')], true)).toBe(true);
    expect(shouldPollArticlePublishing([attempt('queued')], false)).toBe(true);
  });
});

describe('manual publishing interaction helpers', () => {
  test('selects the localized plugin-error path for a string WordPress error', () => {
    expect(
      reduceManualWordPressError(null, {
        body: { error: 'The remote post was not found.' },
        type: 'failed',
      }),
    ).toEqual({ kind: 'plugin', error: 'The remote post was not found.' });
  });

  test.each([
    undefined,
    null,
    {},
    { error: '' },
    { error: { message: 'unsafe' } },
  ])('selects the request-error path for an unusable WordPress failure: %j', (body) => {
    expect(reduceManualWordPressError(null, { body, type: 'failed' })).toEqual({
      kind: 'request',
    });
  });

  test('a WordPress success clears an earlier provider error', () => {
    const failed = reduceManualWordPressError(null, {
      body: { error: 'Authentication rejected.' },
      type: 'failed',
    });

    expect(reduceManualWordPressError(failed, { type: 'succeeded' })).toBeNull();
  });

  test('starting another WordPress request clears an earlier provider error', () => {
    const failed = reduceManualWordPressError(null, {
      body: { error: 'Authentication rejected.' },
      type: 'failed',
    });

    expect(reduceManualWordPressError(failed, { type: 'started' })).toBeNull();
  });

  test('manual refresh observation reads backend publication state without inventing timestamps', () => {
    const state = {
      auto_publish_attempts: [],
      auto_publish_error: null,
      publications: [publication('static-site', null)],
    };
    const before = structuredClone(state);

    expect(
      hasObservedManualPublishTarget(state, {
        provider: 'static-site',
        ref: 'abc123',
        scope: 'org_1:art_1',
      }),
    ).toBe(true);
    expect(state).toEqual(before);
    expect(state.publications[0]?.published_at).toBe('2026-08-13T10:02:00.000Z');
    expect(state.publications[0]?.updated_at).toBeNull();
  });
});

describe('publishing errors and destination URLs', () => {
  test.each([
    'not_connected',
    'images_incomplete',
    'image_generation_failed',
    'auto_publish_disabled',
    'subscription_required',
    'plugin_upgrade_required',
    'invalid_credentials',
    'wordpress_auth_failed',
    'invalid_article_payload',
    'invalid_provider_response',
    'wordpress_publish_in_progress',
    'wordpress_request_failed',
    'network_error',
    'static_publish_in_progress',
    'slug_conflict',
    'installation_not_found',
    'installation_suspended',
    'missing_write_permission',
    'repo_not_found',
    'commit_rejected',
    'ref_conflict',
    'github_request_failed',
    'record_failed',
    'queue_send_failed',
  ])('maps known error code %s without falling back to unknown', (code) => {
    expect(getPublishingErrorPresentation(code).messageKey).not.toBe('publishing.errors.unknown');
  });

  test('maps known errors to localized keys and actions', () => {
    expect(getPublishingErrorPresentation('not_connected')).toEqual({
      action: 'integrations',
      messageKey: 'publishing.errors.notConnected',
    });
    expect(getPublishingErrorPresentation('plugin_upgrade_required')).toEqual({
      action: 'wordpress_docs',
      messageKey: 'publishing.errors.pluginUpgradeRequired',
    });
    expect(getPublishingErrorPresentation('slug_conflict')).toEqual({
      action: 'edit_slug',
      messageKey: 'publishing.errors.slugConflict',
    });
  });

  test('uses a localized unknown fallback for future codes', () => {
    expect(getPublishingErrorPresentation('future_provider_error')).toEqual({
      action: null,
      messageKey: 'publishing.errors.unknown',
    });
  });

  test.each([
    ['https://example.com/post', 'https://example.com/post'],
    ['http://example.com/post', 'http://example.com/post'],
    ['javascript:alert(1)', null],
    ['data:text/html,hello', null],
    ['https://token@example.com/post', null],
    ['//example.com/post', null],
    ['not a URL', null],
    ['', null],
    [null, null],
  ] as const)('validates publication URL %s', (value, expected) => {
    expect(getSafePublicationUrl(value)).toBe(expected);
  });
});
