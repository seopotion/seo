import { META_DESCRIPTION_MAX, META_DESCRIPTION_MIN, META_TITLE_MAX } from '@shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useBlocker, useParams, useSearchParams } from 'react-router';
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
  publishToWordPress,
  updateArticle,
  updateWordPressPost,
} from '../lib/queries';
import { articleStatusTone, imagesTone } from '../lib/status';

const PUBLISH_CUSTOMER_VISIBLE = "This posts the article to the customer's LIVE WordPress site.";

const UPDATE_CUSTOMER_VISIBLE =
  "This overwrites the article on the customer's LIVE WordPress site.";

const UNSAVED_WARNING =
  'You have unsaved edits — WordPress is sent the last saved version, not what is in the editor. ' +
  'Save first if you meant to publish these changes.';

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
type Pending = { kind: 'publish' } | { kind: 'update' };

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

  // Dirty is measured against the record the cache holds, so a save (which
  // writes the response back) clears it, and a background refetch that finds
  // the worker changed `content` correctly shows up as a difference.
  const saved = toDraft(article);
  const dirty = (Object.keys(saved) as (keyof ArticleDraft)[]).some(
    (field) => draft[field] !== saved[field],
  );

  const imagesPending = article.images_status === 'pending';
  const imagesComplete = article.images_status === 'complete';
  const published = article.wordpress_post_id;

  // The tab-close half of the leave guard; the in-app half is the blocker below.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const blocker = useBlocker(dirty);

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

  const invalidateArticle = () => {
    queryClient.invalidateQueries({ queryKey: ['article', article.id] });
    queryClient.invalidateQueries({ queryKey: ['articles'] });
  };

  const publish = useMutation({
    mutationFn: () => publishToWordPress(article.id),
    onSuccess: invalidateArticle,
  });

  const updatePost = useMutation({
    mutationFn: () => updateWordPressPost(article.id),
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
          {published ? (
            <Badge tone="good">WordPress: published · #{published}</Badge>
          ) : (
            <Badge>WordPress: not published</Badge>
          )}
        </div>
        <p className="mt-3 text-sm text-neutral-400">
          keyword: {article.keyword} · created {formatDateTime(article.created_at)} · last saved{' '}
          {formatDateTime(article.updated_at)}{' '}
          <span className="font-mono text-xs">{article.id}</span>
        </p>
      </header>

      {imagesPending && (
        <p className="mt-5 rounded border border-amber-600 bg-amber-950 p-3 text-sm font-semibold text-amber-200">
          {IMAGES_PENDING_BANNER}
        </p>
      )}

      <div className="mt-6 space-y-4">
        <Field id="title" label="Title">
          <input
            id="title"
            type="text"
            value={draft.title}
            disabled={imagesPending}
            onChange={(event) => set('title', event.target.value)}
            className={INPUT_CLASS}
          />
        </Field>

        <Field id="slug" label="Slug">
          <input
            id="slug"
            type="text"
            value={draft.slug}
            disabled={imagesPending}
            onChange={(event) => set('slug', event.target.value)}
            className={`${INPUT_CLASS} font-mono`}
          />
        </Field>

        <Field
          id="meta_title"
          label="Meta title"
          hint={
            <Counter length={draft.meta_title.length} max={META_TITLE_MAX} label={META_TITLE_MAX} />
          }
        >
          <input
            id="meta_title"
            type="text"
            value={draft.meta_title}
            disabled={imagesPending}
            onChange={(event) => set('meta_title', event.target.value)}
            className={INPUT_CLASS}
          />
        </Field>

        <Field
          id="meta_description"
          label="Meta description"
          hint={
            <Counter
              length={draft.meta_description.length}
              min={META_DESCRIPTION_MIN}
              max={META_DESCRIPTION_MAX}
              label={`${META_DESCRIPTION_MIN}–${META_DESCRIPTION_MAX}`}
            />
          }
        >
          <textarea
            id="meta_description"
            rows={3}
            value={draft.meta_description}
            disabled={imagesPending}
            onChange={(event) => set('meta_description', event.target.value)}
            className={INPUT_CLASS}
          />
        </Field>

        <Field
          id="content"
          label="Content"
          hint={
            <span className="text-xs text-neutral-500">
              Markdown — <code>## headings</code>, <code>**bold**</code>, <code>![alt](url)</code>{' '}
              images, plus a raw <code>&lt;iframe&gt;</code> for the YouTube embed
            </span>
          }
        >
          <textarea
            id="content"
            rows={28}
            value={draft.content}
            disabled={imagesPending}
            onChange={(event) => set('content', event.target.value)}
            className={`${INPUT_CLASS} font-mono text-xs leading-5`}
          />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!dirty || imagesPending || save.isPending}
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
          {fieldErrors && (
            <ul className="mt-1 list-disc pl-5">
              {Object.entries(fieldErrors).map(([field, message]) => (
                <li key={field}>
                  <span className="font-mono text-xs">{field}</span>: {message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <section className="mt-8 rounded border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="font-semibold">WordPress</h2>
        <p className="mt-1 text-sm text-neutral-400">
          {published
            ? `Live on the customer's site as post #${published}.`
            : 'Not published. Publishing creates the post on the live site.'}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!imagesComplete || publish.isPending || updatePost.isPending}
            onClick={() => setPending({ kind: published ? 'update' : 'publish' })}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {published ? 'Update live post' : 'Publish to WordPress'}
          </button>
          {!imagesComplete && (
            <span className="text-sm text-amber-300">
              The API refuses this until every image is generated — images are{' '}
              {article.images_status}.
            </span>
          )}
        </div>

        {publish.isError && (
          <p className="mt-3 text-sm text-red-400">
            {errorText(publish.error, 'Could not publish to WordPress.')}
          </p>
        )}
        {updatePost.isError && (
          <p className="mt-3 text-sm text-red-400">
            {errorText(updatePost.error, 'Could not update the WordPress post.')}
          </p>
        )}
        {publish.isSuccess && (
          <WordPressResult
            message={`Published as post #${publish.data.post_id}.`}
            warnings={publish.data.warnings}
          />
        )}
        {updatePost.isSuccess && (
          <WordPressResult
            message={`Live post #${updatePost.data.post_id} updated.`}
            warnings={updatePost.data.warnings}
          />
        )}
      </section>

      {pending?.kind === 'publish' && (
        <ConfirmDialog
          title="Publish to WordPress"
          body={`“${article.title}” is created as a new post on the customer's WordPress site.`}
          confirmLabel="Publish to the live site"
          variant="danger"
          warning={dirty ? UNSAVED_WARNING : undefined}
          customerVisible={PUBLISH_CUSTOMER_VISIBLE}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            publish.mutate();
          }}
        />
      )}

      {pending?.kind === 'update' && (
        <ConfirmDialog
          title="Update the live WordPress post"
          body={`Post #${published} is overwritten with the saved version of this article.`}
          confirmLabel="Update the live post"
          variant="danger"
          warning={dirty ? UNSAVED_WARNING : undefined}
          customerVisible={UPDATE_CUSTOMER_VISIBLE}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            updatePost.mutate();
          }}
        />
      )}

      {blocker.state === 'blocked' && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          body="This article has edits that were never saved. Leaving throws them away."
          confirmLabel="Discard and leave"
          variant="danger"
          onCancel={() => blocker.reset()}
          onConfirm={() => blocker.proceed()}
        />
      )}
    </div>
  );
}

const INPUT_CLASS =
  'mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 disabled:cursor-not-allowed disabled:opacity-50';

/** `id` must match the control's own `id` — that pairing is the label. */
function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="flex flex-wrap items-baseline gap-2 text-sm text-neutral-400">
        {label} {hint}
      </label>
      {children}
    </div>
  );
}

/** The length rules the API enforces, shown before the save is refused. */
function Counter({
  length,
  min = 0,
  max,
  label,
}: {
  length: number;
  min?: number;
  max: number;
  label: string | number;
}) {
  const ok = length >= min && length <= max;
  return (
    <span className={`text-xs ${ok ? 'text-neutral-500' : 'text-amber-300'}`}>
      {length}/{label}
    </span>
  );
}

/** The plugin reports non-fatal problems (missing media, taxonomy) as warnings. */
function WordPressResult({ message, warnings }: { message: string; warnings?: string[] }) {
  return (
    <div className="mt-3 text-sm text-emerald-400">
      <p>{message}</p>
      {warnings && warnings.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-amber-300">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
