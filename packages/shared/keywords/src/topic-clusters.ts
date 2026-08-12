import type { LlmClient, LlmCompleteParams, LlmMessage } from '@shared/providers';
import {
  type ArticleType,
  normalizeKeyword,
  type SearchIntent,
  type TopicRole,
} from '@shared/schemas';
import { parseJsonResponse } from './json-response';
import { compareTopicSignals, type TopicSignalCandidate } from './topic-signals';

export const TOPIC_CLUSTER_MAX_CANDIDATES = 150;
export const TOPIC_CLUSTER_SERP_NEIGHBORS = 3;

export interface TopicClusterCandidate extends TopicSignalCandidate {
  keyword: string;
  intent: SearchIntent | null;
  article_type: ArticleType | null;
  opportunity_score: number | null;
}

export interface TopicClusterContext {
  businessName: string;
  businessDescription: string;
  targetAudience: readonly string[];
  language: string;
  country: string;
}

export interface TopicArticleTarget {
  primary_index: number;
  member_indices: number[];
  content_focus: string;
}

export interface TopicCluster {
  label: string;
  pillar_index: number;
  targets: TopicArticleTarget[];
}

export interface TopicClusterResult {
  clusters: TopicCluster[];
}

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

interface PairwisePromptEvidence {
  left_index: number;
  right_index: number;
  serp_url_overlap: number;
}

function positivePairwiseEvidence(
  candidates: readonly TopicClusterCandidate[],
): PairwisePromptEvidence[] {
  const neighbors = Array.from({ length: candidates.length }, () => [] as PairwisePromptEvidence[]);
  for (let left = 0; left < candidates.length; left++) {
    for (let right = left + 1; right < candidates.length; right++) {
      const signals = compareTopicSignals(
        candidates[left] as TopicClusterCandidate,
        candidates[right] as TopicClusterCandidate,
      );
      if (signals.serp_url_overlap !== null && signals.serp_url_overlap > 0) {
        const row = {
          left_index: left,
          right_index: right,
          serp_url_overlap: signals.serp_url_overlap,
        };
        neighbors[left]?.push(row);
        neighbors[right]?.push(row);
      }
    }
  }

  const selected = new Map<string, PairwisePromptEvidence>();
  for (const [candidateIndex, candidateNeighbors] of neighbors.entries()) {
    candidateNeighbors
      .sort((left, right) => {
        if (left.serp_url_overlap !== right.serp_url_overlap) {
          return right.serp_url_overlap - left.serp_url_overlap;
        }
        const leftNeighbor =
          left.left_index === candidateIndex ? left.right_index : left.left_index;
        const rightNeighbor =
          right.left_index === candidateIndex ? right.right_index : right.left_index;
        return leftNeighbor - rightNeighbor;
      })
      .slice(0, TOPIC_CLUSTER_SERP_NEIGHBORS)
      .forEach((row) => {
        selected.set(`${row.left_index}:${row.right_index}`, row);
      });
  }

  return [...selected.values()].sort(
    (left, right) => left.left_index - right.left_index || left.right_index - right.right_index,
  );
}

function assertTopicClusterCandidateLimit(candidateCount: number): void {
  if (candidateCount > TOPIC_CLUSTER_MAX_CANDIDATES) {
    throw new TopicClusterValidationError(
      `Topic clustering accepts at most ${TOPIC_CLUSTER_MAX_CANDIDATES} candidates; received ${candidateCount}`,
    );
  }
}

