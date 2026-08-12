import { describe, expect, test } from 'vitest';
import { completeTopicBrief } from '../src/topic';

const complete = {
  keyword: ' Membrane   Fouling ',
  topic_cluster_id: 'topic:membrane fouling',
  topic_cluster_label: 'Membrane fouling',
  topic_role: 'pillar' as const,
  topic_content_focus: 'What membrane fouling is and why it occurs',
  topic_primary_keyword: 'membrane fouling',
};

describe('completeTopicBrief', () => {
  test('returns the exact complete brief when normalized primary and current keywords match', () => {
    expect(completeTopicBrief(complete)).toEqual({
      topic_cluster_id: 'topic:membrane fouling',
      topic_cluster_label: 'Membrane fouling',
      topic_role: 'pillar',
      topic_content_focus: 'What membrane fouling is and why it occurs',
      topic_primary_keyword: 'membrane fouling',
    });
  });

  test('returns null for legacy or incomplete metadata without throwing', () => {
    expect(
      completeTopicBrief({
        keyword: 'membrane fouling',
        topic_cluster_id: null,
        topic_cluster_label: null,
        topic_role: null,
        topic_content_focus: null,
        topic_primary_keyword: null,
      }),
    ).toBeNull();
    expect(completeTopicBrief({ ...complete, topic_content_focus: '   ' })).toBeNull();
    expect(completeTopicBrief({ ...complete, topic_cluster_label: null })).toBeNull();
  });

  test('returns null for an invalid role or a different primary keyword', () => {
    expect(completeTopicBrief({ ...complete, topic_role: 'overview' as never })).toBeNull();
    expect(
      completeTopicBrief({ ...complete, topic_primary_keyword: 'membrane cleaning' }),
    ).toBeNull();
  });
});
