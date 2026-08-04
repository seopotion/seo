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
export async function recordWordPressPublication(article: Article, postId: number): Promise<void> {
  await ArticleRepo.recordPublication(article.id, {
    provider: 'wordpress',
    ref: String(postId),
    slug: article.slug,
  });
}
