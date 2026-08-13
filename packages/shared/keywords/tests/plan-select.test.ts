import { describe, expect, test } from 'vitest';
import type { MaterializedTopicClusters, MaterializedTopicTarget } from '../src/plan-select';
import { selectTopicClusterTargets, TopicClusterValidationError } from '../src/plan-select';

function target(
  overrides: Partial<MaterializedTopicTarget> & { topic_cluster_id: string; primary_index: number },
): MaterializedTopicTarget {
  return {
    topic_cluster_label: overrides.topic_cluster_id,
    topic_role: 'pillar',
    primary_keyword: `kw-${overrides.primary_index}`,
    member_indices: [overrides.primary_index],
    content_focus: 'focus',
    opportunity_score: 50,
    ...overrides,
  };
}

describe('selectTopicClusterTargets', () => {
  // Final-review finding 1: a cluster with zero pillar survivors (e.g. its
  // pillar was dropped by an upstream pool filter) is dropped instead of
  // throwing — its supports could never schedule anyway.
  test('a cluster with zero pillar survivors is dropped, not thrown', () => {
    const materialized: MaterializedTopicClusters = {
      targets: [
        target({
          topic_cluster_id: 'orphan',
          topic_role: 'support',
          primary_index: 0,
          opportunity_score: 90,
        }),
        target({
          topic_cluster_id: 'healthy',
          topic_role: 'pillar',
          primary_index: 1,
          opportunity_score: 80,
        }),
        target({
          topic_cluster_id: 'healthy',
          topic_role: 'support',
          primary_index: 2,
          opportunity_score: 70,
        }),
      ],
      duplicates: [],
    };

    const selected = selectTopicClusterTargets(materialized, 10);

    expect(selected.map((t) => t.primary_index)).toEqual([1, 2]);
  });

  test('a cluster with more than one pillar still throws', () => {
    const materialized: MaterializedTopicClusters = {
      targets: [
        target({ topic_cluster_id: 'dup', topic_role: 'pillar', primary_index: 0 }),
        target({ topic_cluster_id: 'dup', topic_role: 'pillar', primary_index: 1 }),
      ],
      duplicates: [],
    };

    expect(() => selectTopicClusterTargets(materialized, 10)).toThrow(TopicClusterValidationError);
  });
});
