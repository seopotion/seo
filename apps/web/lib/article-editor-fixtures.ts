import type { ArticleDetailResponse, ArticleUpdateBody } from './article-editor';

/**
 * Dev-only article bodies behind `?fixtures=1`, so the editor is clickable
 * without seeded Mongo data. The Content Planner's `dev-article-missing` row has
 * no entry here on purpose — that is what makes the not-found panel demoable.
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
    keyword_id: 'dev-keyword-content-editor',
    meta_description:
      'Build a SaaS content calendar you can actually hold: pick a sustainable cadence, map topics across the funnel, and review what shipped each month.',
    meta_title: 'Content Calendar for SaaS: A Practical Guide',
    published_at: null,
    slug: 'content-calendar-for-saas',
    static_site_published_at: null,
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
    keyword_id: 'dev-keyword-meta-editor',
    meta_description:
      'A practical technical SEO checklist for growing websites, covering crawlability, indexation, Core Web Vitals, and structured data that stays valid.',
    meta_title: 'Technical SEO Checklist for Growing Sites',
    published_at: null,
    slug: 'technical-seo-checklist',
    static_site_published_at: null,
    status: 'generated',
    title: 'Technical SEO Checklist for Growing Websites',
    updated_at: '2026-07-09T14:20:00.000Z',
  },
};

/** Saves made during the session, so a fixture edit survives an editor reopen. */
const fixtureArticleEdits = new Map<string, ArticleDetailResponse>();

export function createFixtureArticleDetail(articleId: string): ArticleDetailResponse | null {
  return fixtureArticleEdits.get(articleId) ?? FIXTURE_ARTICLE_DETAILS[articleId] ?? null;
}

export function saveFixtureArticleDetail(
  articleId: string,
  patch: ArticleUpdateBody,
): ArticleDetailResponse {
  const current = createFixtureArticleDetail(articleId);

  if (!current) {
    throw new Error('fixture_article_not_found');
  }

  const updated = { ...current, ...patch, updated_at: new Date().toISOString() };
  fixtureArticleEdits.set(articleId, updated);

  return updated;
}
