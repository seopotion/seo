import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useBlocker, useNavigate } from 'react-router';
import {
  ARTICLE_INPUT_CLASS,
  ArticleFieldErrors,
  ArticleFields,
} from '../components/ArticleFields';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { errorText } from '../lib/errors';
import { type ArticleDraft, ArticleValidationError, createArticle } from '../lib/queries';
import { useOrgDetail } from './OrgWorkspace';

const EMPTY_DRAFT: ArticleDraft = {
  title: '',
  slug: '',
  meta_title: '',
  meta_description: '',
  content: '',
};

export function CreateArticlePage() {
  const { org } = useOrgDetail();
  const orgId = org.id;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const allowLeave = useRef(false);
  const [keyword, setKeyword] = useState('');
  const [draft, setDraft] = useState<ArticleDraft>(EMPTY_DRAFT);
  const [confirming, setConfirming] = useState(false);

  const dirty = keyword !== '' || Object.values(draft).some((value) => value !== '');

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const blocker = useBlocker(() => dirty && !allowLeave.current);
  const backTo = `/orgs/${orgId}/articles`;

  const create = useMutation({
    mutationFn: () =>
      createArticle(orgId, {
        ...draft,
        keyword: keyword.trim() || null,
      }),
    onSuccess: (created) => {
      allowLeave.current = true;
      queryClient.invalidateQueries({ queryKey: ['articles'] });
      queryClient.invalidateQueries({ queryKey: ['org', orgId] });
      navigate(`/articles/${created.id}?org=${orgId}`);
    },
  });

  const set = (field: keyof ArticleDraft, value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));
  const fieldErrors = create.error instanceof ArticleValidationError ? create.error.fields : null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!create.isPending) setConfirming(true);
  };

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold">Create article</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Add a standalone article with an optional focus keyword. It is not linked to the planner or
        published automatically.
      </p>

      <form className="mt-6" onSubmit={submit}>
        <div className="mb-4">
          <label htmlFor="keyword" className="text-sm text-neutral-400">
            Focus keyword <span className="text-xs text-neutral-500">optional</span>
          </label>
          <input
            id="keyword"
            type="text"
            value={keyword}
            disabled={create.isPending}
            onChange={(event) => setKeyword(event.target.value)}
            className={ARTICLE_INPUT_CLASS}
          />
        </div>

        <ArticleFields draft={draft} disabled={create.isPending} onChange={set} />

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={create.isPending}
            onClick={() => navigate(backTo)}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {create.isPending ? 'Creating…' : 'Create article'}
          </button>
        </div>

        {create.isError && (
          <div className="mt-3 text-sm text-red-400">
            <p>{errorText(create.error, 'Could not create the article.')}</p>
            {fieldErrors && <ArticleFieldErrors fields={fieldErrors} />}
          </div>
        )}
      </form>

      {confirming && (
        <ConfirmDialog
          title="Create standalone article"
          body="The article appears immediately in the customer’s Content History. It is not published, and it cannot currently be deleted through the admin app."
          confirmLabel="Create article"
          customerVisible="The article appears immediately in Content History."
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            create.mutate();
          }}
        />
      )}

      {blocker.state === 'blocked' && (
        <ConfirmDialog
          title="Discard this draft?"
          body="This article has not been created. Leaving throws away the draft."
          confirmLabel="Discard and leave"
          variant="danger"
          onCancel={() => blocker.reset()}
          onConfirm={() => blocker.proceed()}
        />
      )}
    </div>
  );
}
