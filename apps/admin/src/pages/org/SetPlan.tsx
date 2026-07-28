import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { errorText } from '../../lib/errors';
import { type Plan, setPlan } from '../../lib/queries';

const PLANS = ['free', 'paid', 'expert'] as const satisfies readonly Plan[];

const CUSTOMER_VISIBLE =
  "The customer's plan changes immediately (their app capabilities shift); paid plans kick the " +
  'strategy pipeline, so planner entries and articles will start appearing.';

/**
 * The first operator lever: override the entitlement plan. Customer-visible and
 * pipeline-triggering, so it goes through the two-step confirm (design §5).
 */
export function SetPlan({ orgId, plan }: { orgId: string; plan: Plan }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Plan>(plan);
  const [confirming, setConfirming] = useState(false);

  const apply = useMutation({
    mutationFn: () => setPlan(orgId, selected),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org', orgId] }),
  });

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selected}
          onChange={(event) => setSelected(event.target.value as Plan)}
          className="rounded border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm"
        >
          {PLANS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={selected === plan || apply.isPending}
          onClick={() => setConfirming(true)}
          className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {apply.isPending ? 'Applying…' : 'Apply'}
        </button>
      </div>

      {apply.isError && (
        <p className="mt-2 text-sm text-red-400">
          {errorText(apply.error, 'Could not change the plan.')}
        </p>
      )}

      {apply.isSuccess && (
        <p className="mt-2 text-sm text-emerald-400">
          Plan set to {apply.data.plan}
          {apply.data.strategy_kicked ? ' — strategy job kicked.' : '.'}
        </p>
      )}

      {confirming && (
        <ConfirmDialog
          title="Change plan"
          body={`This org moves from "${plan}" to "${selected}".`}
          confirmLabel={`Set plan to ${selected}`}
          variant="danger"
          customerVisible={CUSTOMER_VISIBLE}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            apply.mutate();
          }}
        />
      )}
    </div>
  );
}
