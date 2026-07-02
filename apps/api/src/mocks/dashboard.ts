import type { z } from '@hono/zod-openapi';
import type { SetupPresets } from '@shared/schemas';
import type {
  ArticleDetailResponse,
  ArticlesResponse,
  PlannerResponse,
} from '../schemas/dashboard';

/**
 * Populated mock fixtures for the dashboard endpoints. These let the frontend
 * build real populated states (planner cards, history rows, filled settings)
 * against type-checked shapes. Swap for real repository reads later — this whole
 * module is the seam. See design/product-flow.md §2.
 */

type Article = z.infer<typeof ArticlesResponse>['articles'][number];
type ArticleDetail = z.infer<typeof ArticleDetailResponse>;
type PlannerKeyword = z.infer<typeof PlannerResponse>['keywords'][number];

// Content Planner (§2.1) — a mix of not-yet-generated (article_id: null →
// Pre-Create affordance) and generated (article_id set → Visit Article) cards.
export const MOCK_PLANNER: PlannerKeyword[] = [
  {
    id: 'kw_1',
    keyword: 'landing page design best practices',
    status: 'scheduled',
    scheduled_date: '2026-07-02',
    search_volume: 170,
    difficulty: 36,
    article_id: 'art_1',
  },
  {
    id: 'kw_2',
    keyword: 'notion website builder',
    status: 'scheduled',
    scheduled_date: '2026-07-03',
    search_volume: 2400,
    difficulty: 48,
    article_id: null,
  },
  {
    id: 'kw_3',
    keyword: 'how to add custom domain to notion',
    status: 'scheduled',
    scheduled_date: '2026-07-04',
    search_volume: 880,
    difficulty: 22,
    article_id: null,
  },
  {
    id: 'kw_4',
    keyword: 'best notion templates for startups',
    status: 'scheduled',
    scheduled_date: '2026-07-05',
    search_volume: 1300,
    difficulty: 41,
    article_id: null,
  },
  {
    id: 'kw_5',
    keyword: 'seo for notion sites',
    status: 'scheduled',
    scheduled_date: '2026-07-06',
    search_volume: 320,
    difficulty: 18,
    article_id: null,
  },
];

// Content History (§2.2) — generated/published rows for the active site.
export const MOCK_ARTICLES: Article[] = [
  {
    id: 'art_1',
    title: '10 Landing Page Design Best Practices for Notion Sites',
    slug: 'landing-page-design-best-practices',
    keyword: 'landing page design best practices',
    status: 'generated',
    difficulty: 36,
    search_volume: 170,
    featured_image_url: 'https://cdnimg.co/mock/landing-page-best-practices.png',
    created_at: '2026-07-02T08:12:00.000Z',
    published_at: null,
  },
  {
    id: 'art_2',
    title: 'How to Build a Notion Website: A Complete Guide',
    slug: 'how-to-build-a-notion-website',
    keyword: 'notion website builder',
    status: 'published',
    difficulty: 48,
    search_volume: 2400,
    featured_image_url: 'https://cdnimg.co/mock/notion-website-guide.png',
    created_at: '2026-07-01T08:05:00.000Z',
    published_at: '2026-07-01T09:00:00.000Z',
  },
];

// Full article records (§2.2.1), keyed by id, for GET /articles/:id.
export const MOCK_ARTICLE_DETAILS: Record<string, ArticleDetail> = {
  art_1: {
    id: 'art_1',
    keyword_id: 'kw_1',
    title: '10 Landing Page Design Best Practices for Notion Sites',
    slug: 'landing-page-design-best-practices',
    meta_description:
      'Master landing page design for your Notion site with these 10 proven best practices for higher conversions and better SEO.',
    featured_image_url: 'https://cdnimg.co/mock/landing-page-best-practices.png',
    content: [
      '# Build Landing Pages in Notion? Master These 10 Practices',
      '',
      'A great landing page turns visitors into customers. Here are ten practices that consistently move the needle.',
      '',
      '## 1. Lead with a clear value proposition',
      '',
      'Your headline should state the outcome, not the feature.',
      '',
      '## 2. Keep the call-to-action above the fold',
      '',
      'Visitors decide in seconds — make the next step obvious.',
    ].join('\n'),
    status: 'generated',
    created_at: '2026-07-02T08:12:00.000Z',
    published_at: null,
  },
  art_2: {
    id: 'art_2',
    keyword_id: 'kw_2',
    title: 'How to Build a Notion Website: A Complete Guide',
    slug: 'how-to-build-a-notion-website',
    meta_description:
      'Learn how to build and publish a professional website with Notion, from setup to custom domains and SEO.',
    featured_image_url: 'https://cdnimg.co/mock/notion-website-guide.png',
    content: [
      '# How to Build a Notion Website',
      '',
      'Notion is a surprisingly capable website builder. This guide walks through the full process.',
      '',
      '## Getting started',
      '',
      'Create a public page and structure your content.',
    ].join('\n'),
    status: 'published',
    created_at: '2026-07-01T08:05:00.000Z',
    published_at: '2026-07-01T09:00:00.000Z',
  },
};

// Settings baseline (§2.3 + §2.6) — the scan presets, now editable. GET returns
// these; PATCH deep-merges the caller's partial against them (non-persisting).
export const MOCK_PRESETS: SetupPresets = {
  business: {
    name: 'Clewas',
    language: 'English',
    country: 'Global (English)',
    description:
      'Clewas helps Notion users turn their pages into fast, SEO-friendly public websites without code.',
  },
  audience: {
    target: 'Content creators and bloggers using Notion for writing',
    competitors: ['super.so', 'potion.so', 'simple.ink'],
  },
  blog: {
    sitemap_url: 'https://www.clewas.com/sitemap.xml',
    main_blog_url: 'https://www.clewas.com/blog',
    best_articles: ['https://www.clewas.com/blog/notion-seo-guide'],
  },
  article_preferences: {
    content_seo: {
      article_style: 'Informative',
      internal_links: true,
      llm_instructions: 'Write in a practical, example-driven tone.',
    },
    engagement: {
      image_style: 'Sketch',
    },
  },
};
