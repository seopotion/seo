import { addDays } from './planner-utils';
import type { ArticleDetailResponse, PlannerArticle } from './types';

export function createPlannerFixtureArticles(): PlannerArticle[] {
  const today = startOfToday();

  return [
    {
      articleId: 'dev-article-content-editor',
      candidateId: 'dev-candidate-content-editor',
      difficulty: 34,
      generationError: null,
      generationStatus: 'generated',
      id: 'dev-keyword-content-editor',
      intent: 'informational',
      keyword: 'content calendar for SaaS',
      opportunityScore: 82,
      scheduledDate: toDateKey(addDays(today, 1)),
      status: 'generated',
      title: 'Content Calendar for SaaS: A Practical Planning Guide',
      volume: 2400,
    },
    {
      articleId: null,
      candidateId: 'dev-candidate-planned',
      difficulty: 18,
      generationError: null,
      generationStatus: 'pending',
      id: 'dev-keyword-planned',
      intent: 'informational',
      keyword: 'seo brief template',
      opportunityScore: 74,
      scheduledDate: toDateKey(addDays(today, 3)),
      status: 'planned',
      title: 'seo brief template',
      volume: 1300,
    },
    {
      articleId: 'dev-article-meta-editor',
      candidateId: 'dev-candidate-meta-editor',
      difficulty: 42,
      generationError: null,
      generationStatus: 'generated',
      id: 'dev-keyword-meta-editor',
      intent: 'informational',
      keyword: 'technical seo checklist',
      opportunityScore: 68,
      scheduledDate: toDateKey(addDays(today, 7)),
      status: 'generated',
      title: 'Technical SEO Checklist for Growing Websites',
      volume: 5400,
    },
    // Points at an article id with no fixture body, so the editor's not-found
    // panel is reachable by clicking rather than only in theory.
    {
      articleId: 'dev-article-missing',
      candidateId: 'dev-candidate-missing',
      difficulty: 27,
      generationError: null,
      generationStatus: 'generated',
      id: 'dev-keyword-missing',
      intent: 'informational',
      keyword: 'seo audit template',
      opportunityScore: 61,
      scheduledDate: toDateKey(addDays(today, 9)),
      status: 'generated',
      title: 'SEO Audit Template',
      volume: 880,
    },
  ];
}

/**
 * Dev-only article bodies behind `?fixtures=1`, so the editor is clickable
 * without seeded Mongo data. The `dev-article-missing` planner row has no entry
 * here on purpose — that is what makes the not-found panel demoable.
 */
const FIXTURE_ARTICLE_DETAILS: Record<string, ArticleDetailResponse> = {
  'dev-article-content-editor': {
    content: [
      '# Content Calendar for SaaS: A Practical Planning Guide',
      'A content calendar keeps a SaaS marketing team honest. It turns a vague ambition to "publish more" into dated, owned, reviewable work.',
      '## Why a calendar beats a backlog',
      'A backlog is a wish list; a calendar is a commitment. Once a piece has a date and an owner, the conversation shifts from whether to publish to what ships this week.',
      '## Choosing a cadence you can hold',
      'Pick the cadence you can sustain in your slowest month, not your best one. Two solid posts a month beat eight rushed ones that nobody edits.',
      '## Mapping topics to the funnel',
      'Balance the calendar across awareness, consideration, and decision. A calendar weighted entirely to bottom-of-funnel comparison pages starves the top and stalls within a quarter.',
      '## Reviewing what shipped',
      'Close each month by reviewing what actually published against what was planned. The gap is the most useful planning input you have.',
    ].join('\n\n'),
    created_at: '2026-07-10T10:00:00.000Z',
    featured_image_url: '',
    id: 'dev-article-content-editor',
    images_status: 'pending',
    keyword: 'content calendar for SaaS',
    meta_description:
      'Build a SaaS content calendar you can actually hold: pick a sustainable cadence, map topics across the funnel, and review what shipped each month.',
    meta_title: 'Content Calendar for SaaS: A Practical Guide',
    published_at: null,
    slug: 'content-calendar-for-saas',
    status: 'generated',
    title: 'Content Calendar for SaaS: A Practical Planning Guide',
    updated_at: null,
  },
  'dev-article-meta-editor': {
    content: [
      '# Technical SEO Checklist for Growing Websites',
      'Technical SEO is what makes the rest of your content work. This checklist covers what tends to break first as a site grows past a few hundred pages.',
      '## Crawlability',
      'Confirm that the pages you care about are reachable from a link, returned as 200, and not blocked in robots.txt. Most "Google ignores my page" reports end here.',
      '## Indexation',
      'Watch the gap between pages submitted and pages indexed. A widening gap usually means thin duplicates or a canonical pointing somewhere unexpected.',
      '## Site speed',
      'Measure Core Web Vitals with field data, not just lab scores. Real users on real phones are the population Google grades you against.',
      '## Structured data',
      'Add schema where it earns a richer result: articles, products, FAQs. Validate it after every template change, because that is when it silently breaks.',
    ].join('\n\n'),
    created_at: '2026-07-08T09:00:00.000Z',
    featured_image_url: '',
    id: 'dev-article-meta-editor',
    images_status: 'complete',
    keyword: 'technical seo checklist',
    meta_description:
      'A practical technical SEO checklist for growing websites, covering crawlability, indexation, Core Web Vitals, and structured data that stays valid.',
    meta_title: 'Technical SEO Checklist for Growing Sites',
    published_at: null,
    slug: 'technical-seo-checklist',
    status: 'generated',
    title: 'Technical SEO Checklist for Growing Websites',
    updated_at: '2026-07-09T14:20:00.000Z',
  },
};

/** Saves made during the session, so a fixture edit survives a modal reopen. */
const fixtureArticleEdits = new Map<string, ArticleDetailResponse>();

export function createFixtureArticleDetail(articleId: string): ArticleDetailResponse | null {
  return fixtureArticleEdits.get(articleId) ?? FIXTURE_ARTICLE_DETAILS[articleId] ?? null;
}

export function saveFixtureArticleDetail(
  articleId: string,
  patch: Pick<
    ArticleDetailResponse,
    'content' | 'meta_description' | 'meta_title' | 'slug' | 'title'
  >,
): ArticleDetailResponse {
  const current = createFixtureArticleDetail(articleId);

  if (!current) {
    throw new Error('fixture_article_not_found');
  }

  const updated = { ...current, ...patch, updated_at: new Date().toISOString() };
  fixtureArticleEdits.set(articleId, updated);

  return updated;
}

function startOfToday() {
  const today = new Date();

  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}
