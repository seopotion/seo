import { ARTICLE_TYPES, SEARCH_INTENTS } from '@shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, type Tone } from '../../components/Badge';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DateForm } from '../../components/DateForm';
import { Table, Td, Th } from '../../components/Table';
import { errorText } from '../../lib/errors';
import { EMPTY, formatDateTime, orEmpty } from '../../lib/format';
import {
  type BriefPatch,
  fetchPlanner,
  generateNow,
  rescheduleKeyword,
  resetGeneration,
  type ScheduledKeyword,
  unscheduleKeyword,
  updateBrief,
} from '../../lib/queries';
import { useOrgDetail } from '../OrgWorkspace';

type Pending =
  | { kind: 'reschedule'; keyword: ScheduledKeyword; date: string }
  | { kind: 'unschedule'; keyword: ScheduledKeyword }
  | { kind: 'generate'; keyword: ScheduledKeyword }
  | { kind: 'reset'; keyword: ScheduledKeyword }
  | { kind: 'brief'; keyword: ScheduledKeyword; patch: BriefPatch };

const RESCHEDULE_CUSTOMER_VISIBLE = "The entry moves on the customer's planner.";

const UNSCHEDULE_CUSTOMER_VISIBLE = "The entry disappears from the customer's planner.";

const GENERATE_CUSTOMER_VISIBLE = "A generated article will appear in the customer's app.";

const FREE_PLAN_WARNING =
  'This org is on the free plan: generation fails for unpaid orgs and burns one of 3 attempts. ' +
  'Set the plan first.';

const RESET_BODY =
  'The entry goes back to pending with 0 attempts, so the daily 07:00 UTC run — or "Generate ' +
  'now" — will pick it up again. Without this, a keyword past the 3-attempt cap is ignored ' +
  'forever. The recorded failure reason is cleared with it.';

/**
 * The operator planner: every scheduled keyword with the generation attempts,
 * error and timing the customer view omits — the screen you open when someone
 * asks why an article never showed up.
 */
