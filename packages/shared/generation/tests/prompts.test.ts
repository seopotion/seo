import { describe, expect, test } from 'vitest';
import { buildArticlePrompt } from '../src/article';
import { buildHumanizePrompt } from '../src/humanize';
import type { GenerationContext, Outline } from '../src/types';

const ctx: GenerationContext = {
  businessName: 'Acme',
  businessDescription: 'widgets',
  language: 'Spanish',
  country: 'ES',
  audience: 'makers',
  competitors: ['rival.com'],
  articleStyle: 'practical',
  internalLinks: true,
  llmInstructions: '',
  keyword: 'mejores widgets',
  articleType: 'listicle',
  intent: 'commercial',
  serpCompetitors: [],
};

const outline: Outline = {
  h1: 'Los Mejores Widgets',
  meta_title: 't',
  meta_description: 'd',
  slug: 's',
  sections: [{ heading: 'Intro', intent: 'i' }],
  faqs: [{ question: '¿Que?', answer: 'a' }],
  internal_link_opportunities: ['guia de widgets'],
  cta: 'Compra ya',
};

describe('article + humanize prompts', () => {
  test('buildArticlePrompt carries language, keyword, headings, markdown instruction', () => {
    const joined = buildArticlePrompt(ctx, outline)
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('Spanish');
    expect(joined).toContain('mejores widgets');
    expect(joined).toContain('Intro');
    expect(joined.toLowerCase()).toContain('markdown');
  });

  // internal_links_count = 0 is the only way to turn linking off today (#186 —
  // there is no internal-linking system, so every generated link is invented).
  // The outline step emits `internal_link_opportunities` regardless of the
  // setting, so both prompt halves have to be gated, not just the instruction.
  test('internalLinks: false keeps link topics out of the prompt entirely', () => {
    const joined = buildArticlePrompt({ ...ctx, internalLinks: false }, outline)
      .map((m) => m.content)
      .join('\n');
    expect(joined).not.toContain('guia de widgets');
    expect(joined.toLowerCase()).not.toContain('internal-link');
    // The rest of the outline still has to survive the guard.
    expect(joined).toContain('Intro');
    expect(joined).toContain('Compra ya');
  });

  test('buildHumanizePrompt passes the markdown as the user message', () => {
    const msgs = buildHumanizePrompt(ctx, '# Title\n\nbody');
    expect(msgs.at(-1)!.role).toBe('user');
    expect(msgs.at(-1)!.content).toContain('# Title');
    expect(msgs[0]!.content).toContain('Spanish');
  });
});
