'use client';

import { META_DESCRIPTION_MAX, META_DESCRIPTION_MIN, META_TITLE_MAX } from '@shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { createFixtureArticleDetail, saveFixtureArticleDetail } from './article-editor-fixtures';
import { type ArticlePublishingState, shouldPollArticlePublishing } from './auto-publishing';
import { dashboardQueryKeys } from './dashboard-query-keys';

export type ArticleStatus = 'generated' | 'published' | 'deleted';
export type ArticleImagesStatus = 'pending' | 'complete' | 'failed';
export type ArticleEditorMode = 'editor' | 'preview';
export type ArticleSaveState = 'error' | 'idle' | 'saved' | 'saving';
export type ArticleSaveApiError = 'generic' | 'invalid' | 'not_found' | 'unauthorized';

/** The five fields the editor can change. */
export type EditableArticleField = 'content' | 'metaDescription' | 'metaTitle' | 'slug' | 'title';

/**
 * A view over `GET /dashboard/articles/{id}` (apps/api/src/schemas/dashboard.ts
 * `ArticleDetailResponse`). Content Planner and Content History cache the same
 * response under the same key, so they read it through this one type rather than
 * two partial ones that drift. `video` is omitted — nothing renders it yet.
 */
export type ArticleDetailResponse = ArticlePublishingState & {
  content: string;
  created_at: string;
  featured_image_url: string;
  id: string;
  images_status: ArticleImagesStatus;
  keyword: string | null;
  keyword_id: string | null;
  meta_description: string;
  meta_title: string;
  published_at: string | null;
  slug: string;
  static_site_published_at: string | null;
  status: ArticleStatus;
  title: string;
  updated_at: string | null;
  wordpress_post_id?: number;
};

export type ArticleEditorDraft = {
  content: string;
  createdAt: string;
  featuredImageUrl: string;
  id: string;
  imagesStatus: ArticleImagesStatus;
  keyword: string | null;
  metaDescription: string;
  metaTitle: string;
  publishedAt: string | null;
  slug: string;
  status: ArticleStatus;
  title: string;
  updatedAt: string | null;
};

export type ArticleUpdateBody = Pick<
  ArticleDetailResponse,
  'content' | 'meta_description' | 'meta_title' | 'slug' | 'title'
>;

export type ArticleEditorValidation = ReturnType<typeof getArticleEditorValidation>;

