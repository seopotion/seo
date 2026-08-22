/**
 * Article pipeline operations (spec: docs/superpowers/specs/
 * 2026-08-22-article-cli-design.md). Inspection reads Mongo; generate-next and
 * publish enqueue SQS tasks that the deployed workers consume — the CLI never
 * generates or publishes in-process, so a run exercises the deployed pipeline.
 */
import { GetQueueAttributesCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { ArticleRepo, closeDb, KeywordRepo } from '@shared/db';
import { MAX_GENERATION_ATTEMPTS } from '@shared/generation';
import type { Article, PublishingError } from '@shared/schemas';
import { GenerateTask } from '@shared/schemas';
import {
  type ArticleShowData,
  type ArticlesListData,
  fail,
  type GenerateNextData,
  ok,
  type PublishingErrorView,
  type Result,
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

export async function generateNext(opts: {
  org?: string;
  user?: string;
  count: number;
  wait: boolean;
  timeoutMs: number;
}): Promise<Result<GenerateNextData>> {
  const queueUrl = process.env.GENERATION_QUEUE_URL;
  if (!queueUrl) {
    return fail(
      'QUEUE_URL_MISSING',
      'GENERATION_QUEUE_URL is not set.',
      'Point it at the staging generation queue (aws sqs list-queues), or at ElasticMQ with SQS_ENDPOINT for local dev.',
    );
  }
  const probe = await preflightQueue(queueUrl);
  if (!probe.ok) return probe;
  const client = probe.data;

  try {
    const resolved = await resolveOrgId(opts.org, opts.user);
    if (!resolved.ok) return resolved;
    const orgId = resolved.data;

    // Same eligibility as the scheduler's listDueForGeneration, minus the date
    // cap (the worker never checks scheduled_date — only the scheduler does) and
    // scoped to one org. listByOrg sorts by scheduled_date asc, so "next" is
    // simply the head of the filtered list.
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
        'Inspect the planner with `db strategy-audit`, or build one with `db strategy-run`.',
      );
    }

    const targets = eligible.slice(0, opts.count);
    for (const target of targets) {
      await client.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(GenerateTask.parse({ org_id: orgId, keyword_id: target.id })),
        }),
      );
    }

    return ok({
      org_id: orgId,
      enqueued: targets.map((k) => ({
        keyword_id: k.id,
        keyword: k.keyword,
        scheduled_date: k.scheduled_date,
        generation_status: k.generation_status,
        generation_attempts: k.generation_attempts,
      })),
      wait: null,
    });
  } finally {
    client.destroy();
    await closeDb();
  }
}
