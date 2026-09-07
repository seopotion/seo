import type { Article } from '@shared/schemas';
import { describe, expect, test } from 'vitest';
import {
  articlePath,
  manifestPath,
  type PublishedArticle,
  parseManifest,
  renderArticle,
  renderManifest,
} from '../src/lib/static-site';

/**
 * The committed contract (design/static-site-integration.md). These bytes land
 * in someone else's repository and are read by adapters we do not control, so
 * the assertions are on the exact output, not on a round-trip.
 */

const CDN = 'https://cdn.seopotion.com/orgs/org_1/articles/art_1';

function article(over: Partial<Article> = {}): Article {
  return {
    id: 'art_1',
    org_id: 'org_1',
    keyword_id: 'kw_1',
    title: 'How AI Outfit Generators Work',
    meta_title: 'How AI Outfit Generators Work | Guide',
    slug: 'ai-outfit-generator',
    keyword: 'ai outfit generator',
    topic_cluster_id: null,
    topic_cluster_label: null,
    topic_role: null,
    topic_content_focus: null,
    topic_primary_keyword: null,
    meta_description: 'What they do and how to use one.',
    featured_image_url: `${CDN}/cover.webp`,
    content: '## First section\n\nBody text.',
    difficulty: 30,
    search_volume: 500,
    status: 'generated',
    created_at: new Date('2026-07-01T00:00:00.000Z'),
    published_at: null,
    publications: [],
    auto_publish: { preflight_error: null, attempts: [] },
    updated_at: null,
    images: [
      {
        role: 'cover',
        section_heading: null,
        prompt: 'p',
        alt: 'A generated outfit',
        url: `${CDN}/cover.webp`,
        model: 'm',
        seed: null,
        generated_at: new Date('2026-07-01T00:00:00.000Z'),
        width: 1200,
        height: 630,
      },
    ],
    images_status: 'complete',
    video: null,
    readability: null,
    ...over,
  };
}

function published(over: Partial<PublishedArticle> = {}): PublishedArticle {
  const a = over.article ?? article();
  return {
    article: a,
    slug: a.slug,
    published_at: new Date('2026-07-29T10:15:00.000Z'),
    updated_at: null,
    ...over,
  };
}

describe('paths', () => {
  test('normalizes content_path however it was configured', () => {
    for (const configured of ['seopotion/', 'seopotion', '/seopotion/', '/seopotion']) {
      expect(articlePath(configured, 'a-slug')).toBe('seopotion/articles/a-slug.md');
      expect(manifestPath(configured)).toBe('seopotion/manifest.json');
    }
  });

  test('supports a nested path, and the repo root', () => {
    expect(articlePath('src/content/blog/', 'a-slug')).toBe('src/content/blog/articles/a-slug.md');
    expect(manifestPath('/')).toBe('manifest.json');
  });
});

describe('renderArticle', () => {
  test('emits every frontmatter field the contract names, then the body verbatim', () => {
    const out = renderArticle(published());

    expect(out).toBe(
      [
        '---',
        'source_article_id: "art_1"',
        'slug: "ai-outfit-generator"',
        'title: "How AI Outfit Generators Work"',
        'meta_title: "How AI Outfit Generators Work | Guide"',
        'meta_description: "What they do and how to use one."',
        'keyword: "ai outfit generator"',
        'published_at: "2026-07-29T10:15:00.000Z"',
        'updated_at: null',
        `cover: "${CDN}/cover.webp"`,
        'cover_alt: "A generated outfit"',
        'cover_width: 1200',
        'cover_height: 630',
        'images: []',
        'video: null',
        '---',
        '',
        '## First section',
        '',
        'Body text.',
        '',
      ].join('\n'),
    );
  });

  test('serializes a null keyword as an empty version-1 frontmatter string', () => {
    const generated = renderArticle(published());
    const standalone = renderArticle(published({ article: article({ keyword: null }) }));

    expect(standalone).toBe(generated.replace('keyword: "ai outfit generator"', 'keyword: ""'));
  });

  test('quotes scalars that would otherwise change meaning in YAML', () => {
    const out = renderArticle(
      published({
        article: article({
          // Unquoted, the colon-space ends the key; YAML 1.1 reads a bare `no`
          // as boolean false; a raw quote would break a naive quoted emitter.
          title: 'Widgets: A "Complete" Guide',
          slug: 'no',
        }),
      }),
    );

    expect(out).toContain('title: "Widgets: A \\"Complete\\" Guide"');
    expect(out).toContain('slug: "no"');
  });

  test('carries the body byte-for-byte, including raw HTML', () => {
    const content = '## Watch\n\n<iframe src="https://www.youtube.com/embed/x"></iframe>\n\nAfter.';
    const out = renderArticle(published({ article: article({ content }) }));

    expect(out.split('---\n\n')[1]).toBe(`${content}\n`);
  });

  test('lists inline images as a block sequence and drops unfilled slots', () => {
    const inline = (alt: string, url: string): Article['images'][number] => ({
      role: 'inline',
      section_heading: '## First section',
      prompt: 'p',
      alt,
      url,
      model: null,
      seed: null,
      generated_at: null,
      width: 1200,
      height: 672,
    });
    const out = renderArticle(
      published({
        article: article({
          images: [
            ...article().images,
            inline('Step one', `${CDN}/inline-1.webp`),
            // A slot the pipeline never filled would emit a broken `src`.
            inline('Step two', ''),
          ],
        }),
      }),
    );

    expect(out).toContain(
      [
        'images:',
        `  - src: "${CDN}/inline-1.webp"`,
        '    alt: "Step one"',
        '    width: 1200',
        '    height: 672',
      ].join('\n'),
    );
    expect(out).not.toContain('Step two');
  });

  test('falls back to null dimensions for images generated before #178', () => {
    const legacy = article({
      images: article().images.map((i) => ({ ...i, width: null, height: null })),
    });
    const out = renderArticle(published({ article: legacy }));

    expect(out).toContain('cover_width: null');
    expect(out).toContain('cover_height: null');
  });

  test('emits the video block when there is one', () => {
    const out = renderArticle(
      published({
        article: article({
          video: { video_id: 'dQw4w9WgXcQ', title: 'Outfit demo', section_heading: '## Watch' },
        }),
      }),
    );

    expect(out).toContain('video:\n  id: "dQw4w9WgXcQ"\n  title: "Outfit demo"');
  });

  test('stamps updated_at on a republish', () => {
    const out = renderArticle(published({ updated_at: new Date('2026-07-30T09:00:00.000Z') }));
    expect(out).toContain('updated_at: "2026-07-30T09:00:00.000Z"');
  });
});

