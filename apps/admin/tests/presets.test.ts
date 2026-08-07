import type { SetupPresets } from '@shared/schemas';
import { describe, expect, test } from 'vitest';
import { diffPresets, normalizePresets } from '../src/lib/presets';

/** A full presets record — the editor always diffs two complete objects. */
const PRESETS: SetupPresets = {
  business: {
    name: 'Acme',
    language: 'en',
    country: 'US',
    description: 'We sell anvils.',
  },
  audience: {
    target: ['coyotes'],
    competitors: ['roadrunner.com', 'birdseed.io'],
  },
  blog: {
    sitemap_url: 'https://acme.test/sitemap.xml',
    main_blog_url: 'https://acme.test/blog',
    best_articles: ['https://acme.test/blog/anvils'],
  },
  article_preferences: {
    content_seo: {
      article_style: 'practical',
      internal_links_count: 1,
      table_of_contents: true,
      llm_instructions: 'Keep it dry.',
    },
    engagement: { image_style: 'photo', youtube_videos: true },
    publishing: { auto_publish: false },
  },
};

/** Structured-clone the fixture so a test's edits never leak into the next one. */
function edit(mutate: (draft: SetupPresets) => void): SetupPresets {
  const draft = structuredClone(PRESETS);
  mutate(draft);
  return draft;
}

describe('diffPresets', () => {
  test('an untouched draft produces an empty patch', () => {
    expect(diffPresets(PRESETS, structuredClone(PRESETS))).toEqual({});
  });

  test('a changed leaf produces only its own subtree', () => {
    const patch = diffPresets(
      PRESETS,
      edit((draft) => {
        draft.business.name = 'Acme Corp';
      }),
    );

    expect(patch).toEqual({ business: { name: 'Acme Corp' } });
  });

  test('a deeply nested leaf keeps the rest of its section out', () => {
    const patch = diffPresets(
      PRESETS,
      edit((draft) => {
        draft.article_preferences.publishing.auto_publish = true;
      }),
    );

    expect(patch).toEqual({ article_preferences: { publishing: { auto_publish: true } } });
  });

  test('an edited array is sent whole, because the merge replaces arrays', () => {
    const patch = diffPresets(
      PRESETS,
      edit((draft) => {
        draft.audience.competitors.push('acme-rival.com');
      }),
    );

    expect(patch).toEqual({
      audience: { competitors: ['roadrunner.com', 'birdseed.io', 'acme-rival.com'] },
    });
  });

  test('an array whose items are unchanged is absent', () => {
    const patch = diffPresets(
      PRESETS,
      edit((draft) => {
        draft.audience.competitors = ['roadrunner.com', 'birdseed.io'];
      }),
    );

    expect(patch).toEqual({});
  });

  test('several edits each keep their own path, and untouched sections are absent', () => {
    const patch = diffPresets(
      PRESETS,
      edit((draft) => {
        draft.business.country = 'CA';
        draft.article_preferences.content_seo.internal_links_count = 3;
      }),
    );

    expect(patch).toEqual({
      business: { country: 'CA' },
      article_preferences: { content_seo: { internal_links_count: 3 } },
    });
    expect(patch).not.toHaveProperty('audience');
    expect(patch).not.toHaveProperty('blog');
    expect(patch.article_preferences).not.toHaveProperty('engagement');
  });

  test('false and empty-string edits are patched, not treated as absent', () => {
    const patch = diffPresets(
      PRESETS,
      edit((draft) => {
        draft.article_preferences.content_seo.table_of_contents = false;
        draft.business.description = '';
      }),
    );

    expect(patch).toEqual({
      business: { description: '' },
      article_preferences: { content_seo: { table_of_contents: false } },
    });
  });
});

describe('normalizePresets', () => {
  test('drops blank list lines and trims the rest', () => {
    const normalized = normalizePresets(
      edit((draft) => {
        draft.audience.competitors = ['  roadrunner.com  ', '', 'birdseed.io', '   '];
      }),
    );

    expect(normalized.audience.competitors).toEqual(['roadrunner.com', 'birdseed.io']);
  });

  test('mid-typing whitespace does not read as a change', () => {
    const draft = edit((d) => {
      d.blog.best_articles = ['https://acme.test/blog/anvils', ''];
    });

    expect(diffPresets(PRESETS, normalizePresets(draft))).toEqual({});
  });

  test('leaves scalars alone', () => {
    expect(normalizePresets(structuredClone(PRESETS))).toEqual(PRESETS);
  });
});
