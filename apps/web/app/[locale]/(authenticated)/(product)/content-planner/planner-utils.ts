import type { CalendarDay, PlannerArticle, PlannerKeywordResponse } from './types';

export const DAYS_IN_RANGE = 45;

export function mapPlannerKeywords(keywords: PlannerKeywordResponse[]): PlannerArticle[] {
  return keywords.map((keyword) => ({
    articleId: keyword.article_id,
    difficulty: keyword.difficulty,
    id: keyword.id,
    keyword: keyword.keyword,
    scheduledDate: keyword.scheduled_date,
    status: keyword.article_id ? 'generated' : 'planned',
    title: keyword.keyword,
    volume: keyword.search_volume,
  }));
}

export function buildCalendarWeeks(rangeStart: Date, articles: PlannerArticle[]): CalendarDay[][] {
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

export function startOfToday() {
  const today = new Date();

  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
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

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function formatDateFromKey(dateKey: string, locale: string) {
  const [year, month, day] = dateKey.split('-').map(Number);

  return formatDate(new Date(year, month - 1, day), locale, 'long');
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

export function formatMonth(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: 'short' }).format(date);
}

export function formatNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale).format(value);
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

export function isFirstDayOfMonth(date: Date) {
  return date.getDate() === 1;
}
