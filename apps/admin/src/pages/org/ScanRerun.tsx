import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { errorText } from '../../lib/errors';
import { type OrgDetail, rerunScan } from '../../lib/queries';

const REFUSED =
  'Refused for live orgs — a rescan would overwrite presets and knock the org out of its ' +
  'dashboard.';

const BODY =
  "The onboarding scan is queued again for this org's website. When it completes the scanner " +
  'overwrites the presets with what it finds and moves setup to "setup_scan_completed", so any ' +
  'preset edits made since the last scan are lost.';

const CUSTOMER_VISIBLE =
  'The customer sees onboarding move forward, and their presets are replaced by the scan result.';

/**
 * The stuck-onboarding lever (design §7). The API hard-409s a `setup_complete`
 * org because the worker's `completeScan` overwrites presets *and* resets the
 * status — mirrored here as a disabled control with the reason, rather than
 * leaving the operator to find out by clicking.
 */
export function ScanRerun({
  orgId,
  setupStatus,
}: {
  orgId: string;
  setupStatus: OrgDetail['org']['setup_status'];
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const scan = useMutation({
    mutationFn: () => rerunScan(orgId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org', orgId] }),
  });

  const live = setupStatus === 'setup_complete';

  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={live || scan.isPending}
        title={live ? REFUSED : undefined}
        onClick={() => setConfirming(true)}
        className="rounded border border-red-800 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {scan.isPending ? 'Queueing…' : 'Re-run scan'}
      </button>
      {live && <p className="mt-2 text-xs text-neutral-500">{REFUSED}</p>}

      {scan.isError && (
        <p className="mt-2 text-sm text-red-400">
          {errorText(scan.error, 'Could not queue the scan.')}
        </p>
      )}
      {scan.isSuccess && (
        <p className="mt-2 text-sm text-emerald-400">Scan queued — reload in a minute.</p>
      )}

      {confirming && (
        <ConfirmDialog
          title="Re-run the onboarding scan"
          body={BODY}
          confirmLabel="Re-run scan"
          variant="danger"
          customerVisible={CUSTOMER_VISIBLE}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            scan.mutate();
          }}
        />
      )}
    </div>
  );
}
