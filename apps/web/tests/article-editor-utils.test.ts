import { describe, expect, test } from 'vitest';
import {
  getArticleEditorValidation,
  getArticleSaveApiError,
  getServerInvalidFields,
  hasEditableArticleChanges,
  mapArticleDetail,
  toArticleUpdateBody,
} from '../app/[locale]/(authenticated)/(product)/content-planner/article-editor-utils';
import type {
  ArticleDetailResponse,
  ArticleEditorDraft,
} from '../app/[locale]/(authenticated)/(product)/content-planner/types';

const response: ArticleDetailResponse = {
  content: '# body',
  created_at: '2026-07-10T10:00:00.000Z',
  featured_image_url: 'https://x/1.png',
  id: 'art_1',
  images_status: 'complete',
  keyword: 'technical seo checklist',
  meta_description: 'd'.repeat(130),
  meta_title: 'Technical SEO Checklist',
  published_at: null,
  slug: 'technical-seo-checklist',
  status: 'generated',
  title: 'Technical SEO Checklist for Growing Websites',
  updated_at: '2026-07-10T10:30:00.000Z',
};

const draft = (over: Partial<ArticleEditorDraft> = {}): ArticleEditorDraft => ({
  ...mapArticleDetail(response),
  ...over,
});

describe('mapArticleDetail / toArticleUpdateBody', () => {
  test('maps every response field to its camelCase counterpart', () => {
    expect(mapArticleDetail(response)).toEqual({
      content: '# body',
      createdAt: '2026-07-10T10:00:00.000Z',
      featuredImageUrl: 'https://x/1.png',
      id: 'art_1',
      imagesStatus: 'complete',
      keyword: 'technical seo checklist',
      metaDescription: 'd'.repeat(130),
      metaTitle: 'Technical SEO Checklist',
      publishedAt: null,
      slug: 'technical-seo-checklist',
      status: 'generated',
      title: 'Technical SEO Checklist for Growing Websites',
      updatedAt: '2026-07-10T10:30:00.000Z',
    });
  });

  test('a null updated_at survives the mapping', () => {
    expect(mapArticleDetail({ ...response, updated_at: null }).updatedAt).toBeNull();
  });

  test('round-trips the editable fields back to snake_case', () => {
    expect(toArticleUpdateBody(mapArticleDetail(response))).toEqual({
      content: response.content,
      meta_description: response.meta_description,
      meta_title: response.meta_title,
      slug: response.slug,
      title: response.title,
    });
  });

  test('sends only the five editable fields', () => {
    expect(Object.keys(toArticleUpdateBody(draft())).sort()).toEqual([
      'content',
      'meta_description',
      'meta_title',
      'slug',
      'title',
    ]);
  });
});

describe('getArticleEditorValidation', () => {
  test('a fully populated draft is valid', () => {
    expect(getArticleEditorValidation(draft()).isValid).toBe(true);
  });

  test('a null draft is invalid without throwing', () => {
    const validation = getArticleEditorValidation(null);
    expect(validation.isValid).toBe(false);
    expect(validation.titleMissing).toBe(true);
  });

  test.each([
    ['title', { title: '   ' }, 'titleMissing'],
    ['slug', { slug: '   ' }, 'slugMissing'],
    ['metaTitle', { metaTitle: '   ' }, 'metaTitleMissing'],
    ['metaDescription', { metaDescription: '   ' }, 'metaDescriptionMissing'],
    ['content', { content: '   ' }, 'contentMissing'],
  ] as const)('whitespace-only %s is treated as missing', (_field, over, flag) => {
    const validation = getArticleEditorValidation(draft(over));
    expect(validation[flag]).toBe(true);
    expect(validation.isValid).toBe(false);
  });

  test('meta title is valid at 60 and too long at 61', () => {
    expect(getArticleEditorValidation(draft({ metaTitle: 'x'.repeat(60) })).metaTitleTooLong).toBe(
      false,
    );
    expect(getArticleEditorValidation(draft({ metaTitle: 'x'.repeat(61) })).metaTitleTooLong).toBe(
      true,
    );
  });

  test.each([
    [119, true],
    [120, false],
    [160, false],
    [161, true],
  ])('meta description of %i chars is outside target: %s', (length, outside) => {
    const validation = getArticleEditorValidation(draft({ metaDescription: 'x'.repeat(length) }));
    expect(validation.metaDescriptionOutsideTarget).toBe(outside);
    expect(validation.isValid).toBe(!outside);
  });

  test('a missing meta description reports missing, not out-of-target', () => {
    const validation = getArticleEditorValidation(draft({ metaDescription: '' }));
    expect(validation.metaDescriptionMissing).toBe(true);
    expect(validation.metaDescriptionOutsideTarget).toBe(false);
  });
});

describe('hasEditableArticleChanges', () => {
  test('is false when nothing changed', () => {
    expect(hasEditableArticleChanges(draft(), draft())).toBe(false);
  });

  test.each([
    'title',
    'slug',
    'metaTitle',
    'metaDescription',
    'content',
  ] as const)('detects a change to %s', (field) => {
    expect(hasEditableArticleChanges(draft(), draft({ [field]: 'changed' }))).toBe(true);
  });

  test('ignores non-editable fields', () => {
    expect(hasEditableArticleChanges(draft(), draft({ updatedAt: 'later' }))).toBe(false);
  });
});

describe('getArticleSaveApiError', () => {
  test.each([
    [400, 'invalid'],
    [401, 'unauthorized'],
    [404, 'not_found'],
    [403, 'generic'],
    [500, 'generic'],
  ] as const)('maps %i to %s', (status, expected) => {
    expect(getArticleSaveApiError(status)).toBe(expected);
  });
});

describe('getServerInvalidFields', () => {
  test('maps snake_case server keys to modal field names', () => {
    const body = {
      error: 'Validation failed',
      fields: { meta_title: 'too long', meta_description: 'wrong length', title: 'required' },
    };
    expect(getServerInvalidFields(body).sort()).toEqual(['metaDescription', 'metaTitle', 'title']);
  });

  test('drops keys the modal has no field for', () => {
    expect(getServerInvalidFields({ fields: { org_id: 'nope' } })).toEqual([]);
  });

  test.each([
    [null],
    [undefined],
    ['nope'],
    [42],
    [{}],
    [{ fields: null }],
    [{ fields: 'x' }],
  ])('returns [] for garbage: %s', (body) => {
    expect(getServerInvalidFields(body)).toEqual([]);
  });
});
