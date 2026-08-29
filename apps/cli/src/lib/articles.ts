/**
 * Article pipeline operations (spec: docs/superpowers/specs/
 * 2026-08-22-article-cli-design.md). Inspection reads Mongo. generate-next
 * launches an article-generation run via `@shared/articles` (a Step Functions
 * execution when deployed, in-process locally). publish enqueues SQS tasks
 * that the deployed publish worker consumes.
 */
import { GetQueueAttributesCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { launchGeneration } from '@shared/articles';
import { ArticleRepo, closeDb, IntegrationRepo, KeywordRepo, OrgRepo } from '@shared/db';
import { MAX_GENERATION_ATTEMPTS } from '@shared/generation';
import type { Article, IntegrationProvider, PublishingError } from '@shared/schemas';
import { INTEGRATION_PROVIDERS, isPaid, PublishTask } from '@shared/schemas';
import {
  type ArticleShowData,
  type ArticlesListData,
  fail,
  type GenerateNextData,
  ok,
  type PublishArticleData,
  type PublishingErrorView,
  type Result,
  type WaitOutcome,
  type WaitReport,
} from '../types';
import { resolveOrgId } from './target';

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function errorView(error: PublishingError | null): PublishingErrorView | null {
  if (!error) return null;
  return { code: error.code, kind: error.kind, message: error.message, at: error.at.toISOString() };
}

/**
 * Error names the AWS SDK surfaces when credentials are missing, expired, or
 * rejected — the "you are not logged in" family, as opposed to a bad queue URL.
 */
const CREDENTIAL_ERRORS = new Set([
  'CredentialsProviderError',
  'ExpiredToken',
  'ExpiredTokenException',
  'InvalidClientTokenId',
  'UnrecognizedClientException',
  'AccessDenied',
  'AccessDeniedException',
]);

/**
 * AWS auth preflight: probe the target queue BEFORE any Mongo write, so an
 * expired SSO session can't strand half-done state. Returns the client on
 * success — reuse it for the actual sends and destroy() it in `finally`.
 */
async function preflightQueue(queueUrl: string): Promise<Result<SQSClient>> {
  const endpoint = process.env.SQS_ENDPOINT;
  const client = new SQSClient(
    endpoint
      ? {
          endpoint,
          region: 'elasticmq',
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        }
      : {},
  );
  try {
    await client.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }),
    );
    return ok(client);
  } catch (e) {
    client.destroy();
    const error = e as Error;
    if (CREDENTIAL_ERRORS.has(error.name)) {
      return fail(
        'AWS_NOT_AUTHENTICATED',
        `AWS rejected the queue probe: ${error.message}`,
        'Log in with the AWS CLI (e.g. `aws sso login`) or check AWS_PROFILE, then re-run.',
      );
    }
    return fail(
      'SQS_UNAVAILABLE',
      `Queue probe failed for ${queueUrl}: ${error.message}`,
      'Check the queue URL and your network/VPN.',
    );
  }
}

export async function listArticles(opts: {
  org?: string;
  user?: string;
  limit: number;
}): Promise<Result<ArticlesListData>> {
  try {
    const resolved = await resolveOrgId(opts.org, opts.user);
    if (!resolved.ok) return resolved;
    const { articles, total } = await ArticleRepo.listByOrg(resolved.data, {
      limit: opts.limit,
      offset: 0,
    });
    return ok({
      org_id: resolved.data,
      total,
      articles: articles.map((a) => ({
        id: a.id,
        title: a.title,
        status: a.status,
        images_status: a.images_status,
        created_at: a.created_at.toISOString(),
        attempts: a.auto_publish.attempts.map((entry) => ({
          provider: entry.provider,
          status: entry.status,
        })),
        published_to: a.publications.map((p) => p.provider),
      })),
    });
  } finally {
    await closeDb();
  }
}

