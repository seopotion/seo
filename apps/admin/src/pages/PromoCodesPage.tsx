import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, type ReactNode, useState } from 'react';
import { Badge } from '../components/Badge';
import { Table, Td, Th } from '../components/Table';
import { errorText } from '../lib/errors';
import { EMPTY, formatDateTime } from '../lib/format';
import {
  createPromoCode,
  deactivatePromoCode,
  fetchPromoCodes,
  fetchPromoRedemptions,
  type PromoCode,
  type PromoCodeInput,
} from '../lib/queries';

/** "30% off for 3 months" / "100% off forever" / "30% off the first payment". */
function discountLabel(p: PromoCode): string {
  if (p.duration === 'forever') return `${p.percent}% off forever`;
  if (p.duration === 'repeating') return `${p.percent}% off for ${p.duration_in_months} months`;
  return `${p.percent}% off the first payment`;
}

const emptyForm = {
  code: '',
  name: '',
  percent: '30',
  duration: 'repeating' as PromoCodeInput['duration'],
  duration_in_months: '3',
  max_redemptions: '',
  expires_at: '',
  affiliate: '',
};

type FormState = typeof emptyForm;

/**
 * Promo code administration (design spec 2026-08-29): mint codes, watch
 * confirmed redemptions per code, and kill one off. Not org-scoped — codes
 * apply across every org's checkout, so this lives at the top level rather
 * than inside a workspace.
 */
