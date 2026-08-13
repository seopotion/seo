import { normalizeKeyword, type TopicRole } from '@shared/schemas';

export interface MaterializedTopicTarget {
  topic_cluster_id: string;
  topic_cluster_label: string;
  topic_role: TopicRole;
  primary_index: number;
  primary_keyword: string;
  member_indices: number[];
  content_focus: string;
  opportunity_score: number | null;
}

export interface TopicDuplicateMapping {
  duplicate_index: number;
  primary_index: number;
  topic_cluster_id: string;
}

export interface MaterializedTopicClusters {
  targets: MaterializedTopicTarget[];
  duplicates: TopicDuplicateMapping[];
}

export interface TopicCandidateTarget {
  keyword: string;
  opportunity_score: number | null;
  topic_cluster_id: string;
  topic_cluster_label: string;
  topic_role: TopicRole;
  topic_content_focus: string;
  topic_primary_keyword: string;
}

export class TopicClusterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TopicClusterValidationError';
  }
}

interface SelectionCluster {
  topicClusterId: string;
  priority: number | null;
  pillar: MaterializedTopicTarget;
  supports: MaterializedTopicTarget[];
}

function compareNullableScore(
  left: MaterializedTopicTarget,
  right: MaterializedTopicTarget,
): number {
  if (left.opportunity_score === null) return right.opportunity_score === null ? 0 : 1;
  if (right.opportunity_score === null) return -1;
  return right.opportunity_score - left.opportunity_score;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function selectionClusters(materialized: MaterializedTopicClusters): SelectionCluster[] {
  const targetsByCluster = new Map<string, MaterializedTopicTarget[]>();
  for (const target of materialized.targets) {
    const targets = targetsByCluster.get(target.topic_cluster_id) ?? [];
    targets.push(target);
    targetsByCluster.set(target.topic_cluster_id, targets);
  }

  return [...targetsByCluster.keys()]
    .sort(compareText)
    .map((topicClusterId) => {
      const targets = targetsByCluster.get(topicClusterId) as MaterializedTopicTarget[];
      const pillars = targets.filter((target) => target.topic_role === 'pillar');
      if (pillars.length !== 1) {
        throw new TopicClusterValidationError(
          `Topic cluster ${topicClusterId} must contain exactly one pillar target`,
        );
      }
      const scoredTargets = targets.filter((target) => target.opportunity_score !== null);
      const priority =
        scoredTargets.length === 0
          ? null
          : Math.max(...scoredTargets.map((target) => target.opportunity_score as number));
      const supports = targets
        .filter((target) => target.topic_role === 'support')
        .sort(
          (left, right) =>
            compareNullableScore(left, right) ||
            compareText(
              normalizeKeyword(left.primary_keyword),
              normalizeKeyword(right.primary_keyword),
            ) ||
            left.primary_index - right.primary_index,
        );
      return {
        topicClusterId,
        priority,
        pillar: pillars[0] as MaterializedTopicTarget,
        supports,
      };
    })
    .sort((left, right) => {
      if (left.priority === null)
        return right.priority === null ? compareText(left.topicClusterId, right.topicClusterId) : 1;
      if (right.priority === null) return -1;
      return (
        right.priority - left.priority || compareText(left.topicClusterId, right.topicClusterId)
      );
    });
}

export function selectTopicClusterTargets(
  materialized: MaterializedTopicClusters,
  limit: number,
): MaterializedTopicTarget[] {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new TopicClusterValidationError('limit must be a non-negative integer');
  }
  if (limit === 0 || materialized.targets.length === 0) return [];

  const clusters = selectionClusters(materialized);
  const selectedClusters = clusters.slice(0, limit);
  const selected = selectedClusters.map((cluster) => cluster.pillar);
  const supportPositions = new Array(selectedClusters.length).fill(0) as number[];

  while (selected.length < limit && selected.length < materialized.targets.length) {
    let added = false;
    for (const [clusterIndex, cluster] of selectedClusters.entries()) {
      if (selected.length >= limit) break;
      const supportPosition = supportPositions[clusterIndex] as number;
      const support = cluster.supports[supportPosition];
      if (support === undefined) continue;
      selected.push(support);
      supportPositions[clusterIndex] = supportPosition + 1;
      added = true;
    }
    if (!added) break;
  }

  return selected;
}

function requiredCandidateText(value: unknown, field: string, index: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TopicClusterValidationError(
      `Topic candidate index ${index} ${field} must be a non-empty string`,
    );
  }
  return value;
}

export function selectTopicCandidateTargets<T extends TopicCandidateTarget>(
  candidates: readonly T[],
  limit: number,
): T[] {
  const normalizedKeywords = new Set<string>();
  const labelsByCluster = new Map<string, string>();
  const targets = candidates.map((candidate, index): MaterializedTopicTarget => {
    const keyword = requiredCandidateText(candidate.keyword, 'keyword', index);
    const primaryKeyword = requiredCandidateText(
      candidate.topic_primary_keyword,
      'topic_primary_keyword',
      index,
    );
    const normalizedKeyword = normalizeKeyword(keyword);
    if (normalizeKeyword(primaryKeyword) !== normalizedKeyword) {
      throw new TopicClusterValidationError(
        `Topic candidate index ${index} is not a primary target: normalized topic_primary_keyword must equal normalized keyword`,
      );
    }
    if (normalizedKeywords.has(normalizedKeyword)) {
      throw new TopicClusterValidationError(
        `Duplicate primary target keyword ${normalizedKeyword} at topic candidate index ${index}`,
      );
    }
    normalizedKeywords.add(normalizedKeyword);

    const topicClusterId = requiredCandidateText(
      candidate.topic_cluster_id,
      'topic_cluster_id',
      index,
    );
    const topicClusterLabel = requiredCandidateText(
      candidate.topic_cluster_label,
      'topic_cluster_label',
      index,
    );
    const contentFocus = requiredCandidateText(
      candidate.topic_content_focus,
      'topic_content_focus',
      index,
    );
    if (candidate.topic_role !== 'pillar' && candidate.topic_role !== 'support') {
      throw new TopicClusterValidationError(
        `Topic candidate index ${index} topic_role must be pillar or support`,
      );
    }
    if (
      candidate.opportunity_score !== null &&
      (typeof candidate.opportunity_score !== 'number' ||
        !Number.isFinite(candidate.opportunity_score))
    ) {
      throw new TopicClusterValidationError(
        `Topic candidate index ${index} opportunity_score must be a finite number or null`,
      );
    }

    const priorLabel = labelsByCluster.get(topicClusterId);
    if (priorLabel !== undefined && priorLabel !== topicClusterLabel) {
      throw new TopicClusterValidationError(
        `Topic cluster ${topicClusterId} has inconsistent labels ${JSON.stringify(priorLabel)} and ${JSON.stringify(topicClusterLabel)}`,
      );
    }
    labelsByCluster.set(topicClusterId, topicClusterLabel);

    return {
      topic_cluster_id: topicClusterId,
      topic_cluster_label: topicClusterLabel,
      topic_role: candidate.topic_role,
      primary_index: index,
      primary_keyword: keyword,
      member_indices: [index],
      content_focus: contentFocus,
      opportunity_score: candidate.opportunity_score,
    };
  });

  const materialized = { targets, duplicates: [] };
  if (limit === 0 && targets.length > 0) {
    selectTopicClusterTargets(materialized, 1);
    return [];
  }
  return selectTopicClusterTargets(materialized, limit).map(
    (target) => candidates[target.primary_index] as T,
  );
}