describe('renderManifest', () => {
  const generatedAt = new Date('2026-07-29T10:15:00.000Z');

  test('is a version-1 index with repo-root-relative paths', () => {
    const json = renderManifest([published()], 'seopotion/', generatedAt);
    const manifest = JSON.parse(json);

    expect(manifest.version).toBe(1);
    expect(manifest.generated_at).toBe('2026-07-29T10:15:00.000Z');
    expect(manifest.articles).toEqual([
      {
        source_article_id: 'art_1',
        slug: 'ai-outfit-generator',
        title: 'How AI Outfit Generators Work',
        meta_title: 'How AI Outfit Generators Work | Guide',
        meta_description: 'What they do and how to use one.',
        keyword: 'ai outfit generator',
        cover: `${CDN}/cover.webp`,
        cover_alt: 'A generated outfit',
        cover_width: 1200,
        cover_height: 630,
        images: [],
        published_at: '2026-07-29T10:15:00.000Z',
        updated_at: null,
        path: 'seopotion/articles/ai-outfit-generator.md',
      },
    ]);
    // Ends with a newline: this file lands in someone else's `git diff`.
    expect(json.endsWith('}\n')).toBe(true);
  });

  test('serializes a null keyword as an empty version-1 manifest string', () => {
    const generated = renderManifest([published()], 'seopotion/', generatedAt);
    const standalone = renderManifest(
      [published({ article: article({ keyword: null }) })],
      'seopotion/',
      generatedAt,
    );

    expect(standalone).toBe(generated.replace('"keyword": "ai outfit generator"', '"keyword": ""'));
  });

  test('repeats the inline images, so an adapter never has to parse the frontmatter', () => {
    const withInline = article({
      images: [
        ...article().images,
        {
          role: 'inline',
          section_heading: '## First section',
          prompt: 'p',
          alt: 'Step one',
          url: `${CDN}/inline-1.webp`,
          model: null,
          seed: null,
          generated_at: null,
          width: 1200,
          height: 672,
        },
      ],
    });
    const manifest = JSON.parse(
      renderManifest([published({ article: withInline })], 'seopotion/', generatedAt),
    );

    expect(manifest.articles[0].images).toEqual([
      { src: `${CDN}/inline-1.webp`, alt: 'Step one', width: 1200, height: 672 },
    ]);
  });

  test('sorts newest first, breaking ties on slug so the bytes are deterministic', () => {
    const at = (iso: string, slug: string) =>
      published({ article: article({ slug }), slug, published_at: new Date(iso) });

    const json = renderManifest(
      [
        at('2026-07-01T00:00:00.000Z', 'oldest'),
        at('2026-07-29T00:00:00.000Z', 'same-day-b'),
        at('2026-07-29T00:00:00.000Z', 'same-day-a'),
      ],
      'seopotion/',
      generatedAt,
    );

    expect(JSON.parse(json).articles.map((a: { slug: string }) => a.slug)).toEqual([
      'same-day-a',
      'same-day-b',
      'oldest',
    ]);
  });

  test('addresses a renamed article by the slug it was committed under', () => {
    // The editor renamed the article after publishing; until it republishes,
    // the repo still holds the old filename and the index must point at it.
    const json = renderManifest(
      [published({ article: article({ slug: 'new-name' }), slug: 'old-name' })],
      'seopotion/',
      generatedAt,
    );

    const [entry] = JSON.parse(json).articles;
    expect(entry.slug).toBe('old-name');
    expect(entry.path).toBe('seopotion/articles/old-name.md');
  });

  test('parses a historical version-1 manifest without source ownership metadata', () => {
    const manifest = JSON.parse(renderManifest([published()], 'seopotion/', generatedAt));
    delete manifest.articles[0].source_article_id;

    expect(parseManifest(JSON.stringify(manifest)).articles[0]?.source_article_id).toBeNull();
  });
});
