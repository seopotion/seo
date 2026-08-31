import type { CandidateStatus, GENERATION_STATUSES, SearchIntent } from '@shared/schemas';

export type PlannerArticleStatus = 'planned' | 'generated';
export type PlannerGenerationStatus = (typeof GENERATION_STATUSES)[number];
export type TargetKeywordStatus = 'available' | 'scheduled' | 'generating' | 'generated' | 'failed';
export type ResearchSeedError = 'required' | 'too_long';
export type KeywordResearchApiError =
  | 'forbidden'
  | 'generic'
  | 'invalid'
  | 'not_found'
  | 'provider'
  | 'unauthorized'
  | 'upgrade';
export type CandidateAddApiError =
  | 'forbidden'
  | 'generic'
  | 'invalid'
  | 'not_found'
  | 'unauthorized'
  | 'upgrade';
export type CandidateDeleteApiError =
  | 'candidate_not_deletable'
  | 'generic'
  | 'not_found'
  | 'unauthorized'
  | 'upgrade';
export type CandidateScheduleError =
  | 'candidate_already_scheduled'
  | 'candidate_not_schedulable'
  | 'date_occupied'
  | 'generic'
  | 'invalid_date'
  | 'keyword_already_scheduled'
  | 'not_found'
  | 'upgrade';

export type KeywordMetric = {
  competition: number | null;
  cpc: number | null;
  difficulty: number | null;
  intent: SearchIntent | null;
  keyword: string;
  search_volume: number | null;
  trend: number | null;
};

export type CandidateKeywordResponse = {
  difficulty: number | null;
  id: string;
  intent: SearchIntent | null;
  keyword: string;
  opportunity_score: number | null;
  schedulable: boolean;
  search_volume: number | null;
  status: CandidateStatus;
};

export type PlannerKeywordResponse = {
  article_id: string | null;
  candidate_id: string | null;
  difficulty: number;
  generation_error: string | null;
  generation_status: PlannerGenerationStatus;
  id: string;
  intent: SearchIntent | null;
  keyword: string;
  opportunity_score: number | null;
  scheduled_date: string;
  search_volume: number;
};

export type PlannerArticle = {
  articleId: string | null;
  candidateId: string | null;
  difficulty: number;
  generationError: string | null;
  generationStatus: PlannerGenerationStatus;
  id: string;
  intent: SearchIntent | null;
  keyword: string;
  opportunityScore: number | null;
  scheduledDate: string;
  status: PlannerArticleStatus;
  title: string;
  volume: number;
};

export type TargetKeyword = {
  candidateId: string | null;
  difficulty: number | null;
  id: string;
  intent: SearchIntent | null;
  keyword: string;
  opportunityScore: number | null;
  schedulable: boolean;
  source: 'candidate' | 'planner';
  status: TargetKeywordStatus;
  volume: number | null;
};

export type ArticleLoadApiError = 'generic' | 'not_found';

export type CalendarDay = {
  date: Date;
  dateKey: string;
  // Belongs to the month being displayed, rather than the padding days that
  // complete the first and last week rows.
  inMonth: boolean;
  isPast: boolean;
  article?: PlannerArticle;
};
