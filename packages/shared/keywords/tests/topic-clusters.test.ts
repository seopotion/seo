import type { LlmClient } from '@shared/providers';
import { describe, expect, it, vi } from 'vitest';
import {
  assignTopicClusters,
  buildTopicClusterPrompt,
  type MaterializedTopicClusters,
  type MaterializedTopicTarget,
  materializeTopicClusters,
  parseTopicClusterResponse,
  selectTopicCandidateTargets,
  selectTopicClusterTargets,
  TOPIC_CLUSTER_MAX_CANDIDATES,
  TOPIC_CLUSTER_SERP_NEIGHBORS,
  type TopicClusterCandidate,
  type TopicClusterContext,
  type TopicClusterResult,
} from '../src/topic-clusters';

const context: TopicClusterContext = {
  businessName: 'Clear Water Systems',
  businessDescription: 'Industrial reverse-osmosis treatment systems',
  targetAudience: ['plant operators', 'water-treatment engineers'],
  language: 'English',
  country: 'United States',
};

const candidate = (
  keyword: string,
  overrides: Partial<TopicClusterCandidate> = {},
): TopicClusterCandidate => ({
  keyword,
  intent: 'informational',
  article_type: 'definition',
  opportunity_score: 75,
  core_keyword: null,
  category_ids: [],
  serp_competitors: null,
  ...overrides,
});

const candidates = [
  candidate('reverse osmosis membrane', {
    core_keyword: 'reverse osmosis membrane',
    category_ids: [10, 20],
    serp_competitors: [{ url: 'https://source.example/a' }, { url: 'https://source.example/b' }],
  }),
  candidate('reverse osmosis membranes', {
    core_keyword: 'Reverse Osmosis Membrane',
    category_ids: [20, 30],
    serp_competitors: [{ url: 'https://source.example/b' }, { url: 'https://other.example/c' }],
  }),
  candidate('how to prevent membrane fouling', {
    intent: 'informational',
    article_type: 'how_to_guide',
    opportunity_score: 82,
    core_keyword: 'prevent membrane fouling',
  }),
];

const validResponse = () => ({
  clusters: [
    {
      label: 'Membrane fouling',
      pillar_index: 0,
      targets: [
        {
          primary_index: 0,
          member_indices: [0, 1],
          content_focus: 'What reverse-osmosis membranes are and how they work',
        },
        {
          primary_index: 2,
          member_indices: [2],
          content_focus: 'How operators can prevent membrane fouling',
        },
      ],
    },
  ],
});

const reply = (text: string) => ({
  text,
  model: 'served-model',
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: null },
});

const promptText = (input: readonly TopicClusterCandidate[]): string =>
  buildTopicClusterPrompt(input, context)
    .map((message) => message.content)
    .join('\n');

const promptEdges = (input: readonly TopicClusterCandidate[]) =>
  promptText(input)
    .split('\n')
    .filter((line) => line.startsWith('{"left_index"'))
    .map(
      (line) =>
        JSON.parse(line) as {
          left_index: number;
          right_index: number;
          serp_url_overlap: number;
        },
    );

