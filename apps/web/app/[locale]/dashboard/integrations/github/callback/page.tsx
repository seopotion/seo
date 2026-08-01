'use client';

import { DEFAULT_CONTENT_PATH } from '@shared/schemas';
import { useSearchParams } from 'next/navigation';
import { hasLocale, useLocale, useTranslations } from 'next-intl';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Badge, Button, Input, Label } from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { api } from '@/lib/api';
import { clearToken, getToken } from '@/lib/auth';
import { GITHUB_RETURN_LOCALE_KEY, type GithubRepoSummary } from '@/lib/integrations';
import { cn } from '@/lib/utils';

type RedeemErrorKey = 'cancelled' | 'expired' | 'installationGone' | 'redeemFailed';
type ConnectErrorKey = 'claimed' | 'connectFailed' | 'noAccess' | 'noWriteAccess';

const SETTINGS_HREF = '/settings?tab=integrations';

/**
 * GitHub App install callback (#7, design/github-app.md § The install flow).
 * GitHub's Setup URL is a single unprefixed path, so it always lands on the
 * default locale; the Settings panel stashed the user's own locale before the
 * hand-off and we restore it on the way back — the GSC callback's trick.
 *
 * Steps 4 and 5 of the flow live here: redeem `?installation_id&state` for the
 * repositories the user just granted, then let them pick which repo, branch and
 * folder we commit into. Nothing is stored until they confirm.
 */
