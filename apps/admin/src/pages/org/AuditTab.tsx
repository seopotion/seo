import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Table, Td, Th } from '../../components/Table';
import { errorText } from '../../lib/errors';
import { EMPTY, formatDateTime } from '../../lib/format';
import { AUDIT_PAGE_SIZE, type AuditAction, fetchAudit } from '../../lib/queries';
import { useOrgDetail } from '../OrgWorkspace';

/**
 * Every operator action taken on this org, newest first — the append-only log
 * from design §5. Strictly read-only by design: an audit trail an operator can
 * edit answers nothing. `before` is the pre-mutation snapshot, which is what
 * makes a manual revert a copy-paste rather than an investigation.
 */
export function AuditTab() {
  const { org } = useOrgDetail();
  const orgId = org.id;

  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const audit = useQuery({
    queryKey: ['audit', orgId, offset],
    queryFn: () => fetchAudit(orgId, offset),
  });

  const page = audit.data;
  const shown = page ? page.actions.length : 0;

  return (
    <div>
      {audit.isPending && <p className="text-sm text-neutral-500">Loading the audit trail…</p>}
      {audit.isError && (
        <p className="text-sm text-red-400">
          {errorText(audit.error, 'Could not load the audit trail.')}
        </p>
      )}

      {page && page.actions.length === 0 && (
        <p className="text-sm text-neutral-400">No admin actions recorded for this org.</p>
      )}

      {page && page.actions.length > 0 && (
        <div>
          <Table
            head={
              <>
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>Details</Th>
              </>
            }
          >
            {page.actions.map((action) => (
              <ActionRows
                key={action.id}
                action={action}
                expanded={expanded === action.id}
                onToggle={() => setExpanded(expanded === action.id ? null : action.id)}
              />
            ))}
          </Table>

          <div className="mt-3 flex items-center gap-3 text-sm text-neutral-400">
            <span>
              {offset + 1}–{offset + shown} of {page.total}
            </span>
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - AUDIT_PAGE_SIZE))}
              className="ml-auto rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={offset + shown >= page.total}
              onClick={() => setOffset(offset + AUDIT_PAGE_SIZE)}
              className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The row itself plus, when open, the snapshot row underneath it. */
function ActionRows({
  action,
  expanded,
  onToggle,
}: {
  action: AuditAction;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="hover:bg-neutral-900">
        <Td>
          <span className="whitespace-nowrap">{formatDateTime(action.at)}</span>
        </Td>
        <Td>{action.actor}</Td>
        <Td>
          <span className="font-mono text-xs">{action.action}</span>
        </Td>
        <Td>
          {action.entity ? (
            <span className="whitespace-nowrap">
              {action.entity.type}{' '}
              <span className="font-mono text-xs text-neutral-500" title={action.entity.id}>
                …{action.entity.id.slice(-6)}
              </span>
            </span>
          ) : (
            EMPTY
          )}
        </Td>
        <Td>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="rounded border border-neutral-700 px-2 py-1 text-xs whitespace-nowrap hover:bg-neutral-800"
          >
            {expanded ? 'Hide' : 'Show'} payload / before
          </button>
        </Td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} className="px-3 py-3">
            <div className="grid gap-4 md:grid-cols-2">
              <Snapshot title="Payload (the request)" value={action.payload} />
              <Snapshot title="Before (pre-mutation snapshot)" value={action.before} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Snapshot({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-wider text-neutral-500 uppercase">{title}</h3>
      <pre className="mt-1 max-h-96 overflow-auto rounded border border-neutral-800 bg-neutral-950 p-3 text-xs whitespace-pre-wrap text-neutral-300">
        {value === null || value === undefined ? EMPTY : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
