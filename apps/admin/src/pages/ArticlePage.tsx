import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useBlocker, useParams, useSearchParams } from 'react-router';
import { ArticleFieldErrors, ArticleFields } from '../components/ArticleFields';
import { ArticleImages } from '../components/ArticleImages';
import { ArticlePublishing } from '../components/ArticlePublishing';
import { Badge } from '../components/Badge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ApiError } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import {
  type ArticleDetail,
  type ArticleDraft,
  ArticleValidationError,
  fetchArticle,
  retryImages,
  updateArticle,
} from '../lib/queries';
import { articleStatusTone, imagesTone } from '../lib/status';

const IMAGES_REPLAY_BODY =
  'The image task is queued again for this article. Replay is idempotent by design — the worker ' +
  'fills each slot only if it is still empty, so an image that already landed is left alone and ' +
  'nothing already written is overwritten. Safe to click.';

const IMAGES_PENDING_BANNER =
  'Images are being generated — editing is blocked until they finish. The images worker rewrites ' +
  'this article atomically as each image lands, so a save now would be silently overwritten (and ' +
  'the API refuses it).';

/**
 * The article editor: its own route rather than a workspace tab, so an operator
 * can be handed a link straight to the piece under discussion. The org is
 * carried in `?org=` purely for the back-link — the article record itself has
 * no org field, and nothing on this page is org-scoped.
 */
