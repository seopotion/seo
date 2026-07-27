import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Badge } from '../components/Badge';
import { errorText } from '../lib/errors';
import { searchOrgs } from '../lib/queries';
import { planTone, setupTone, strategyTone } from '../lib/status';

/**
 * The screen every operator workflow starts from (design §2: search → org
 * workspace → act). The query lives in the URL so coming back from a workspace
 * restores the results instead of an empty box.
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [draft, setDraft] = useState(query);

  const results = useQuery({
    queryKey: ['orgs', query],
    queryFn: () => searchOrgs(query),
    enabled: query !== '',
  });

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold">Find an organization</h1>

      <form
        className="mt-6 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const next = draft.trim();
          setParams(next ? { q: next } : {});
        }}
      >
        <input
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Org id, owner email, or website URL"
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-4 py-2"
        />
        <button
          type="submit"
          className="rounded bg-neutral-100 px-4 py-2 font-semibold text-neutral-900 hover:bg-white"
        >
          Search
        </button>
      </form>

      {query === '' && (
        <p className="mt-6 text-sm text-neutral-500">
          Search by org id, owner email, or a piece of the website URL.
        </p>
      )}

      {query !== '' && results.isPending && (
        <p className="mt-6 text-sm text-neutral-500">Searching…</p>
      )}

      {results.isError && (
        <p className="mt-6 text-sm text-red-400">{errorText(results.error, 'Search failed.')}</p>
      )}

      {results.data?.orgs.length === 0 && (
        <p className="mt-6 text-sm text-neutral-400">No orgs match “{query}”.</p>
      )}

      <ul className="mt-6 space-y-2">
        {results.data?.orgs.map((org) => (
          <li key={org.id}>
            <Link
              to={`/orgs/${org.id}`}
              className="block rounded border border-neutral-800 bg-neutral-900 px-4 py-3 hover:border-neutral-600"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{org.website_url}</span>
                {org.name && <span className="text-sm text-neutral-400">{org.name}</span>}
                <span className="ml-auto flex flex-wrap gap-2">
                  <Badge tone={planTone(org.plan)}>{org.plan}</Badge>
                  <Badge tone={setupTone(org.setup_status)}>{org.setup_status}</Badge>
                  <Badge tone={strategyTone(org.strategy_status)}>
                    strategy: {org.strategy_status}
                  </Badge>
                </span>
              </div>
              <p className="mt-1 font-mono text-xs text-neutral-500">{org.id}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
