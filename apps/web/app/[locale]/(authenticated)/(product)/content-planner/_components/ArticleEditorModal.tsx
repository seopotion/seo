'use client';

import { META_DESCRIPTION_MAX, META_DESCRIPTION_MIN, META_TITLE_MAX } from '@shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Edit3, Eye, ImageIcon, Loader2, Save, X } from 'lucide-react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Input, Label, Separator, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { cn } from '@/lib/utils';
import {
  getArticleEditorValidation,
  getArticleSaveApiError,
  getServerInvalidFields,
  hasEditableArticleChanges,
  mapArticleDetail,
  toArticleUpdateBody,
} from '../article-editor-utils';
import { createFixtureArticleDetail, saveFixtureArticleDetail } from '../fixtures';
import { formatDateFromKey, formatDateTime, formatNumber } from '../planner-utils';
import type {
  ArticleDetailResponse,
  ArticleEditorDraft,
  ArticleSaveApiError,
  EditableArticleField,
  PlannerArticle,
  PlannerArticleStatus,
} from '../types';

type ContentPlannerTranslations = ReturnType<typeof useTranslations<'ContentPlannerPage'>>;
type ArticleEditorMode = 'editor' | 'preview';
type ArticleSaveState = 'error' | 'idle' | 'saved' | 'saving';

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

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function ArticleEditorModal({
  article,
  fixturesEnabled,
  onClose,
  onUnauthorized,
  organizationId,
}: {
  article: PlannerArticle | null;
  fixturesEnabled: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
  organizationId: string;
}) {
  const t = useTranslations('ContentPlannerPage');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousArticleKeyRef = useRef<string | null>(null);
  const [draftArticle, setDraftArticle] = useState<ArticleEditorDraft | null>(null);
  const [savedArticle, setSavedArticle] = useState<ArticleEditorDraft | null>(null);
  const [editorMode, setEditorMode] = useState<ArticleEditorMode>('editor');
  const [showCloseConfirmation, setShowCloseConfirmation] = useState(false);
  const [saveState, setSaveState] = useState<ArticleSaveState>('idle');
  const [saveError, setSaveError] = useState<ArticleSaveApiError | null>(null);
  const [serverInvalidFields, setServerInvalidFields] = useState<EditableArticleField[]>([]);
  const articleId = article?.articleId ?? null;
  const articleKey = articleId ?? article?.id ?? null;

  const articleQuery = useQuery({
    queryKey: dashboardQueryKeys.articleDetail(organizationId, articleId ?? ''),
    queryFn: async (): Promise<ArticleDetailResponse | null> => {
      if (!articleId) return null;
      if (fixturesEnabled) return createFixtureArticleDetail(articleId);

      const response = await api.api.v0.dashboard.articles[':id'].$get({
        param: { id: articleId },
      });

      if ((response.status as number) === 401) {
        onUnauthorized();
        return null;
      }

      // Null (not a throw) so the modal can tell "gone" from "broken".
      if ((response.status as number) === 404) return null;
      if (!response.ok) throw new Error('article_load_failed');

      return response.json();
    },
    // Fixtures render without an organization, so only the real path needs one.
    enabled: fixturesEnabled ? Boolean(articleId) : Boolean(organizationId && articleId),
    // The editor must never render content a concurrent save has replaced.
    staleTime: 0,
  });

  const loadedArticle = articleQuery.data ?? null;

  useEffect(() => {
    const changedArticle = previousArticleKeyRef.current !== articleKey;

    if (changedArticle) {
      previousArticleKeyRef.current = articleKey;
      setEditorMode('editor');
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
  }, [articleId, articleKey, loadedArticle]);

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
          onUnauthorized();
        }

        // The 400 body names the offending fields; the modal localizes them.
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

    onClose();
  }, [dirty, onClose]);

  useDialogFocusManagement({
    active: Boolean(article),
    dialogRef,
    focusKey: `${articleKey ?? 'closed'}-${Boolean(draftArticle)}`,
    onEscape: requestClose,
  });

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
    onClose();
  }, [onClose, savedArticle]);

  const continueEditing = useCallback(() => {
    setShowCloseConfirmation(false);
  }, []);

  if (!article) {
    return null;
  }

  const isGeneratedArticle = Boolean(article.articleId);
  // Only the full editor takes over the viewport; the message panels are cards.
  const showsFullEditor = isGeneratedArticle && Boolean(draftArticle);

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 grid bg-slate-950/40',
        showsFullEditor
          ? 'place-items-stretch p-0 sm:place-items-center sm:p-4'
          : 'place-items-center p-4',
      )}
      role="presentation"
    >
      <button
        type="button"
        aria-label={t('actions.closeDetails')}
        className="absolute inset-0 cursor-default"
        onMouseDown={requestClose}
      />

      {!isGeneratedArticle ? (
        <PlannedArticleDetails
          article={article}
          dialogRef={dialogRef}
          locale={locale}
          onClose={requestClose}
          t={t}
        />
      ) : draftArticle ? (
        <GeneratedArticleEditor
          article={article}
          canSave={canSave}
          dialogRef={dialogRef}
          dirty={dirty}
          draftArticle={draftArticle}
          editorMode={editorMode}
          locale={locale}
          onClose={requestClose}
          onContinueEditing={continueEditing}
          onDiscardAndClose={discardAndClose}
          onEditorModeChange={setEditorMode}
          onSave={saveArticle}
          onUpdateDraftField={updateDraftField}
          saveError={saveError}
          saveState={saveState}
          serverInvalidFields={serverInvalidFields}
          showCloseConfirmation={showCloseConfirmation}
          t={t}
          validation={validation}
        />
      ) : articleQuery.isPending ? (
        <ArticleEditorMessage
          dialogRef={dialogRef}
          message={t('editor.status.loading')}
          onClose={requestClose}
          t={t}
        />
      ) : articleQuery.isError ? (
        <ArticleEditorMessage
          dialogRef={dialogRef}
          message={t('editor.status.loadError')}
          onClose={requestClose}
          onRetry={() => articleQuery.refetch()}
          t={t}
        />
      ) : (
        <ArticleEditorMessage
          dialogRef={dialogRef}
          message={t('editor.status.notFound')}
          onClose={requestClose}
          t={t}
        />
      )}
    </div>
  );
}

