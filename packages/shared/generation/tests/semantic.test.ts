import { describe, expect, test } from 'vitest';
import { buildSemanticCheckPrompt, parseSemanticResult } from '../src/semantic';
import type { GenerationContext } from '../src/types';

const ctx = {
  businessName: 'Acme',
  competitors: ['rival.com'],
  keyword: 'best widgets',
  language: 'English',
  includeCta: true,
  topic_cluster_id: null,
  topic_cluster_label: null,
  topic_role: null,
  topic_content_focus: null,
  topic_primary_keyword: null,
} as GenerationContext;

describe('semantic check', () => {
  test('prompt names competitors, keyword, language, and the JSON contract', () => {
    const joined = buildSemanticCheckPrompt(ctx, '# Article\n\nbody')
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('rival.com');
    expect(joined).toContain('best widgets');
    expect(joined).toContain('English');
    expect(joined).toContain('pass');
  });

  test('parseSemanticResult parses pass/fail with defaulted reasons', () => {
    expect(parseSemanticResult('{"pass":true}')).toEqual({ pass: true, reasons: [] });
    expect(
      parseSemanticResult('```json\n{"pass":false,"reasons":["promotes rival"]}\n```'),
    ).toEqual({
      pass: false,
      reasons: ['promotes rival'],
    });
  });

  test('makes the final CTA preference a pass/fail requirement', () => {
    const enabled = buildSemanticCheckPrompt(ctx, '# Article\n\nBody')
      .map((message) => message.content)
      .join('\n');
    const disabled = buildSemanticCheckPrompt(
      { ...ctx, includeCta: false },
      '# Article\n\nContact us today.',
    )
      .map((message) => message.content)
      .join('\n');

    expect(enabled).toContain('lacks one concise, relevant call to action near the end');
    expect(disabled).toContain('contains a call to action');
    expect(disabled).toContain('contact, subscribe, buy, book, download, sign up');
  });

  test.each([
    ['pillar', 'broad, authoritative overview/hub'],
    ['support', 'deep coverage of the assigned focus'],
  ] as const)('a complete %s brief makes scope compliance mandatory', (role, scope) => {
    const focus = 'How membrane fouling affects reverse-osmosis output';
    const joined = buildSemanticCheckPrompt(
      {
        ...ctx,
        topic_cluster_id: 'topic:membrane fouling',
        topic_cluster_label: 'Membrane fouling',
        topic_role: role,
        topic_content_focus: focus,
        topic_primary_keyword: ' BEST   WIDGETS ',
      },
      '# Article\n\nbody',
    )
      .map((message) => message.content)
      .join('\n');

    expect(joined).toContain('Topic cluster: Membrane fouling');
    expect(joined).toContain(`Topic role: ${role}`);
    expect(joined).toContain(focus);
    expect(joined).toContain('materially ignores its assigned content focus');
    expect(joined).toContain(scope);
  });

  test('legacy and incomplete metadata keep the semantic check topic-agnostic', () => {
    const legacy = buildSemanticCheckPrompt(ctx, '# Article\n\nbody')
      .map((message) => message.content)
      .join('\n');
    const incomplete = buildSemanticCheckPrompt(
      {
        ...ctx,
        topic_cluster_id: 'topic:best widgets',
        topic_cluster_label: 'Widgets',
        topic_role: 'support',
        topic_content_focus: null,
        topic_primary_keyword: 'best widgets',
      },
      '# Article\n\nbody',
    )
      .map((message) => message.content)
      .join('\n');

    for (const prompt of [legacy, incomplete]) {
      expect(prompt).not.toContain('Topic cluster:');
      expect(prompt).not.toContain('Topic role:');
      expect(prompt).not.toContain('Assigned content focus');
      expect(prompt).not.toContain('pillar/support scope');
    }
  });
});
