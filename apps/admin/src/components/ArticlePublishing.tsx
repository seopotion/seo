import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { errorMessage, errorText } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import {
  type ArticleDetail,
  fetchPublishingTargets,
  publishToStaticSite,
  publishToWordPress,
  updateWordPressPost,
} from '../lib/queries';
import { Badge } from './Badge';
import { ConfirmDialog } from './ConfirmDialog';

const PUBLISH_CUSTOMER_VISIBLE = "This posts the article to the customer's LIVE WordPress site.";

const UPDATE_CUSTOMER_VISIBLE =
  "This overwrites the article on the customer's LIVE WordPress site.";

const UNSAVED_WARNING =
  'You have unsaved edits. Publishing uses the last saved version, not what is currently in the editor.';

type PendingAction = {
  provider: 'wordpress' | 'static-site';
  published: boolean;
  target: string;
};

export function ArticlePublishing({
  article,
  dirty,
  imageUploadBusy,
  onPublished,
}: {
  article: ArticleDetail;
  dirty: boolean;
  imageUploadBusy: boolean;
  onPublished: () => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const wordpressBusy = useRef(false);
  const staticSiteBusy = useRef(false);
  const targets = useQuery({
    queryKey: ['publishing-targets', article.id],
    queryFn: () => fetchPublishingTargets(article.id),
  });

  const refreshAfterPublish = async () => {
    await Promise.all([
      onPublished(),
      queryClient.invalidateQueries({ queryKey: ['publishing-targets', article.id] }),
    ]);
  };

  const wordpress = useMutation({
    mutationFn: (published: boolean) =>
      published ? updateWordPressPost(article.id) : publishToWordPress(article.id),
    onSuccess: refreshAfterPublish,
    onSettled: () => {
      wordpressBusy.current = false;
    },
  });

  const staticSite = useMutation({
    mutationFn: (_published: boolean) => publishToStaticSite(article.id),
    onSuccess: refreshAfterPublish,
    onSettled: () => {
      staticSiteBusy.current = false;
    },
  });

  const openConfirmation = (action: PendingAction) => {
    wordpress.reset();
    staticSite.reset();
    setPending(action);
  };

  const confirm = () => {
    if (!pending) return;
    if (pending.provider === 'wordpress') {
      if (wordpressBusy.current) return;
      wordpressBusy.current = true;
      wordpress.mutate(pending.published);
    } else {
      if (staticSiteBusy.current) return;
      staticSiteBusy.current = true;
      staticSite.mutate(pending.published);
    }
    setPending(null);
  };

  const imagesComplete = article.images_status === 'complete';

  return (
    <section className="mt-8 rounded border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="font-semibold">Publishing</h2>
      <p className="mt-1 text-sm text-neutral-400">
        Publishing sends the last saved version. Each destination is published separately.
      </p>

      {targets.isPending && (
        <p className="mt-4 text-sm text-neutral-500">Loading publishing destinations…</p>
      )}

      {targets.isError && (
        <p className="mt-4 text-sm text-red-400">
          {errorText(targets.error, 'Could not load publishing destinations.')}
        </p>
      )}

      {targets.data?.destinations.length === 0 && (
        <p className="mt-4 rounded border border-neutral-700 bg-neutral-950 p-3 text-sm text-neutral-400">
          This organization has no connected publishing destinations.
        </p>
      )}

      {targets.data && targets.data.destinations.length > 0 && (
        <div className="mt-4 space-y-4">
          {targets.data.destinations.map((destination) => {
            const publication = article.publications.find(
              (entry) => entry.provider === destination.provider,
            );
            const wordpressRef =
              destination.provider === 'wordpress'
                ? (article.wordpress_post_id ?? publication?.ref)
                : undefined;
            const published = Boolean(publication || wordpressRef);
            const publishedAt =
              publication?.published_at ??
              (destination.provider === 'wordpress' && wordpressRef ? article.published_at : null);
            const isWordPress = destination.provider === 'wordpress';
            const mutation = isWordPress ? wordpress : staticSite;
            const actionLabel = isWordPress
              ? published
                ? 'Update WordPress post'
                : 'Publish to WordPress'
              : published
                ? 'Update custom site'
                : 'Publish to custom site';
            const mutationStartedPublished = mutation.variables ?? published;
            const loadingLabel = isWordPress
              ? mutationStartedPublished
                ? 'Updating WordPress…'
                : 'Publishing to WordPress…'
              : mutationStartedPublished
                ? 'Updating custom site…'
                : 'Publishing to custom site…';

            return (
              <div
                key={destination.provider}
                className="rounded border border-neutral-700 bg-neutral-950 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{isWordPress ? 'WordPress' : 'Custom site'}</h3>
                  <Badge tone="good">connected</Badge>
                  <Badge tone={published ? 'good' : 'neutral'}>
                    {published ? 'published' : 'not published'}
                  </Badge>
                </div>
                <p className="mt-2 break-all font-mono text-xs text-neutral-300">
                  {destination.target}
                </p>
                <p className="mt-2 text-xs text-neutral-500">
                  Connected {formatDateTime(destination.connected_at)}
                  {publishedAt ? ` · Previously published ${formatDateTime(publishedAt)}` : ''}
                  {isWordPress && wordpressRef ? ` · Post #${wordpressRef}` : ''}
                </p>

                {destination.last_error && (
                  <p className="mt-3 rounded border border-amber-700 bg-amber-950/60 p-3 text-sm text-amber-200">
                    Integration warning: {errorMessage(destination.last_error.code)} ·{' '}
                    {formatDateTime(destination.last_error.at)}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={
                      !imagesComplete ||
                      imageUploadBusy ||
                      mutation.isPending ||
                      targets.isPending ||
                      targets.isError
                    }
                    onClick={() =>
                      openConfirmation({
                        provider: destination.provider,
                        published,
                        target: destination.target,
                      })
                    }
                    className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {mutation.isPending ? loadingLabel : actionLabel}
                  </button>
                  {!imagesComplete && (
                    <span className="text-sm text-amber-300">
                      Publishing is unavailable until images are complete — images are{' '}
                      {article.images_status}.
                    </span>
                  )}
                </div>

                {mutation.isError && (
                  <p className="mt-3 text-sm text-red-400">
                    {errorText(
                      mutation.error,
                      isWordPress
                        ? 'Could not publish to WordPress.'
                        : 'Could not publish to the custom site.',
                    )}
                  </p>
                )}

                {isWordPress && wordpress.isSuccess && (
                  <WordPressResult
                    message={
                      wordpress.variables
                        ? `Live post #${wordpress.data.post_id} updated.`
                        : `Published as post #${wordpress.data.post_id}.`
                    }
                    warnings={wordpress.data.warnings}
                  />
                )}

                {!isWordPress && staticSite.isSuccess && (
                  <StaticSiteResult
                    updated={staticSite.variables}
                    path={staticSite.data.path}
                    commitUrl={staticSite.data.commit_url}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {pending?.provider === 'wordpress' && (
        <ConfirmDialog
          title={pending.published ? 'Update the live WordPress post' : 'Publish to WordPress'}
          body={
            pending.published
              ? `Post #${article.wordpress_post_id ?? article.publications.find((entry) => entry.provider === 'wordpress')?.ref} is overwritten with the saved version of this article.`
              : `“${article.title}” is created as a new post on the customer's WordPress site.`
          }
          confirmLabel={pending.published ? 'Update the live post' : 'Publish to the live site'}
          variant="danger"
          warning={dirty ? UNSAVED_WARNING : undefined}
          customerVisible={pending.published ? UPDATE_CUSTOMER_VISIBLE : PUBLISH_CUSTOMER_VISIBLE}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      )}

      {pending?.provider === 'static-site' && (
        <ConfirmDialog
          title={pending.published ? 'Update custom site' : 'Publish to custom site'}
          body={`This commits the saved article and manifest to ${pending.target}. The customer’s deployment may make it live immediately.`}
          confirmLabel={pending.published ? 'Update custom site' : 'Publish to custom site'}
          variant="danger"
          warning={dirty ? UNSAVED_WARNING : undefined}
          customerVisible="This changes the customer’s repository and may trigger their live deployment."
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      )}
    </section>
  );
}

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

function StaticSiteResult({
  updated,
  path,
  commitUrl,
}: {
  updated: boolean;
  path: string;
  commitUrl: string;
}) {
  let safeCommitUrl: string | null = null;
  try {
    const url = new URL(commitUrl);
    if (url.protocol === 'https:' && url.hostname === 'github.com') safeCommitUrl = url.href;
  } catch {}

  return (
    <div className="mt-3 text-sm text-emerald-400">
      <p>{updated ? 'Custom site updated.' : 'Published to custom site.'}</p>
      <p className="mt-1 font-mono text-xs">{path}</p>
      {safeCommitUrl && (
        <a
          href={safeCommitUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block underline"
        >
          View GitHub commit
        </a>
      )}
    </div>
  );
}