export function ArticlePage() {
  const { articleId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const orgId = searchParams.get('org');

  const article = useQuery({
    queryKey: ['article', articleId],
    queryFn: () => fetchArticle(articleId),
  });

  const backTo = orgId ? `/orgs/${orgId}/articles` : '/';
  const backLabel = orgId ? '← Back to the org’s articles' : '← Back to search';

  if (article.isPending) return <p className="text-sm text-neutral-500">Loading the article…</p>;

  if (article.isError) {
    const notFound = article.error instanceof ApiError && article.error.status === 404;
    return (
      <div>
        <p className="text-sm text-red-400">
          {notFound
            ? 'Article not found.'
            : errorText(article.error, 'Could not load the article.')}
        </p>
        <Link to={backTo} className="mt-3 inline-block text-sm text-neutral-400 underline">
          {backLabel}
        </Link>
      </div>
    );
  }

  return (
    // Remounting on id keeps the draft from carrying across articles; a refetch
    // of the same article deliberately does not reset it.
    <ArticleEditor
      key={article.data.id}
      article={article.data}
      backTo={backTo}
      backLabel={backLabel}
    />
  );
}

function toDraft(article: ArticleDetail): ArticleDraft {
  return {
    title: article.title,
    slug: article.slug,
    meta_title: article.meta_title,
    meta_description: article.meta_description,
    content: article.content,
  };
}

/** The pending two-step confirm, if any. */
type Pending = { kind: 'images' };

function ArticleEditor({
  article,
  backTo,
  backLabel,
}: {
  article: ArticleDetail;
  backTo: string;
  backLabel: string;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ArticleDraft>(() => toDraft(article));
  const [pending, setPending] = useState<Pending | null>(null);
  const [imageUploadBusy, setImageUploadBusy] = useState(false);

  // Dirty is measured against the record the cache holds, so a save (which
  // writes the response back) clears it, and a background refetch that finds
  // the worker changed `content` correctly shows up as a difference.
  const saved = toDraft(article);
  const dirty = (Object.keys(saved) as (keyof ArticleDraft)[]).some(
    (field) => draft[field] !== saved[field],
  );

  const imagesPending = article.images_status === 'pending';
  const imagesFailed = article.images_status === 'failed';
  const wordpressPublication = article.publications.find(
    (publication) => publication.provider === 'wordpress',
  );
  const staticSitePublication = article.publications.find(
    (publication) => publication.provider === 'static-site',
  );
  const wordpressRef = article.wordpress_post_id ?? wordpressPublication?.ref;

  // The tab-close half of the leave guard; the in-app half is the blocker below.
  useEffect(() => {
    if (!dirty && !imageUploadBusy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, imageUploadBusy]);

  const blocker = useBlocker(dirty || imageUploadBusy);

  const save = useMutation({
    mutationFn: () => updateArticle(article.id, draft),
    onSuccess: (updated) => {
      // The PATCH response *is* the new record — writing it straight to the
      // cache clears the dirty state in the same tick, so the leave guard can't
      // fire on an edit that was just saved.
      queryClient.setQueryData(['article', article.id], updated);
      queryClient.invalidateQueries({ queryKey: ['articles'] });
    },
  });

  const invalidateArticle = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['article', article.id] }),
      queryClient.invalidateQueries({ queryKey: ['articles'] }),
    ]);

  const replayImages = useMutation({
    mutationFn: () => retryImages(article.id),
    // Like generate-now: the worker flips the status on its own schedule, so
    // this only refetches — the row updates when the replay lands.
    onSuccess: invalidateArticle,
  });

  const fieldErrors = save.error instanceof ArticleValidationError ? save.error.fields : null;
  const set = (field: keyof ArticleDraft, value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  return (
    <div className="max-w-4xl">
      <Link to={backTo} className="text-sm text-neutral-400 underline">
        {backLabel}
      </Link>

      <header className="mt-4">
        <h1 className="text-xl font-semibold">{article.title}</h1>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone={articleStatusTone(article.status)}>{article.status}</Badge>
          <Badge tone={imagesTone(article.images_status)}>images: {article.images_status}</Badge>
          {wordpressRef && <Badge tone="good">WordPress: published · #{wordpressRef}</Badge>}
          {staticSitePublication && <Badge tone="good">Custom site: published</Badge>}
        </div>
        <p className="mt-3 text-sm text-neutral-400">
          keyword: {article.keyword ?? 'No focus keyword'} · created{' '}
          {formatDateTime(article.created_at)} · last saved {formatDateTime(article.updated_at)}{' '}
          <span className="font-mono text-xs">{article.id}</span>
        </p>
      </header>

      {imagesPending && (
        <p className="mt-5 rounded border border-amber-600 bg-amber-950 p-3 text-sm font-semibold text-amber-200">
          {IMAGES_PENDING_BANNER}
        </p>
      )}

      {imagesFailed && (
        <div className="mt-5 rounded border border-red-800 bg-red-950/50 p-3 text-sm text-red-200">
          <p>
            Image generation failed, which blocks publishing. Replaying the task is safe — the
            worker only fills slots that are still empty.
          </p>
          <button
            type="button"
            disabled={replayImages.isPending}
            onClick={() => setPending({ kind: 'images' })}
            className="mt-3 rounded border border-red-700 px-3 py-1.5 text-sm font-semibold text-red-100 hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {replayImages.isPending ? 'Queueing…' : 'Retry images'}
          </button>
          {replayImages.isError && (
            <p className="mt-2 text-red-400">
              {errorText(replayImages.error, 'Could not queue the image task.')}
            </p>
          )}
          {replayImages.isSuccess && (
            <p className="mt-2 text-emerald-400">
              Images queued — reload in a minute to see the status move.
            </p>
          )}
        </div>
      )}

      <div className="mt-6">
        <ArticleFields draft={draft} disabled={imagesPending || imageUploadBusy} onChange={set} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!dirty || imagesPending || save.isPending || imageUploadBusy}
          onClick={() => save.mutate()}
          className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
        {dirty && !imagesPending && <span className="text-sm text-amber-300">Unsaved changes</span>}
        {!dirty && save.isSuccess && <span className="text-sm text-emerald-400">Saved.</span>}
      </div>

      {save.isError && (
        <div className="mt-3 text-sm text-red-400">
          <p>{errorText(save.error, 'Could not save the article.')}</p>
          {fieldErrors && <ArticleFieldErrors fields={fieldErrors} />}
        </div>
      )}

      <ArticleImages
        article={article}
        disabled={dirty || save.isPending}
        onBusy={setImageUploadBusy}
        onUploaded={(updated) => {
          setDraft(toDraft(updated));
          queryClient.setQueryData(['article', article.id], updated);
          invalidateArticle();
        }}
      />

      <ArticlePublishing
        article={article}
        dirty={dirty}
        imageUploadBusy={imageUploadBusy}
        onPublished={invalidateArticle}
      />

      {pending?.kind === 'images' && (
        <ConfirmDialog
          title="Retry images"
          body={IMAGES_REPLAY_BODY}
          confirmLabel="Queue the image task"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            replayImages.mutate();
          }}
        />
      )}

      {blocker.state === 'blocked' && (
        <ConfirmDialog
          title={imageUploadBusy ? 'Leave during image upload?' : 'Discard unsaved changes?'}
          body={
            imageUploadBusy
              ? 'The image upload is still running. Stay here until it finishes.'
              : 'This article has edits that were never saved. Leaving throws them away.'
          }
          confirmLabel="Discard and leave"
          variant="danger"
          onCancel={() => blocker.reset()}
          onConfirm={() => blocker.proceed()}
        />
      )}
    </div>
  );
}
