import { addDays } from './planner-utils';
import type { PlannerArticle } from './types';

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
