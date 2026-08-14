import type { Article } from '@shared/schemas';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const recordPublication = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@shared/db', () => ({ ArticleRepo: { recordPublication } }));

import { recordWordPressPublication } from '../src/lib/publications';

const article = {
  id: 'article-1',
  slug: 'publishing-guide',
  publications: [],
} as unknown as Article;

beforeEach(() => {
  recordPublication.mockClear();
});

describe('WordPress publication recording', () => {
  test('records an explicit first-publication timestamp with no update', async () => {
    const publishedAt = new Date('2026-08-12T10:00:00.000Z');

    await recordWordPressPublication(article, {
      post_id: 42,
      slug: 'publishing-guide-final',
      remote_url: 'https://example.com/publishing-guide-final/',
      published_at: publishedAt,
    });

    expect(recordPublication).toHaveBeenCalledWith(
      article.id,
      {
        provider: 'wordpress',
        ref: '42',
        slug: 'publishing-guide-final',
        remote_url: 'https://example.com/publishing-guide-final/',
      },
      { publishedAt, updatedAt: null },
    );
  });

  test('records a WordPress republish as an update without moving its first publication', async () => {
    const updatedAt = new Date('2026-08-13T10:00:00.000Z');
    const published = {
      ...article,
      publications: [
        {
          provider: 'wordpress' as const,
          ref: '42',
          slug: article.slug,
          remote_url: null,
          published_at: new Date('2026-08-12T10:00:00.000Z'),
          updated_at: null,
        },
      ],
    };

    await recordWordPressPublication(published, {
      post_id: 42,
      slug: 'publishing-guide-final',
      remote_url: null,
      published_at: updatedAt,
    });

    expect(recordPublication).toHaveBeenCalledWith(
      article.id,
      expect.objectContaining({ provider: 'wordpress', ref: '42' }),
      { updatedAt },
    );
  });
});
