import { CANDIDATE_STATUSES, type CandidateStatus } from '@shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, type Tone } from '../../components/Badge';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DateForm } from '../../components/DateForm';
import { Table, Td, Th } from '../../components/Table';
import { errorText } from '../../lib/errors';
import { EMPTY, orEmpty } from '../../lib/format';
import {
  type CandidateItem,
  fetchCandidates,
  POOL_PAGE_SIZE,
  rejectCandidate,
  restoreCandidate,
  scheduleCandidate,
} from '../../lib/queries';
import { useOrgDetail } from '../OrgWorkspace';
import { ResearchPanel } from './ResearchPanel';

/** The pending two-step confirm, if any. */
type Pending =
  | { kind: 'reject'; candidate: CandidateItem }
  | { kind: 'restore'; candidate: CandidateItem }
  | { kind: 'schedule'; candidate: CandidateItem; date: string };

const SCHEDULE_CUSTOMER_VISIBLE =
  "The keyword appears on the customer's planner, and the daily 07:00 UTC run will generate an " +
  'article for it on that date.';

/**
 * The candidate pool exactly as stored — including rejected rows and why they
 * were rejected, which the customer app hides. This is the left half of the
 * daily curation loop (design §7): research → pool → schedule.
 */
export function PoolTab() {
  const { org } = useOrgDetail();
  const orgId = org.id;
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<CandidateStatus | null>(null);
  const [offset, setOffset] = useState(0);
  const [researching, setResearching] = useState(false);
  /** Id of the row whose inline date form is open. */
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const pool = useQuery({
    queryKey: ['candidates', orgId, status, offset],
    queryFn: () => fetchCandidates(orgId, status, offset),
  });

  const invalidatePool = () => queryClient.invalidateQueries({ queryKey: ['candidates', orgId] });

  const reject = useMutation({
    mutationFn: (candidate: CandidateItem) => rejectCandidate(candidate.id),
    onSuccess: invalidatePool,
  });

  const restore = useMutation({
    mutationFn: (candidate: CandidateItem) => restoreCandidate(candidate.id),
    onSuccess: invalidatePool,
  });

  const schedule = useMutation({
    mutationFn: (input: { candidate: CandidateItem; date: string }) =>
      scheduleCandidate(input.candidate.id, input.date),
    onSuccess: () => {
      setScheduling(null);
      // The row leaves the pool, lands on the planner, and bumps the header's
      // scheduled-keyword count — all three views must agree without a reload.
      invalidatePool();
      queryClient.invalidateQueries({ queryKey: ['planner', orgId] });
      queryClient.invalidateQueries({ queryKey: ['org', orgId] });
    },
  });

  const page = pool.data;
  const shown = page ? page.candidates.length : 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-neutral-400">
          Status{' '}
          <select
            value={status ?? 'all'}
            onChange={(event) => {
              const next = event.target.value;
              setStatus(next === 'all' ? null : (next as CandidateStatus));
              setOffset(0);
            }}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          >
            <option value="all">all</option>
            {CANDIDATE_STATUSES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setResearching(true)}
          className="ml-auto rounded bg-neutral-100 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-white"
        >
          Research keywords
        </button>
      </div>

      {reject.isError && (
        <p className="mt-3 text-sm text-red-400">
          {errorText(reject.error, 'Could not reject that candidate.')}
        </p>
      )}
      {restore.isError && (
        <p className="mt-3 text-sm text-red-400">
          {errorText(restore.error, 'Could not restore that candidate.')}
        </p>
      )}
      {schedule.isError && (
        <p className="mt-3 text-sm text-red-400">
          {errorText(schedule.error, 'Could not schedule that candidate.')}
        </p>
      )}

      {pool.isPending && <p className="mt-6 text-sm text-neutral-500">Loading the pool…</p>}
      {pool.isError && (
        <p className="mt-6 text-sm text-red-400">
          {errorText(pool.error, 'Could not load the candidate pool.')}
        </p>
      )}

      {page && page.candidates.length === 0 && (
        <p className="mt-6 text-sm text-neutral-400">
          {status ? `No "${status}" candidates.` : 'The pool is empty — research a seed keyword.'}
        </p>
      )}

      {page && page.candidates.length > 0 && (
        <div className="mt-4">
          <Table
            head={
              <>
                <Th>Keyword</Th>
                <Th>Status</Th>
                <Th numeric>Volume</Th>
                <Th numeric>Difficulty</Th>
                <Th numeric>CPC</Th>
                <Th numeric>Competition</Th>
                <Th numeric>Trend</Th>
                <Th>Intent</Th>
                <Th>Type</Th>
                <Th numeric>Opportunity</Th>
                <Th numeric>Relevance</Th>
                <Th>SERP</Th>
                <Th>Actions</Th>
              </>
            }
          >
            {page.candidates.map((candidate) => (
              <tr key={candidate.id}>
                <Td>
                  <div className="font-medium">{candidate.keyword}</div>
                  <div className="text-xs text-neutral-500">source: {candidate.source}</div>
                </Td>
                <Td>
                  <Badge tone={statusTone(candidate.status)}>{candidate.status}</Badge>
                  {candidate.rejection_reason && (
                    <div className="mt-1 text-xs whitespace-nowrap text-neutral-400">
                      {candidate.rejection_reason}
                    </div>
                  )}
                </Td>
                <Td numeric>{orEmpty(candidate.search_volume)}</Td>
                <Td numeric>{orEmpty(candidate.difficulty)}</Td>
                <Td numeric>{orEmpty(candidate.cpc)}</Td>
                <Td numeric>{orEmpty(candidate.competition)}</Td>
                <Td numeric>{orEmpty(candidate.trend)}</Td>
                <Td>{orEmpty(candidate.intent)}</Td>
                <Td>{orEmpty(candidate.article_type)}</Td>
                <Td numeric>{orEmpty(candidate.opportunity_score)}</Td>
                <Td numeric>{orEmpty(candidate.relevance_score)}</Td>
                <Td>
                  <SerpCell competitors={candidate.serp_competitors} />
                </Td>
                <Td>
                  {candidate.status === 'rejected' ? (
                    <button
                      type="button"
                      onClick={() => setPending({ kind: 'restore', candidate })}
                      className="rounded border border-neutral-700 px-2 py-1 text-xs whitespace-nowrap hover:bg-neutral-800"
                    >
                      Restore
                    </button>
                  ) : candidate.status !== 'candidate' ? (
                    <span className="text-xs text-neutral-600">{EMPTY}</span>
                  ) : scheduling === candidate.id ? (
                    <DateForm
                      initial={tomorrow()}
                      submitLabel="Schedule"
                      onSubmit={(date) => setPending({ kind: 'schedule', candidate, date })}
                      onCancel={() => setScheduling(null)}
                    />
                  ) : (
                    <div className="flex gap-2 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={!candidate.schedulable}
                        title={
                          candidate.schedulable
                            ? undefined
                            : 'Missing the volume/difficulty metrics scheduling requires.'
                        }
                        onClick={() => setScheduling(candidate.id)}
                        className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Schedule
                      </button>
                      <button
                        type="button"
                        onClick={() => setPending({ kind: 'reject', candidate })}
                        className="rounded border border-red-800 px-2 py-1 text-xs text-red-300 hover:bg-red-950"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>

          <div className="mt-3 flex items-center gap-3 text-sm text-neutral-400">
            <span>
              {page.offset + 1}–{page.offset + shown} of {page.total}
            </span>
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - POOL_PAGE_SIZE))}
              className="ml-auto rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page.offset + shown >= page.total}
              onClick={() => setOffset(offset + POOL_PAGE_SIZE)}
              className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {researching && <ResearchPanel orgId={orgId} onClose={() => setResearching(false)} />}

      {pending?.kind === 'reject' && (
        <ConfirmDialog
          title="Reject candidate"
          body={`"${pending.candidate.keyword}" leaves the pool and will not be scheduled.`}
          confirmLabel="Reject"
          variant="danger"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            reject.mutate(pending.candidate);
          }}
        />
      )}

      {pending?.kind === 'restore' && (
        <ConfirmDialog
          title="Restore candidate"
          body={`"${pending.candidate.keyword}" goes back into the pool as a plain candidate, where it can be scheduled again. The rejection reason stays on the record.`}
          confirmLabel="Restore"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            restore.mutate(pending.candidate);
          }}
        />
      )}

      {pending?.kind === 'schedule' && (
        <ConfirmDialog
          title="Schedule candidate"
          body={`"${pending.candidate.keyword}" is scheduled for ${pending.date}.`}
          confirmLabel={`Schedule for ${pending.date}`}
          customerVisible={SCHEDULE_CUSTOMER_VISIBLE}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            schedule.mutate({ candidate: pending.candidate, date: pending.date });
          }}
        />
      )}
    </div>
  );
}

/** Tomorrow (UTC) — the default scheduling target, since today's run has fired. */
function tomorrow(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function statusTone(status: CandidateStatus): Tone {
  if (status === 'rejected') return 'bad';
  return status === 'selected' ? 'good' : 'neutral';
}

/** SERP validation captured up to 10 competitors — kept collapsed so the row
 * stays one line, expandable when an operator is questioning a rejection. */
function SerpCell({ competitors }: { competitors: CandidateItem['serp_competitors'] }) {
  if (!competitors || competitors.length === 0) return <span>{EMPTY}</span>;

  return (
    <details>
      <summary className="cursor-pointer whitespace-nowrap text-neutral-400">
        {competitors.length} sites
      </summary>
      <ol className="mt-1 max-w-xs space-y-0.5 text-xs text-neutral-400">
        {competitors.map((competitor) => (
          <li key={`${competitor.rank}-${competitor.domain}`} title={competitor.title ?? undefined}>
            {orEmpty(competitor.rank)}. {competitor.domain}
          </li>
        ))}
      </ol>
    </details>
  );
}
