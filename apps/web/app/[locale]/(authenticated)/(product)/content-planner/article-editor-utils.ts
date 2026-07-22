import { META_DESCRIPTION_MAX, META_DESCRIPTION_MIN, META_TITLE_MAX } from '@shared/schemas';
import type {
  ArticleDetailResponse,
  ArticleEditorDraft,
  ArticleSaveApiError,
  EditableArticleField,
} from './types';

/** Snake-cased API record -> the modal's camelCase draft. */
export function mapArticleDetail(response: ArticleDetailResponse): ArticleEditorDraft {
  return {
    content: response.content,
    createdAt: response.created_at,
    featuredImageUrl: response.featured_image_url,
    id: response.id,
    imagesStatus: response.images_status,
    keyword: response.keyword,
    metaDescription: response.meta_description,
    metaTitle: response.meta_title,
    publishedAt: response.published_at,
    slug: response.slug,
    status: response.status,
    title: response.title,
    updatedAt: response.updated_at,
  };
}

/** The draft -> the PATCH body: exactly the five editable fields. */
export function toArticleUpdateBody(draftArticle: ArticleEditorDraft) {
  return {
    content: draftArticle.content,
    meta_description: draftArticle.metaDescription,
    meta_title: draftArticle.metaTitle,
    slug: draftArticle.slug,
    title: draftArticle.title,
  };
}

export function getArticleEditorValidation(article: ArticleEditorDraft | null) {
  const titleMissing = !article?.title.trim();
  const slugMissing = !article?.slug.trim();
  const metaTitleMissing = !article?.metaTitle.trim();
  const metaDescriptionMissing = !article?.metaDescription.trim();
  const contentMissing = !article?.content.trim();
  const metaTitleTooLong = article ? article.metaTitle.length > META_TITLE_MAX : false;
  const metaDescriptionOutsideTarget = article
    ? !metaDescriptionMissing &&
      (article.metaDescription.length < META_DESCRIPTION_MIN ||
        article.metaDescription.length > META_DESCRIPTION_MAX)
    : false;
  const requiredFieldsValid =
    !titleMissing &&
    !slugMissing &&
    !metaTitleMissing &&
    !metaDescriptionMissing &&
    !contentMissing;

  return {
    contentMissing,
    isValid: requiredFieldsValid && !metaTitleTooLong && !metaDescriptionOutsideTarget,
    metaDescriptionMissing,
    metaDescriptionOutsideTarget,
    metaTitleMissing,
    metaTitleTooLong,
    slugMissing,
    titleMissing,
  };
}

export function hasEditableArticleChanges(
  savedArticle: ArticleEditorDraft,
  draftArticle: ArticleEditorDraft,
) {
  return (
    savedArticle.title !== draftArticle.title ||
    savedArticle.slug !== draftArticle.slug ||
    savedArticle.metaTitle !== draftArticle.metaTitle ||
    savedArticle.metaDescription !== draftArticle.metaDescription ||
    savedArticle.content !== draftArticle.content
  );
}

export function getArticleSaveApiError(status: number): ArticleSaveApiError {
  if (status === 400) return 'invalid';
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'not_found';
  return 'generic';
}

const SERVER_FIELD_NAMES: Record<string, EditableArticleField> = {
  content: 'content',
  meta_description: 'metaDescription',
  meta_title: 'metaTitle',
  slug: 'slug',
  title: 'title',
};

/**
 * Read the 400 body's `fields` map into modal field names. Only the names —
 * the server's messages are English-only, so the modal localizes its own.
 */
export function getServerInvalidFields(body: unknown): EditableArticleField[] {
  if (!body || typeof body !== 'object') return [];
  const fields = (body as { fields?: unknown }).fields;
  if (!fields || typeof fields !== 'object') return [];

  return Object.keys(fields).flatMap((key) => SERVER_FIELD_NAMES[key] ?? []);
}