export function PlannerTab() {
  const { org } = useOrgDetail();
  const orgId = org.id;
  const queryClient = useQueryClient();

  /** Id of the row whose inline date form is open. */
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  /** Id of the row whose inline brief form is open. */
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const planner = useQuery({
    queryKey: ['planner', orgId],
    queryFn: () => fetchPlanner(orgId),
  });

  /** Unschedule releases the candidate and moves the header count, so all three
   * views refetch together. */
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['planner', orgId] });
    queryClient.invalidateQueries({ queryKey: ['candidates', orgId] });
    queryClient.invalidateQueries({ queryKey: ['org', orgId] });
  };

  const reschedule = useMutation({
    mutationFn: (input: { keyword: ScheduledKeyword; date: string }) =>
      rescheduleKeyword(input.keyword.id, input.date),
    onSuccess: () => {
      setRescheduling(null);
      queryClient.invalidateQueries({ queryKey: ['planner', orgId] });
    },
  });

  const unschedule = useMutation({
    mutationFn: (keyword: ScheduledKeyword) => unscheduleKeyword(keyword.id),
    onSuccess: invalidateAll,
  });

  const generate = useMutation({
    mutationFn: (keyword: ScheduledKeyword) => generateNow(keyword.id),
    // No status flip and no polling: the worker claims the task and the row
    // updates on the next load (design §7).
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['planner', orgId] }),
  });

  const reset = useMutation({
    mutationFn: (keyword: ScheduledKeyword) => resetGeneration(keyword.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['planner', orgId] }),
  });

  const editBrief = useMutation({
    mutationFn: (input: { keyword: ScheduledKeyword; patch: BriefPatch }) =>
      updateBrief(input.keyword.id, input.patch),
    onSuccess: () => {
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['planner', orgId] });
    },
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-400">
        <span>Strategy: {planner.data?.strategy_status ?? org.strategy_status}</span>
        <span className="text-neutral-600">
          Generation is asynchronous — reload in a minute to see a queued run land.
        </span>
      </div>

      {reschedule.isError && (
        <p className="mt-3 text-sm text-red-400">
          {errorText(reschedule.error, 'Could not move that entry.')}
        </p>
      )}
      {unschedule.isError && (
        <p className="mt-3 text-sm text-red-400">
          {errorText(unschedule.error, 'Could not unschedule that entry.')}
        </p>
      )}
      {generate.isError && (
        <p className="mt-3 text-sm text-red-400">
          {errorText(generate.error, 'Could not queue generation.')}
        </p>
      )}
      {reset.isError && (
        <p className="mt-3 text-sm text-red-400">
          {errorText(reset.error, 'Could not reset that entry.')}
        </p>
      )}
      {editBrief.isError && (
        <p className="mt-3 text-sm text-red-400">
          {errorText(editBrief.error, 'Could not save that brief.')}
        </p>
      )}
      {generate.isSuccess && (
        <p className="mt-3 text-sm text-emerald-400">
          Generation queued for “{generate.variables.keyword}” — refresh in a minute.
        </p>
      )}

      {planner.isPending && <p className="mt-6 text-sm text-neutral-500">Loading the planner…</p>}
      {planner.isError && (
        <p className="mt-6 text-sm text-red-400">
          {errorText(planner.error, 'Could not load the planner.')}
        </p>
      )}

      {planner.data?.keywords.length === 0 && (
        <p className="mt-6 text-sm text-neutral-400">
          Nothing scheduled — schedule a candidate from the Pool tab.
        </p>
      )}

      {planner.data && planner.data.keywords.length > 0 && (
        <div className="mt-4">
          <Table
            head={
              <>
                <Th>Date</Th>
                <Th>Keyword</Th>
                <Th numeric>Volume</Th>
                <Th numeric>Difficulty</Th>
                <Th>Type</Th>
                <Th>Intent</Th>
                <Th numeric>Opportunity</Th>
                <Th>Generation</Th>
                <Th numeric>Attempts</Th>
                <Th>Started</Th>
                <Th>Error</Th>
                <Th>Article</Th>
                <Th>Actions</Th>
              </>
            }
          >
            {planner.data.keywords.map((keyword) => {
              // Both guards the API enforces: it refuses to move or drop an
              // entry once generation started, and refuses to regenerate a
              // finished one.
              const movable =
                keyword.generation_status === 'pending' && keyword.article_id === null;
              const generatable =
                keyword.generation_status !== 'generated' && keyword.article_id === null;
              // The over-cap lever: `resetGeneration` only matches a failed,
              // article-less entry. `movable` is the same guard `updateBrief`
              // uses, so the brief is editable exactly while the row can move.
              const resettable =
                keyword.generation_status === 'failed' && keyword.article_id === null;

              return (
                <tr key={keyword.id}>
                  <Td>{keyword.scheduled_date}</Td>
                  <Td>
                    <span className="font-medium">{keyword.keyword}</span>
                  </Td>
                  <Td numeric>{orEmpty(keyword.search_volume)}</Td>
                  <Td numeric>{orEmpty(keyword.difficulty)}</Td>
                  <Td>{orEmpty(keyword.article_type)}</Td>
                  <Td>{orEmpty(keyword.intent)}</Td>
                  <Td numeric>{orEmpty(keyword.opportunity_score)}</Td>
                  <Td>
                    <Badge tone={generationTone(keyword.generation_status)}>
                      {keyword.generation_status}
                    </Badge>
                  </Td>
                  <Td numeric>{keyword.generation_attempts}</Td>
                  <Td>
                    <span className="whitespace-nowrap">
                      {formatDateTime(keyword.generation_started_at)}
                    </span>
                  </Td>
                  <Td>
                    <ErrorCell error={keyword.generation_error} />
                  </Td>
                  <Td>
                    {keyword.article_id ? (
                      <span className="font-mono text-xs text-emerald-400">
                        {keyword.article_id}
                      </span>
                    ) : (
                      EMPTY
                    )}
                  </Td>
                  <Td>
                    {rescheduling === keyword.id ? (
                      <DateForm
                        initial={keyword.scheduled_date}
                        submitLabel="Move"
                        onSubmit={(date) => setPending({ kind: 'reschedule', keyword, date })}
                        onCancel={() => setRescheduling(null)}
                      />
                    ) : editing === keyword.id ? (
                      <BriefForm
                        keyword={keyword}
                        pending={editBrief.isPending}
                        onSubmit={(patch) => setPending({ kind: 'brief', keyword, patch })}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <div className="flex flex-wrap gap-2 whitespace-nowrap">
                        {movable && (
                          <>
                            <button
                              type="button"
                              onClick={() => setRescheduling(keyword.id)}
                              className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
                            >
                              Reschedule
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing(keyword.id)}
                              className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
                            >
                              Edit brief
                            </button>
                            <button
                              type="button"
                              onClick={() => setPending({ kind: 'unschedule', keyword })}
                              className="rounded border border-red-800 px-2 py-1 text-xs text-red-300 hover:bg-red-950"
                            >
                              Unschedule
                            </button>
                          </>
                        )}
                        {resettable && (
                          <button
                            type="button"
                            onClick={() => setPending({ kind: 'reset', keyword })}
                            className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
                          >
                            Reset generation
                          </button>
                        )}
                        {generatable && (
                          <button
                            type="button"
                            onClick={() => setPending({ kind: 'generate', keyword })}
                            className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
                          >
                            Generate now
                          </button>
                        )}
                        {!movable && !generatable && !resettable && (
                          <span className="text-xs text-neutral-600">{EMPTY}</span>
                        )}
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        </div>
      )}

      {pending?.kind === 'reschedule' && (
        <ConfirmDialog
          title="Reschedule keyword"
          body={`"${pending.keyword.keyword}" moves from ${pending.keyword.scheduled_date} to ${pending.date}.`}
          confirmLabel={`Move to ${pending.date}`}
          customerVisible={RESCHEDULE_CUSTOMER_VISIBLE}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            reschedule.mutate({ keyword: pending.keyword, date: pending.date });
          }}
        />
      )}

      {pending?.kind === 'unschedule' && (
        <ConfirmDialog
          title="Unschedule keyword"
          body={`"${pending.keyword.keyword}" leaves ${pending.keyword.scheduled_date} and returns to the candidate pool, where it can be scheduled again.`}
          confirmLabel="Unschedule"
          variant="danger"
          customerVisible={UNSCHEDULE_CUSTOMER_VISIBLE}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            unschedule.mutate(pending.keyword);
          }}
        />
      )}

      {pending?.kind === 'brief' && (
        <ConfirmDialog
          title="Edit brief"
          body={`The brief for "${pending.keyword.keyword}" becomes ${describeBrief(pending.patch)}. It steers the article the generator writes — nothing already generated changes.`}
          confirmLabel="Save brief"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            editBrief.mutate({ keyword: pending.keyword, patch: pending.patch });
          }}
        />
      )}

      {pending?.kind === 'reset' && (
        <ConfirmDialog
          title="Reset generation"
          body={`"${pending.keyword.keyword}" failed ${pending.keyword.generation_attempts} time(s). ${RESET_BODY}`}
          confirmLabel="Reset to pending"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            reset.mutate(pending.keyword);
          }}
        />
      )}

      {pending?.kind === 'generate' && (
        <ConfirmDialog
          title="Generate now"
          body={`An article for "${pending.keyword.keyword}" is queued immediately, ahead of the 07:00 UTC run.`}
          confirmLabel="Queue generation"
          variant="danger"
          warning={org.plan === 'free' ? FREE_PLAN_WARNING : undefined}
          customerVisible={GENERATE_CUSTOMER_VISIBLE}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            generate.mutate(pending.keyword);
          }}
        />
      )}
    </div>
  );
}

