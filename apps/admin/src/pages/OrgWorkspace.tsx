import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router';
import { Badge } from '../components/Badge';
import { ApiError } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { fetchOrg, type OrgDetail } from '../lib/queries';
import { planTone, setupTone, strategyTone } from '../lib/status';

const TABS = [
  { to: '', label: 'Overview', end: true },
  { to: 'pool', label: 'Pool', end: false },
  { to: 'planner', label: 'Planner', end: false },
  { to: 'articles', label: 'Articles', end: false },
  { to: 'audit', label: 'Audit', end: false },
];

/**
 * The org workspace: one `GET /orgs/{id}` feeds the always-visible header and
 * every tab below it, handed down through the router outlet so a tab never
 * refetches what the shell already has.
 */
export function OrgWorkspace() {
  const { orgId = '' } = useParams();
  const org = useQuery({ queryKey: ['org', orgId], queryFn: () => fetchOrg(orgId) });

  if (org.isPending) return <p className="text-sm text-neutral-500">Loading org…</p>;

  if (org.isError) {
    const notFound = org.error instanceof ApiError && org.error.status === 404;
    return (
      <div>
        <p className="text-sm text-red-400">
          {notFound ? 'Org not found.' : errorText(org.error, 'Could not load this org.')}
        </p>
        <Link to="/" className="mt-3 inline-block text-sm text-neutral-400 underline">
          Back to search
        </Link>
      </div>
    );
  }

  return (
    <div>
      <OrgHeader detail={org.data} />

      <nav className="mt-6 flex gap-1 border-b border-neutral-800">
        {TABS.map((tab) => (
          <NavLink
            key={tab.label}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `-mb-px border-b-2 px-4 py-2 text-sm ${
                isActive
                  ? 'border-neutral-100 font-medium text-neutral-100'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="py-6">
        <Outlet context={org.data} />
      </div>
    </div>
  );
}

/** The org detail the workspace already loaded — for use inside a tab route. */
export function useOrgDetail(): OrgDetail {
  return useOutletContext<OrgDetail>();
}

function OrgHeader({ detail }: { detail: OrgDetail }) {
  const { org, owner, gsc, counts } = detail;

  return (
    <header className="rounded border border-neutral-800 bg-neutral-900 px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <a
          href={org.website_url}
          target="_blank"
          rel="noreferrer"
          className="text-xl font-semibold underline decoration-neutral-600 underline-offset-4"
        >
          {org.website_url}
        </a>
        {org.name && <span className="text-neutral-300">{org.name}</span>}
        {owner && <span className="text-sm text-neutral-400">{owner.email}</span>}
        <span className="font-mono text-xs text-neutral-600">{org.id}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone={planTone(org.plan)}>plan: {org.plan}</Badge>
        <Badge tone={setupTone(org.setup_status)}>{org.setup_status}</Badge>
        <Badge tone={strategyTone(org.strategy_status)}>strategy: {org.strategy_status}</Badge>
        {gscBadge(gsc)}
        <Badge tone={org.wordpress.connected ? 'good' : 'neutral'}>
          WordPress: {org.wordpress.connected ? 'connected' : 'not connected'}
        </Badge>
      </div>

      <p className="mt-3 text-sm text-neutral-400">
        {counts.scheduled_keywords} scheduled keywords · {counts.articles_generated} generated ·{' '}
        {counts.articles_published} published
      </p>
    </header>
  );
}

/** A GSC connection that once worked can be broken by a refresh failure — that
 * distinction is the whole point of the badge (design §6). */
function gscBadge(gsc: OrgDetail['gsc']) {
  if (!gsc) return <Badge>GSC: not connected</Badge>;
  if (gsc.last_refresh_failed_at) {
    return <Badge tone="bad">GSC: broken since {formatDateTime(gsc.last_refresh_failed_at)}</Badge>;
  }
  return (
    <Badge tone={gsc.connected ? 'good' : 'neutral'}>
      GSC: {gsc.connected ? 'connected' : 'not connected'}
    </Badge>
  );
}