/** The `articles show` projection — also the per-poll read behind `--wait`. */
async function toShowData(article: Article): Promise<ArticleShowData> {
  const planner = await KeywordRepo.findById(article.keyword_id);
  return {
    id: article.id,
    org_id: article.org_id,
    title: article.title,
    slug: article.slug,
    keyword: article.keyword,
    status: article.status,
    images_status: article.images_status,
    created_at: article.created_at.toISOString(),
    published_at: iso(article.published_at),
    updated_at: iso(article.updated_at),
    preflight_error: errorView(article.auto_publish.preflight_error),
    attempts: article.auto_publish.attempts.map((entry) => ({
      provider: entry.provider,
      status: entry.status,
      attempt_count: entry.attempt_count,
      requested_at: entry.requested_at.toISOString(),
      last_attempt_at: iso(entry.last_attempt_at),
      last_error: errorView(entry.last_error),
    })),
    publications: article.publications.map((p) => ({
      provider: p.provider,
      ref: p.ref,
      slug: p.slug,
      remote_url: p.remote_url,
      published_at: p.published_at.toISOString(),
      updated_at: iso(p.updated_at),
    })),
    planner: planner
      ? {
          keyword_id: planner.id,
          scheduled_date: planner.scheduled_date,
          generation_status: planner.generation_status,
          generation_attempts: planner.generation_attempts,
          generation_error: planner.generation_error,
        }
      : null,
  };
}

export async function showArticle(articleId: string): Promise<Result<ArticleShowData>> {
  try {
    const article = await ArticleRepo.findById(articleId);
    if (!article) return fail('ARTICLE_NOT_FOUND', `No article with id "${articleId}".`);
    return ok(await toShowData(article));
  } finally {
    await closeDb();
  }
}

export const POLL_MS = 5_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function pollUntil(
  observe: () => Promise<WaitOutcome[]>,
  timeoutMs: number,
): Promise<WaitReport> {
  const startedAt = Date.now();
  for (;;) {
    const outcomes = await observe();
    if (outcomes.every((o) => o.done)) {
      return { timed_out: false, elapsed_ms: Date.now() - startedAt, outcomes };
    }
    if (Date.now() - startedAt + POLL_MS > timeoutMs) {
      return { timed_out: true, elapsed_ms: Date.now() - startedAt, outcomes };
    }
    await sleep(POLL_MS);
  }
}

/**
 * The providers auto-publish will actually run for, computed ONCE at wait
 * start: with the preset off, an unpaid org, or nothing connected, the images
 * worker never hands off to publishing, and success is images completing.
 */
async function expectedProviders(orgId: string): Promise<IntegrationProvider[]> {
  const org = await OrgRepo.findById(orgId);
  if (!org?.presets?.article_preferences.publishing.auto_publish || !isPaid(org)) return [];
  return [...new Set((await IntegrationRepo.listByOrgId(orgId)).map((i) => i.provider))];
}

function attemptViews(article: Article): WaitOutcome['attempts'] {
  return article.auto_publish.attempts.map((entry) => ({
    provider: entry.provider,
    status: entry.status,
    error: entry.last_error?.code ?? null,
  }));
}

/** Terminal check for one provider: published (either record) / failed / cancelled. */
function providerState(article: Article, provider: IntegrationProvider) {
  const published =
    article.publications.some((p) => p.provider === provider) ||
    article.auto_publish.attempts.some(
      (entry) => entry.provider === provider && entry.status === 'published',
    );
  const attempt = article.auto_publish.attempts.find((entry) => entry.provider === provider);
  const terminal = published || attempt?.status === 'failed' || attempt?.status === 'cancelled';
  return { published, terminal };
}

async function generationOutcome(
  keywordId: string,
  providers: IntegrationProvider[],
): Promise<WaitOutcome> {
  const current = await KeywordRepo.findById(keywordId);
  const articleId = current?.article_id ?? null;
  const article = articleId ? await ArticleRepo.findById(articleId) : null;
  const base: WaitOutcome = {
    keyword_id: keywordId,
    article_id: articleId,
    generation_status: current?.generation_status ?? null,
    images_status: article?.images_status ?? null,
    preflight_error: article?.auto_publish.preflight_error?.code ?? null,
    attempts: article ? attemptViews(article) : [],
    done: false,
    ok: false,
  };

  const exhausted =
    current?.generation_status === 'failed' &&
    current.generation_attempts >= MAX_GENERATION_ATTEMPTS;
  if (exhausted || (!current && !article)) return { ...base, done: true, ok: false };
  if (!article) return base;

  if (article.images_status === 'failed' || base.preflight_error) {
    return { ...base, done: true, ok: false };
  }
  if (article.images_status !== 'complete') return base;
  if (providers.length === 0) return { ...base, done: true, ok: true };

  const states = providers.map((provider) => providerState(article, provider));
  if (!states.every((s) => s.terminal)) return base;
  return { ...base, done: true, ok: states.every((s) => s.published) };
}