/** Snake-cased API record -> the editor's camelCase draft. */
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
export function toArticleUpdateBody(draftArticle: ArticleEditorDraft): ArticleUpdateBody {
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
 * Read the 400 body's `fields` map into editor field names. Only the names —
 * the server's messages are English-only, so the UI localizes its own.
 */
export function getServerInvalidFields(body: unknown): EditableArticleField[] {
  if (!body || typeof body !== 'object') return [];
  const fields = (body as { fields?: unknown }).fields;
  if (!fields || typeof fields !== 'object') return [];

  return Object.keys(fields).flatMap((key) => SERVER_FIELD_NAMES[key] ?? []);
}

/** Thrown by the save mutation so `onError` can localize by reason. */
class ArticleSaveError extends Error {
  reason: ArticleSaveApiError;
  invalidFields: EditableArticleField[];

  constructor(reason: ArticleSaveApiError, invalidFields: EditableArticleField[] = []) {
    super(reason);
    this.name = 'ArticleSaveError';
    this.reason = reason;
    this.invalidFields = invalidFields;
  }
}

export type ArticleEditorController = {
  /** The saved record as the server last returned it; null until it loads. */
  article: ArticleDetailResponse | null;
  canSave: boolean;
  continueEditing: () => void;
  dirty: boolean;
  discardAndClose: () => void;
  draftArticle: ArticleEditorDraft | null;
  isError: boolean;
  isPending: boolean;
  refetch: () => void;
  requestClose: () => void;
  saveArticle: () => void;
  saveError: ArticleSaveApiError | null;
  saveState: ArticleSaveState;
  serverInvalidFields: EditableArticleField[];
  showCloseConfirmation: boolean;
  updateDraftField: (field: EditableArticleField, value: string) => void;
  validation: ArticleEditorValidation;
};

/**
 * Load one article, hold the editor draft over it, and save the five editable
 * fields back (#74). Shared by the Content Planner modal and the Content History
 * detail page, which both address the article by the same query key — so a save
 * on either surface is immediately visible on the other.
 */
export function useArticleEditor({
  articleId,
  enabled = true,
  fixturesEnabled = false,
  onClose,
  onUnauthorized,
  organizationId,
  pollPublishingState = false,
  forcePublishingStateRefresh = false,
}: {
  articleId: string | null;
  /** Extra gate ANDed with "we have what the request needs" (e.g. not redirecting). */
  enabled?: boolean;
  fixturesEnabled?: boolean;
  /** Called once the editor is safe to leave — after a discard, or when clean. */
  onClose: () => void;
  onUnauthorized: () => void;
  organizationId: string;
  pollPublishingState?: boolean;
  forcePublishingStateRefresh?: boolean;
}): ArticleEditorController {
  const queryClient = useQueryClient();
  const previousArticleIdRef = useRef<string | null>(null);
  const [draftArticle, setDraftArticle] = useState<ArticleEditorDraft | null>(null);
  const [savedArticle, setSavedArticle] = useState<ArticleEditorDraft | null>(null);
  const [showCloseConfirmation, setShowCloseConfirmation] = useState(false);
  const [saveState, setSaveState] = useState<ArticleSaveState>('idle');
  const [saveError, setSaveError] = useState<ArticleSaveApiError | null>(null);
  const [serverInvalidFields, setServerInvalidFields] = useState<EditableArticleField[]>([]);

  // Both callbacks are re-created by their callers on most renders; holding them
  // in refs keeps the handlers below stable.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  const articleQuery = useQuery({
    queryKey: dashboardQueryKeys.articleDetail(organizationId, articleId ?? ''),
    queryFn: async (): Promise<ArticleDetailResponse | null> => {
      if (!articleId) return null;
      if (fixturesEnabled) return createFixtureArticleDetail(articleId);

      const response = await api.api.v0.dashboard.articles[':id'].$get({
        param: { id: articleId },
      });

      if ((response.status as number) === 401) {
        onUnauthorizedRef.current();
        return null;
      }

      // Null (not a throw) so the caller can tell "gone" from "broken".
      if ((response.status as number) === 404) return null;
      if (!response.ok) throw new Error('article_load_failed');

      return response.json();
    },
    // Fixtures render without an organization, so only the real path needs one.
    enabled:
      enabled && (fixturesEnabled ? Boolean(articleId) : Boolean(organizationId && articleId)),
    refetchInterval: (query) =>
      pollPublishingState &&
      shouldPollArticlePublishing(
        query.state.data?.auto_publish_attempts ?? [],
        forcePublishingStateRefresh,
      )
        ? 4_000
        : false,
    // The editor must never render content a concurrent save has replaced.
    staleTime: 0,
  });

  const loadedArticle = articleQuery.data ?? null;

  useEffect(() => {
    const changedArticle = previousArticleIdRef.current !== articleId;

    if (changedArticle) {
      previousArticleIdRef.current = articleId;
      setShowCloseConfirmation(false);
      setSaveState('idle');
      setSaveError(null);
      setServerInvalidFields([]);
    }

    if (!articleId || !loadedArticle) {
      if (changedArticle) {
        setDraftArticle(null);
        setSavedArticle(null);
      }
      return;
    }

    // Seed once the data arrives; an in-progress edit is never clobbered.
    setDraftArticle((current) =>
      changedArticle || !current ? mapArticleDetail(loadedArticle) : current,
    );
    setSavedArticle((current) =>
      changedArticle || !current ? mapArticleDetail(loadedArticle) : current,
    );
  }, [articleId, loadedArticle]);

  const saveMutation = useMutation({
    mutationFn: async (draft: ArticleEditorDraft): Promise<ArticleDetailResponse> => {
      const body = toArticleUpdateBody(draft);

      if (fixturesEnabled) return saveFixtureArticleDetail(draft.id, body);

      const response = await api.api.v0.dashboard.articles[':id'].$patch({
        param: { id: draft.id },
        json: body,
      });

      if (!response.ok) {
        const reason = getArticleSaveApiError(response.status as number);

        if (reason === 'unauthorized') {
          onUnauthorizedRef.current();
        }

        // The 400 body names the offending fields; the UI localizes them.
        const invalidFields =
          reason === 'invalid'
            ? getServerInvalidFields(await response.json().catch(() => null))
            : [];

        throw new ArticleSaveError(reason, invalidFields);
      }

      return response.json();
    },
    onSuccess: (updated) => {
      // Reseed from the response so `updated_at` is the server's, not ours.
      const nextArticle = mapArticleDetail(updated);
      setDraftArticle(nextArticle);
      setSavedArticle(nextArticle);
      setSaveState('saved');
      setSaveError(null);
      setServerInvalidFields([]);
      setShowCloseConfirmation(false);
      queryClient.setQueryData(
        dashboardQueryKeys.articleDetail(organizationId, updated.id),
        updated,
      );
      // Content History lists the title/slug this save may have changed.
      queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.articleLists(organizationId) });
    },
    onError: (error) => {
      setSaveState('error');
      setSaveError(error instanceof ArticleSaveError ? error.reason : 'generic');
      setServerInvalidFields(error instanceof ArticleSaveError ? error.invalidFields : []);
    },
  });

  const dirty = useMemo(
    () =>
      Boolean(
        draftArticle && savedArticle && hasEditableArticleChanges(savedArticle, draftArticle),
      ),
    [draftArticle, savedArticle],
  );
  const validation = useMemo(() => getArticleEditorValidation(draftArticle), [draftArticle]);
  const canSave = Boolean(draftArticle && dirty && validation.isValid);

  const requestClose = useCallback(() => {
    if (dirty) {
      setShowCloseConfirmation(true);
      return;
    }

    onCloseRef.current();
  }, [dirty]);

  const updateDraftField = useCallback((field: EditableArticleField, value: string) => {
    setDraftArticle((currentArticle) =>
      currentArticle ? { ...currentArticle, [field]: value } : currentArticle,
    );
    setSaveState('idle');
    setSaveError(null);
    // The server's verdict is stale the moment the user edits.
    setServerInvalidFields((current) => (current.length ? [] : current));
    setShowCloseConfirmation(false);
  }, []);

  const saveArticle = useCallback(() => {
    if (!draftArticle || !validation.isValid || saveMutation.isPending) {
      return;
    }

    setSaveState('saving');
    saveMutation.mutate(draftArticle);
  }, [draftArticle, saveMutation, validation.isValid]);

  const discardAndClose = useCallback(() => {
    if (savedArticle) {
      setDraftArticle(savedArticle);
    }

    setShowCloseConfirmation(false);
    onCloseRef.current();
  }, [savedArticle]);

  const continueEditing = useCallback(() => {
    setShowCloseConfirmation(false);
  }, []);

  const refetch = useCallback(() => {
    void articleQuery.refetch();
  }, [articleQuery]);

  return {
    article: loadedArticle,
    canSave,
    continueEditing,
    dirty,
    discardAndClose,
    draftArticle,
    isError: articleQuery.isError,
    isPending: articleQuery.isPending,
    refetch,
    requestClose,
    saveArticle,
    saveError,
    saveState,
    serverInvalidFields,
    showCloseConfirmation,
    updateDraftField,
    validation,
  };
}
