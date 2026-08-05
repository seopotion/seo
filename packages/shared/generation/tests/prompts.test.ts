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
  maxInternalLinks: 0,
  linkCandidates: [],
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
  internal_links: [],
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

  test('buildHumanizePrompt passes the markdown as the user message', () => {
    const msgs = buildHumanizePrompt(ctx, '# Title\n\nbody');
    expect(msgs.at(-1)!.role).toBe('user');
    expect(msgs.at(-1)!.content).toContain('# Title');
    expect(msgs[0]!.content).toContain('Spanish');
  });
});
