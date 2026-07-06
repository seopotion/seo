'use client';

import { CalendarDays, Search, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Separator } from '@/components/ui';
import { cn } from '@/lib/utils';

type PlannerArticleStatus = 'planned' | 'generated';

type PlannerArticleType =
  | 'listicle'
  | 'how_to_guide'
  | 'comparison'
  | 'product_guide'
  | 'case_study'
  | 'definition'
  | 'alternatives';

type PlannerArticle = {
  id: string;
  scheduledDate: string;
  title: string;
  keyword: string;
  volume: number;
  difficulty: number;
  type: PlannerArticleType;
  status: PlannerArticleStatus;
};

type CalendarDay = {
  date: Date;
  dateKey: string;
  inRange: boolean;
  article?: PlannerArticle;
};

const DAYS_IN_RANGE = 45;
const plannerArticles: PlannerArticle[] = [];

export default function ContentPlannerPage() {
  const t = useTranslations('ContentPlannerPage');
  const locale = useLocale();
  const [selectedArticle, setSelectedArticle] = useState<PlannerArticle | null>(null);

  const today = useMemo(() => startOfToday(), []);
  const rangeEnd = useMemo(() => addDays(today, DAYS_IN_RANGE - 1), [today]);
  const calendarWeeks = useMemo(() => buildCalendarWeeks(today, plannerArticles), [today]);
  const activeDays = useMemo(
    () => calendarWeeks.flat().filter((day) => day.inRange),
    [calendarWeeks],
  );
  const weekdayLabels = useMemo(
    () => calendarWeeks[0]?.map((day) => formatWeekday(day.date, locale, 'short')) ?? [],
    [calendarWeeks, locale],
  );
  const dateRangeText = useMemo(
    () => `${formatDate(today, locale, 'medium')} - ${formatDate(rangeEnd, locale, 'medium')}`,
    [locale, rangeEnd, today],
  );

  return (
    <div className="grid gap-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-semibold text-lg text-slate-950">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-slate-600 text-sm">{t('description')}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <SummaryPill
            icon={<CalendarDays className="size-4" />}
            label={t('rangeLabel')}
            value={dateRangeText}
          />
          <SummaryPill label={t('rangeDays', { count: DAYS_IN_RANGE })} value={t('activeRange')} />
          <SummaryPill
            label={t('scheduledCount', { count: plannerArticles.length })}
            value={t('oneArticlePerDay')}
          />
        </div>
      </header>

      <section
        aria-label={t('calendarLabel')}
        className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white md:block"
      >
        <div className="grid grid-cols-7 border-slate-200 border-b bg-slate-50">
          {weekdayLabels.map((weekday) => (
            <div key={weekday} className="px-3 py-2 font-semibold text-slate-600 text-xs">
              {weekday}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {calendarWeeks.flat().map((day) => (
            <PlannerDayCell
              key={day.dateKey}
              day={day}
              locale={locale}
              onSelectArticle={setSelectedArticle}
              t={t}
            />
          ))}
        </div>
      </section>

      <section aria-label={t('agendaLabel')} className="grid gap-2 md:hidden">
        {activeDays.map((day) => (
          <PlannerAgendaRow
            key={day.dateKey}
            day={day}
            locale={locale}
            onSelectArticle={setSelectedArticle}
            t={t}
          />
        ))}
      </section>

      <ArticleDetailModal
        article={selectedArticle}
        locale={locale}
        onClose={() => setSelectedArticle(null)}
        t={t}
      />
    </div>
  );
}

function PlannerDayCell({
  day,
  locale,
  onSelectArticle,
  t,
}: {
  day: CalendarDay;
  locale: string;
  onSelectArticle: (article: PlannerArticle) => void;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage'>>;
}) {
  return (
    <div
      className={cn(
        'flex h-36 min-w-0 flex-col border-slate-200 border-r border-b p-2',
        day.inRange ? 'bg-white' : 'bg-slate-50 text-slate-400',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className={cn(
              'truncate font-medium text-slate-600 text-xs',
              !day.inRange && 'text-slate-400',
            )}
          >
            {formatWeekday(day.date, locale, 'short')}
          </p>
          <p
            className={cn('font-semibold text-slate-950 text-sm', !day.inRange && 'text-slate-400')}
          >
            {formatDayNumber(day.date, locale)}
          </p>
        </div>
        {isFirstDayOfMonth(day.date) && (
          <span className="truncate text-slate-500 text-xs">{formatMonth(day.date, locale)}</span>
        )}
      </div>

      <div className="mt-3 flex min-h-0 flex-1 items-end">
        {day.article ? (
          <ArticleButton
            article={day.article}
            locale={locale}
            onSelectArticle={onSelectArticle}
            t={t}
          />
        ) : day.inRange ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto min-h-9 w-full justify-start whitespace-normal px-2 py-1.5 text-left text-xs leading-snug"
          >
            <Search className="size-3.5" aria-hidden="true" />
            <span className="min-w-0">{t('actions.researchKeyword')}</span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PlannerAgendaRow({
  day,
  locale,
  onSelectArticle,
  t,
}: {
  day: CalendarDay;
  locale: string;
  onSelectArticle: (article: PlannerArticle) => void;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage'>>;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-600 text-sm">
            {formatWeekday(day.date, locale, 'long')}
          </p>
          <p className="truncate font-semibold text-slate-950 text-sm">
            {formatDate(day.date, locale, 'long')}
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 font-semibold text-slate-700 text-xs">
          {formatDayNumber(day.date, locale)}
        </span>
      </div>

      {day.article ? (
        <ArticleButton
          article={day.article}
          locale={locale}
          onSelectArticle={onSelectArticle}
          t={t}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-auto min-h-9 w-full justify-start whitespace-normal px-3 py-2 text-left text-sm leading-snug"
        >
          <Search className="size-4" aria-hidden="true" />
          <span className="min-w-0">{t('actions.researchKeyword')}</span>
        </Button>
      )}
    </div>
  );
}

function ArticleButton({
  article,
  locale,
  onSelectArticle,
  t,
}: {
  article: PlannerArticle;
  locale: string;
  onSelectArticle: (article: PlannerArticle) => void;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage'>>;
}) {
  return (
    <button
      type="button"
      className="grid w-full min-w-0 gap-1 rounded-md border border-slate-200 bg-slate-50 p-2 text-left transition-colors hover:border-slate-300 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t('actions.openArticle', { title: article.title })}
      onClick={() => onSelectArticle(article)}
    >
      <span className="line-clamp-2 font-semibold text-slate-950 text-sm leading-snug">
        {article.keyword}
      </span>
      <span className="truncate font-normal text-slate-600 text-xs">
        {t('metrics.volume')}: {formatNumber(article.volume, locale)}
      </span>
      <span className="truncate font-normal text-slate-600 text-xs">
        {t('metrics.difficulty')}: {formatNumber(article.difficulty, locale)}
      </span>
    </button>
  );
}

function ArticleDetailModal({
  article,
  locale,
  onClose,
  t,
}: {
  article: PlannerArticle | null;
  locale: string;
  onClose: () => void;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage'>>;
}) {
  useEffect(() => {
    if (!article) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [article, onClose]);

  if (!article) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"
      role="presentation"
    >
      <button
        type="button"
        aria-label={t('actions.closeDetails')}
        className="absolute inset-0 cursor-default"
        onMouseDown={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="planner-article-detail-title"
        className="relative w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-lg"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-slate-500 text-sm">{t('modal.title')}</p>
            <h2
              id="planner-article-detail-title"
              className="mt-1 line-clamp-3 font-semibold text-base text-slate-950"
            >
              {article.title}
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('actions.closeDetails')}
            autoFocus
            className="size-8"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <Separator className="my-4" />

        <dl className="grid gap-3 text-sm">
          <DetailItem label={t('modal.type')} value={t(`articleTypes.${article.type}`)} />
          <DetailItem
            label={t('modal.scheduledDate')}
            value={formatDateFromKey(article.scheduledDate, locale)}
          />
          <div className="grid gap-1">
            <dt className="text-slate-500">{t('modal.status')}</dt>
            <dd>
              <StatusBadge status={article.status} t={t} />
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 truncate font-medium text-slate-950">{value}</dd>
    </div>
  );
}

function StatusBadge({
  status,
  t,
}: {
  status: PlannerArticleStatus;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage'>>;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'w-fit border-transparent',
        status === 'generated' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700',
      )}
    >
      {t(`statuses.${status}`)}
    </Badge>
  );
}

function SummaryPill({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
      {icon ? <span className="shrink-0 text-slate-500">{icon}</span> : null}
      <div className="min-w-0">
        <p className="truncate text-slate-500 text-xs">{label}</p>
        <p className="truncate font-medium text-slate-950 text-sm">{value}</p>
      </div>
    </div>
  );
}

function buildCalendarWeeks(rangeStart: Date, articles: PlannerArticle[]): CalendarDay[][] {
  const rangeEnd = addDays(rangeStart, DAYS_IN_RANGE - 1);
  const gridStart = startOfWeekMonday(rangeStart);
  const articleByDate = new Map(articles.map((article) => [article.scheduledDate, article]));
  const weeks: CalendarDay[][] = [];
  let cursor = gridStart;

  while (cursor <= rangeEnd) {
    const week: CalendarDay[] = [];

    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const date = addDays(cursor, dayOffset);
      const dateKey = toDateKey(date);
      const inRange = date >= rangeStart && date <= rangeEnd;

      week.push({
        article: inRange ? articleByDate.get(dateKey) : undefined,
        date,
        dateKey,
        inRange,
      });
    }

    weeks.push(week);
    cursor = addDays(cursor, 7);
  }

  return weeks;
}

function startOfToday() {
  const today = new Date();

  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function startOfWeekMonday(date: Date) {
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;

  return addDays(date, offset);
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(date.getDate() + days);

  return new Date(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate());
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function formatDateFromKey(dateKey: string, locale: string) {
  const [year, month, day] = dateKey.split('-').map(Number);

  return formatDate(new Date(year, month - 1, day), locale, 'long');
}

function formatDate(date: Date, locale: string, dateStyle: 'medium' | 'long') {
  return new Intl.DateTimeFormat(locale, { dateStyle }).format(date);
}

function formatWeekday(date: Date, locale: string, weekday: 'short' | 'long') {
  return new Intl.DateTimeFormat(locale, { weekday }).format(date);
}

function formatDayNumber(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(date);
}

function formatMonth(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: 'short' }).format(date);
}

function formatNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale).format(value);
}

function isFirstDayOfMonth(date: Date) {
  return date.getDate() === 1;
}