async function publishOutcome(
  articleId: string,
  providers: IntegrationProvider[],
): Promise<WaitOutcome> {
  const article = await ArticleRepo.findById(articleId);
  if (!article) {
    return {
      keyword_id: null,
      article_id: articleId,
      generation_status: null,
      images_status: null,
      preflight_error: null,
      attempts: [],
      done: true,
      ok: false,
    };
  }
  const states = providers.map((provider) => providerState(article, provider));
  const done = states.every((s) => s.terminal);
  return {
    keyword_id: null,
    article_id: articleId,
    generation_status: null,
    images_status: article.images_status,
    preflight_error: article.auto_publish.preflight_error?.code ?? null,
    attempts: attemptViews(article),
    done,
    ok: done && states.every((s) => s.published),
  };
}

export async function generateNext(opts: {
  org?: string;
  user?: string;
  count: number;
  wait: boolean;
  timeoutMs: number;
}): Promise<Result<GenerateNextData>> {
  try {
    const resolved = await resolveOrgId(opts.org, opts.user);
    if (!resolved.ok) return resolved;
    const orgId = resolved.data;

    // launchGeneration fails these permanently (no retry) — check them up
    // front so `--wait` doesn't burn its whole timeout on a doomed org.
    const org = await OrgRepo.findById(orgId);
    if (!org) return fail('ORG_NOT_FOUND', `No org with id "${orgId}".`);
    if (!org.presets) {
      return fail(
        'ORG_NOT_FINALIZED',
        `Org "${orgId}" has no presets — launching generation would fail it permanently.`,
        'Finish onboarding for this org first.',
      );
    }
    if (!isPaid(org)) {
      return fail(
        'ORG_NOT_PAID',
        `Org "${orgId}" is on plan "${org.plan}" — generation refuses unpaid orgs.`,
        `npm run cli -- db set-plan --org ${orgId} --plan paid`,
      );
    }

    // Same eligibility as the scheduler's listDueForGeneration, minus the date
    // cap (the generation pipeline never checks scheduled_date — only the
    // scheduler does) and scoped to one org. listByOrg sorts by scheduled_date
    // asc, so "next" is simply the head of the filtered list.
    const keywords = await KeywordRepo.listByOrg(orgId);
    const eligible = keywords.filter(
      (k) =>
        k.article_id === null &&
        (k.generation_status === 'pending' || k.generation_status === 'failed') &&
        k.generation_attempts < MAX_GENERATION_ATTEMPTS,
    );
    if (eligible.length === 0) {
      return fail(
        'NO_KEYWORDS_DUE',
        `Org "${orgId}" has no ungenerated planner keywords with attempts left.`,
        'Inspect the planner with `db strategy-audit`, or build one with `db strategy-run` (add --force if the strategy already completed).',
      );
    }

    const targets = eligible.slice(0, opts.count);
    const launched: { keyword_id: string; keyword: string; run_id: string }[] = [];
    const failures: { keyword_id: string; keyword: string; error: string }[] = [];
    for (const target of targets) {
      try {
        // wait: true unconditionally — this CLI process closes the shared
        // Mongo connection and exits right after generateNext returns, which
        // would otherwise race launchGeneration's fire-and-forget local run
        // (see apps/cli/src/lib/db.ts's launchStrategy call for the same fix).
        // `--wait` (opts.wait) only controls the outcome poll below now.
        const res = await launchGeneration(orgId, target.id, { wait: true });
        if (res)
          launched.push({ keyword_id: target.id, keyword: target.keyword, run_id: res.run_id });
      } catch (e) {
        // launchGeneration already released the claim (KeywordRepo.failGeneration)
        // before rethrowing — record the failure and keep launching the rest
        // of the batch instead of losing it to one bad keyword.
        failures.push({
          keyword_id: target.id,
          keyword: target.keyword,
          error: (e as Error).message,
        });
      }
    }

    let wait: WaitReport | null = null;
    if (opts.wait && launched.length > 0) {
      const providers = await expectedProviders(orgId);
      wait = await pollUntil(
        () => Promise.all(launched.map((l) => generationOutcome(l.keyword_id, providers))),
        opts.timeoutMs,
      );
    }

    return ok({ org_id: orgId, enqueued: launched, failures, wait });
  } finally {
    await closeDb();
  }
}

