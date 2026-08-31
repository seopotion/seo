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

const topicCtx = {
  ...ctx,
  topic_cluster_id: 'topic:membrane fouling',
  topic_cluster_label: 'Membrane fouling',
  topic_role: 'pillar',
  topic_content_focus: 'How membrane fouling affects reverse-osmosis output',
  topic_primary_keyword: 'best widgets',
} as GenerationContext;

const clean = {
  unsupported_claims: { violated: false, detail: '' },
  competitor_promotion: { violated: false, competitor: '', detail: '' },
  keyword_use: { violated: false, detail: '' },
  call_to_action: { violated: false, detail: '' },
  topic_scope: { violated: false, detail: '' },
  language: { violated: false, detail: '' },
};
const verdict = (patch: Record<string, unknown>) => JSON.stringify({ ...clean, ...patch });

describe('semantic check', () => {
  test('prompt names competitors, keyword, language, and every rule key', () => {
    const joined = buildSemanticCheckPrompt(ctx, '# Article\n\nbody')
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('rival.com');
    expect(joined).toContain('best widgets');
    expect(joined).toContain('English');
    for (const rule of ['competitor_promotion', 'keyword_use', 'call_to_action', 'language']) {
      expect(joined).toContain(rule);
    }
  });

  test('a clean verdict passes', () => {
    expect(parseSemanticResult(verdict({}), ctx)).toEqual({ pass: true, reasons: [] });
  });

  test('a violated rule fails and carries its detail', () => {
    expect(
      parseSemanticResult(
        verdict({ keyword_use: { violated: true, detail: 'keyword never appears' } }),
        ctx,
      ),
    ).toEqual({ pass: false, reasons: ['keyword_use: keyword never appears'] });
  });

  test('promoting a listed competitor fails, matching on the registrable name', () => {
    const result = parseSemanticResult(
      verdict({
        competitor_promotion: {
          violated: true,
          competitor: 'Rival',
          detail: 'the conclusion links to rival.com',
        },
      }),
      ctx,
    );
    expect(result.pass).toBe(false);
    expect(result.reasons[0]).toContain('the conclusion links to rival.com');
  });

  // #277: the judge kept failing articles for "promoting a competitor" when the
  // brand it named was the org's OWN — the one thing includeCta demands. A
  // business outside the competitor list can never be a competitor violation.
  test('naming a business that is not a listed competitor is not a violation', () => {
    expect(
      parseSemanticResult(
        verdict({
          competitor_promotion: {
            violated: true,
            competitor: 'Acme',
            detail: 'the conclusion recommends Acme as an alternative',
          },
        }),
        ctx,
      ),
    ).toEqual({ pass: true, reasons: [] });
  });

  test('an empty competitor list makes competitor promotion impossible', () => {
    expect(
      parseSemanticResult(
        verdict({
          competitor_promotion: { violated: true, competitor: 'Someone', detail: 'promotes them' },
        }),
        { ...ctx, competitors: [] } as GenerationContext,
      ).pass,
    ).toBe(true);
  });

  test('topic scope only counts when the article has a complete topic brief', () => {
    const scoped = verdict({ topic_scope: { violated: true, detail: 'strays from the pillar' } });
    expect(parseSemanticResult(scoped, ctx)).toEqual({ pass: true, reasons: [] });
    expect(parseSemanticResult(scoped, topicCtx)).toEqual({
      pass: false,
      reasons: ['topic_scope: strays from the pillar'],
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
    const joined = buildSemanticCheckPrompt({ ...topicCtx, topic_role: role }, '# Article\n\nbody')
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
      { ...topicCtx, topic_role: 'support', topic_content_focus: null },
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