function PlannedArticleDetails({
  article,
  dialogRef,
  locale,
  onClose,
  t,
}: {
  article: PlannerArticle;
  dialogRef: RefObject<HTMLDivElement | null>;
  locale: string;
  onClose: () => void;
  t: ContentPlannerTranslations;
}) {
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="planner-article-detail-title"
      tabIndex={-1}
      className="relative w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-lg"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-slate-500 text-sm">{t('modal.title')}</p>
          <h2
            id="planner-article-detail-title"
            className="mt-1 line-clamp-3 font-semibold text-base text-slate-950"
          >
            {article.keyword}
          </h2>
          <p className="mt-2 text-slate-600 text-sm">{t('editor.status.notGenerated')}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('actions.closeDetails')}
          className="size-8"
          data-dialog-initial-focus
          onClick={onClose}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <Separator className="my-4" />

      <dl className="grid gap-3 text-sm">
        <DetailItem label={t('modal.keyword')} value={article.keyword} />
        <DetailItem label={t('metrics.volume')} value={formatNumber(article.volume, locale)} />
        <DetailItem
          label={t('metrics.difficulty')}
          value={formatNumber(article.difficulty, locale)}
        />
        <DetailItem
          label={t('modal.scheduledDate')}
          value={formatDateFromKey(article.scheduledDate, locale)}
        />
        <div className="grid gap-1">
          <dt className="text-slate-500">{t('modal.status')}</dt>
          <dd>
            <StatusBadge status={article.status} t={t} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Loading / not-found / load-error panel — the editor has no draft to show. */
function ArticleEditorMessage({
  dialogRef,
  message,
  onClose,
  onRetry,
  t,
}: {
  dialogRef: RefObject<HTMLDivElement | null>;
  message: string;
  onClose: () => void;
  onRetry?: () => void;
  t: ContentPlannerTranslations;
}) {
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="planner-article-editor-message-title"
      tabIndex={-1}
      className="relative w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-lg"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2
            id="planner-article-editor-message-title"
            className="font-semibold text-base text-slate-950"
          >
            {t('editor.title')}
          </h2>
          <p className="mt-2 text-slate-600 text-sm">{message}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('editor.actions.close')}
          className="size-8"
          data-dialog-initial-focus={onRetry ? undefined : true}
          onClick={onClose}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      {onRetry ? (
        <Button
          type="button"
          size="sm"
          className="mt-4"
          data-dialog-initial-focus
          onClick={onRetry}
        >
          {t('editor.actions.retry')}
        </Button>
      ) : null}
    </div>
  );
}

