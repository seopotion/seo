import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Table, Td, Th } from '../../components/Table';
import { errorText } from '../../lib/errors';
import { orEmpty } from '../../lib/format';
import { addCandidates, type KeywordMetric, researchKeywords } from '../../lib/queries';

const CUSTOMER_VISIBLE =
  "Added keywords show up in the customer's keyword pool, where they can be scheduled.";

/**
 * Operator curation, the manual half of design §7: run a seed through
 * DataForSEO, pick the keywords worth writing about, push them into the pool.
 * Added rows are stored with source `manual` — the audit log holds the rest of
 * the provenance.
 */
export function ResearchPanel({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [seed, setSeed] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  // Escape closes the panel — but not while the confirm is up, or one keypress
  // would dismiss both and throw away the results.
  useEffect(() => {
    if (confirming) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirming, onClose]);

  const research = useMutation({
    mutationFn: (value: string) => researchKeywords(orgId, value),
    onSuccess: () => setSelected([]),
  });

  const add = useMutation({
    mutationFn: (keywords: KeywordMetric[]) => addCandidates(orgId, keywords),
    onSuccess: () => {
      setSelected([]);
      queryClient.invalidateQueries({ queryKey: ['candidates', orgId] });
    },
  });

  // The seed itself is a result too, and can repeat inside `similar` — one row
  // per keyword, seed first.
  const rows = research.data
    ? [
        ...new Map(
          [research.data.seed, ...research.data.similar].map((m) => [m.keyword, m]),
        ).values(),
      ]
    : [];

  const toggle = (keyword: string) =>
    setSelected((current) =>
      current.includes(keyword)
        ? current.filter((item) => item !== keyword)
        : [...current, keyword],
    );

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/70 p-4">
      <div className="my-8 w-full max-w-5xl rounded border border-neutral-700 bg-neutral-900 p-5 shadow-xl">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Research keywords</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
          >
            Close
          </button>
        </div>

        <form
          className="mt-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = seed.trim();
            if (value) research.mutate(value);
          }}
        >
          <input
            type="search"
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
            placeholder="Seed keyword"
            maxLength={200}
            className="w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={research.isPending || seed.trim() === ''}
            className="rounded bg-neutral-100 px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {research.isPending ? 'Researching…' : 'Research'}
          </button>
        </form>

        {research.isError && (
          <p className="mt-3 text-sm text-red-400">
            {errorText(research.error, 'The research provider failed — try again.')}
          </p>
        )}
        {add.isError && (
          <p className="mt-3 text-sm text-red-400">
            {errorText(add.error, 'Could not add those keywords.')}
          </p>
        )}
        {add.isSuccess && (
          <p className="mt-3 text-sm text-emerald-400">
            Added {add.data.added} to the pool
            {add.data.skipped > 0 && ` · ${add.data.skipped} already there`}.
          </p>
        )}

        {rows.length > 0 && (
          <>
            <div className="mt-4">
              <Table
                head={
                  <>
                    <Th> </Th>
                    <Th>Keyword</Th>
                    <Th numeric>Volume</Th>
                    <Th numeric>Difficulty</Th>
                    <Th numeric>CPC</Th>
                    <Th numeric>Competition</Th>
                    <Th numeric>Trend</Th>
                    <Th>Intent</Th>
                  </>
                }
              >
                {rows.map((row) => (
                  <tr key={row.keyword}>
                    <Td>
                      <input
                        type="checkbox"
                        checked={selected.includes(row.keyword)}
                        onChange={() => toggle(row.keyword)}
                        aria-label={`Select ${row.keyword}`}
                      />
                    </Td>
                    <Td>{row.keyword}</Td>
                    <Td numeric>{orEmpty(row.search_volume)}</Td>
                    <Td numeric>{orEmpty(row.difficulty)}</Td>
                    <Td numeric>{orEmpty(row.cpc)}</Td>
                    <Td numeric>{orEmpty(row.competition)}</Td>
                    <Td numeric>{orEmpty(row.trend)}</Td>
                    <Td>{orEmpty(row.intent)}</Td>
                  </tr>
                ))}
              </Table>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <span className="text-sm text-neutral-400">{selected.length} selected</span>
              <button
                type="button"
                disabled={selected.length === 0 || add.isPending}
                onClick={() => setConfirming(true)}
                className="ml-auto rounded bg-neutral-100 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {add.isPending ? 'Adding…' : 'Add selected to pool'}
              </button>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              Keywords already in the pool are skipped, not duplicated.
            </p>
          </>
        )}

        {confirming && (
          <ConfirmDialog
            title="Add to candidate pool"
            body={`${selected.length} keyword${selected.length === 1 ? '' : 's'} join this org's pool.`}
            confirmLabel="Add to pool"
            customerVisible={CUSTOMER_VISIBLE}
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              add.mutate(rows.filter((row) => selected.includes(row.keyword)));
            }}
          />
        )}
      </div>
    </div>
  );
}