export async function publishArticle(opts: {
  articleId: string;
  provider?: string;
  wait: boolean;
  timeoutMs: number;
}): Promise<Result<PublishArticleData>> {
  if (opts.provider && !(INTEGRATION_PROVIDERS as readonly string[]).includes(opts.provider)) {
    return fail(
      'BAD_ARGS',
      `Unknown provider "${opts.provider}".`,
      `Use one of: ${INTEGRATION_PROVIDERS.join(', ')}.`,
    );
  }
  const queueUrl = process.env.PUBLISH_QUEUE_URL;
  if (!queueUrl) {
    return fail(
      'QUEUE_URL_MISSING',
      'PUBLISH_QUEUE_URL is not set.',
      'Point it at the staging publish queue (aws sqs list-queues), or at ElasticMQ with SQS_ENDPOINT for local dev.',
    );
  }
  const probe = await preflightQueue(queueUrl);
  if (!probe.ok) return probe;
  const client = probe.data;

  try {
    const article = await ArticleRepo.findById(opts.articleId);
    if (!article) return fail('ARTICLE_NOT_FOUND', `No article with id "${opts.articleId}".`);
    const org = await OrgRepo.findById(article.org_id);
    if (!org) return fail('ORG_NOT_FOUND', `No org with id "${article.org_id}".`);

    // The publish worker checks these same gates and, when one fails, consumes
    // the task and records a typed failure on the attempt (visible via
    // `articles show` as `last_error`) rather than retrying — surface them as
    // errors BEFORE enqueueing instead, so we avoid burning that attempt and
    // give an immediate, actionable error here.
    if (article.images_status !== 'complete') {
      return fail(
        'IMAGES_INCOMPLETE',
        `images_status is "${article.images_status}" — the publish worker refuses articles without complete images.`,
        'Check `articles show`; a failed image run can be replayed with POST /admin/articles/{id}/images.',
      );
    }
    if (!org.presets?.article_preferences.publishing.auto_publish) {
      return fail(
        'AUTO_PUBLISH_DISABLED',
        'The org preset article_preferences.publishing.auto_publish is off.',
        'Enable automatic publishing in the dashboard settings for this org.',
      );
    }
    if (!isPaid(org)) {
      return fail(
        'ORG_NOT_PAID',
        `Org "${org.id}" is on plan "${org.plan}" — publishing requires a paid plan.`,
        `npm run cli -- db set-plan --org ${org.id} --plan paid`,
      );
    }

    // Presence of an Integration row = connected (same as the retry route). The
    // route's lazy org→Integration WordPress migration is NOT replicated here:
    // it needs apps/api's crypto. Legacy-mirror orgs read as NOT_CONNECTED; any
    // dashboard publish migrates them.
    const integrations = await IntegrationRepo.listByOrgId(org.id);
    const connected = integrations.map((i) => i.provider);
    if (opts.provider && !connected.includes(opts.provider as IntegrationProvider)) {
      return fail(
        'NOT_CONNECTED',
        `No "${opts.provider}" integration is connected for org "${org.id}".`,
        `Connected: ${connected.length ? connected.join(', ') : '(none)'}.`,
      );
    }
    const requested = opts.provider
      ? [opts.provider as IntegrationProvider]
      : [...new Set(connected)];
    if (requested.length === 0) {
      return fail(
        'NOT_CONNECTED',
        `Org "${org.id}" has no publishing integration connected.`,
        'Connect WordPress or a static site in the dashboard first.',
      );
    }

    await ArticleRepo.clearAutoPublishPreflightError(article.id);
    const requestedAt = new Date();
    const publishedTo = new Set(article.publications.map((p) => p.provider));
    const providers: PublishArticleData['providers'] = [];
    for (const provider of requested) {
      const attempt = article.auto_publish.attempts.find((entry) => entry.provider === provider);
      if (publishedTo.has(provider) || attempt?.status === 'published') {
        providers.push({ provider, action: 'skipped_published' });
        continue;
      }
      if (attempt?.status === 'failed' || attempt?.status === 'cancelled') {
        await ArticleRepo.resetAutoPublishAttempt(article.id, provider, requestedAt);
      } else if (!attempt) {
        await ArticleRepo.initializeAutoPublishAttempt(article.id, provider, requestedAt);
      }
      await client.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(
            PublishTask.parse({ org_id: org.id, article_id: article.id, provider }),
          ),
        }),
      );
      providers.push({ provider, action: 'enqueued' });
    }

    const enqueuedProviders = providers
      .filter((p) => p.action === 'enqueued')
      .map((p) => p.provider as IntegrationProvider);
    let wait: WaitReport | null = null;
    if (opts.wait && enqueuedProviders.length > 0) {
      wait = await pollUntil(
        () => publishOutcome(article.id, enqueuedProviders).then((o) => [o]),
        opts.timeoutMs,
      );
    }
    return ok({ article_id: article.id, org_id: org.id, providers, wait });
  } finally {
    client.destroy();
    await closeDb();
  }
}
