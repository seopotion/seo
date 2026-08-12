import { normalizeKeyword, type TopicRole } from '@shared/schemas';

export interface TopicBriefFields {
  topic_cluster_id: string | null;
  topic_cluster_label: string | null;
  topic_role: TopicRole | null;
  topic_content_focus: string | null;
  topic_primary_keyword: string | null;
}

export interface CompleteTopicBrief {
  topic_cluster_id: string;
  topic_cluster_label: string;
  topic_role: TopicRole;
  topic_content_focus: string;
  topic_primary_keyword: string;
}

export function completeTopicBrief(
  input: TopicBriefFields & { keyword: string },
): CompleteTopicBrief | null {
  const {
    topic_cluster_id,
    topic_cluster_label,
    topic_role,
    topic_content_focus,
    topic_primary_keyword,
  } = input;
  if (
    typeof topic_cluster_id !== 'string' ||
    !topic_cluster_id.trim() ||
    typeof topic_cluster_label !== 'string' ||
    !topic_cluster_label.trim() ||
    (topic_role !== 'pillar' && topic_role !== 'support') ||
    typeof topic_content_focus !== 'string' ||
    !topic_content_focus.trim() ||
    typeof topic_primary_keyword !== 'string' ||
    !topic_primary_keyword.trim() ||
    normalizeKeyword(topic_primary_keyword) !== normalizeKeyword(input.keyword)
  ) {
    return null;
  }
  return {
    topic_cluster_id,
    topic_cluster_label,
    topic_role,
    topic_content_focus,
    topic_primary_keyword,
  };
}
