import type {
  CalendarDay,
  CandidateAddApiError,
  CandidateDeleteApiError,
  CandidateKeywordResponse,
  CandidateScheduleError,
  KeywordMetric,
  KeywordResearchApiError,
  PlannerArticle,
  PlannerKeywordResponse,
  ResearchSeedError,
  TargetKeyword,
  TargetKeywordStatus,
} from './types';

export const RESEARCH_SEED_MAX_LENGTH = 200;

const CANDIDATE_SCHEDULE_CONFLICTS = new Set<CandidateScheduleError>([
  'candidate_already_scheduled',
  'candidate_not_schedulable',
  'date_occupied',
  'keyword_already_scheduled',
]);

export function isCandidateScheduleSuccess(status: number) {
  return status === 200 || status === 201;
}

export function getKeywordResearchApiError(status: number): KeywordResearchApiError {
  if (status === 400) return 'invalid';
  if (status === 401) return 'unauthorized';
  if (status === 402) return 'upgrade';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 502) return 'provider';
  return 'generic';
}

export function getCandidateAddApiError(status: number): CandidateAddApiError {
  if (status === 400) return 'invalid';
  if (status === 401) return 'unauthorized';
  if (status === 402) return 'upgrade';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  return 'generic';
}

export function getCandidateDeleteApiError(
  status: number,
  responseBody?: unknown,
): CandidateDeleteApiError {
  if (status === 401) return 'unauthorized';
  if (status === 402) return 'upgrade';
  if (status === 404) return 'not_found';

  if (
    status === 409 &&
    typeof responseBody === 'object' &&
    responseBody !== null &&
    'error' in responseBody &&
    responseBody.error === 'candidate_not_deletable'
  ) {
    return 'candidate_not_deletable';
  }

  return 'generic';
}

export function getCandidateScheduleError(
  status: number,
  responseBody?: unknown,
): CandidateScheduleError {
  if (status === 400) {
    return 'invalid_date';
  }

  if (status === 402) {
    return 'upgrade';
  }

  if (status === 404) {
    return 'not_found';
  }

  if (
    status === 409 &&
    typeof responseBody === 'object' &&
    responseBody !== null &&
    'error' in responseBody &&
    typeof responseBody.error === 'string' &&
    CANDIDATE_SCHEDULE_CONFLICTS.has(responseBody.error as CandidateScheduleError)
  ) {
    return responseBody.error as CandidateScheduleError;
  }

  return 'generic';
}

export function validateResearchSeed(value: string): {
  error: ResearchSeedError | null;
  seed: string;
} {
  const seed = value.trim();

  if (!seed) {
    return { error: 'required', seed };
  }

  if (seed.length > RESEARCH_SEED_MAX_LENGTH) {
    return { error: 'too_long', seed };
  }

  return { error: null, seed };
}

export function combineResearchResults(
  seed: KeywordMetric,
  similar: KeywordMetric[],
): KeywordMetric[] {
  const seenKeywords = new Set<string>();
  const results: KeywordMetric[] = [];

  for (const metric of [seed, ...similar]) {
    const normalizedKeyword = metric.keyword.trim().replace(/\s+/g, ' ').toLowerCase();

    if (seenKeywords.has(normalizedKeyword)) {
      continue;
    }

    seenKeywords.add(normalizedKeyword);
    results.push(metric);
  }

  return results;
}

export function mapPlannerKeywords(keywords: PlannerKeywordResponse[]): PlannerArticle[] {
  return keywords.map((keyword) => ({
    articleId: keyword.article_id,
    candidateId: keyword.candidate_id,
    difficulty: keyword.difficulty,
    generationError: keyword.generation_error,
    generationStatus: keyword.generation_status,
    id: keyword.id,
    intent: keyword.intent,
    keyword: keyword.keyword,
    opportunityScore: keyword.opportunity_score,
    scheduledDate: keyword.scheduled_date,
    status: keyword.article_id !== null ? 'generated' : 'planned',
    title: keyword.keyword,
    volume: keyword.search_volume,
  }));
}