/**
 * The three brief fields, edited in place. Every field is nullable, so an empty
 * select or box means `null` — and all three are always sent: they are seeded
 * from the row, and a partial body would only add a diff to get wrong.
 */
function BriefForm({
  keyword,
  pending,
  onSubmit,
  onCancel,
}: {
  keyword: ScheduledKeyword;
  pending: boolean;
  onSubmit: (patch: BriefPatch) => void;
  onCancel: () => void;
}) {
  const [patch, setPatch] = useState<BriefPatch>({
    article_type: keyword.article_type,
    intent: keyword.intent,
    opportunity_score: keyword.opportunity_score,
  });

  return (
    <form
      className="flex w-52 flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(patch);
      }}
    >
      <select
        aria-label="Article type"
        value={patch.article_type ?? ''}
        onChange={(event) =>
          setPatch({
            ...patch,
            article_type: (event.target.value || null) as BriefPatch['article_type'],
          })
        }
        className={BRIEF_INPUT}
      >
        <option value="">(no type)</option>
        {ARTICLE_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>

      <select
        aria-label="Intent"
        value={patch.intent ?? ''}
        onChange={(event) =>
          setPatch({ ...patch, intent: (event.target.value || null) as BriefPatch['intent'] })
        }
        className={BRIEF_INPUT}
      >
        <option value="">(no intent)</option>
        {SEARCH_INTENTS.map((intent) => (
          <option key={intent} value={intent}>
            {intent}
          </option>
        ))}
      </select>

      <input
        type="number"
        step="any"
        aria-label="Opportunity score"
        placeholder="opportunity score"
        value={patch.opportunity_score ?? ''}
        onChange={(event) =>
          setPatch({
            ...patch,
            opportunity_score: event.target.value === '' ? null : Number(event.target.value),
          })
        }
        className={BRIEF_INPUT}
      />

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Save brief'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const BRIEF_INPUT =
  'w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100';

function describeBrief(patch: BriefPatch): string {
  return [
    `type ${patch.article_type ?? 'none'}`,
    `intent ${patch.intent ?? 'none'}`,
    `opportunity ${patch.opportunity_score ?? 'none'}`,
  ].join(', ');
}

function generationTone(status: ScheduledKeyword['generation_status']): Tone {
  if (status === 'generated') return 'good';
  if (status === 'failed') return 'bad';
  return status === 'generating' ? 'warn' : 'neutral';
}

/** Generation errors are long provider messages — one line until asked for. */
function ErrorCell({ error }: { error: string | null }) {
  if (!error) return <span>{EMPTY}</span>;

  return (
    <details>
      <summary className="max-w-48 cursor-pointer truncate text-red-300" title={error}>
        {error}
      </summary>
      <p className="mt-1 max-w-md text-xs wrap-break-words whitespace-pre-wrap text-red-300">
        {error}
      </p>
    </details>
  );
}
