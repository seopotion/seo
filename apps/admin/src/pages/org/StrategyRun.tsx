import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { errorText } from '../../lib/errors';
import { type OrgDetail, runStrategy } from '../../lib/queries';

const CUSTOMER_VISIBLE =
  "Planner entries and candidates will appear in the customer's app when the run completes.";

const FORCE_BODY =
  'The strategy status is reset so the job can be claimed again, then the 30-day run is queued. ' +
  'Additive, not destructive: the pipeline dedupes against the existing planner and pool, so the ' +
  'worst case is a few more candidates than needed — nothing already scheduled is lost.';

const PENDING_WARNING =
  'This org already has a pending strategy job. If it is genuinely still running, forcing now ' +
  'queues a second one — only do this when the status has been stuck for a while.';

/**
 * The strategy lever (design §7). Two buttons, never both live: a `none`/`failed`
 * org is claimable so the plain run applies, and a `completed`/`pending` one can
 * only move via the explicit force re-run. Whichever does not apply is rendered
 * disabled with its reason, so the operator never discovers the 409 by hitting it.
 */
export function StrategyRun({
  orgId,
  strategyStatus,
}: {
  orgId: string;
  strategyStatus: OrgDetail['org']['strategy_status'];
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<'run' | 'force' | null>(null);

  const run = useMutation({
    mutationFn: (force: boolean) => runStrategy(orgId, force),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org', orgId] }),
  });

  // Exactly `claimStrategy`'s own condition, mirrored.
  const claimable = strategyStatus === 'none' || strategyStatus === 'failed';

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!claimable || run.isPending}
          title={claimable ? undefined : `Already ${strategyStatus} — use Force re-run.`}
          onClick={() => setConfirming('run')}
          className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {run.isPending ? 'Queueing…' : 'Run strategy'}
        </button>
        <button
          type="button"
          disabled={claimable || run.isPending}
          title={
            claimable
              ? `Nothing to force — the strategy is "${strategyStatus}", so the plain run applies.`
              : undefined
          }
          onClick={() => setConfirming('force')}
          className="rounded border border-red-800 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Force re-run
        </button>
      </div>

      {run.isError && (
        <p className="mt-2 text-sm text-red-400">
          {errorText(run.error, 'Could not start the strategy job.')}
        </p>
      )}
      {run.isSuccess && <p className="mt-2 text-sm text-emerald-400">Strategy queued.</p>}

      {confirming === 'run' && (
        <ConfirmDialog
          title="Run strategy"
          body="The 30-day strategy job is queued for this org: it researches keywords, fills the candidate pool, and schedules the planner."
          confirmLabel="Run strategy"
          customerVisible={CUSTOMER_VISIBLE}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            run.mutate(false);
          }}
        />
      )}

      {confirming === 'force' && (
        <ConfirmDialog
          title="Force a strategy re-run"
          body={FORCE_BODY}
          confirmLabel="Force re-run"
          variant="danger"
          warning={strategyStatus === 'pending' ? PENDING_WARNING : undefined}
          customerVisible={CUSTOMER_VISIBLE}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            run.mutate(true);
          }}
        />
      )}
    </div>
  );
}