export function buildTopicClusterPrompt(
  candidates: readonly TopicClusterCandidate[],
  context: TopicClusterContext,
): LlmMessage[] {
  assertTopicClusterCandidateLimit(candidates.length);
  const candidateRows = candidates.map((candidate, index) => {
    const row: Record<string, unknown> = {
      index,
      keyword: candidate.keyword,
      intent: candidate.intent,
      article_type: candidate.article_type,
      opportunity_score: candidate.opportunity_score,
    };
    if (typeof candidate.core_keyword === 'string' && candidate.core_keyword.trim().length > 0) {
      row.core_keyword = candidate.core_keyword.trim();
    }
    if ((candidate.category_ids?.length ?? 0) > 0) {
      row.category_ids = [...(candidate.category_ids ?? [])];
    }
    return row;
  });
  const pairwiseEvidence = positivePairwiseEvidence(candidates);

  return [
    {
      role: 'system',
      content:
        'Assign the candidates to broad topic clusters and distinct article targets. ' +
        'A topic cluster is a broad subject family. An article target is one page and search ' +
        'intent inside that family. Group singular, plural, synonymous, and other wording ' +
        'variants into one article target instead of proposing duplicate pages. Retain ' +
        'meaningfully distinct search intents as separate article targets inside the same ' +
        'cluster. Choose one broad, useful pillar target per topic cluster, and set pillar_index ' +
        "to that target's primary_index. Missing evidence is unknown, not disagreement. " +
        'Different provider core keywords do not prove different topics. Zero measured SERP URL ' +
        'overlap does not by itself prove different topics. Category evidence is supporting ' +
        'evidence only. Return every candidate index exactly once across all member_indices. ' +
        'Preserve a useful topic and target order. Respond ONLY with JSON matching: ' +
        '{"clusters":[{"label":string,"pillar_index":number,"targets":[' +
        '{"primary_index":number,"member_indices":number[],"content_focus":string}]}]}.',
    },
    {
      role: 'user',
      content: [
        `Business: ${context.businessName}`,
        `Description: ${context.businessDescription}`,
        `Target audience: ${context.targetAudience.join(', ')}`,
        `Language: ${context.language}`,
        `Country: ${context.country}`,
        `Candidates:\n${candidateRows.map((row) => JSON.stringify(row)).join('\n')}`,
        `Positive measured SERP-overlap evidence:\n${
          pairwiseEvidence.length > 0
            ? pairwiseEvidence.map((row) => JSON.stringify(row)).join('\n')
            : '(none available)'
        }`,
      ].join('\n'),
    },
  ];
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TopicClusterValidationError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function candidateIndex(value: unknown, path: string, candidateCount: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TopicClusterValidationError(`${path} must be an integer candidate index`);
  }
  if (value < 0 || value >= candidateCount) {
    throw new TopicClusterValidationError(
      `${path} index ${value} is out of range for ${candidateCount} candidates`,
    );
  }
  return value;
}

function validateTopicClusterResult(value: unknown, candidateCount: number): TopicClusterResult {
  if (!Number.isInteger(candidateCount) || candidateCount < 0) {
    throw new TopicClusterValidationError('candidateCount must be a non-negative integer');
  }
  const root = recordAt(value, 'Topic cluster response');
  if (!Array.isArray(root.clusters)) {
    throw new TopicClusterValidationError('Topic cluster response must contain a clusters array');
  }
  if (candidateCount > 0 && root.clusters.length === 0) {
    throw new TopicClusterValidationError(
      `Topic cluster response has no clusters; covered 0/${candidateCount} candidate indexes`,
    );
  }

  const seenMembers = new Set<number>();
  const seenPrimaries = new Set<number>();
  const clusters: TopicCluster[] = [];

  for (const [clusterPosition, rawCluster] of root.clusters.entries()) {
    const clusterPath = `clusters[${clusterPosition}]`;
    const cluster = recordAt(rawCluster, clusterPath);
    if (typeof cluster.label !== 'string' || cluster.label.trim().length === 0) {
      throw new TopicClusterValidationError(`${clusterPath}.label must be a non-empty string`);
    }
    const pillarIndex = candidateIndex(
      cluster.pillar_index,
      `${clusterPath}.pillar_index`,
      candidateCount,
    );
    if (!Array.isArray(cluster.targets) || cluster.targets.length === 0) {
      throw new TopicClusterValidationError(`${clusterPath}.targets must be a non-empty array`);
    }

    const targets: TopicArticleTarget[] = [];
    for (const [targetPosition, rawTarget] of cluster.targets.entries()) {
      const targetPath = `${clusterPath}.targets[${targetPosition}]`;
      const target = recordAt(rawTarget, targetPath);
      const primaryIndex = candidateIndex(
        target.primary_index,
        `${targetPath}.primary_index`,
        candidateCount,
      );
      if (seenPrimaries.has(primaryIndex)) {
        throw new TopicClusterValidationError(`Duplicate target primary index ${primaryIndex}`);
      }
      seenPrimaries.add(primaryIndex);

      if (!Array.isArray(target.member_indices) || target.member_indices.length === 0) {
        throw new TopicClusterValidationError(
          `${targetPath}.member_indices must be a non-empty array`,
        );
      }
      if (typeof target.content_focus !== 'string' || target.content_focus.trim().length === 0) {
        throw new TopicClusterValidationError(
          `${targetPath}.content_focus must be a non-empty string`,
        );
      }

      const memberIndices = target.member_indices.map((rawIndex, memberPosition) =>
        candidateIndex(rawIndex, `${targetPath}.member_indices[${memberPosition}]`, candidateCount),
      );
      if (!memberIndices.includes(primaryIndex)) {
        throw new TopicClusterValidationError(
          `${targetPath}.primary_index ${primaryIndex} must appear in its member_indices`,
        );
      }
      for (const memberIndex of memberIndices) {
        if (seenMembers.has(memberIndex)) {
          throw new TopicClusterValidationError(
            `Duplicate candidate index ${memberIndex}; covered ${seenMembers.size}/${candidateCount} unique candidate indexes before the duplicate`,
          );
        }
        seenMembers.add(memberIndex);
      }

      targets.push({
        primary_index: primaryIndex,
        member_indices: memberIndices,
        content_focus: target.content_focus,
      });
    }

    const pillarMatches = targets.filter((target) => target.primary_index === pillarIndex).length;
    if (pillarMatches !== 1) {
      throw new TopicClusterValidationError(
        `${clusterPath}.pillar_index ${pillarIndex} must be the primary_index of exactly one target in that cluster`,
      );
    }

    clusters.push({ label: cluster.label, pillar_index: pillarIndex, targets });
  }

  if (seenMembers.size !== candidateCount) {
    const missing = Array.from({ length: candidateCount }, (_, index) => index).filter(
      (index) => !seenMembers.has(index),
    );
    throw new TopicClusterValidationError(
      `Missing candidate indexes [${missing.join(', ')}]; covered ${seenMembers.size}/${candidateCount}`,
    );
  }

  return { clusters };
}

