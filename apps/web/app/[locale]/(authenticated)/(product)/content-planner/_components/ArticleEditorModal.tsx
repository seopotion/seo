'use client';

import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef } from 'react';
import {
  ARTICLE_EDITOR_TITLE_ID,
  ArticleEditorDetailItem,
  ArticleEditorMessage,
  ArticleEditorPanel,
} from '@/components/article/ArticleEditorPanel';
import { Badge, Button, Dialog, DialogContent, Separator } from '@/components/ui';
import { useArticleEditor } from '@/lib/article-editor';
import { cn } from '@/lib/utils';
import {
  formatDateFromKey,
  formatDateTime,
  formatNullableNumber,
  formatNumber,
} from '../planner-utils';
import type { PlannerArticle, PlannerArticleStatus } from '../types';

type ContentPlannerTranslations = ReturnType<typeof useTranslations<'ContentPlannerPage'>>;

const PLANNED_ARTICLE_TITLE_ID = 'planner-article-detail-title';

/**
 * The card surfaces are a small centred panel rather than the full-bleed editor,
 * so they undo `DialogContent`'s viewport-filling defaults. `cn` is tailwind-merge,
 * so each utility here replaces the one it conflicts with.
 */
const CARD_CLASSNAME =
  'block h-auto max-w-md rounded-lg border border-border p-5 sm:h-auto sm:max-w-md';

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

  if (!article) {
    return null;
  }

  const isGeneratedArticle = Boolean(article.articleId);
  // Only the full editor takes over the viewport; the message panels are cards.
  const showsFullEditor = isGeneratedArticle && Boolean(draftArticle);

  return (
    // The parent unmounts this component to close it, so it is only ever
    // rendered open. Radix still reports close requests through onOpenChange.
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) requestClose();
      }}
    >
      <DialogContent
        // Remounting on either the article or the draft arriving is what re-aims
        // initial focus, the job the old hook's `focusKey` did.
        key={`${articleKey ?? 'closed'}-${Boolean(draftArticle)}`}
        ref={dialogRef}
        aria-labelledby={isGeneratedArticle ? ARTICLE_EDITOR_TITLE_ID : PLANNED_ARTICLE_TITLE_ID}
        className={cn(showsFullEditor ? 'sm:h-[min(92dvh,900px)] sm:max-w-6xl' : CARD_CLASSNAME)}
        overlayClassName={showsFullEditor ? undefined : 'place-items-center p-4'}
        onOpenAutoFocus={(event) => {
          // The preferred control lives inside ArticleEditorPanel, several
          // layers down, so it is found by attribute rather than threaded
          // through as a ref. Radix's first-tabbable default covers the rest.
          const preferred = dialogRef.current?.querySelector<HTMLElement>(
            '[data-dialog-initial-focus]',
          );

          if (!preferred || preferred.hasAttribute('disabled')) {
            return;
          }

          event.preventDefault();
          preferred.focus();
        }}
      >
        {!isGeneratedArticle ? (
          <PlannedArticleDetails article={article} locale={locale} onClose={requestClose} t={t} />
        ) : draftArticle ? (
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
                  value={formatNullableNumber(article.difficulty, locale)}
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
        ) : editor.isPending ? (
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
      </DialogContent>
    </Dialog>
  );
}

function PlannedArticleDetails({
  article,
  locale,
  onClose,
  t,
}: {
  article: PlannerArticle;
  locale: string;
  onClose: () => void;
  t: ContentPlannerTranslations;
}) {
  return (
    <>
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
          value={formatNullableNumber(article.difficulty, locale)}
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
    </>
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
