'use client';

import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode, RefObject } from 'react';
import { useEffect, useRef } from 'react';
import {
  ARTICLE_EDITOR_TITLE_ID,
  ArticleEditorDetailItem,
  ArticleEditorMessage,
  ArticleEditorPanel,
} from '@/components/article/ArticleEditorPanel';
import { Badge, Button, Separator } from '@/components/ui';
import { useArticleEditor } from '@/lib/article-editor';
import { cn } from '@/lib/utils';
import { formatDateFromKey, formatDateTime, formatNumber } from '../planner-utils';
import type { PlannerArticle, PlannerArticleStatus } from '../types';

type ContentPlannerTranslations = ReturnType<typeof useTranslations<'ContentPlannerPage'>>;

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
  const editorT = useTranslations('ArticleEditor');
  const locale = useLocale();
  const dialogRef = useRef<HTMLDivElement>(null);
  const articleId = article?.articleId ?? null;
  const articleKey = articleId ?? article?.id ?? null;

  const editor = useArticleEditor({
    articleId,
    fixturesEnabled,
    onClose,
    onUnauthorized,
    organizationId,
  });
  const { draftArticle, requestClose } = editor;

  useDialogFocusManagement({
    active: Boolean(article),
    dialogRef,
    focusKey: `${articleKey ?? 'closed'}-${Boolean(draftArticle)}`,
    onEscape: requestClose,
  });

  if (!article) {
    return null;
  }

  const isGeneratedArticle = Boolean(article.articleId);
  // Only the full editor takes over the viewport; the message panels are cards.
  const showsFullEditor = isGeneratedArticle && Boolean(draftArticle);

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 grid bg-foreground/40',
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
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={ARTICLE_EDITOR_TITLE_ID}
          tabIndex={-1}
          className="relative flex h-dvh w-full flex-col bg-card shadow-lg sm:h-[min(92dvh,900px)] sm:max-w-6xl sm:rounded-lg sm:border sm:border-border"
        >
          <ArticleEditorPanel
            canSave={editor.canSave}
            context={
              <dl className="grid gap-3 text-sm">
                <ArticleEditorDetailItem label={t('modal.keyword')} value={article.keyword} />
                <ArticleEditorDetailItem
                  label={t('modal.scheduledDate')}
                  value={formatDateFromKey(article.scheduledDate, locale)}
                />
                <ArticleEditorDetailItem
                  label={t('metrics.volume')}
                  value={formatNumber(article.volume, locale)}
                />
                <ArticleEditorDetailItem
                  label={t('metrics.difficulty')}
                  value={formatNumber(article.difficulty, locale)}
                />
              </dl>
            }
            dirty={editor.dirty}
            draftArticle={draftArticle}
            onClose={requestClose}
            onContinueEditing={editor.continueEditing}
            onDiscardAndClose={editor.discardAndClose}
            onSave={editor.saveArticle}
            onUpdateDraftField={editor.updateDraftField}
            saveError={editor.saveError}
            saveState={editor.saveState}
            serverInvalidFields={editor.serverInvalidFields}
            showCloseConfirmation={editor.showCloseConfirmation}
            updatedAtLabel={editorT('status.updatedAt', {
              date: formatDateTime(draftArticle.updatedAt ?? draftArticle.createdAt, locale),
            })}
            validation={editor.validation}
          />
        </div>
      ) : (
        <ArticleEditorMessageCard dialogRef={dialogRef}>
          {editor.isPending ? (
            <ArticleEditorMessage message={editorT('status.loading')} onClose={requestClose} />
          ) : editor.isError ? (
            <ArticleEditorMessage
              message={editorT('status.loadError')}
              onClose={requestClose}
              onRetry={editor.refetch}
            />
          ) : (
            <ArticleEditorMessage message={editorT('status.notFound')} onClose={requestClose} />
          )}
        </ArticleEditorMessageCard>
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
      className="relative w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-muted-foreground text-sm">{t('modal.title')}</p>
          <h2
            id="planner-article-detail-title"
            className="mt-1 line-clamp-3 font-semibold text-base text-foreground"
          >
            {article.keyword}
          </h2>
          <p className="mt-2 text-muted-foreground text-sm">{t('modal.notGenerated')}</p>
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
        <ArticleEditorDetailItem label={t('modal.keyword')} value={article.keyword} />
        <ArticleEditorDetailItem
          label={t('metrics.volume')}
          value={formatNumber(article.volume, locale)}
        />
        <ArticleEditorDetailItem
          label={t('metrics.difficulty')}
          value={formatNumber(article.difficulty, locale)}
        />
        <ArticleEditorDetailItem
          label={t('modal.scheduledDate')}
          value={formatDateFromKey(article.scheduledDate, locale)}
        />
        <div className="grid gap-1">
          <dt className="text-muted-foreground">{t('modal.status')}</dt>
          <dd>
            <StatusBadge status={article.status} t={t} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** The dialog shell the loading / not-found / load-error panels sit in. */
function ArticleEditorMessageCard({
  children,
  dialogRef,
}: {
  children: ReactNode;
  dialogRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={ARTICLE_EDITOR_TITLE_ID}
      tabIndex={-1}
      className="relative w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg"
    >
      {children}
    </div>
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
        status === 'generated' ? 'bg-success-muted text-success' : 'bg-info-muted text-info',
      )}
    >
      {t(`statuses.${status}`)}
    </Badge>
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