function GeneratedArticleEditor({
  article,
  canSave,
  dialogRef,
  dirty,
  draftArticle,
  editorMode,
  locale,
  onClose,
  onContinueEditing,
  onDiscardAndClose,
  onEditorModeChange,
  onSave,
  onUpdateDraftField,
  saveError,
  saveState,
  serverInvalidFields,
  showCloseConfirmation,
  t,
  validation,
}: {
  article: PlannerArticle;
  canSave: boolean;
  dialogRef: RefObject<HTMLDivElement | null>;
  dirty: boolean;
  draftArticle: ArticleEditorDraft;
  editorMode: ArticleEditorMode;
  locale: string;
  onClose: () => void;
  onContinueEditing: () => void;
  onDiscardAndClose: () => void;
  onEditorModeChange: (mode: ArticleEditorMode) => void;
  onSave: () => void;
  onUpdateDraftField: (field: EditableArticleField, value: string) => void;
  saveError: ArticleSaveApiError | null;
  saveState: ArticleSaveState;
  serverInvalidFields: EditableArticleField[];
  showCloseConfirmation: boolean;
  t: ContentPlannerTranslations;
  validation: ReturnType<typeof getArticleEditorValidation>;
}) {
  const metaDescriptionInTarget =
    draftArticle.metaDescription.length >= META_DESCRIPTION_MIN &&
    draftArticle.metaDescription.length <= META_DESCRIPTION_MAX;
  const saving = saveState === 'saving';
  const invalidOnServer = (field: EditableArticleField) => serverInvalidFields.includes(field);
  const serverFieldMessage = (field: EditableArticleField) =>
    invalidOnServer(field) ? t('editor.validation.serverRejected') : undefined;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="planner-article-editor-title"
      tabIndex={-1}
      className="relative flex h-dvh w-full flex-col bg-white shadow-lg sm:h-[min(92dvh,900px)] sm:max-w-6xl sm:rounded-lg sm:border sm:border-slate-200"
    >
      <header className="flex shrink-0 flex-col gap-3 border-slate-200 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2
              id="planner-article-editor-title"
              className="min-w-0 truncate font-semibold text-base text-slate-950"
            >
              {t('editor.title')}
            </h2>
            <ArticleEditorStatusBadge status={draftArticle.status} t={t} />
          </div>
          <p className="mt-1 truncate text-slate-600 text-sm">{draftArticle.title}</p>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
          {saving ? (
            <span className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 font-medium text-slate-700 text-xs">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              {t('editor.status.saving')}
            </span>
          ) : saveState === 'error' ? (
            <span className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-red-50 px-2.5 py-1 font-medium text-red-700 text-xs">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              {t('editor.status.saveFailed')}
            </span>
          ) : dirty ? (
            <span className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 font-medium text-amber-700 text-xs">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              {t('editor.status.unsavedChanges')}
            </span>
          ) : saveState === 'saved' ? (
            <span className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 text-xs">
              <Check className="size-3.5" aria-hidden="true" />
              {t('editor.actions.saved')}
            </span>
          ) : null}
          <Button type="button" size="sm" disabled={!canSave || saving} onClick={onSave}>
            <Save className="size-4" aria-hidden="true" />
            {t('editor.actions.save')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('editor.actions.close')}
            className="size-9"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:overflow-hidden">
        <main className="grid min-w-0 gap-4 p-4 sm:p-5 lg:min-h-0 lg:overflow-y-auto">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
            <EditorField
              id="article-editor-title-input"
              label={t('editor.fields.title')}
              message={
                validation.titleMissing
                  ? t('editor.validation.required')
                  : serverFieldMessage('title')
              }
              invalid={validation.titleMissing || invalidOnServer('title')}
            >
              <Input
                id="article-editor-title-input"
                value={draftArticle.title}
                aria-invalid={validation.titleMissing || invalidOnServer('title')}
                data-dialog-initial-focus
                onChange={(event) => onUpdateDraftField('title', event.target.value)}
              />
            </EditorField>

            <EditorField
              id="article-editor-slug-input"
              label={t('editor.fields.slug')}
              message={
                validation.slugMissing
                  ? t('editor.validation.required')
                  : serverFieldMessage('slug')
              }
              invalid={validation.slugMissing || invalidOnServer('slug')}
            >
              <Input
                id="article-editor-slug-input"
                value={draftArticle.slug}
                aria-invalid={validation.slugMissing || invalidOnServer('slug')}
                onChange={(event) => onUpdateDraftField('slug', event.target.value)}
              />
            </EditorField>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <EditorField
              id="article-editor-meta-title-input"
              label={t('editor.fields.metaTitle')}
              message={
                validation.metaTitleMissing
                  ? t('editor.validation.required')
                  : validation.metaTitleTooLong
                    ? t('editor.validation.metaTitleTooLong')
                    : serverFieldMessage('metaTitle')
              }
              invalid={
                validation.metaTitleMissing ||
                validation.metaTitleTooLong ||
                invalidOnServer('metaTitle')
              }
              meta={
                <Counter
                  current={draftArticle.metaTitle.length}
                  max={META_TITLE_MAX}
                  warning={validation.metaTitleTooLong}
                />
              }
            >
              <Input
                id="article-editor-meta-title-input"
                value={draftArticle.metaTitle}
                aria-invalid={
                  validation.metaTitleMissing ||
                  validation.metaTitleTooLong ||
                  invalidOnServer('metaTitle')
                }
                onChange={(event) => onUpdateDraftField('metaTitle', event.target.value)}
              />
            </EditorField>

            <EditorField
              id="article-editor-meta-description-input"
              label={t('editor.fields.metaDescription')}
              message={
                validation.metaDescriptionMissing
                  ? t('editor.validation.required')
                  : validation.metaDescriptionOutsideTarget
                    ? t('editor.validation.metaDescriptionRange')
                    : serverFieldMessage('metaDescription')
              }
              invalid={
                validation.metaDescriptionMissing ||
                validation.metaDescriptionOutsideTarget ||
                invalidOnServer('metaDescription')
              }
              hint={t('editor.validation.metaDescriptionTarget')}
              meta={
                <Counter
                  current={draftArticle.metaDescription.length}
                  max={META_DESCRIPTION_MAX}
                  warning={!metaDescriptionInTarget}
                />
              }
            >
              <Textarea
                id="article-editor-meta-description-input"
                value={draftArticle.metaDescription}
                aria-invalid={
                  validation.metaDescriptionMissing ||
                  validation.metaDescriptionOutsideTarget ||
                  invalidOnServer('metaDescription')
                }
                className="min-h-24 resize-y"
                onChange={(event) => onUpdateDraftField('metaDescription', event.target.value)}
              />
            </EditorField>
          </div>

          <section className="grid gap-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Label htmlFor="article-editor-content-input">{t('editor.fields.content')}</Label>
                  {validation.contentMissing ? (
                    <FieldMessage tone="error">{t('editor.validation.required')}</FieldMessage>
                  ) : invalidOnServer('content') ? (
                    <FieldMessage tone="error">
                      {t('editor.validation.serverRejected')}
                    </FieldMessage>
                  ) : null}
                </div>
              </div>

              <fieldset className="inline-flex w-fit rounded-md border border-slate-200 bg-slate-100 p-1">
                <legend className="sr-only">{t('editor.tabs.label')}</legend>
                <SegmentedButton
                  active={editorMode === 'editor'}
                  icon={<Edit3 className="size-3.5" aria-hidden="true" />}
                  label={t('editor.tabs.editor')}
                  onClick={() => onEditorModeChange('editor')}
                />
                <SegmentedButton
                  active={editorMode === 'preview'}
                  icon={<Eye className="size-3.5" aria-hidden="true" />}
                  label={t('editor.tabs.preview')}
                  onClick={() => onEditorModeChange('preview')}
                />
              </fieldset>
            </div>

            {editorMode === 'editor' ? (
              <Textarea
                id="article-editor-content-input"
                value={draftArticle.content}
                aria-invalid={validation.contentMissing || invalidOnServer('content')}
                className="min-h-90 resize-y font-mono text-sm leading-6 lg:min-h-107"
                onChange={(event) => onUpdateDraftField('content', event.target.value)}
              />
            ) : (
              <div className="min-h-90 rounded-md border border-slate-200 bg-white p-4 lg:min-h-107">
                {draftArticle.content.trim() ? (
                  <ArticleContentPreview content={draftArticle.content} />
                ) : (
                  <p className="text-slate-500">{t('editor.preview.empty')}</p>
                )}
              </div>
            )}
          </section>
        </main>

        <aside className="grid content-start gap-5 border-slate-200 border-t bg-slate-50 p-4 sm:p-5 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-l">
          <section className="grid gap-3">
            <h3 className="font-semibold text-slate-950 text-sm">{t('editor.sections.context')}</h3>
            <dl className="grid gap-3 text-sm">
              <DetailItem label={t('modal.keyword')} value={article.keyword} />
              <DetailItem
                label={t('modal.scheduledDate')}
                value={formatDateFromKey(article.scheduledDate, locale)}
              />
              <DetailItem
                label={t('metrics.volume')}
                value={formatNumber(article.volume, locale)}
              />
              <DetailItem
                label={t('metrics.difficulty')}
                value={formatNumber(article.difficulty, locale)}
              />
              <div className="grid gap-1">
                <dt className="text-slate-500">{t('modal.status')}</dt>
                <dd>
                  <ArticleEditorStatusBadge status={draftArticle.status} t={t} />
                </dd>
              </div>
            </dl>
          </section>

          <section className="grid gap-3">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <h3 className="truncate font-semibold text-slate-950 text-sm">
                {t('editor.fields.featuredImage')}
              </h3>
              <ImageStatusBadge status={draftArticle.imagesStatus} t={t} />
            </div>

            {draftArticle.featuredImageUrl ? (
              <Image
                src={draftArticle.featuredImageUrl}
                alt=""
                width={640}
                height={360}
                unoptimized
                className="aspect-video w-full rounded-md border border-slate-200 object-cover"
              />
            ) : (
              <div className="grid aspect-video place-items-center rounded-md border border-dashed border-slate-300 bg-white text-center text-slate-500 text-sm">
                <div className="grid justify-items-center gap-2 px-4">
                  <ImageIcon className="size-6 text-slate-400" aria-hidden="true" />
                  <span>{t('editor.fields.featuredImagePlaceholder')}</span>
                </div>
              </div>
            )}
          </section>
        </aside>
      </div>

      <footer className="shrink-0 border-slate-200 border-t bg-white">
        {saveError ? (
          <div className="border-red-200 border-b bg-red-50 px-4 py-3 sm:px-5">
            <p className="text-red-800 text-sm">
              {saveError === 'invalid'
                ? t('editor.status.saveInvalid')
                : saveError === 'not_found'
                  ? t('editor.status.saveNotFound')
                  : t('editor.status.saveError')}
            </p>
          </div>
        ) : null}

        {showCloseConfirmation ? (
          <div className="flex flex-col gap-3 border-amber-200 border-b bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="text-amber-800 text-sm">{t('editor.closeConfirmation.description')}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={onDiscardAndClose}>
                {t('editor.actions.discard')}
              </Button>
              <Button type="button" size="sm" onClick={onContinueEditing}>
                {t('editor.actions.continueEditing')}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 px-4 py-3 text-slate-500 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <span className="truncate">{draftArticle.id}</span>
          <span className="truncate">
            {t('editor.status.updatedAt', {
              date: formatDateTime(draftArticle.updatedAt ?? draftArticle.createdAt, locale),
            })}
          </span>
        </div>
      </footer>
    </div>
  );
}

function EditorField({
  children,
  hint,
  id,
  invalid = false,
  label,
  message,
  meta,
}: {
  children: ReactNode;
  hint?: string;
  id: string;
  invalid?: boolean;
  label: string;
  message?: string;
  meta?: ReactNode;
}) {
  return (
    <div className="grid content-start gap-2">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <Label htmlFor={id} className="min-w-0 truncate text-slate-700">
          {label}
        </Label>
        {meta ? <div className="shrink-0">{meta}</div> : null}
      </div>
      {children}
      {message || hint ? (
        <div className="grid gap-1">
          {message ? (
            <FieldMessage tone={invalid ? 'error' : 'warning'}>{message}</FieldMessage>
          ) : null}
          {hint ? <p className="text-slate-500 text-xs">{hint}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function FieldMessage({ children, tone }: { children: ReactNode; tone: 'error' | 'warning' }) {
  return (
    <p
      className={cn(
        'wrap-break-word text-xs',
        tone === 'error' ? 'text-red-600' : 'text-amber-700',
      )}
    >
      {children}
    </p>
  );
}

function Counter({ current, max, warning }: { current: number; max: number; warning: boolean }) {
  return (
    <span className={cn('text-xs', warning ? 'text-amber-700' : 'text-slate-500')}>
      {current} / {max}
    </span>
  );
}

function ArticleContentPreview({ content }: { content: string }) {
  const blocks = content
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <article className="grid gap-4 wrap-break-word text-slate-800">
      {blocks.map((block, index) => {
        const heading = getMarkdownHeading(block);
        const key = `${index}-${block}`;

        if (heading?.level === 1) {
          return (
            <h1 key={key} className="font-semibold text-2xl text-slate-950 leading-tight">
              {heading.text}
            </h1>
          );
        }

        if (heading?.level === 2) {
          return (
            <h2 key={key} className="font-semibold text-lg text-slate-950 leading-snug">
              {heading.text}
            </h2>
          );
        }

        if (heading?.level === 3) {
          return (
            <h3 key={key} className="font-semibold text-base text-slate-950 leading-snug">
              {heading.text}
            </h3>
          );
        }

        return (
          <p key={key} className="whitespace-pre-wrap text-sm leading-7">
            {block}
          </p>
        );
      })}
    </article>
  );
}

function getMarkdownHeading(block: string) {
  const match = /^(#{1,3})\s+(.+)$/.exec(block);

  if (!match) {
    return null;
  }

  return {
    level: match[1].length,
    text: match[2].trim(),
  };
}

function SegmentedButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-8 items-center gap-1.5 rounded px-2.5 font-semibold text-xs transition-colors',
        active ? 'bg-white text-slate-950 shadow-xs' : 'text-slate-600 hover:text-slate-950',
      )}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ArticleEditorStatusBadge({
  status,
  t,
}: {
  status: ArticleEditorDraft['status'];
  t: ContentPlannerTranslations;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'w-fit border-transparent',
        status === 'published'
          ? 'bg-emerald-100 text-emerald-700'
          : status === 'deleted'
            ? 'bg-rose-100 text-rose-700'
            : 'bg-sky-100 text-sky-700',
      )}
    >
      {t(`editor.articleStatuses.${status}`)}
    </Badge>
  );
}

function ImageStatusBadge({
  status,
  t,
}: {
  status: NonNullable<ArticleEditorDraft['imagesStatus']>;
  t: ContentPlannerTranslations;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'w-fit border-transparent',
        status === 'complete'
          ? 'bg-emerald-100 text-emerald-700'
          : status === 'failed'
            ? 'bg-rose-100 text-rose-700'
            : 'bg-amber-100 text-amber-700',
      )}
    >
      {t(`editor.imageStatuses.${status}`)}
    </Badge>
  );
}

