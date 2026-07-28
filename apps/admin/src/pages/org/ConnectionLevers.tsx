import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { errorText } from '../../lib/errors';
import { connectWordPress, disconnectGsc, disconnectWordPress } from '../../lib/queries';

const CONNECT_BODY =
  "The plugin key is verified against the customer's site before anything is stored — a bad key " +
  'changes nothing. On success we can publish for this org without them touching WordPress.';

const CONNECT_CUSTOMER_VISIBLE =
  'Nothing changes for the customer until an operator publishes an article to their site.';

const WORDPRESS_DISCONNECT_BODY =
  'The stored plugin key is deleted. Operators can no longer publish for this org until it is ' +
  'reconnected — already published posts stay on the site.';

const GSC_DISCONNECT_BODY =
  'Nothing can repair a broken Search Console consent server-side: the OAuth grant is the ' +
  "customer's, so disconnecting is what forces them to reconnect cleanly. The stored connection " +
  'and its refresh token are deleted.';

const GSC_CUSTOMER_VISIBLE =
  'The customer will see Search Console as disconnected and must re-consent.';

type Pending = { kind: 'connect'; token: string } | { kind: 'wordpress' } | { kind: 'gsc' };

/**
 * Connection surgery (design §6): connect WordPress on behalf for wizard-of-oz
 * engagements where we hold the customer's plugin key, and disconnect either
 * integration. Both disconnects mirror the API's own 409 as a disabled control.
 */
export function ConnectionLevers({
  orgId,
  wordpressConnected,
  gscConnected,
}: {
  orgId: string;
  wordpressConnected: boolean;
  gscConnected: boolean;
}) {
  const queryClient = useQueryClient();
  // Never seeded from the server and cleared on success: the stored key is
  // redacted out of the org detail and is never echoed back into this field.
  const [token, setToken] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);

  // The badges in the header and the rows above both read the org detail.
  const invalidateOrg = () => queryClient.invalidateQueries({ queryKey: ['org', orgId] });

  const connect = useMutation({
    mutationFn: (pluginToken: string) => connectWordPress(orgId, pluginToken),
    onSuccess: () => {
      setToken('');
      invalidateOrg();
    },
  });

  const disconnectWp = useMutation({
    mutationFn: () => disconnectWordPress(orgId),
    onSuccess: invalidateOrg,
  });

  const disconnectSearchConsole = useMutation({
    mutationFn: () => disconnectGsc(orgId),
    onSuccess: invalidateOrg,
  });

  return (
    <div className="mt-4 space-y-4">
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          setPending({ kind: 'connect', token });
        }}
      >
        <label className="block">
          <span className="text-xs font-medium text-neutral-400">
            WordPress plugin key {wordpressConnected && '(replaces the stored one)'}
          </span>
          <input
            type="password"
            required
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="paste the customer's key"
            className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
          />
        </label>
        <button
          type="submit"
          disabled={token.trim() === '' || connect.isPending}
          className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {connect.isPending ? 'Verifying…' : wordpressConnected ? 'Reconnect' : 'Connect'}
        </button>
        {connect.isError && (
          <p className="text-sm text-red-400">
            {errorText(connect.error, 'Could not connect WordPress.')}
          </p>
        )}
        {connect.isSuccess && <p className="text-sm text-emerald-400">WordPress connected.</p>}
      </form>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!wordpressConnected || disconnectWp.isPending}
          title={wordpressConnected ? undefined : 'Nothing to disconnect.'}
          onClick={() => setPending({ kind: 'wordpress' })}
          className={DANGER}
        >
          Disconnect WordPress
        </button>
        <button
          type="button"
          disabled={!gscConnected || disconnectSearchConsole.isPending}
          title={gscConnected ? undefined : 'Nothing to disconnect.'}
          onClick={() => setPending({ kind: 'gsc' })}
          className={DANGER}
        >
          Disconnect Search Console
        </button>
      </div>

      {disconnectWp.isError && (
        <p className="text-sm text-red-400">
          {errorText(disconnectWp.error, 'Could not disconnect WordPress.')}
        </p>
      )}
      {disconnectSearchConsole.isError && (
        <p className="text-sm text-red-400">
          {errorText(disconnectSearchConsole.error, 'Could not disconnect Search Console.')}
        </p>
      )}

      {pending?.kind === 'connect' && (
        <ConfirmDialog
          title="Connect WordPress on behalf"
          body={
            wordpressConnected
              ? `${CONNECT_BODY} The key currently stored for this org is replaced.`
              : CONNECT_BODY
          }
          confirmLabel="Verify and connect"
          customerVisible={CONNECT_CUSTOMER_VISIBLE}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const { token: pluginToken } = pending;
            setPending(null);
            connect.mutate(pluginToken);
          }}
        />
      )}

      {pending?.kind === 'wordpress' && (
        <ConfirmDialog
          title="Disconnect WordPress"
          body={WORDPRESS_DISCONNECT_BODY}
          confirmLabel="Disconnect"
          variant="danger"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            disconnectWp.mutate();
          }}
        />
      )}

      {pending?.kind === 'gsc' && (
        <ConfirmDialog
          title="Disconnect Search Console"
          body={GSC_DISCONNECT_BODY}
          confirmLabel="Disconnect"
          variant="danger"
          customerVisible={GSC_CUSTOMER_VISIBLE}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            disconnectSearchConsole.mutate();
          }}
        />
      )}
    </div>
  );
}

const DANGER =
  'rounded border border-red-800 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950 disabled:cursor-not-allowed disabled:opacity-40';