describe('buildTopicClusterPrompt', () => {
  it('includes business, audience, candidate context, and compact candidate signals', () => {
    const messages = buildTopicClusterPrompt(candidates, context);
    const prompt = messages.map((message) => message.content).join('\n');

    expect(prompt).toContain('Clear Water Systems');
    expect(prompt).toContain('Industrial reverse-osmosis treatment systems');
    expect(prompt).toContain('plant operators');
    expect(prompt).toContain('water-treatment engineers');
    expect(prompt).toContain('reverse osmosis membranes');
    expect(prompt).toContain('how_to_guide');
    expect(prompt).toContain('"index":0');
    expect(prompt).toContain('"index":2');
    expect(prompt).toContain('"opportunity_score":82');
    expect(prompt).toContain('"core_keyword":"Reverse Osmosis Membrane"');
    expect(prompt).toContain('"category_ids":[10,20]');
    expect(prompt).toContain('"serp_url_overlap":0.3333333333333333');
    expect(prompt).not.toContain('"same_core_keyword"');
    expect(prompt).not.toContain('"shared_category_ids"');
  });

  it('states the unknown-evidence and article-target rules without exposing domains', () => {
    const prompt = buildTopicClusterPrompt(candidates, context)
      .map((message) => message.content)
      .join('\n');

    expect(prompt).toContain('Missing evidence is unknown');
    expect(prompt).toContain('Different provider core keywords do not prove different topics');
    expect(prompt).toContain('Zero measured SERP URL overlap does not by itself prove');
    expect(prompt).toContain('wording variants into one article target');
    expect(prompt).toContain('distinct search intents as separate article targets');
    expect(prompt).toContain('Return every candidate index exactly once');
    expect(prompt).not.toMatch(/competitor/i);
    expect(prompt).not.toContain('source.example');
    expect(prompt).not.toContain('other.example');
  });

  it('emits only positive measured SERP overlap', () => {
    const input = [
      candidate('one', { serp_competitors: [{ url: 'https://one.test/a' }] }),
      candidate('two', { serp_competitors: [{ url: 'https://two.test/b' }] }),
      candidate('three', { serp_competitors: null }),
      candidate('four', { serp_competitors: [{ url: 'https://one.test/a' }] }),
    ];

    expect(promptEdges(input)).toEqual([{ left_index: 0, right_index: 3, serp_url_overlap: 1 }]);
    expect(promptText(input)).not.toContain('https://');
  });

  it('bounds dense SERP evidence and selects deterministic neighbors and edge order', () => {
    const input = Array.from({ length: 20 }, (_, index) =>
      candidate(`dense ${index}`, { serp_competitors: [{ url: 'https://shared.test/page' }] }),
    );

    const edges = promptEdges(input);
    expect(edges.length).toBeLessThanOrEqual(input.length * TOPIC_CLUSTER_SERP_NEIGHBORS);
    expect(edges).toEqual(
      [...edges].sort(
        (left, right) => left.left_index - right.left_index || left.right_index - right.right_index,
      ),
    );
    expect(edges).toContainEqual({ left_index: 0, right_index: 19, serp_url_overlap: 1 });
    expect(edges).not.toContainEqual({ left_index: 18, right_index: 19, serp_url_overlap: 1 });
    expect(promptEdges(input)).toEqual(edges);
  });

  it('accepts 150 candidates and clearly rejects 151 in the builder and adapter', async () => {
    const accepted = Array.from({ length: TOPIC_CLUSTER_MAX_CANDIDATES }, (_, index) =>
      candidate(`candidate ${index}`),
    );
    expect(() => buildTopicClusterPrompt(accepted, context)).not.toThrow();

    const rejected = [...accepted, candidate('candidate 150')];
    expect(() => buildTopicClusterPrompt(rejected, context)).toThrow(
      /at most 150 candidates; received 151/i,
    );

    const llm: LlmClient = { complete: vi.fn() };
    await expect(assignTopicClusters(rejected, context, llm)).rejects.toThrow(
      /at most 150 candidates; received 151/i,
    );
    expect(llm.complete).not.toHaveBeenCalled();
  });
});

