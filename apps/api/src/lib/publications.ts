import { ArticleRepo } from '@shared/db';
import type { Article } from '@shared/schemas';

/**
 * Mirror a successful WordPress publish/update into `article.publications[]`
 * (#7), which replaces `wordpress_post_id` — that field stays written alongside
 * it for one release. Shared by the customer route and the admin lever so the
 * two cannot drift.
 *
 * The recorded slug is the one the remote now holds; the editor can change
 * `article.slug` afterwards, and that difference is what makes a stale remote
 * path detectable at the next publish (design/integrations-model.md).
 */
export async function recordWordPressPublication(
  article: Article,
  publication:
    | number
    | { post_id: number; slug: string; remote_url: string | null; published_at?: Date },
): Promise<void> {
  const postId = typeof publication === 'number' ? publication : publication.post_id;
  const publishedAt = typeof publication === 'number' ? undefined : publication.published_at;
  const existing = article.publications.some((entry) => entry.provider === 'wordpress');
  await ArticleRepo.recordPublication(
    article.id,
    {
      provider: 'wordpress',
      ref: String(postId),
      slug: typeof publication === 'number' ? article.slug : publication.slug,
      remote_url: typeof publication === 'number' ? undefined : publication.remote_url,
    },
    publishedAt
      ? existing
        ? { updatedAt: publishedAt }
        : { publishedAt, updatedAt: null }
      : undefined,
  );
}
