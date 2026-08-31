'use client';

import { META_DESCRIPTION_MAX, META_DESCRIPTION_MIN, META_TITLE_MAX } from '@shared/schemas';
import { AlertTriangle, Check, Edit3, Eye, ImageIcon, Loader2, Save, X } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { ArticleContentPreview } from '@/components/article/ArticleContentPreview';
import { Badge, Button, Input, Label, Textarea } from '@/components/ui';
import type {
  ArticleEditorController,
  ArticleEditorDraft,
  ArticleEditorMode,
  EditableArticleField,
} from '@/lib/article-editor';
import { cn } from '@/lib/utils';

type ArticleEditorTranslations = ReturnType<typeof useTranslations<'ArticleEditor'>>;

/** The heading the container's `aria-labelledby` should point at. */
export const ARTICLE_EDITOR_TITLE_ID = 'article-editor-title';

/**
 * The editor itself — header, fields, preview, footer — with no container of its
 * own, so the Content Planner can mount it inside a dialog and Content History
 * can mount it inline on the article page (#74).
 */
export function ArticleEditorPanel({
  canSave,
  context,
  dirty,
  draftArticle,
  headerActions,
  onClose,
  onContinueEditing,
  onDiscardAndClose,
  onSave,
  onUpdateDraftField,
  saveError,
  saveState,
  serverInvalidFields,
  showCloseConfirmation,
  updatedAtLabel,
  validation,
}: Pick<
  ArticleEditorController,
  | 'canSave'
  | 'dirty'
  | 'saveError'
  | 'saveState'
  | 'serverInvalidFields'
  | 'showCloseConfirmation'
  | 'validation'
> & {
  /** Surface-specific detail list rendered above the featured image. */
  context?: ReactNode;
  draftArticle: ArticleEditorDraft;
  /** Extra buttons beside Save (e.g. Content History's "Cancel"). */
  headerActions?: ReactNode;
  /** Renders the ✕ button when given; the page variant leaves it off. */
  onClose?: () => void;
  onContinueEditing: () => void;
  onDiscardAndClose: () => void;
  onSave: () => void;
  onUpdateDraftField: (field: EditableArticleField, value: string) => void;
  /** Preformatted "Last updated …" line; the caller owns date formatting. */
  updatedAtLabel: string;
}) {
  const t = useTranslations('ArticleEditor');
  const [editorMode, setEditorMode] = useState<ArticleEditorMode>('editor');
  const metaDescriptionInTarget =
    draftArticle.metaDescription.length >= META_DESCRIPTION_MIN &&
    draftArticle.metaDescription.length <= META_DESCRIPTION_MAX;
  const saving = saveState === 'saving';
  const invalidOnServer = (field: EditableArticleField) => serverInvalidFields.includes(field);
  const serverFieldMessage = (field: EditableArticleField) =>
    invalidOnServer(field) ? t('validation.serverRejected') : undefined;

  return (
    <>
      <header className="flex shrink-0 flex-col gap-3 border-border border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2
              id={ARTICLE_EDITOR_TITLE_ID}
              className="min-w-0 truncate font-semibold text-base text-foreground"
            >
              {t('title')}
            </h2>
            <ArticleEditorStatusBadge status={draftArticle.status} t={t} />
          </div>
          <p className="mt-1 truncate text-muted-foreground text-sm">{draftArticle.title}</p>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
          {saving ? (
            <span className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 font-medium text-foreground text-xs">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              {t('status.saving')}
            </span>
          ) : saveState === 'error' ? (
            <span className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-red-50 px-2.5 py-1 font-medium text-red-700 text-xs">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              {t('status.saveFailed')}
            </span>
          ) : dirty ? (
            <span className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 font-medium text-amber-700 text-xs">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              {t('status.unsavedChanges')}
            </span>
          ) : saveState === 'saved' ? (
            <span className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 text-xs">
              <Check className="size-3.5" aria-hidden="true" />
              {t('actions.saved')}
            </span>
          ) : null}
          {headerActions}
          <Button type="button" size="sm" disabled={!canSave || saving} onClick={onSave}>
            <Save className="size-4" aria-hidden="true" />
            {t('actions.save')}
          </Button>
          {onClose ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('actions.close')}
              className="size-9"
              onClick={onClose}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:overflow-hidden">
        <main className="grid min-w-0 gap-4 p-4 sm:p-5 lg:min-h-0 lg:overflow-y-auto">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
            <EditorField
              id="article-editor-title-input"
              label={t('fields.title')}
              message={
                validation.titleMissing ? t('validation.required') : serverFieldMessage('title')
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
              label={t('fields.slug')}
              message={
                validation.slugMissing ? t('validation.required') : serverFieldMessage('slug')
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
              label={t('fields.metaTitle')}
              message={
                validation.metaTitleMissing
                  ? t('validation.required')
                  : validation.metaTitleTooLong
                    ? t('validation.metaTitleTooLong')
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
              label={t('fields.metaDescription')}
              message={
                validation.metaDescriptionMissing
                  ? t('validation.required')
                  : validation.metaDescriptionOutsideTarget
                    ? t('validation.metaDescriptionRange')
                    : serverFieldMessage('metaDescription')
              }
              invalid={
                validation.metaDescriptionMissing ||
                validation.metaDescriptionOutsideTarget ||
                invalidOnServer('metaDescription')
              }
              hint={t('validation.metaDescriptionTarget')}
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
                  <Label htmlFor="article-editor-content-input">{t('fields.content')}</Label>
                  {validation.contentMissing ? (
                    <FieldMessage tone="error">{t('validation.required')}</FieldMessage>
                  ) : invalidOnServer('content') ? (
                    <FieldMessage tone="error">{t('validation.serverRejected')}</FieldMessage>
                  ) : null}
                </div>
              </div>

              <fieldset className="inline-flex w-fit rounded-md border border-border bg-muted p-1">
                <legend className="sr-only">{t('tabs.label')}</legend>
                <SegmentedButton
                  active={editorMode === 'editor'}
                  icon={<Edit3 className="size-3.5" aria-hidden="true" />}
                  label={t('tabs.editor')}
                  onClick={() => setEditorMode('editor')}
                />
                <SegmentedButton
                  active={editorMode === 'preview'}
                  icon={<Eye className="size-3.5" aria-hidden="true" />}
                  label={t('tabs.preview')}
                  onClick={() => setEditorMode('preview')}
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
              <div className="min-h-90 rounded-md border border-border bg-card p-4 lg:min-h-107">
                {draftArticle.content.trim() ? (
                  <ArticleContentPreview content={draftArticle.content} />
                ) : (
                  <p className="text-muted-foreground">{t('preview.empty')}</p>
                )}
              </div>
            )}
          </section>
        </main>

        <aside className="grid content-start gap-5 border-border border-t bg-muted/50 p-4 sm:p-5 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-l">
          {context ? (
            <section className="grid gap-3">
              <h3 className="font-semibold text-foreground text-sm">{t('sections.context')}</h3>
              {context}
            </section>
          ) : null}

          <section className="grid gap-3">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <h3 className="truncate font-semibold text-foreground text-sm">
                {t('fields.featuredImage')}
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
                className="aspect-video w-full rounded-md border border-border object-cover"
              />
            ) : (
              <div className="grid aspect-video place-items-center rounded-md border border-dashed border-border bg-card text-center text-muted-foreground text-sm">
                <div className="grid justify-items-center gap-2 px-4">
                  <ImageIcon className="size-6 text-muted-foreground" aria-hidden="true" />
                  <span>{t('fields.featuredImagePlaceholder')}</span>
                </div>
              </div>
            )}
          </section>
        </aside>
      </div>

      <footer className="shrink-0 border-border border-t bg-card">
        {saveError ? (
          <div className="border-red-200 border-b bg-red-50 px-4 py-3 sm:px-5">
            <p className="text-red-800 text-sm">
              {saveError === 'invalid'
                ? t('status.saveInvalid')
                : saveError === 'not_found'
                  ? t('status.saveNotFound')
                  : t('status.saveError')}
            </p>
          </div>
        ) : null}

        {showCloseConfirmation ? (
          <div className="flex flex-col gap-3 border-amber-200 border-b bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="text-amber-800 text-sm">{t('closeConfirmation.description')}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={onDiscardAndClose}>
                {t('actions.discard')}
              </Button>
              <Button type="button" size="sm" onClick={onContinueEditing}>
                {t('actions.continueEditing')}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 px-4 py-3 text-muted-foreground text-xs sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <span className="truncate">{draftArticle.id}</span>
          <span className="truncate">{updatedAtLabel}</span>
        </div>
      </footer>
    </>
  );
}

/** Loading / not-found / load-error panel — the editor has no draft to show. */
export function ArticleEditorMessage({
  message,
  onClose,
  onRetry,
}: {
  message: string;
  onClose: () => void;
  onRetry?: () => void;
}) {
  const t = useTranslations('ArticleEditor');

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id={ARTICLE_EDITOR_TITLE_ID} className="font-semibold text-base text-foreground">
            {t('title')}
          </h2>
          <p className="mt-2 text-muted-foreground text-sm">{message}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('actions.close')}
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
          {t('actions.retry')}
        </Button>
      ) : null}
    </>
  );
}

export function ArticleEditorStatusBadge({
  status,
  t,
}: {
  status: ArticleEditorDraft['status'];
  t: ArticleEditorTranslations;
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
      {t(`articleStatuses.${status}`)}
    </Badge>
  );
}

/** A `<dt>/<dd>` pair for the sidebar's context list. */
export function ArticleEditorDetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-break-word font-medium text-foreground">{value}</dd>
    </div>
  );
}

function ImageStatusBadge({
  status,
  t,
}: {
  status: ArticleEditorDraft['imagesStatus'];
  t: ArticleEditorTranslations;
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
      {t(`imageStatuses.${status}`)}
    </Badge>
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
        <Label htmlFor={id} className="min-w-0 truncate text-foreground">
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
          {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
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
    <span className={cn('text-xs', warning ? 'text-amber-700' : 'text-muted-foreground')}>
      {current} / {max}
    </span>
  );
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
        active
          ? 'bg-card text-foreground shadow-xs'
          : 'text-muted-foreground hover:text-foreground',
      )}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