describe('parseTopicClusterResponse', () => {
  it('validates a pillar and support target while grouping wording variants', () => {
    const result = parseTopicClusterResponse(JSON.stringify(validResponse()), 3);

    expect(result).toEqual(validResponse());
    expect(result.clusters[0]!.targets[0]!.member_indices).toEqual([0, 1]);
    expect(result.clusters[0]!.targets.map((target) => target.primary_index)).toEqual([0, 2]);
  });

  it('preserves cluster and target order', () => {
    const response = {
      clusters: [
        {
          label: 'First',
          pillar_index: 0,
          targets: [
            { primary_index: 0, member_indices: [0], content_focus: 'First target' },
            { primary_index: 1, member_indices: [1], content_focus: 'Second target' },
          ],
        },
        {
          label: 'Second',
          pillar_index: 2,
          targets: [{ primary_index: 2, member_indices: [2], content_focus: 'Third target' }],
        },
      ],
    };

    const result = parseTopicClusterResponse(JSON.stringify(response), 3);
    expect(result.clusters.map((cluster) => cluster.label)).toEqual(['First', 'Second']);
    expect(result.clusters[0]!.targets.map((target) => target.content_focus)).toEqual([
      'First target',
      'Second target',
    ]);
  });

  it('accepts markdown-fenced valid JSON', () => {
    const fenced = `\`\`\`json\n${JSON.stringify(validResponse())}\n\`\`\``;
    expect(parseTopicClusterResponse(fenced, 3)).toEqual(validResponse());
  });

  it('accepts an empty cluster result only for empty input', () => {
    expect(parseTopicClusterResponse('{"clusters":[]}', 0)).toEqual({ clusters: [] });
    expect(() => parseTopicClusterResponse('{"clusters":[]}', 1)).toThrow(
      /no clusters; covered 0\/1/i,
    );
  });

  it('rejects invalid JSON and a missing clusters array', () => {
    expect(() => parseTopicClusterResponse('not json', 1)).toThrow(/invalid JSON/i);
    expect(() => parseTopicClusterResponse('{}', 1)).toThrow(/clusters array/i);
  });

  it.each([
    [
      'blank label',
      { ...validResponse(), clusters: [{ ...validResponse().clusters[0]!, label: ' ' }] },
      /label must be a non-empty string/i,
    ],
    [
      'blank content focus',
      {
        ...validResponse(),
        clusters: [
          {
            ...validResponse().clusters[0]!,
            targets: [
              { ...validResponse().clusters[0]!.targets[0]!, content_focus: '\t' },
              validResponse().clusters[0]!.targets[1]!,
            ],
          },
        ],
      },
      /content_focus must be a non-empty string/i,
    ],
  ])('rejects %s', (_name, response, error) => {
    expect(() => parseTopicClusterResponse(JSON.stringify(response), 3)).toThrow(error);
  });

  it('rejects missing candidate indexes with coverage counts', () => {
    const response = validResponse();
    response.clusters[0]!.targets = [response.clusters[0]!.targets[0]!];

    expect(() => parseTopicClusterResponse(JSON.stringify(response), 3)).toThrow(
      /Missing candidate indexes \[2\]; covered 2\/3/i,
    );
  });

  it('rejects duplicate candidate indexes with coverage counts', () => {
    const response = validResponse();
    response.clusters[0]!.targets[1]!.member_indices = [2, 1];

    expect(() => parseTopicClusterResponse(JSON.stringify(response), 3)).toThrow(
      /Duplicate candidate index 1; covered 3\/3 unique candidate indexes/i,
    );
  });

  it('rejects out-of-range and non-integer indexes', () => {
    const outOfRange = validResponse();
    outOfRange.clusters[0]!.targets[1]!.member_indices = [3];
    expect(() => parseTopicClusterResponse(JSON.stringify(outOfRange), 3)).toThrow(
      /index 3 is out of range for 3 candidates/i,
    );

    const nonInteger = validResponse();
    nonInteger.clusters[0]!.targets[0]!.primary_index = 0.5;
    expect(() => parseTopicClusterResponse(JSON.stringify(nonInteger), 3)).toThrow(
      /must be an integer candidate index/i,
    );
  });

  it('rejects a primary index outside its target members', () => {
    const response = validResponse();
    response.clusters[0]!.targets[0]!.member_indices = [1];

    expect(() => parseTopicClusterResponse(JSON.stringify(response), 3)).toThrow(
      /primary_index 0 must appear in its member_indices/i,
    );
  });

  it('rejects a pillar index that is not a target primary', () => {
    const response = validResponse();
    response.clusters[0]!.pillar_index = 1;

    expect(() => parseTopicClusterResponse(JSON.stringify(response), 3)).toThrow(
      /pillar_index 1 must be the primary_index of exactly one target/i,
    );
  });

  it('rejects duplicate target primary indexes', () => {
    const response = validResponse();
    response.clusters[0]!.targets[1]!.primary_index = 0;

    expect(() => parseTopicClusterResponse(JSON.stringify(response), 3)).toThrow(
      /Duplicate target primary index 0/i,
    );
  });

  it('rejects empty target and member lists', () => {
    const emptyTargets = validResponse();
    emptyTargets.clusters[0]!.targets = [];
    expect(() => parseTopicClusterResponse(JSON.stringify(emptyTargets), 3)).toThrow(
      /targets must be a non-empty array/i,
    );

    const emptyMembers = validResponse();
    emptyMembers.clusters[0]!.targets[0]!.member_indices = [];
    expect(() => parseTopicClusterResponse(JSON.stringify(emptyMembers), 3)).toThrow(
      /member_indices must be a non-empty array/i,
    );
  });
});