function CallbackInner() {
  const t = useTranslations('GithubCallback');
  const router = useRouter();
  const currentLocale = useLocale();
  const params = useSearchParams();
  const [repos, setRepos] = useState<GithubRepoSummary[] | null>(null);
  const [grant, setGrant] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [repo, setRepo] = useState<string | null>(null);
  const [branch, setBranch] = useState('');
  const [contentPath, setContentPath] = useState(DEFAULT_CONTENT_PATH);
  const [redeemErrorKey, setRedeemErrorKey] = useState<RedeemErrorKey | null>(null);
  const [connectErrorKey, setConnectErrorKey] = useState<ConnectErrorKey | null>(null);
  const [saving, setSaving] = useState(false);
  // Strict Mode runs effects twice; redeeming twice would burn the state's TTL
  // on a request whose answer we already have.
  const redeemed = useRef(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    // `setup_action=request` means the installation is waiting on an org owner's
    // approval — there is no installation id yet, and this is not an error.
    if (params.get('setup_action') === 'request') {
      setPendingApproval(true);
      return;
    }
    const installationId = Number(params.get('installation_id'));
    const state = params.get('state');
    if (!installationId || !state) {
      setRedeemErrorKey('cancelled');
      return;
    }
    if (redeemed.current) return;
    redeemed.current = true;
    void (async () => {
      const res = await api.api.v0.dashboard.integrations.github.installation.$post({
        json: { installation_id: installationId, state },
      });
      if ((res.status as number) === 401) {
        clearToken();
        router.replace('/');
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        const code = 'code' in data ? data.code : undefined;
        setRedeemErrorKey(
          code === 'invalid_state' || code === 'stale_installation'
            ? 'expired'
            : code === 'installation_not_found' || code === 'installation_suspended'
              ? 'installationGone'
              : 'redeemFailed',
        );
        return;
      }
      if (!('repos' in data)) {
        setRedeemErrorKey('redeemFailed');
        return;
      }
      setRepos(data.repos);
      setGrant(data.grant);
      // One repo is the common case — preselect it so the whole screen is a
      // single confirm.
      const only = data.repos.length === 1 ? data.repos[0] : undefined;
      if (only) {
        setRepo(only.full_name);
        setBranch(only.default_branch);
      }
    })();
  }, [params, router]);

  function selectRepo(selected: GithubRepoSummary) {
    setRepo(selected.full_name);
    // The branch is free text (we never list branches), so seed it from the
    // repo's default and let them override.
    setBranch(selected.default_branch);
    setConnectErrorKey(null);
  }

  async function confirm() {
    if (!grant || !repo || !branch.trim() || !contentPath.trim() || saving) return;
    setSaving(true);
    setConnectErrorKey(null);

    const res = await api.api.v0.dashboard.integrations['static-site'].$post({
      json: { grant, repo, branch: branch.trim(), content_path: contentPath.trim() },
    });
    if ((res.status as number) === 401) {
      clearToken();
      router.replace('/');
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      const code = 'code' in data ? data.code : undefined;
      setSaving(false);
      setConnectErrorKey(
        code === 'installation_claimed'
          ? 'claimed'
          : code === 'missing_write_permission'
            ? 'noWriteAccess'
            : code === 'repo_not_found'
              ? 'noAccess'
              : 'connectFailed',
      );
      return;
    }

    // sessionStorage is user-writable and can outlive a locale rename, so treat
    // anything we don't recognise as absent rather than routing to a dead prefix.
    const stored = window.sessionStorage.getItem(GITHUB_RETURN_LOCALE_KEY);
    const returnLocale = hasLocale(routing.locales, stored) ? stored : currentLocale;
    window.sessionStorage.removeItem(GITHUB_RETURN_LOCALE_KEY);
    // Not `connected=1`: every settings panel is mounted (tabs only toggle
    // `hidden`), so the GSC panel would read that as its own return and show a
    // stale "Search Console connected" banner on the next tab switch.
    router.replace(`${SETTINGS_HREF}&connected=static-site`, { locale: returnLocale });
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-md content-start gap-4 px-4 py-16">
      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="font-semibold text-lg text-slate-950">{t('title')}</h1>

        {redeemErrorKey ? (
          <>
            <ErrorPanel>{t(`errors.${redeemErrorKey}`)}</ErrorPanel>
            <Button asChild variant="outline" className="w-fit">
              <Link href={SETTINGS_HREF}>{t('backToSettings')}</Link>
            </Button>
          </>
        ) : pendingApproval ? (
          <>
            <p className="text-slate-600 text-sm">{t('pendingApproval')}</p>
            <Button asChild variant="outline" className="w-fit">
              <Link href={SETTINGS_HREF}>{t('backToSettings')}</Link>
            </Button>
          </>
        ) : !repos ? (
          <p className="text-slate-600 text-sm">{t('redeeming')}</p>
        ) : repos.length === 0 ? (
          <>
            <p className="text-slate-600 text-sm">{t('noRepos')}</p>
            <Button asChild variant="outline" className="w-fit">
              <Link href={SETTINGS_HREF}>{t('backToSettings')}</Link>
            </Button>
          </>
        ) : (
          <>
            <div>
              <p className="font-medium text-slate-950 text-sm">{t('pickTitle')}</p>
              <p className="mt-1 text-slate-500 text-sm">{t('pickBody')}</p>
            </div>
            <fieldset className="grid gap-2">
              <legend className="sr-only">{t('pickTitle')}</legend>
              {repos.map((candidate) => {
                const isSelected = repo === candidate.full_name;
                return (
                  <label
                    key={candidate.full_name}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors',
                      isSelected
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 hover:border-slate-300',
                      saving && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <input
                      type="radio"
                      name="github-repo"
                      className="mt-1 size-4 accent-slate-900"
                      checked={isSelected}
                      disabled={saving}
                      onChange={() => selectRepo(candidate)}
                    />
                    <span className="grid min-w-0 gap-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium text-slate-950 text-sm">
                          {candidate.full_name}
                        </span>
                        {candidate.private ? (
                          <Badge variant="secondary" className="border-transparent">
                            {t('private')}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="text-slate-500 text-xs">
                        {t('defaultBranch', { branch: candidate.default_branch })}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <div className="grid gap-2">
              <Label htmlFor="github-branch">{t('branch')}</Label>
              <Input
                autoComplete="off"
                disabled={!repo || saving}
                id="github-branch"
                onChange={(event) => setBranch(event.target.value)}
                spellCheck={false}
                value={branch}
              />
              <p className="text-slate-500 text-xs">{t('branchHint')}</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="github-content-path">{t('contentPath')}</Label>
              <Input
                autoComplete="off"
                disabled={!repo || saving}
                id="github-content-path"
                onChange={(event) => setContentPath(event.target.value)}
                spellCheck={false}
                value={contentPath}
              />
              <p className="text-slate-500 text-xs">{t('contentPathHint')}</p>
            </div>

            {connectErrorKey ? <ErrorPanel>{t(`errors.${connectErrorKey}`)}</ErrorPanel> : null}

            <Button
              type="button"
              className="w-fit"
              disabled={!repo || !branch.trim() || !contentPath.trim() || saving}
              onClick={confirm}
            >
              {saving ? t('saving') : t('confirm')}
            </Button>
          </>
        )}
      </div>
    </main>
  );
}

function ErrorPanel({ children }: { children: string }) {
  return (
    <p
      aria-live="polite"
      className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm"
    >
      {children}
    </p>
  );
}

// useSearchParams requires a Suspense boundary in the app router.
export default function GithubCallbackPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md px-4 py-16" />}>
      <CallbackInner />
    </Suspense>
  );
}
