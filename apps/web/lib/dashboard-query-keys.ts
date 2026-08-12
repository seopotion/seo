import type { CandidateStatus } from '@shared/schemas';

export const dashboardQueryKeys = {
  all: ['dashboard'] as const,
  organizations: () => [...dashboardQueryKeys.all, 'organizations'] as const,
  organization: (organizationId: string) =>
    [...dashboardQueryKeys.all, 'organization', organizationId] as const,
  home: (organizationId: string) =>
    [...dashboardQueryKeys.organization(organizationId), 'home'] as const,
  analytics: (organizationId: string) =>
    [...dashboardQueryKeys.organization(organizationId), 'analytics'] as const,
  analyticsSummary: (organizationId: string, range: string, scope: string) =>
    [...dashboardQueryKeys.analytics(organizationId), 'summary', range, scope] as const,
  analyticsArticles: (organizationId: string, range: string) =>
    [...dashboardQueryKeys.analytics(organizationId), 'articles', range] as const,
  analyticsArticle: (organizationId: string, articleId: string) =>
    [...dashboardQueryKeys.analytics(organizationId), 'article', articleId] as const,
  planner: (organizationId: string) =>
    [...dashboardQueryKeys.organization(organizationId), 'planner'] as const,
  candidatePool: (organizationId: string) =>
    [...dashboardQueryKeys.organization(organizationId), 'candidate-pool'] as const,
  candidatePoolPages: (organizationId: string) =>
    [...dashboardQueryKeys.candidatePool(organizationId), 'pages'] as const,
  candidatePoolList: (organizationId: string, status: CandidateStatus, limit: number) =>
    [...dashboardQueryKeys.candidatePoolPages(organizationId), status, limit] as const,
  candidatePoolPage: (
    organizationId: string,
    status: CandidateStatus,
    limit: number,
    offset: number,
  ) => [...dashboardQueryKeys.candidatePoolList(organizationId, status, limit), offset] as const,
  articles: (organizationId: string) =>
    [...dashboardQueryKeys.organization(organizationId), 'articles'] as const,
  articleLists: (organizationId: string) =>
    [...dashboardQueryKeys.articles(organizationId), 'lists'] as const,
  articleList: (organizationId: string, status: string, limit: number, offset: number) =>
    [...dashboardQueryKeys.articleLists(organizationId), status, limit, offset] as const,
  articleDetails: (organizationId: string) =>
    [...dashboardQueryKeys.articles(organizationId), 'details'] as const,
  articleDetail: (organizationId: string, articleId: string) =>
    [...dashboardQueryKeys.articleDetails(organizationId), articleId] as const,
  settings: (organizationId: string) =>
    [...dashboardQueryKeys.organization(organizationId), 'settings'] as const,
  generalSettings: (organizationId: string) =>
    [...dashboardQueryKeys.settings(organizationId), 'general'] as const,
  articleSettings: (organizationId: string) =>
    [...dashboardQueryKeys.settings(organizationId), 'articles'] as const,
  connectedIntegrations: (organizationId: string) =>
    [...dashboardQueryKeys.organization(organizationId), 'integrations', 'connected'] as const,
  gscStatus: (organizationId: string) =>
    [...dashboardQueryKeys.organization(organizationId), 'gsc', 'status'] as const,
};