describe('materializeTopicClusters', () => {
  it('turns wording variants into one target plus a duplicate mapping', () => {
    const materialized = materializeTopicClusters(candidates, validResponse());

    expect(materialized).toEqual({
      targets: [
        {
          topic_cluster_id: 'topic:reverse osmosis membrane',
          topic_cluster_label: 'Membrane fouling',
          topic_role: 'pillar',
          primary_index: 0,
          primary_keyword: 'reverse osmosis membrane',
          member_indices: [0, 1],
          content_focus: 'What reverse-osmosis membranes are and how they work',
          opportunity_score: 75,
        },
        {
          topic_cluster_id: 'topic:reverse osmosis membrane',
          topic_cluster_label: 'Membrane fouling',
          topic_role: 'support',
          primary_index: 2,
          primary_keyword: 'how to prevent membrane fouling',
          member_indices: [2],
          content_focus: 'How operators can prevent membrane fouling',
          opportunity_score: 82,
        },
      ],
      duplicates: [
        {
          duplicate_index: 1,
          primary_index: 0,
          topic_cluster_id: 'topic:reverse osmosis membrane',
        },
      ],
    });
  });

  it('derives IDs only from normalized pillar keywords, not labels', () => {
    const first = materializeTopicClusters(candidates, validResponse());
    const renamed = validResponse();
    renamed.clusters[0]!.label = 'A completely different label';

    const second = materializeTopicClusters(candidates, renamed);

    expect(first.targets[0]!.topic_cluster_id).toBe('topic:reverse osmosis membrane');
    expect(second.targets[0]!.topic_cluster_id).toBe(first.targets[0]!.topic_cluster_id);
    expect(second.targets[0]!.topic_cluster_label).toBe('A completely different label');
  });

  it('preserves cluster, target, and member order and reads primary scores', () => {
    const input = [...candidates, candidate('membrane maintenance', { opportunity_score: null })];
    const result: TopicClusterResult = {
      clusters: [
        {
          label: 'Prevention',
          pillar_index: 2,
          targets: [
            {
              primary_index: 2,
              member_indices: [2, 1],
              content_focus: 'Prevention overview',
            },
            { primary_index: 0, member_indices: [0], content_focus: 'Membrane overview' },
          ],
        },
        {
          label: 'Maintenance',
          pillar_index: 3,
          targets: [
            { primary_index: 3, member_indices: [3], content_focus: 'Maintenance overview' },
          ],
        },
      ],
    };

    const materialized = materializeTopicClusters(input, result);

    expect(materialized.targets.map((target) => target.primary_index)).toEqual([2, 0, 3]);
    expect(materialized.targets[0]!.member_indices).toEqual([2, 1]);
    expect(materialized.targets.map((target) => target.opportunity_score)).toEqual([82, 75, null]);
    expect(materialized.duplicates.map((mapping) => mapping.duplicate_index)).toEqual([1]);
  });

  it('rejects malformed external results and blank normalized pillar keywords', () => {
    const duplicate = validResponse();
    duplicate.clusters[0]!.targets[1]!.member_indices = [2, 1];
    expect(() => materializeTopicClusters(candidates, duplicate)).toThrow(
      /Duplicate candidate index 1/i,
    );

    const blankCandidates = [candidate(' \t ')];
    const blankResult: TopicClusterResult = {
      clusters: [
        {
          label: 'Blank',
          pillar_index: 0,
          targets: [{ primary_index: 0, member_indices: [0], content_focus: 'Blank keyword' }],
        },
      ],
    };
    expect(() => materializeTopicClusters(blankCandidates, blankResult)).toThrow(
      /blank normalized keyword/i,
    );
  });

  it('does not mutate candidates or the validated result', () => {
    const input = candidates.map((entry) => ({
      ...entry,
      category_ids: [...(entry.category_ids ?? [])],
      serp_competitors: entry.serp_competitors?.map((serp) => ({ ...serp })) ?? null,
    }));
    const result = validResponse();
    const inputBefore = structuredClone(input);
    const resultBefore = structuredClone(result);

    materializeTopicClusters(input, result);

    expect(input).toEqual(inputBefore);
    expect(result).toEqual(resultBefore);
  });
});