export function PromoCodesPage() {
  const queryClient = useQueryClient();
  const codes = useQuery({ queryKey: ['promo-codes'], queryFn: fetchPromoCodes });
  const [form, setForm] = useState<FormState>(emptyForm);
  const [expanded, setExpanded] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['promo-codes'] });

  const create = useMutation({
    mutationFn: () =>
      createPromoCode({
        code: form.code.trim() === '' ? undefined : form.code.trim().toUpperCase(),
        name: form.name.trim(),
        percent: Number(form.percent),
        duration: form.duration,
        duration_in_months:
          form.duration === 'repeating' ? Number(form.duration_in_months) : undefined,
        max_redemptions:
          form.max_redemptions.trim() === '' ? undefined : Number(form.max_redemptions),
        expires_at: form.expires_at === '' ? undefined : new Date(form.expires_at).toISOString(),
        affiliate: form.affiliate.trim() === '' ? undefined : form.affiliate.trim(),
      }),
    onSuccess: () => {
      setForm(emptyForm);
      void invalidate();
    },
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => deactivatePromoCode(id),
    onSuccess: () => void invalidate(),
  });

  const set = (key: keyof FormState) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <h1 className="text-xl font-semibold">Promo codes</h1>

      <form
        className="space-y-3 rounded border border-neutral-800 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Code (blank = generated)">
            <input
              className={inputCls}
              value={form.code}
              onChange={(event) => set('code')(event.target.value)}
              placeholder="LAUNCH30"
            />
          </Field>
          <Field label="Name">
            <input
              className={inputCls}
              required
              value={form.name}
              onChange={(event) => set('name')(event.target.value)}
              placeholder="Launch promo"
            />
          </Field>
          <Field label="Percent off">
            <input
              className={inputCls}
              required
              type="number"
              min={1}
              max={100}
              value={form.percent}
              onChange={(event) => set('percent')(event.target.value)}
            />
          </Field>
          <Field label="Duration">
            <select
              className={inputCls}
              value={form.duration}
              onChange={(event) => set('duration')(event.target.value)}
            >
              <option value="once">once (first payment)</option>
              <option value="repeating">repeating (months)</option>
              <option value="forever">forever</option>
            </select>
          </Field>
          {form.duration === 'repeating' ? (
            <Field label="Months">
              <input
                className={inputCls}
                required
                type="number"
                min={1}
                value={form.duration_in_months}
                onChange={(event) => set('duration_in_months')(event.target.value)}
              />
            </Field>
          ) : null}
          <Field label="Max redemptions (blank = unlimited)">
            <input
              className={inputCls}
              type="number"
              min={1}
              value={form.max_redemptions}
              onChange={(event) => set('max_redemptions')(event.target.value)}
            />
          </Field>
          <Field label="Expires at (blank = never)">
            <input
              className={inputCls}
              type="date"
              value={form.expires_at}
              onChange={(event) => set('expires_at')(event.target.value)}
            />
          </Field>
          <Field label="Affiliate (attribution label)">
            <input
              className={inputCls}
              value={form.affiliate}
              onChange={(event) => set('affiliate')(event.target.value)}
              placeholder="jane"
            />
          </Field>
        </div>
        <p className="text-xs text-neutral-500">
          Heads-up: “repeating” counts months against billing cycles — a 3-month code applied at a
          yearly checkout discounts the entire first yearly payment.
        </p>
        {create.isError && (
          <p className="text-sm text-red-400">
            {errorText(create.error, 'Could not create that code.')}
          </p>
        )}
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {create.isPending ? 'Creating…' : 'Create code'}
        </button>
      </form>

      {deactivate.isError && (
        <p className="text-sm text-red-400">
          {errorText(deactivate.error, 'Could not deactivate that code.')}
        </p>
      )}

      {codes.isPending && <p className="text-sm text-neutral-500">Loading…</p>}
      {codes.isError && (
        <p className="text-sm text-red-400">
          {errorText(codes.error, 'Could not load promo codes.')}
        </p>
      )}

      {codes.data && codes.data.promo_codes.length === 0 && (
        <p className="text-sm text-neutral-400">No promo codes yet.</p>
      )}

      {codes.data && codes.data.promo_codes.length > 0 && (
        <Table
          head={
            <>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Discount</Th>
              <Th>Affiliate</Th>
              <Th numeric>Redemptions</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </>
          }
        >
          {codes.data.promo_codes.map((p) => (
            <Fragment key={p.id}>
              <tr>
                <Td>
                  <span className="font-mono">{p.code}</span>
                </Td>
                <Td>{p.name}</Td>
                <Td>{discountLabel(p)}</Td>
                <Td>{p.affiliate ?? EMPTY}</Td>
                <Td numeric>
                  <button
                    type="button"
                    className="underline decoration-neutral-600 underline-offset-2"
                    onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                  >
                    {p.confirmed_redemptions}
                    {p.max_redemptions !== null ? ` / ${p.max_redemptions}` : ''}
                  </button>
                </Td>
                <Td>
                  <Badge tone={p.active ? 'good' : 'neutral'}>
                    {p.active ? 'active' : 'inactive'}
                  </Badge>
                </Td>
                <Td>
                  {p.active ? (
                    <button
                      type="button"
                      disabled={deactivate.isPending}
                      onClick={() => {
                        if (window.confirm(`Deactivate ${p.code}? This cannot be undone.`)) {
                          deactivate.mutate(p.id);
                        }
                      }}
                      className="rounded border border-red-800 px-2 py-1 text-xs text-red-300 hover:bg-red-950 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Deactivate
                    </button>
                  ) : (
                    <span className="text-xs text-neutral-600">{EMPTY}</span>
                  )}
                </Td>
              </tr>
              {expanded === p.id && (
                <tr>
                  <td colSpan={7} className="bg-neutral-900/50 px-3 py-2">
                    <Redemptions promoCodeId={p.id} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </Table>
      )}
    </div>
  );
}

/** The affiliate attribution report for one code, opened inline under its row. */
function Redemptions({ promoCodeId }: { promoCodeId: string }) {
  const redemptions = useQuery({
    queryKey: ['promo-codes', promoCodeId, 'redemptions'],
    queryFn: () => fetchPromoRedemptions(promoCodeId),
  });

  if (redemptions.isPending) return <p className="text-sm text-neutral-400">Loading…</p>;
  if (redemptions.isError) {
    return (
      <p className="text-sm text-red-400">
        {errorText(redemptions.error, 'Could not load redemptions.')}
      </p>
    );
  }
  if (redemptions.data.redemptions.length === 0) {
    return <p className="text-sm text-neutral-400">No redemptions yet.</p>;
  }

  return (
    <ul className="space-y-1 text-xs text-neutral-300">
      {redemptions.data.redemptions.map((r) => (
        <li key={r.id}>
          org <span className="font-mono">{r.org_id}</span> — {r.status}
          {r.confirmed_at ? ` at ${formatDateTime(r.confirmed_at)}` : ''}
        </li>
      ))}
    </ul>
  );
}

const inputCls =
  'w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: control is the generic `children` — the label wraps it, same association pattern as the inline labels elsewhere in this app.
    <label className="block text-xs text-neutral-400">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