export function combineTargetKeywords(
  candidates: CandidateKeywordResponse[],
  plannerArticles: PlannerArticle[],
): TargetKeyword[] {
  const plannerCandidateIds = new Set(
    plannerArticles.flatMap((article) =>
      article.candidateId !== null ? [article.candidateId] : [],
    ),
  );
  const seenCandidateIds = new Set<string>();
  const seenPlannerCandidateIds = new Set<string>();
  const targetKeywords: TargetKeyword[] = [];

  for (const candidate of candidates) {
    if (plannerCandidateIds.has(candidate.id) || seenCandidateIds.has(candidate.id)) {
      continue;
    }

    seenCandidateIds.add(candidate.id);
    targetKeywords.push({
      candidateId: candidate.id,
      difficulty: candidate.difficulty,
      id: candidate.id,
      intent: candidate.intent,
      keyword: candidate.keyword,
      opportunityScore: candidate.opportunity_score,
      schedulable: candidate.schedulable,
      source: 'candidate',
      status: 'available',
      volume: candidate.search_volume,
    });
  }

  for (const article of plannerArticles) {
    if (article.candidateId !== null && seenPlannerCandidateIds.has(article.candidateId)) {
      continue;
    }

    if (article.candidateId !== null) {
      seenPlannerCandidateIds.add(article.candidateId);
    }

    targetKeywords.push({
      candidateId: article.candidateId,
      difficulty: article.difficulty,
      id: article.id,
      intent: article.intent,
      keyword: article.keyword,
      opportunityScore: article.opportunityScore,
      schedulable: false,
      source: 'planner',
      status: getPlannerTargetKeywordStatus(article),
      volume: article.volume,
    });
  }

  return targetKeywords;
}

function getPlannerTargetKeywordStatus(article: PlannerArticle): TargetKeywordStatus {
  if (article.articleId !== null || article.generationStatus === 'generated') {
    return 'generated';
  }

  if (article.generationStatus === 'generating') {
    return 'generating';
  }

  if (article.generationStatus === 'failed') {
    return 'failed';
  }

  return 'scheduled';
}

/**
 * Whole-week grid for one calendar month: the Monday on or before the 1st
 * through the Sunday on or after the last day, so every row has 7 cells.
 * Articles attach only to in-month days: a keyword scheduled on a padding day
 * belongs to the neighbouring month's grid, and would otherwise render twice.
 */
export function buildMonthWeeks(
  monthStart: Date,
  articles: PlannerArticle[],
  today: Date,
): CalendarDay[][] {
  const monthEnd = endOfMonth(monthStart);
  const articleByDate = new Map(articles.map((article) => [article.scheduledDate, article]));
  const weeks: CalendarDay[][] = [];
  let cursor = startOfWeekMonday(monthStart);

  while (cursor <= monthEnd) {
    const week: CalendarDay[] = [];

    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const date = addDays(cursor, dayOffset);
      const dateKey = toDateKey(date);
      const inMonth = isSameMonth(date, monthStart);

      week.push({
        article: inMonth ? articleByDate.get(dateKey) : undefined,
        date,
        dateKey,
        inMonth,
        isPast: date < today,
      });
    }

    weeks.push(week);
    cursor = addDays(cursor, 7);
  }

  return weeks;
}

export function startOfToday() {
  const today = new Date();

  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Only ever called with a month start, so there is no end-of-month clamping to do. */
export function addMonths(monthStart: Date, months: number) {
  return new Date(monthStart.getFullYear(), monthStart.getMonth() + months, 1);
}

export function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function endOfMonth(date: Date) {
  // Day 0 of the next month is the last day of this one.
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function startOfWeekMonday(date: Date) {
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;

  return addDays(date, offset);
}

export function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(date.getDate() + days);

  return new Date(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate());
}

export function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function formatDateFromKey(dateKey: string, locale: string) {
  // `T00:00:00` (no `Z`) parses as local midnight, matching toDateKey above.
  return formatDate(new Date(`${dateKey}T00:00:00`), locale, 'long');
}

export function formatDate(date: Date, locale: string, dateStyle: 'medium' | 'long') {
  return new Intl.DateTimeFormat(locale, { dateStyle }).format(date);
}

export function formatDateTime(dateTime: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(dateTime));
}

export function formatWeekday(date: Date, locale: string, weekday: 'short' | 'long') {
  return new Intl.DateTimeFormat(locale, { weekday }).format(date);
}

export function formatDayNumber(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(date);
}

export function formatMonthYear(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date);
}

export function formatNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale).format(value);
}

/** A metric the provider did not report (#304) renders as the planner's `notAvailable` dash. */
export function formatNullableNumber(value: number | null, locale: string) {
  return value === null ? '—' : formatNumber(value, locale);
}

export function slugifyArticleTitle(value: string) {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'article-draft';
}