const materializedTarget = (
  topicClusterId: string,
  topicRole: 'pillar' | 'support',
  primaryIndex: number,
  primaryKeyword: string,
  opportunityScore: number | null,
): MaterializedTopicTarget => ({
  topic_cluster_id: topicClusterId,
  topic_cluster_label: topicClusterId,
  topic_role: topicRole,
  primary_index: primaryIndex,
  primary_keyword: primaryKeyword,
  member_indices: [primaryIndex],
  content_focus: `${primaryKeyword} focus`,
  opportunity_score: opportunityScore,
});

const selectionFixture = (): MaterializedTopicClusters => ({
  targets: [
    materializedTarget('topic:a', 'support', 1, 'A first support', 90),
    materializedTarget('topic:c', 'pillar', 5, 'C pillar', null),
    materializedTarget('topic:b', 'support', 4, 'B support', 70),
    materializedTarget('topic:a', 'pillar', 0, 'A pillar', 20),
    materializedTarget('topic:b', 'pillar', 3, 'B pillar', 85),
    materializedTarget('topic:a', 'support', 2, 'A second support', 80),
  ],
  duplicates: [],
});

describe('selectTopicClusterTargets', () => {
  it('selects every chosen cluster pillar before draining supports round-robin', () => {
    const selected = selectTopicClusterTargets(selectionFixture(), 6);

    expect(selected.map((target) => target.primary_index)).toEqual([0, 3, 5, 1, 4, 2]);
    expect(selected.slice(0, 3).every((target) => target.topic_role === 'pillar')).toBe(true);
    for (const [position, target] of selected.entries()) {
      if (target.topic_role === 'pillar') continue;
      expect(
        selected
          .slice(0, position)
          .some(
            (earlier) =>
              earlier.topic_cluster_id === target.topic_cluster_id &&
              earlier.topic_role === 'pillar',
          ),
      ).toBe(true);
    }
  });

  it('uses cluster priority for a limit smaller than the cluster count', () => {
    expect(
      selectTopicClusterTargets(selectionFixture(), 2).map((target) => target.primary_index),
    ).toEqual([0, 3]);
  });

  it('breaks equal cluster priorities by topic cluster ID and puts all-null clusters last', () => {
    const materialized: MaterializedTopicClusters = {
      targets: [
        materializedTarget('topic:z', 'pillar', 0, 'Z pillar', 80),
        materializedTarget('topic:a', 'pillar', 1, 'A pillar', 80),
        materializedTarget('topic:null', 'pillar', 2, 'Null pillar', null),
      ],
      duplicates: [],
    };

    expect(
      selectTopicClusterTargets(materialized, 3).map((target) => target.primary_index),
    ).toEqual([1, 0, 2]);
  });

  it('orders supports by score, normalized keyword, index, with null scores last', () => {
    const materialized: MaterializedTopicClusters = {
      targets: [
        materializedTarget('topic:one', 'support', 5, 'aardvark', null),
        materializedTarget('topic:one', 'support', 4, ' alpha ', 80),
        materializedTarget('topic:one', 'support', 3, 'Zulu', 90),
        materializedTarget('topic:one', 'pillar', 0, 'Pillar', 10),
        materializedTarget('topic:one', 'support', 2, 'Beta', 80),
        materializedTarget('topic:one', 'support', 1, 'Alpha', 80),
      ],
      duplicates: [],
    };

    expect(
      selectTopicClusterTargets(materialized, 10).map((target) => target.primary_index),
    ).toEqual([0, 3, 1, 4, 2, 5]);
  });

  it('never selects duplicate variants as separate targets', () => {
    const materialized = materializeTopicClusters(candidates.slice(0, 2), {
      clusters: [
        {
          label: 'Membranes',
          pillar_index: 0,
          targets: [
            { primary_index: 0, member_indices: [0, 1], content_focus: 'Membrane overview' },
          ],
        },
      ],
    });

    expect(selectTopicClusterTargets(materialized, 10)).toHaveLength(1);
    expect(materialized.duplicates).toEqual([
      {
        duplicate_index: 1,
        primary_index: 0,
        topic_cluster_id: 'topic:reverse osmosis membrane',
      },
    ]);
  });

  it('preserves under-fill and returns empty for zero', () => {
    const materialized = selectionFixture();
    expect(selectTopicClusterTargets(materialized, 100)).toHaveLength(materialized.targets.length);
    expect(selectTopicClusterTargets(materialized, 0)).toEqual([]);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid limit %s', (limit) => {
    expect(() => selectTopicClusterTargets(selectionFixture(), limit)).toThrow(
      /limit must be a non-negative integer/i,
    );
  });

  it('is deterministic across repeated calls and target insertion order', () => {
    const materialized = selectionFixture();
    const reversed = { ...materialized, targets: [...materialized.targets].reverse() };

    const first = selectTopicClusterTargets(materialized, 6).map((target) => target.primary_index);
    const second = selectTopicClusterTargets(materialized, 6).map((target) => target.primary_index);
    const reordered = selectTopicClusterTargets(reversed, 6).map((target) => target.primary_index);

    expect(second).toEqual(first);
    expect(reordered).toEqual(first);
  });
});

