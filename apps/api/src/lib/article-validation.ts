import type { Article } from '@shared/schemas';
import { META_DESCRIPTION_MAX, META_DESCRIPTION_MIN, META_TITLE_MAX } from '@shared/schemas';

type ArticleFields = Pick<
  Article,
  'title' | 'slug' | 'meta_title' | 'meta_description' | 'content'
>;

const isValidArticleSlug = (slug: string): boolean =>
  slug === slug.trim() && /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug);

export function validateArticleFields(body: ArticleFields): Record<string, string> {
  const fields: Record<string, string> = {};

  if (!body.title.trim()) fields.title = 'Title is required';
  if (!body.slug.trim()) fields.slug = 'Slug is required';
  else if (!isValidArticleSlug(body.slug))
    fields.slug = 'Slug must be one path segment containing letters, numbers, and hyphens';
  if (!body.content.trim()) fields.content = 'Content is required';

  if (!body.meta_title.trim()) fields.meta_title = 'Meta title is required';
  else if (body.meta_title.length > META_TITLE_MAX)
    fields.meta_title = `Meta title must be ${META_TITLE_MAX} characters or fewer`;

  if (!body.meta_description.trim()) fields.meta_description = 'Meta description is required';
  else if (
    body.meta_description.length < META_DESCRIPTION_MIN ||
    body.meta_description.length > META_DESCRIPTION_MAX
  )
    fields.meta_description = `Meta description must be between ${META_DESCRIPTION_MIN} and ${META_DESCRIPTION_MAX} characters`;

  return fields;
}