function StatusBadge({
  status,
  t,
}: {
  status: PlannerArticleStatus;
  t: ContentPlannerTranslations;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'w-fit border-transparent',
        status === 'generated' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700',
      )}
    >
      {t(`statuses.${status}`)}
    </Badge>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 wrap-break-word font-medium text-slate-950">{value}</dd>
    </div>
  );
}

function useDialogFocusManagement({
  active,
  dialogRef,
  focusKey,
  onEscape,
}: {
  active: boolean;
  dialogRef: RefObject<HTMLDivElement | null>;
  focusKey: string;
  onEscape: () => void;
}) {
  useEffect(() => {
    if (!active) {
      return;
    }

    if (!focusKey) {
      return;
    }

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalBodyOverflow = document.body.style.overflow;

    document.body.style.overflow = 'hidden';

    function focusInitialElement() {
      const dialog = dialogRef.current;

      if (!dialog) {
        return;
      }

      const preferredElement = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]');
      const focusTarget =
        preferredElement && isElementFocusable(preferredElement)
          ? preferredElement
          : (getFocusableElements(dialog)[0] ?? dialog);

      focusTarget.focus({ preventScroll: true });
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscape();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const dialog = dialogRef.current;

      if (!dialog) {
        return;
      }

      const focusableElements = getFocusableElements(dialog);

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const activeElement = document.activeElement;
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (!activeElement || !dialog.contains(activeElement)) {
        event.preventDefault();
        firstElement.focus({ preventScroll: true });
        return;
      }

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus({ preventScroll: true });
        return;
      }

      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus({ preventScroll: true });
      }
    }

    const animationFrame = window.requestAnimationFrame(focusInitialElement);

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.body.style.overflow = originalBodyOverflow;
      document.removeEventListener('keydown', handleKeyDown);

      window.setTimeout(() => {
        if (previouslyFocused?.isConnected) {
          previouslyFocused.focus({ preventScroll: true });
        }
      }, 0);
    };
  }, [active, dialogRef, focusKey, onEscape]);
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    isElementFocusable,
  );
}

function isElementFocusable(element: HTMLElement) {
  return (
    !element.hasAttribute('disabled') &&
    element.getAttribute('aria-hidden') !== 'true' &&
    element.tabIndex !== -1 &&
    element.getClientRects().length > 0
  );
}
