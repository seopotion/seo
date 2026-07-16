export type PlannerArticleStatus = 'planned' | 'generated';

export type PlannerKeywordResponse = {
  article_id: string | null;
  difficulty: number;
  id: string;
  keyword: string;
  scheduled_date: string;
  search_volume: number;
};

export type PlannerArticle = {
  articleId: string | null;
  difficulty: number;
  id: string;
  keyword: string;
  scheduledDate: string;
  status: PlannerArticleStatus;
  title: string;
  volume: number;
};

export type ArticleEditorDraft = {
  id: string;
  keyword: string;
  title: string;
  metaTitle: string;
  slug: string;
  metaDescription: string;
  featuredImageUrl: string;
  content: string;
  status: 'generated' | 'published' | 'deleted';
  imagesStatus?: 'pending' | 'complete' | 'failed';
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string | null;
};

export type CalendarDay = {
  date: Date;
  dateKey: string;
  inRange: boolean;
  article?: PlannerArticle;
};
