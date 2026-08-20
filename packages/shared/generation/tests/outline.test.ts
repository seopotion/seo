import { describe, expect, test } from 'vitest';
import { buildOutlinePrompt, parseOutline } from '../src/outline';
import type { GenerationContext } from '../src/types';

const ctx: GenerationContext = {
  businessName: 'Acme',
  businessDescription: 'We sell widgets',
  language: 'English',
  country: 'US',
  audience: 'makers',
  competitors: ['rival.com'],
  articleStyle: 'practical',
  includeCta: true,
  maxInternalLinks: 0,
  linkCandidates: [],
  llmInstructions: 'be concise',
  keyword: 'best widgets',
  topic_cluster_id: null,
  topic_cluster_label: null,
  topic_role: null,
  topic_content_focus: null,
  topic_primary_keyword: null,
  articleType: 'listicle',
  intent: 'commercial',
  serpCompetitors: [
    { rank: 1, url: 'https://a.com/best-widgets', domain: 'a.com', title: 'Top 10 Widgets' },
  ],
};

const withCandidates = (max: number): GenerationContext => ({
  ...ctx,
  maxInternalLinks: max,
  linkCandidates: [
    {
      title: 'Widget Guide',
      url: 'https://a.com/blog/widget-guide',
      topic_cluster_id: null,
      topic_role: null,
    },
    {
      title: 'Widget Care',
      url: 'https://a.com/blog/widget-care',
      topic_cluster_id: null,
      topic_role: null,
    },
  ],
});

const outlineJson = (internal_links: string[]) =>
  JSON.stringify({
    h1: 'Best Widgets Ranked',
    meta_title: 't',
    meta_description: 'd',
    slug: 'best-widgets',
    sections: [{ heading: 'H', intent: 'i' }],
    internal_links,
    cta: 'Compare the available options.',
  });

