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
  includeCta: true,
  maxInternalLinks: 0,
  linkCandidates: [],
  llmInstructions: '',
  keyword: 'mejores widgets',
  topic_cluster_id: null,
  topic_cluster_label: null,
  topic_role: null,
  topic_content_focus: null,
  topic_primary_keyword: null,
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

  test('adds grade 8 readability guidance to both English prompts only', () => {
    const english = { ...ctx, language: 'English' };
    const readabilityInstruction = 'Flesch-Kincaid grade level 8 or lower';

    const englishArticle = buildArticlePrompt(english, outline)
      .map((message) => message.content)
      .join('\n');
    const englishHumanize = buildHumanizePrompt(english, '# Title\n\nbody')
      .map((message) => message.content)
      .join('\n');

    expect(englishArticle).toContain(readabilityInstruction);
    expect(englishHumanize).toContain(readabilityInstruction);

    for (const language of ['Spanish', 'Turkish', 'english']) {
      const nonEnglish = { ...ctx, language };
      const article = buildArticlePrompt(nonEnglish, outline)
        .map((message) => message.content)
        .join('\n');
      const humanize = buildHumanizePrompt(nonEnglish, '# Title\n\nbody')
        .map((message) => message.content)
        .join('\n');

      expect(article).not.toContain(readabilityInstruction);
      expect(humanize).not.toContain(readabilityInstruction);
    }
  });

  test('passes the selected URL and its title, and forbids other links (#186)', () => {
    const linked = {
      ...ctx,
      maxInternalLinks: 2,
      linkCandidates: [
        {
          title: 'Widget Guide',
          url: 'https://a.com/blog/widget-guide',
          topic_cluster_id: null,
          topic_role: null,
        },
      ],
    };
    const joined = buildArticlePrompt(linked, {
      ...outline,
      internal_links: ['https://a.com/blog/widget-guide'],
    })
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('https://a.com/blog/widget-guide');
    expect(joined).toContain('Widget Guide');
    expect(joined).toContain('no other links');
  });

  test('forbids hyperlinks outright when nothing was selected (#186)', () => {
    const joined = buildArticlePrompt(ctx, { ...outline, internal_links: [] })
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('Do not include any hyperlinks');
  });

  test('omits CTA content and forbids adding one when the preference is disabled', () => {
    const withoutCta = { ...ctx, includeCta: false };
    const article = buildArticlePrompt(withoutCta, outline)
      .map((message) => message.content)
      .join('\n');
    const humanize = buildHumanizePrompt(withoutCta, '# Title\n\nBody')
      .map((message) => message.content)
      .join('\n');

    expect(article).toContain('Do not include a call to action');
    expect(article).not.toContain('Call to action: Compra ya');
    expect(humanize).toContain('Remove any call to action');
  });

  test('places and preserves one CTA near the end when enabled', () => {
    const article = buildArticlePrompt(ctx, outline)
      .map((message) => message.content)
      .join('\n');
    const humanize = buildHumanizePrompt(ctx, '# Title\n\nBody\n\nCompra ya')
      .map((message) => message.content)
      .join('\n');

    expect(article).toContain('Include the supplied call to action once, near the end');
    expect(article).toContain('Call to action: Compra ya');
    expect(humanize).toContain('Preserve the call to action near the end');
  });

  test('a complete support brief repeats its exact narrow scope in the writing prompt', () => {
    const focus = 'How makers size widgets for high-temperature machinery';
    const support: GenerationContext = {
      ...ctx,
      topic_cluster_id: 'topic:mejores widgets',
      topic_cluster_label: 'Selección de widgets',
      topic_role: 'support',
      topic_content_focus: focus,
      topic_primary_keyword: ' MEJORES   WIDGETS ',
    };

    const joined = buildArticlePrompt(support, outline)
      .map((message) => message.content)
      .join('\n');
    expect(joined).toContain('Topic cluster: Selección de widgets');
    expect(joined).toContain('Topic role: support');
    expect(joined).toContain(focus);
    expect(joined).toContain('go deep on the assigned content focus');
    expect(joined).toContain('Do not broaden it into a second cluster overview');
  });

  test('incomplete metadata preserves topic-agnostic article prompt behavior', () => {
    const joined = buildArticlePrompt(
      {
        ...ctx,
        topic_cluster_id: 'topic:mejores widgets',
        topic_cluster_label: 'Selección de widgets',
        topic_role: 'support',
        topic_content_focus: 'Widget sizing',
        topic_primary_keyword: 'different keyword',
      },
      outline,
    )
      .map((message) => message.content)
      .join('\n');
    expect(joined).not.toContain('Topic cluster:');
    expect(joined).not.toContain('Topic role:');
    expect(joined).not.toContain('Assigned content focus');
    expect(joined).not.toContain('Topic scope:');
  });
});
