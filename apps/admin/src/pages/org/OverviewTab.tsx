import type { ReactNode } from 'react';
import { EMPTY, formatDateTime, orEmpty } from '../../lib/format';
import type { OrgDetail } from '../../lib/queries';
import { useOrgDetail } from '../OrgWorkspace';
import { SetPlan } from './SetPlan';

/**
 * The org exactly as the system sees it (design §2, "diagnose"), rendered from
 * the detail DTO the workspace already loaded — no extra requests. Every
 * optional field degrades to `EMPTY` rather than crashing a half-onboarded org.
 */
export function OverviewTab() {
  const { org, owner, subscriptions, gsc } = useOrgDetail();
  const presets = org.presets;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Section title="Status">
        <Row label="Setup">{org.setup_status}</Row>
        <Row label="Strategy">{org.strategy_status}</Row>
        <Row label="Created">{formatDateTime(org.created_at)}</Row>
        <Row label="Owner">{owner ? orEmpty(owner.email) : EMPTY}</Row>
        <Row label="Owner name">{orEmpty(owner?.name)}</Row>
      </Section>

      <Section title="Plan">
        <Row label="Current">{org.plan}</Row>
        <SetPlan orgId={org.id} plan={org.plan} />
      </Section>

      <Section title="Subscription">
        {!subscriptions.latest && subscriptions.active.length === 0 ? (
          <p className="text-neutral-400">none (comped or free)</p>
        ) : (
          <>
            <Row label="Latest">
              {subscriptions.latest ? describeSubscription(subscriptions.latest) : EMPTY}
            </Row>
            <Row label="Active">
              {subscriptions.active.length === 0
                ? EMPTY
                : subscriptions.active.map((sub) => (
                    <div key={sub.id}>{describeSubscription(sub)}</div>
                  ))}
            </Row>
          </>
        )}
      </Section>

      <Section title="Domain rating">
        <Row label="Value">{orEmpty(org.domain_rating?.value)}</Row>
        <Row label="Checked">{formatDateTime(org.domain_rating?.checked_at)}</Row>
      </Section>

      <Section title="Onboarding">
        <Row label="Referral source">{orEmpty(org.onboarding?.referral_source)}</Row>
        <Row label="Integrations">{orEmpty(org.onboarding?.integrations?.join(', '))}</Row>
      </Section>

      <Section title="Connections">
        <Row label="Google Search Console">
          {gsc ? (gsc.connected ? 'connected' : 'not connected') : 'not connected'}
        </Row>
        <Row label="Google account">{orEmpty(gsc?.google_email)}</Row>
        <Row label="Site URL">{orEmpty(gsc?.site_url)}</Row>
        <Row label="Connected at">{formatDateTime(gsc?.connected_at)}</Row>
        <Row label="Refresh failing since">{formatDateTime(gsc?.last_refresh_failed_at)}</Row>
        <Row label="WordPress">{org.wordpress.connected ? 'connected' : 'not connected'}</Row>
        <Row label="WordPress since">{formatDateTime(org.wordpress.connected_at)}</Row>
      </Section>

      <Section title="Presets">
        {presets ? (
          <>
            <Row label="Business">{orEmpty(presets.business.name)}</Row>
            <Row label="Description">{orEmpty(presets.business.description)}</Row>
            <Row label="Language / country">
              {orEmpty(presets.business.language)} / {orEmpty(presets.business.country)}
            </Row>
            <Row label="Audience">{orEmpty(presets.audience.target.join(', '))}</Row>
            <Row label="Competitors">{presets.audience.competitors.length}</Row>
            <Row label="Best articles">{presets.blog.best_articles.length}</Row>
            <Row label="Auto-publish">
              {presets.article_preferences.publishing.auto_publish ? 'on' : 'off'}
            </Row>
          </>
        ) : (
          <p className="text-neutral-400">none yet — the scan has not produced presets</p>
        )}
        <p className="mt-3 text-xs text-neutral-500">
          Read-only here; the presets editor lands in a later subtask.
        </p>
      </Section>
    </div>
  );
}

function describeSubscription(sub: OrgDetail['subscriptions']['active'][number]): string {
  return `${sub.provider} · ${sub.tier} · ${sub.status} · ends ${formatDateTime(sub.current_period_end)}`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded border border-neutral-800 bg-neutral-900 p-5 text-sm">
      <h2 className="text-xs font-semibold tracking-wider text-neutral-500 uppercase">{title}</h2>
      <dl className="mt-3 space-y-1.5">{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-44 shrink-0 text-neutral-500">{label}</dt>
      <dd className="min-w-0 break-words">{children ?? EMPTY}</dd>
    </div>
  );
}
