import { ARTICLE_STATUSES } from '@shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '../../components/Badge';
import { Table, Td, Th } from '../../components/Table';
import { errorText } from '../../lib/errors';
import { EMPTY, formatDateTime, orEmpty } from '../../lib/format';
import { ARTICLES_PAGE_SIZE, type ArticleStatus, fetchArticles } from '../../lib/queries';
import { articleStatusTone, imagesTone } from '../../lib/status';
import { useOrgDetail } from '../OrgWorkspace';

/**
 * Every article the org has, with the two states the customer app never shows:
 * how far the image pipeline got, and where the piece has been published.
 * Both decide what the editor will let an operator do, so they are columns here
 * rather than a surprise on the next screen.
 */
export function ArticlesTab() {
  const { org } = useOrgDetail();
  const orgId = org.id;

  const [status, setStatus] = useState<ArticleStatus | null>(null);
  const [offset, setOffset] = useState(0);

  const articles = useQuery({
    queryKey: ['articles', orgId, status, offset],
    queryFn: () => fetchArticles(orgId, status, offset),
  });

  const page = articles.data;
  const shown = page ? page.articles.length : 0;

  return (
    <div>
      <Link
        to="new"
        className="mb-5 inline-block rounded bg-neutral-100 px-3 py-2 text-sm font-semibold text-neutral-900 hover:bg-white"
      >
        Add article manually
      </Link>

      <label className="text-sm text-neutral-400">
        Status{' '}
        <select
          value={status ?? 'all'}
          onChange={(event) => {
            const next = event.target.value;
            setStatus(next === 'all' ? null : (next as ArticleStatus));
            setOffset(0);
          }}
          className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
        >
          <option value="all">all</option>
          {ARTICLE_STATUSES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      {articles.isPending && <p className="mt-6 text-sm text-neutral-500">Loading articles…</p>}
      {articles.isError && (
        <p className="mt-6 text-sm text-red-400">
          {errorText(articles.error, 'Could not load the articles.')}
        </p>
      )}

      {page && page.articles.length === 0 && (
        <p className="mt-6 text-sm text-neutral-400">
          {status
            ? `No "${status}" articles.`
            : 'No articles yet — add one manually above or generate one from the planner.'}
        </p>
      )}

      {page && page.articles.length > 0 && (
        <div className="mt-4">
          <Table
            head={
              <>
                <Th>Title</Th>
                <Th>Keyword</Th>
                <Th>Search volume</Th>
                <Th>Status</Th>
                <Th>Images</Th>
                <Th>Publishing</Th>
                <Th>Created</Th>
                <Th>Published</Th>
              </>
            }
          >
            {page.articles.map((article) => (
              <tr key={article.id} className="hover:bg-neutral-900">
                <Td>
                  {/* The link is the row's open affordance — a clickable <tr>
                      would be unreachable by keyboard. */}
                  <Link
                    to={`/articles/${article.id}?org=${orgId}`}
                    className="font-medium underline decoration-neutral-600 underline-offset-4 hover:text-white"
                  >
                    {article.title}
                  </Link>
                  <div className="text-xs text-neutral-500">/{article.slug}</div>
                </Td>
                <Td>{orEmpty(article.keyword)}</Td>
                <Td numeric>{orEmpty(article.search_volume)}</Td>
                <Td>
                  <Badge tone={articleStatusTone(article.status)}>{article.status}</Badge>
                </Td>
                <Td>
                  <Badge tone={imagesTone(article.images_status)}>
                    images: {article.images_status}
                  </Badge>
                </Td>
                <Td>
                  {article.published_to.length === 0 ? (
                    <Badge>not published</Badge>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {article.published_to.map((provider) => (
                        <Badge key={provider} tone="good">
                          {provider === 'wordpress' ? 'WordPress' : 'Custom site'}
                        </Badge>
                      ))}
                    </div>
                  )}
                </Td>
                <Td>
                  <span className="whitespace-nowrap">{formatDateTime(article.created_at)}</span>
                </Td>
                <Td>
                  <span className="whitespace-nowrap">
                    {article.published_at ? formatDateTime(article.published_at) : EMPTY}
                  </span>
                </Td>
              </tr>
            ))}
          </Table>

          <div className="mt-3 flex items-center gap-3 text-sm text-neutral-400">
            <span>
              {offset + 1}–{offset + shown} of {page.total}
            </span>
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - ARTICLES_PAGE_SIZE))}
              className="ml-auto rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={offset + shown >= page.total}
              onClick={() => setOffset(offset + ARTICLES_PAGE_SIZE)}
              className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
