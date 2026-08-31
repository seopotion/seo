'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, LoaderCircle, Search, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Input,
  Label,
  Modal,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { cn } from '@/lib/utils';
import {
  combineResearchResults,
  formatNumber,
  getCandidateAddApiError,
  getKeywordResearchApiError,
  RESEARCH_SEED_MAX_LENGTH,
  validateResearchSeed,
} from '../planner-utils';
import type {
  CandidateAddApiError,
  KeywordMetric,
  KeywordResearchApiError,
  ResearchSeedError,
} from '../types';

type ResearchError =
  | ResearchSeedError
  | Exclude<KeywordResearchApiError, 'unauthorized' | 'upgrade'>;
type AddError = Exclude<CandidateAddApiError, 'unauthorized' | 'upgrade'>;
type AddState = 'added' | 'skipped';

class KeywordsApiError<
  TReason extends KeywordResearchApiError | CandidateAddApiError,
> extends Error {
  reason: TReason;

  constructor(reason: TReason) {
    super(reason);
    this.name = 'KeywordsApiError';
    this.reason = reason;
  }
}

export function ResearchKeywordsModal({
  canResearch,
  onClose,
  onUnauthorized,
  open,
  organizationId,
}: {
  canResearch: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
  open: boolean;
  organizationId: string;
}) {
  const locale = useLocale();
  const t = useTranslations('ContentPlannerPage.researchKeywords');
  const targetKeywordsT = useTranslations('ContentPlannerPage.targetKeywords');
  const queryClient = useQueryClient();
  const [seedInput, setSeedInput] = useState('');
  const [results, setResults] = useState<KeywordMetric[] | null>(null);
  const [searchError, setSearchError] = useState<ResearchError | null>(null);
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const [pendingAdds, setPendingAdds] = useState<Set<string>>(() => new Set());
  const [addStates, setAddStates] = useState<Record<string, AddState>>({});
  const [addErrors, setAddErrors] = useState<Record<string, AddError>>({});
  const sessionRef = useRef(0);

  useEffect(
    () => () => {
      sessionRef.current += 1;
    },
    [],
  );

  const researchMutation = useMutation({
    mutationFn: async (seed: string) => {
      const response = await api.api.v0.keywords.research.$post({
        json: { org_id: organizationId, seed },
      });

      if (!response.ok) {
        const reason = getKeywordResearchApiError(response.status as number);

        if (reason === 'unauthorized') {
          onUnauthorized();
        }

        throw new KeywordsApiError(reason);
      }

      return response.json();
    },
  });
  const addMutation = useMutation({
    mutationFn: async (metric: KeywordMetric) => {
      const response = await api.api.v0.keywords.candidates.$post({
        json: { keywords: [metric], org_id: organizationId },
      });

      if (!response.ok) {
        const reason = getCandidateAddApiError(response.status as number);

        if (reason === 'unauthorized') {
          onUnauthorized();
        }

        throw new KeywordsApiError(reason);
      }

      return response.json();
    },
  });

  const resetState = useCallback(() => {
    sessionRef.current += 1;
    setSeedInput('');
    setResults(null);
    setSearchError(null);
    setUpgradeRequired(false);
    setPendingAdds(new Set());
    setAddStates({});
    setAddErrors({});
    researchMutation.reset();
    addMutation.reset();
  }, [addMutation, researchMutation]);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canResearch) {
      setUpgradeRequired(true);
      return;
    }

    const validation = validateResearchSeed(seedInput);

    if (validation.error) {
      setSearchError(validation.error);
      return;
    }

    setSeedInput(validation.seed);
    setSearchError(null);
    setUpgradeRequired(false);
    const session = sessionRef.current;

    try {
      const response = await researchMutation.mutateAsync(validation.seed);

      if (session !== sessionRef.current) {
        return;
      }

      setResults(combineResearchResults(response.seed, response.similar));
      setAddStates({});
      setAddErrors({});
    } catch (error) {
      if (session !== sessionRef.current) {
        return;
      }

      if (!(error instanceof KeywordsApiError)) {
        setSearchError('generic');
        return;
      }

      if (error.reason === 'unauthorized') {
        return;
      }

      if (error.reason === 'upgrade') {
        setUpgradeRequired(true);
        return;
      }

      setSearchError(error.reason);
    }
  };

  const handleAdd = async (metric: KeywordMetric) => {
    const keywordKey = getKeywordKey(metric);
    const session = sessionRef.current;

    setPendingAdds((current) => new Set(current).add(keywordKey));
    setAddErrors((current) => omitKey(current, keywordKey));

    try {
      const response = await addMutation.mutateAsync(metric);
      const state: AddState = response.added === 1 ? 'added' : 'skipped';

      if (session === sessionRef.current) {
        setAddStates((current) => ({ ...current, [keywordKey]: state }));
      }

      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.candidatePool(organizationId),
      });
    } catch (error) {
      if (session !== sessionRef.current) {
        return;
      }

      if (!(error instanceof KeywordsApiError)) {
        setAddErrors((current) => ({ ...current, [keywordKey]: 'generic' }));
        return;
      }

      if (error.reason === 'unauthorized') {
        return;
      }

      if (error.reason === 'upgrade') {
        setUpgradeRequired(true);
        return;
      }

      setAddErrors((current) => ({ ...current, [keywordKey]: error.reason }));
    } finally {
      if (session === sessionRef.current) {
        setPendingAdds((current) => {
          const next = new Set(current);
          next.delete(keywordKey);
          return next;
        });
      }
    }
  };

  const resultCount = results?.length ?? 0;
  const titleId = 'research-keywords-dialog-title';

  return (
    <Modal closeLabel={t('actions.close')} labelledBy={titleId} onClose={handleClose} open={open}>
      <header className="flex shrink-0 items-start justify-between gap-4 border-border border-b px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 id={titleId} className="font-semibold text-lg text-foreground">
            {t('title')}
          </h2>
          <p className="mt-1 text-muted-foreground text-sm">{t('description')}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('actions.close')}
          className="size-9"
          onClick={handleClose}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </header>

      {!canResearch || upgradeRequired ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
          <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 px-5 py-6 text-center">
            <h3 className="font-semibold text-amber-950">{t('upgrade.title')}</h3>
            <p className="mt-2 text-amber-800 text-sm">{t('upgrade.description')}</p>
            <Button asChild className="mt-4" size="sm">
              <Link href="/billing">{t('upgrade.cta')}</Link>
            </Button>
          </div>
        </div>
      ) : (
        <>
          <form
            className="grid shrink-0 gap-2 border-border border-b px-4 py-4 sm:px-6"
            onSubmit={(event) => void handleSearch(event)}
          >
            <Label htmlFor="research-keyword-seed">{t('form.label')}</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="research-keyword-seed"
                data-modal-initial-focus
                value={seedInput}
                maxLength={RESEARCH_SEED_MAX_LENGTH}
                placeholder={t('form.placeholder')}
                aria-describedby={searchError ? 'research-keyword-error' : undefined}
                aria-invalid={Boolean(searchError)}
                disabled={researchMutation.isPending}
                onChange={(event) => {
                  setSeedInput(event.target.value);
                  setSearchError(null);
                }}
              />
              <Button type="submit" disabled={researchMutation.isPending}>
                {researchMutation.isPending ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Search className="size-4" aria-hidden="true" />
                )}
                {researchMutation.isPending ? t('actions.searching') : t('actions.search')}
              </Button>
            </div>
            <div className="flex min-h-5 items-start justify-between gap-3">
              <div id="research-keyword-error" role={searchError ? 'alert' : undefined}>
                {searchError ? (
                  <p className="text-red-600 text-xs">{t(`errors.${searchError}`)}</p>
                ) : null}
              </div>
              <span className="shrink-0 text-muted-foreground text-xs">
                {t('form.characterCount', {
                  count: seedInput.length,
                  max: RESEARCH_SEED_MAX_LENGTH,
                })}
              </span>
            </div>
          </form>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {results ? (
              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-foreground text-sm">{t('results.title')}</h3>
                  <span className="text-muted-foreground text-xs">
                    {t('results.count', { count: resultCount })}
                  </span>
                </div>

                <ResearchResults
                  addErrors={addErrors}
                  addStates={addStates}
                  locale={locale}
                  onAdd={(metric) => void handleAdd(metric)}
                  pendingAdds={pendingAdds}
                  results={results}
                  t={t}
                  targetKeywordsT={targetKeywordsT}
                />
              </div>
            ) : researchMutation.isPending ? (
              <ResearchState loading message={t('states.loading')} />
            ) : (
              <ResearchState message={t('states.empty')} />
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function ResearchResults({
  addErrors,
  addStates,
  locale,
  onAdd,
  pendingAdds,
  results,
  t,
  targetKeywordsT,
}: {
  addErrors: Record<string, AddError>;
  addStates: Record<string, AddState>;
  locale: string;
  onAdd: (metric: KeywordMetric) => void;
  pendingAdds: Set<string>;
  results: KeywordMetric[];
  t: ReturnType<typeof useTranslations<'ContentPlannerPage.researchKeywords'>>;
  targetKeywordsT: ReturnType<typeof useTranslations<'ContentPlannerPage.targetKeywords'>>;
}) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border border-border md:block">
        <Table aria-label={t('results.tableLabel')} className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[38%]">{t('columns.keyword')}</TableHead>
              <TableHead>{t('columns.difficulty')}</TableHead>
              <TableHead>{t('columns.volume')}</TableHead>
              <TableHead>{t('columns.intent')}</TableHead>
              <TableHead className="w-36">
                <span className="sr-only">{t('columns.action')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((metric) => {
              const keywordKey = getKeywordKey(metric);

              return (
                <TableRow key={keywordKey}>
                  <TableCell className="wrap-break-words font-medium text-foreground">
                    {metric.keyword.trim()}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatMetric(metric.difficulty, locale, targetKeywordsT)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatMetric(metric.search_volume, locale, targetKeywordsT)}
                  </TableCell>
                  <TableCell className="truncate text-muted-foreground">
                    {metric.intent
                      ? targetKeywordsT(`intents.${metric.intent}`)
                      : targetKeywordsT('notAvailable')}
                  </TableCell>
                  <TableCell>
                    <AddKeywordAction
                      error={addErrors[keywordKey]}
                      onAdd={() => onAdd(metric)}
                      pending={pendingAdds.has(keywordKey)}
                      state={addStates[keywordKey]}
                      t={t}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ul aria-label={t('results.listLabel')} className="grid list-none gap-2 md:hidden">
        {results.map((metric) => {
          const keywordKey = getKeywordKey(metric);

          return (
            <li key={keywordKey} className="grid gap-3 rounded-lg border border-border bg-card p-3">
              <h4 className="wrap-break-words font-semibold text-foreground text-sm">
                {metric.keyword.trim()}
              </h4>
              <dl className="grid grid-cols-3 gap-3">
                <Metric
                  label={t('columns.difficulty')}
                  value={formatMetric(metric.difficulty, locale, targetKeywordsT)}
                />
                <Metric
                  label={t('columns.volume')}
                  value={formatMetric(metric.search_volume, locale, targetKeywordsT)}
                />
                <Metric
                  label={t('columns.intent')}
                  value={
                    metric.intent
                      ? targetKeywordsT(`intents.${metric.intent}`)
                      : targetKeywordsT('notAvailable')
                  }
                />
              </dl>
              <AddKeywordAction
                error={addErrors[keywordKey]}
                onAdd={() => onAdd(metric)}
                pending={pendingAdds.has(keywordKey)}
                state={addStates[keywordKey]}
                t={t}
              />
            </li>
          );
        })}
      </ul>
    </>
  );
}

function AddKeywordAction({
  error,
  onAdd,
  pending,
  state,
  t,
}: {
  error?: AddError;
  onAdd: () => void;
  pending: boolean;
  state?: AddState;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage.researchKeywords'>>;
}) {
  return (
    <div className="grid justify-items-start gap-1 md:justify-items-end">
      <Button
        type="button"
        variant={state ? 'ghost' : 'outline'}
        size="sm"
        disabled={pending || Boolean(state)}
        className={cn(state && 'disabled:opacity-100')}
        onClick={onAdd}
      >
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : state ? (
          <Check className="size-4" aria-hidden="true" />
        ) : null}
        {pending ? t('actions.adding') : state ? t(`actions.${state}`) : t('actions.add')}
      </Button>
      {error ? (
        <p role="alert" className="text-red-600 text-xs">
          {t(`addErrors.${error}`)}
        </p>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-foreground text-sm">{value}</dd>
    </div>
  );
}

function ResearchState({ loading = false, message }: { loading?: boolean; message: string }) {
  return (
    <div
      role={loading ? 'status' : undefined}
      className="flex min-h-40 items-center justify-center text-center"
    >
      <div className="grid max-w-md justify-items-center gap-2 text-muted-foreground text-sm">
        {loading ? (
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <Search className="size-5 text-muted-foreground" aria-hidden="true" />
        )}
        <p>{message}</p>
      </div>
    </div>
  );
}

function formatMetric(
  value: number | null,
  locale: string,
  t: ReturnType<typeof useTranslations<'ContentPlannerPage.targetKeywords'>>,
) {
  return value === null ? t('notAvailable') : formatNumber(value, locale);
}

function getKeywordKey(metric: KeywordMetric) {
  return metric.keyword.trim().replace(/\s+/g, ' ').toLowerCase();
}

function omitKey<TValue>(record: Record<string, TValue>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}
