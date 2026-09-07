import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { ArticleRepo, ArticleRunRepo, KeywordRepo, OrgRepo } from '@shared/db';
import type { ArticleRun, StageState } from '@shared/schemas';
import { ArticleFatalError } from './errors';
import { runLocalArticleRun } from './run';

export async function createArticleRun(orgId: string, keywordId: string): Promise<ArticleRun> {
  const org = await OrgRepo.findById(orgId);
  if (!org?.presets) throw new ArticleFatalError(`org ${orgId} missing or has no presets`);
  const keyword = await KeywordRepo.findById(keywordId);
  if (!keyword || keyword.org_id !== orgId)
    throw new ArticleFatalError(`keyword ${keywordId} not found in org ${orgId}`);
  return ArticleRunRepo.create({
    org_id: orgId,
    keyword_id: keywordId,
    status: 'running',
    input: { website_url: org.website_url, presets: org.presets, keyword },
  });
}

async function start(run: ArticleRun, opts?: { wait?: boolean }): Promise<void> {
  const arn = process.env.ARTICLE_STATE_MACHINE_ARN;
  if (arn) {
    const sfn = new SFNClient({});
    await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: arn,
        name: `article-${run.id}`,
        input: JSON.stringify({ run_id: run.id, org_id: run.org_id }),
      }),
    );
  } else if (opts?.wait) {
    await runLocalArticleRun(run.id);
  } else {
    void runLocalArticleRun(run.id).catch((err) => {
      console.error(`[articles] local run ${run.id} failed`, err);
    });
  }
}

/**
 * Launch article generation for one planner keyword. The atomic
 * KeywordRepo.claimGeneration is the idempotency guard (returns null when the
 * keyword is already in flight / linked); attempts now count launches, one per
 * scheduler day or admin click. The execution is named by run_id (NOT keyword)
 * so a failed keyword stays relaunchable — SFN reserves names ~90 days.
 */
export async function launchGeneration(
  orgId: string,
  keywordId: string,
  opts?: { wait?: boolean },
): Promise<{ run_id: string } | null> {
  if (!(await KeywordRepo.claimGeneration(keywordId))) return null;
  let run: ArticleRun | undefined;
  try {
    run = await createArticleRun(orgId, keywordId);
    await start(run, opts);
  } catch (err) {
    // Release the claim so tomorrow's scheduler (or an admin) can relaunch.
    await KeywordRepo.failGeneration(keywordId, (err as Error).message).catch(() => {});
    // Don't leave a created run doc stuck in 'running' forever.
    if (run) await ArticleRunRepo.setStatus(run.id, 'failed').catch(() => {});
    throw err;
  }
  return { run_id: run.id };
}

/**
 * Re-run just the image + publish-handoff stages for an existing article
 * (admin images-regenerate). Implemented as a normal run whose earlier stages
 * are pre-completed — they short-circuit in seconds and the machine drops
 * straight into images_plan. Replay-safe via the article's set-if-absent plan
 * and per-slot CAS fills; no keyword claim involved.
 */
export async function launchImageRepair(
  orgId: string,
  articleId: string,
  opts?: { wait?: boolean },
): Promise<{ run_id: string }> {
  const article = await ArticleRepo.findById(articleId);
  if (!article || article.org_id !== orgId)
    throw new ArticleFatalError(`article ${articleId} not found in org ${orgId}`);
  if (article.keyword_id === null)
    throw new ArticleFatalError(`article ${articleId} is not linked to a planner keyword`);
  const org = await OrgRepo.findById(orgId);
  if (!org?.presets) throw new ArticleFatalError(`org ${orgId} missing or has no presets`);
  const keyword = await KeywordRepo.findById(article.keyword_id);
  if (!keyword) throw new ArticleFatalError(`keyword ${article.keyword_id} not found`);

  const now = new Date();
  const done: StageState = {
    status: 'completed',
    started_at: now,
    finished_at: now,
    stats: {},
    error: null,
  };
  const run = await ArticleRunRepo.create({
    org_id: orgId,
    keyword_id: keyword.id,
    status: 'running',
    input: { website_url: org.website_url, presets: org.presets, keyword },
    stages: { prepare: done, outline: done, draft: done, humanize: done, finalize: done },
    working: {
      link_candidates: [],
      outline: null,
      draft: null,
      humanize_attempts: [],
      content: null,
      readability_grade: null,
      article_id: articleId,
    },
  });
  try {
    await start(run, opts);
  } catch (err) {
    // Don't leave a created run doc stuck in 'running' forever.
    await ArticleRunRepo.setStatus(run.id, 'failed').catch(() => {});
    throw err;
  }
  return { run_id: run.id };
}
