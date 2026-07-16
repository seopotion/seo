import { addDays } from './planner-utils';
import type { PlannerArticle } from './types';

export function createPlannerFixtureArticles(): PlannerArticle[] {
  const today = startOfToday();

  return [
    {
      articleId: 'dev-article-content-editor',
      difficulty: 34,
      id: 'dev-keyword-content-editor',
      keyword: 'content calendar for SaaS',
      scheduledDate: toDateKey(addDays(today, 1)),
      status: 'generated',
      title: 'Content Calendar for SaaS: A Practical Planning Guide',
      volume: 2400,
    },
    {
      articleId: null,
      difficulty: 18,
      id: 'dev-keyword-planned',
      keyword: 'seo brief template',
      scheduledDate: toDateKey(addDays(today, 3)),
      status: 'planned',
      title: 'seo brief template',
      volume: 1300,
    },
    {
      articleId: 'dev-article-meta-editor',
      difficulty: 42,
      id: 'dev-keyword-meta-editor',
      keyword: 'technical seo checklist',
      scheduledDate: toDateKey(addDays(today, 7)),
      status: 'generated',
      title: 'Technical SEO Checklist for Growing Websites',
      volume: 5400,
    },
  ];
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
