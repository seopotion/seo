import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { errorText } from '../../lib/errors';
import { runStrategy } from '../../lib/queries';

const CUSTOMER_VISIBLE =
  "Planner entries and candidates will appear in the customer's app when the run completes.";

/**
 * The strategy lever (design §7): claim the job, enqueue it, and let the badge
 * tell the operator it took. Only the plain run — a completed strategy needs the
 * explicit force re-run, which lands with the phase-2 levers.
 */
export function StrategyRun({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const run = useMutation({
    mutationFn: () => runStrategy(orgId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org', orgId] }),
  });

  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={run.isPending}
        onClick={() => setConfirming(true)}
        className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {run.isPending ? 'Queueing…' : 'Run strategy'}
      </button>

      {run.isError && (
        <p className="mt-2 text-sm text-red-400">
          {errorText(run.error, 'Could not start the strategy job.')}
        </p>
      )}
      {run.isSuccess && <p className="mt-2 text-sm text-emerald-400">Strategy queued.</p>}

      {confirming && (
        <ConfirmDialog
          title="Run strategy"
          body="The 30-day strategy job is queued for this org: it researches keywords, fills the candidate pool, and schedules the planner."
          confirmLabel="Run strategy"
          customerVisible={CUSTOMER_VISIBLE}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            run.mutate();
          }}
        />
      )}
    </div>
  );
}