describe('outline', () => {
  test('buildOutlinePrompt includes keyword, language, and JSON instruction', () => {
    const msgs = buildOutlinePrompt(ctx);
    expect(msgs[0]!.role).toBe('system');
    const joined = msgs.map((m) => m.content).join('\n');
    expect(joined).toContain('best widgets');
    expect(joined).toContain('English');
    expect(joined.toLowerCase()).toContain('json');
  });

  test('buildOutlinePrompt lists ranking SERP articles with title and url (#144)', () => {
    const joined = buildOutlinePrompt(ctx)
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('Top 10 Widgets');
    expect(joined).toContain('https://a.com/best-widgets');
  });

  test('buildOutlinePrompt falls back to domain for legacy entries without title (#144)', () => {
    const legacy = {
      ...ctx,
      serpCompetitors: [{ rank: null, url: null, domain: 'a.com', title: null }],
    };
    const joined = buildOutlinePrompt(legacy)
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('a.com');
  });

  test('buildOutlinePrompt lists candidates with their exact URLs and the ceiling (#186)', () => {
    const joined = buildOutlinePrompt(withCandidates(2))
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('https://a.com/blog/widget-guide');
    expect(joined).toContain('Widget Guide');
    expect(joined).toContain('at most 2');
  });

  test('buildOutlinePrompt tells the model there is nothing to link when there are no candidates (#186)', () => {
    const joined = buildOutlinePrompt(ctx)
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('no internal link candidates');
  });

  test('buildOutlinePrompt requires an empty CTA when CTA generation is disabled', () => {
    const joined = buildOutlinePrompt({ ...ctx, includeCta: false })
      .map((message) => message.content)
      .join('\n');

    expect(joined).toContain('Set "cta" to an empty string');
  });

  test('parseOutline removes a model-produced CTA when CTA generation is disabled', () => {
    const out = parseOutline(
      JSON.stringify({
        h1: 'Best Widgets Ranked',
        meta_title: 't',
        meta_description: 'd',
        slug: 'best-widgets',
        sections: [{ heading: 'H', intent: 'i' }],
        cta: 'Buy now',
      }),
      { ...ctx, includeCta: false },
    );

    expect(out.cta).toBe('');
  });

  test('parseOutline rejects an empty CTA when CTA generation is enabled', () => {
    expect(() =>
      parseOutline(
        JSON.stringify({
          h1: 'Best Widgets Ranked',
          meta_title: 't',
          meta_description: 'd',
          slug: 'best-widgets',
          sections: [{ heading: 'H', intent: 'i' }],
          cta: '   ',
        }),
        ctx,
      ),
    ).toThrow('outline CTA is required');
  });

  test('a complete pillar brief sets its exact focus and broad hub scope', () => {
    const focus = 'How widgets work across the full production lifecycle';
    const pillar: GenerationContext = {
      ...ctx,
      topic_cluster_id: 'topic:best widgets',
      topic_cluster_label: 'Widget fundamentals',
      topic_role: 'pillar',
      topic_content_focus: focus,
      topic_primary_keyword: ' BEST   WIDGETS ',
      maxInternalLinks: 1,
      linkCandidates: [
        {
          title: 'Widget Sizing',
          url: 'https://a.com/blog/widget-sizing',
          topic_cluster_id: 'topic:best widgets',
          topic_role: 'support',
        },
      ],
    };

    const joined = buildOutlinePrompt(pillar)
      .map((message) => message.content)
      .join('\n');
    expect(joined).toContain('Topic cluster: Widget fundamentals');
    expect(joined).toContain('Topic role: pillar');
    expect(joined).toContain(focus);
    expect(joined).toContain('broad, authoritative cluster overview and hub');
    expect(joined).toContain('Do not exhaustively replace');
    expect(joined).toContain('[same-cluster support]');
    expect(joined).toContain('pick none if none fit');
  });

  test('legacy and incomplete briefs emit no partial topic instructions', () => {
    const legacy = buildOutlinePrompt(ctx)
      .map((message) => message.content)
      .join('\n');
    const incomplete = buildOutlinePrompt({
      ...ctx,
      topic_cluster_id: 'topic:best widgets',
      topic_cluster_label: 'Widget fundamentals',
      topic_role: 'pillar',
      topic_content_focus: null,
      topic_primary_keyword: 'best widgets',
    })
      .map((message) => message.content)
      .join('\n');

    for (const prompt of [legacy, incomplete]) {
      expect(prompt).not.toContain('Topic cluster:');
      expect(prompt).not.toContain('Topic role:');
      expect(prompt).not.toContain('Assigned content focus');
      expect(prompt).not.toContain('Topic scope:');
      expect(prompt).not.toContain('null');
      expect(prompt).not.toContain('undefined');
    }
  });

  test('parseOutline parses fenced JSON and applies defaults', () => {
    const out = parseOutline(
      '```json\n{"h1":"Best Widgets Ranked","meta_title":"t","meta_description":"d","slug":"best-widgets","sections":[{"heading":"H","intent":"i"}]}\n```',
      { ...ctx, includeCta: false },
    );
    expect(out.h1).toBe('Best Widgets Ranked');
    expect(out.faqs).toEqual([]);
    expect(out.internal_links).toEqual([]);
  });

  test('parseOutline rejects an outline with no sections', () => {
    expect(() =>
      parseOutline(
        '{"h1":"x","meta_title":"t","meta_description":"d","slug":"s","sections":[]}',
        ctx,
      ),
    ).toThrow();
  });

  test('parseOutline keeps candidate URLs and drops invented ones (#186)', () => {
    const out = parseOutline(
      outlineJson(['https://a.com/blog/widget-guide', '/features/invented', '#']),
      withCandidates(3),
    );
    expect(out.internal_links).toEqual(['https://a.com/blog/widget-guide']);
  });

  test('parseOutline caps at maxInternalLinks and de-duplicates (#186)', () => {
    const out = parseOutline(
      outlineJson([
        'https://a.com/blog/widget-guide',
        'https://a.com/blog/widget-guide',
        'https://a.com/blog/widget-care',
      ]),
      withCandidates(1),
    );
    expect(out.internal_links).toEqual(['https://a.com/blog/widget-guide']);
  });

  test('parseOutline canonicalizes a trailing-slash variant to our URL (#186)', () => {
    const out = parseOutline(outlineJson(['https://a.com/blog/widget-guide/']), withCandidates(2));
    expect(out.internal_links).toEqual(['https://a.com/blog/widget-guide']);
  });

  test('parseOutline yields no links when there are no candidates (#186)', () => {
    const out = parseOutline(outlineJson(['https://a.com/blog/widget-guide']), ctx);
    expect(out.internal_links).toEqual([]);
  });

  test('same-cluster status never forces the model to select a link', () => {
    const semantic: GenerationContext = {
      ...ctx,
      topic_cluster_id: 'topic:best widgets',
      topic_cluster_label: 'Widgets',
      topic_role: 'support',
      topic_content_focus: 'How to choose a widget',
      topic_primary_keyword: 'best widgets',
      maxInternalLinks: 1,
      linkCandidates: [
        {
          title: 'Widget Pillar',
          url: 'https://a.com/blog/widget-pillar',
          topic_cluster_id: 'topic:best widgets',
          topic_role: 'pillar',
        },
      ],
    };

    expect(parseOutline(outlineJson([]), semantic).internal_links).toEqual([]);
  });
});
