import { normalizeKeyword, type SerpCompetitor } from '@shared/schemas';

export interface TopicSignalCandidate {
  core_keyword?: string | null;
  category_ids?: readonly number[];
  serp_competitors?: readonly Pick<SerpCompetitor, 'url'>[] | null;
}

export type CoreKeywordRelation = 'same' | 'different' | 'unknown';

export interface TopicSignalEvidence {
  core_keyword_relation: CoreKeywordRelation;
  serp_url_overlap: number | null;
  shared_category_ids: number[] | null;
}

function normalizedCoreKeyword(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = normalizeKeyword(value);
  return normalized.length > 0 ? normalized : null;
}

function urlSet(candidate: TopicSignalCandidate): Set<string> {
  return new Set(
    (candidate.serp_competitors ?? []).flatMap((entry) => {
      if (typeof entry.url !== 'string') return [];
      const url = entry.url.trim();
      return url.length > 0 ? [url] : [];
    }),
  );
}

export function compareTopicSignals(
  left: TopicSignalCandidate,
  right: TopicSignalCandidate,
): TopicSignalEvidence {
  const leftCore = normalizedCoreKeyword(left.core_keyword);
  const rightCore = normalizedCoreKeyword(right.core_keyword);
  const leftUrls = urlSet(left);
  const rightUrls = urlSet(right);
  let sharedUrls = 0;
  for (const url of leftUrls) if (rightUrls.has(url)) sharedUrls++;

  const rightCategories = new Set(right.category_ids ?? []);
  const sharedCategories = new Set(
    (left.category_ids ?? []).filter((categoryId) => rightCategories.has(categoryId)),
  );

  return {
    core_keyword_relation:
      leftCore === null || rightCore === null
        ? 'unknown'
        : leftCore === rightCore
          ? 'same'
          : 'different',
    serp_url_overlap:
      leftUrls.size === 0 || rightUrls.size === 0
        ? null
        : sharedUrls / (leftUrls.size + rightUrls.size - sharedUrls),
    shared_category_ids:
      (left.category_ids?.length ?? 0) === 0 || (right.category_ids?.length ?? 0) === 0
        ? null
        : [...sharedCategories].sort((a, b) => a - b),
  };
}
