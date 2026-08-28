import { ArticleRepo, IntegrationRepo, OrgRepo } from '@shared/db';
import {
  completeTopicBrief,
  deduplicateLinkCandidates,
  deriveCandidates,
  type LinkCandidate,
  MAX_LINK_CANDIDATES,
  type PostUrlSources,
  prioritizeLinkCandidates,
  verifyCandidates,
} from '@shared/generation';
import type { Article, ArticleRun, Keyword, SetupPresets } from '@shared/schemas';
import { isPaid } from '@shared/schemas';
import { ArticleFatalError } from '../errors';
import type { StageOutcome } from './types';

/**
 * Internal-link targets for this org: its own published articles, each derived
 * to a provider-shaped URL (#228) and then proven live (#186). Anything
 * unproven is dropped — an org with nothing published, or no way to name a
 * post URL, gets no links at all, whatever `internal_links_count` says.
 */
async function resolveLinkCandidates(
  orgId: string,
  presets: SetupPresets,
  keyword: Keyword,
): Promise<LinkCandidate[]> {
  const max = presets.article_preferences.content_seo.internal_links_count ?? 0;
  if (max <= 0) return [];

  let staticSitePostBase: string | null = null;
  for (const integration of await IntegrationRepo.listByOrgId(orgId)) {
    if (integration.provider === 'static-site') staticSitePostBase = integration.post_url_base;
  }
  const sources: PostUrlSources = { staticSitePostBase };

  const topic = completeTopicBrief(keyword);
  const publishedSeen = new Set<string>();
  const eligible = (articles: Article[]) => {
    const rows = articles.filter(
      (article) => article.org_id === orgId && article.status === 'published',
    );
    for (const row of rows) publishedSeen.add(row.id);
    return rows;
  };
  let derived: LinkCandidate[];

  if (topic) {
    const complementaryRole = topic.topic_role === 'pillar' ? 'support' : 'pillar';
    const complementary = eligible(
      await ArticleRepo.listPublishedByTopicCluster(orgId, topic.topic_cluster_id, {
        limit: MAX_LINK_CANDIDATES,
        role: { value: complementaryRole, mode: 'include' },
      }),
    );
    let sameClusterCandidates = deriveCandidates(sources, complementary);
    if (sameClusterCandidates.length < MAX_LINK_CANDIDATES) {
      const remainingSameCluster = eligible(
        await ArticleRepo.listPublishedByTopicCluster(orgId, topic.topic_cluster_id, {
          limit: MAX_LINK_CANDIDATES,
          role: { value: complementaryRole, mode: 'exclude' },
        }),
      );
      sameClusterCandidates = deduplicateLinkCandidates([
        ...sameClusterCandidates,
        ...deriveCandidates(sources, remainingSameCluster),
      ]);
    }
    let gathered = sameClusterCandidates;
    if (sameClusterCandidates.length < MAX_LINK_CANDIDATES) {
      const { articles } = await ArticleRepo.listByOrg(orgId, {
        status: 'published',
        limit: MAX_LINK_CANDIDATES,
        offset: 0,
      });
      gathered = [...sameClusterCandidates, ...deriveCandidates(sources, eligible(articles))];
    }
    derived = deduplicateLinkCandidates(prioritizeLinkCandidates(topic, gathered)).slice(
      0,
      MAX_LINK_CANDIDATES,
    );
  } else {
    const { articles } = await ArticleRepo.listByOrg(orgId, {
      status: 'published',
      limit: MAX_LINK_CANDIDATES,
      offset: 0,
    });
    derived = deriveCandidates(sources, eligible(articles)).slice(0, MAX_LINK_CANDIDATES);
  }

  const candidates = (await verifyCandidates(derived)).slice(0, MAX_LINK_CANDIDATES);
  if (publishedSeen.size > 0 && candidates.length === 0) {
    // The one signal that separates "this org published nothing" from "we
    // failed to place a single link for an org that DID publish" (#228).
    console.warn('internal links: published articles yielded no usable candidates', {
      published: publishedSeen.size,
      derived: derived.length,
      verified: 0,
    });
  }
  console.info('internal link candidates resolved', {
    derived: derived.length,
    verified: candidates.length,
  });
  return candidates;
}

export async function stagePrepare(run: ArticleRun): Promise<StageOutcome> {
  const org = await OrgRepo.findById(run.org_id);
  if (!org?.presets) throw new ArticleFatalError(`org ${run.org_id} missing or has no presets`);
  if (!isPaid(org)) throw new ArticleFatalError('org not paid');
  const link_candidates = await resolveLinkCandidates(org.id, org.presets, run.input.keyword);
  return { completed: true, working: { link_candidates } };
}