export function parseTopicClusterResponse(
  text: string,
  candidateCount: number,
): TopicClusterResult {
  const parsed = parseJsonResponse(text);
  if (parsed === null) {
    throw new TopicClusterValidationError('Topic cluster response is invalid JSON');
  }
  return validateTopicClusterResult(parsed, candidateCount);
}

export function materializeTopicClusters(
  candidates: readonly TopicClusterCandidate[],
  result: TopicClusterResult,
): MaterializedTopicClusters {
  const validated = validateTopicClusterResult(result, candidates.length);
  const targets: MaterializedTopicTarget[] = [];
  const duplicates: TopicDuplicateMapping[] = [];
  const clusterIds = new Set<string>();

  for (const cluster of validated.clusters) {
    const pillarCandidate = candidates[cluster.pillar_index] as TopicClusterCandidate;
    const normalizedPillarKeyword = normalizeKeyword(pillarCandidate.keyword);
    if (normalizedPillarKeyword.length === 0) {
      throw new TopicClusterValidationError(
        `Pillar candidate index ${cluster.pillar_index} has a blank normalized keyword`,
      );
    }
    const topicClusterId = `topic:${normalizedPillarKeyword}`;
    if (clusterIds.has(topicClusterId)) {
      throw new TopicClusterValidationError(`Duplicate topic cluster ID ${topicClusterId}`);
    }
    clusterIds.add(topicClusterId);

    for (const target of cluster.targets) {
      const primaryCandidate = candidates[target.primary_index] as TopicClusterCandidate;
      targets.push({
        topic_cluster_id: topicClusterId,
        topic_cluster_label: cluster.label,
        topic_role: target.primary_index === cluster.pillar_index ? 'pillar' : 'support',
        primary_index: target.primary_index,
        primary_keyword: primaryCandidate.keyword,
        member_indices: [...target.member_indices],
        content_focus: target.content_focus,
        opportunity_score: primaryCandidate.opportunity_score,
      });

      for (const memberIndex of target.member_indices) {
        if (memberIndex === target.primary_index) continue;
        duplicates.push({
          duplicate_index: memberIndex,
          primary_index: target.primary_index,
          topic_cluster_id: topicClusterId,
        });
      }
    }
  }

  return { targets, duplicates };
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

export async function assignTopicClusters(
  candidates: readonly TopicClusterCandidate[],
  context: TopicClusterContext,
  llm: LlmClient,
  model?: string,
): Promise<TopicClusterResult> {
  if (candidates.length === 0) return { clusters: [] };
  assertTopicClusterCandidateLimit(candidates.length);

  const request: LlmCompleteParams = {
    messages: buildTopicClusterPrompt(candidates, context),
    temperature: 0,
    responseFormat: 'json',
  };
  if (model !== undefined) request.model = model;
  const response = await llm.complete(request);
  return parseTopicClusterResponse(response.text, candidates.length);
}
