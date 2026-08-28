import { ArticleRunRepo, KeywordRepo } from '@shared/db';
import { ARTICLE_STAGES, type ArticleRun, type ArticleStageName } from '@shared/schemas';
import { type ArticleStageClients, getArticleStageClients } from './clients';
import { ArticleFatalError, toArticleError } from './errors';
import { stageDraft } from './stages/draft';
import { stageFinalize } from './stages/finalize';
import { stageHandoffPublish } from './stages/handoff';
import { stageHumanize } from './stages/humanize';
import { stageImagesPlan, stageImagesRender } from './stages/images';
import { stageOutline } from './stages/outline';
import { stagePrepare } from './stages/prepare';
import type { StageOutcome } from './stages/types';

export type StageResult = { readability_ok: boolean } | undefined;

const SHORT_CIRCUIT: Record<ArticleStageName, StageResult> = {
  prepare: undefined,
  outline: undefined,
  draft: undefined,
  humanize: { readability_ok: true },
  finalize: undefined,
  images_plan: undefined,
  images_render: undefined,
  handoff_publish: undefined,
};

function dispatch(
  run: ArticleRun,
  stage: ArticleStageName,
  clients: ArticleStageClients,
): Promise<StageOutcome> {
  switch (stage) {
    case 'prepare':
      return stagePrepare(run);
    case 'outline':
      return stageOutline(run, clients.llm);
    case 'draft':
      return stageDraft(run, clients.llm);
    case 'humanize':
      return stageHumanize(run, clients.llm);
    case 'finalize':
      return stageFinalize(run, clients);
    case 'images_plan':
      return stageImagesPlan(run, clients.llm);
    case 'images_render':
      return stageImagesRender(run, clients.image);
    case 'handoff_publish':
      return stageHandoffPublish(run);
  }
}

/**
 * Execute one stage against the run's checkpointed state. Idempotent against
 * SFN double-fire/redrive (completed stages short-circuit). A humanize attempt
 * that misses the readability target persists its attempt WITHOUT completing
 * the stage and returns readability_ok: false — the Choice state loops it.
 */
export async function executeArticleStage(
  runId: string,
  stage: ArticleStageName,
  clients: ArticleStageClients,
): Promise<StageResult> {
  const run = await ArticleRunRepo.findById(runId);
  if (run === null) throw new ArticleFatalError(`article run ${runId} not found`);
  if (run.status === 'completed' || run.stages[stage]?.status === 'completed') {
    return SHORT_CIRCUIT[stage];
  }
  const started = new Date();
  try {
    const outcome = await dispatch(run, stage, clients);
    if (outcome.completed) {
      await ArticleRunRepo.saveStageResult(runId, stage, outcome.working, {
        status: 'completed',
        started_at: started,
        finished_at: new Date(),
        stats: {},
        error: null,
      });
      if (stage === 'handoff_publish') await ArticleRunRepo.setStatus(runId, 'completed');
    } else {
      await ArticleRunRepo.patchWorking(runId, outcome.working);
    }
    return outcome.output;
  } catch (err) {
    const typed = toArticleError(err);
    await ArticleRunRepo.markStageFailed(runId, stage, {
      status: 'failed',
      started_at: started,
      finished_at: new Date(),
      stats: {},
      error: typed.message,
    }).catch(() => {});
    throw typed;
  }
}

/** Local/dev/CLI runner: sequential stages, looping humanize until it passes. */
export async function runLocalArticleRun(
  runId: string,
  clients?: ArticleStageClients,
): Promise<void> {
  const resolved = clients ?? (await getArticleStageClients());
  for (const stage of ARTICLE_STAGES) {
    if (stage === 'humanize') {
      let result: StageResult;
      do {
        result = await executeArticleStage(runId, stage, resolved);
      } while (result?.readability_ok === false);
    } else {
      await executeArticleStage(runId, stage, resolved);
    }
  }
}

/** EventBridge failure handler: stamp keyword + run failed after the execution dies. */
export async function markArticleRunFailed(runId: string): Promise<void> {
  const run = await ArticleRunRepo.findById(runId);
  if (!run) return;
  // Once finalize has linked an article (working.article_id set), the failure
  // is scoped to images/handoff — the keyword already generated its article
  // and must not be flipped back to 'failed' (that leaves article_id set with
  // generation_status: 'failed', a state resetGeneration can't clear and a
  // redrive can't repair since finalize short-circuits on article_id). It's
  // already surfaced via the CloudWatch metricFailed alarm.
  if (run.working.article_id === null) {
    const stageError = Object.values(run.stages).find((s) => s.status === 'failed')?.error;
    await KeywordRepo.failGeneration(run.keyword_id, stageError ?? 'execution failed');
  }
  await ArticleRunRepo.setStatus(runId, 'failed');
}