const candidateTarget = (
  id: string,
  keyword: string,
  topicClusterId: string,
  topicRole: 'pillar' | 'support',
  opportunityScore: number | null,
) => ({
  id,
  keyword,
  opportunity_score: opportunityScore,
  topic_cluster_id: topicClusterId,
  topic_cluster_label: `${topicClusterId} label`,
  topic_role: topicRole,
  topic_content_focus: `${keyword} focus`,
  topic_primary_keyword: keyword,
});

describe('selectTopicCandidateTargets', () => {
  const fixture = () => [
    candidateTarget('a-support-high', 'Zulu support', 'topic:a', 'support', 90),
    candidateTarget('c-pillar', 'C pillar', 'topic:c', 'pillar', null),
    candidateTarget('b-support', 'B support', 'topic:b', 'support', 70),
    candidateTarget('a-pillar', 'A pillar', 'topic:a', 'pillar', 20),
    candidateTarget('b-pillar', 'B pillar', 'topic:b', 'pillar', 85),
    candidateTarget('a-support-low', 'Alpha support', 'topic:a', 'support', 80),
  ];

  it('delegates pillar-first cluster priority and round-robin support ordering', () => {
    const input = fixture();
    const selected = selectTopicCandidateTargets(input, input.length);

    expect(selected.map((target) => target.id)).toEqual([
      'a-pillar',
      'b-pillar',
      'c-pillar',
      'a-support-high',
      'b-support',
      'a-support-low',
    ]);
    expect(selected[0]).toBe(input[3]);
    expect(selected[3]).toBe(input[0]);
  });

  it('uses the cluster maximum score and selects only the best pillars below cluster count', () => {
    expect(selectTopicCandidateTargets(fixture(), 2).map((target) => target.id)).toEqual([
      'a-pillar',
      'b-pillar',
    ]);
  });

  it('retains normalized-keyword support ordering after score ties', () => {
    const input = [
      candidateTarget('support-zulu', 'Zulu', 'topic:one', 'support', 80),
      candidateTarget('pillar', 'Overview', 'topic:one', 'pillar', 1),
      candidateTarget('support-alpha', ' alpha ', 'topic:one', 'support', 80),
      candidateTarget('support-high', 'Beta', 'topic:one', 'support', 90),
      candidateTarget('support-null', 'Aardvark', 'topic:one', 'support', null),
    ];

    expect(selectTopicCandidateTargets(input, 10).map((target) => target.id)).toEqual([
      'pillar',
      'support-high',
      'support-alpha',
      'support-zulu',
      'support-null',
    ]);
  });

  it('rejects duplicate variants and malformed or inconsistent topic metadata', () => {
    const variant = candidateTarget(
      'variant',
      'reverse osmosis membranes',
      'topic:membranes',
      'pillar',
      80,
    );
    variant.topic_primary_keyword = 'reverse osmosis membrane';
    expect(() => selectTopicCandidateTargets([variant], 1)).toThrow(/not a primary target/i);

    const duplicate = candidateTarget('duplicate', ' Same ', 'topic:a', 'support', 1);
    expect(() =>
      selectTopicCandidateTargets(
        [candidateTarget('first', 'same', 'topic:a', 'pillar', 2), duplicate],
        2,
      ),
    ).toThrow(/duplicate primary target keyword/i);

    const missing = candidateTarget('missing', 'keyword', 'topic:a', 'pillar', 1);
    missing.topic_content_focus = ' ';
    expect(() => selectTopicCandidateTargets([missing], 1)).toThrow(
      /topic_content_focus must be a non-empty string/i,
    );

    const inconsistent = [
      candidateTarget('pillar', 'pillar', 'topic:a', 'pillar', 2),
      candidateTarget('support', 'support', 'topic:a', 'support', 1),
    ];
    inconsistent[1]!.topic_cluster_label = 'different label';
    expect(() => selectTopicCandidateTargets(inconsistent, 2)).toThrow(/inconsistent labels/i);

    expect(() =>
      selectTopicCandidateTargets(
        [candidateTarget('support-only', 'support', 'topic:a', 'support', 1)],
        0,
      ),
    ).toThrow(/exactly one pillar target/i);
  });

  it('does not mutate input and is deterministic across repeated calls', () => {
    const input = fixture();
    const before = structuredClone(input);

    const first = selectTopicCandidateTargets(input, input.length);
    const second = selectTopicCandidateTargets(input, input.length);

    expect(first).toEqual(second);
    expect(input).toEqual(before);
  });
});

describe('assignTopicClusters', () => {
  it('skips the LLM and returns an empty valid result for empty input', async () => {
    const llm: LlmClient = { complete: vi.fn() };

    await expect(assignTopicClusters([], context, llm)).resolves.toEqual({ clusters: [] });
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('calls the LLM once with exact deterministic JSON parameters and validates the response', async () => {
    const llm: LlmClient = {
      complete: vi.fn().mockResolvedValue(reply(JSON.stringify(validResponse()))),
    };

    const result = await assignTopicClusters(candidates, context, llm, 'topic-model');

    expect(result).toEqual(validResponse());
    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(llm.complete).toHaveBeenCalledWith({
      messages: buildTopicClusterPrompt(candidates, context),
      model: 'topic-model',
      temperature: 0,
      responseFormat: 'json',
    });
  });

  it('does not supply a model default when the optional model is absent', async () => {
    const llm: LlmClient = {
      complete: vi.fn().mockResolvedValue(
        reply(
          JSON.stringify({
            clusters: [
              {
                label: 'Membranes',
                pillar_index: 0,
                targets: [
                  { primary_index: 0, member_indices: [0], content_focus: 'Membrane basics' },
                ],
              },
            ],
          }),
        ),
      ),
    };

    await assignTopicClusters([candidates[0]!], context, llm);

    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(vi.mocked(llm.complete).mock.calls[0]![0]).not.toHaveProperty('model');
  });
});
