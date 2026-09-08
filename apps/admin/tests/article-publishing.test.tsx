import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ArticlePublishing } from '../src/components/ArticlePublishing';
import { ApiError } from '../src/lib/api';
import type { ArticleDetail, ArticleListItem, PublishingTarget } from '../src/lib/queries';
import { ArticlePage } from '../src/pages/ArticlePage';
import { ArticlesTab } from '../src/pages/org/ArticlesTab';

const mocks = vi.hoisted(() => ({
  fetchPublishingTargets: vi.fn(),
  fetchArticles: vi.fn(),
  fetchArticle: vi.fn(),
  publishToStaticSite: vi.fn(),
  publishToWordPress: vi.fn(),
  updateWordPressPost: vi.fn(),
}));

vi.mock('../src/lib/queries', async (importOriginal) => ({
  ...(await importOriginal()),
  ...mocks,
}));

const wordpressTarget: PublishingTarget = {
  provider: 'wordpress',
  target: 'https://customer.example',
  connected_at: '2026-08-01T10:00:00.000Z',
  last_error: null,
};

const staticSiteTarget: PublishingTarget = {
  provider: 'static-site',
  target: 'customer/repository@main',
  connected_at: '2026-08-02T10:00:00.000Z',
  last_error: null,
};

const article: ArticleDetail = {
  id: 'article',
  keyword_id: null,
  keyword: null,
  title: 'Guide',
  slug: 'guide',
  meta_title: 'Guide',
  meta_description: 'A guide',
  content: '## Body',
  featured_image_url: '',
  status: 'generated',
  images_status: 'complete',
  images: [],
  image_headings: ['Body'],
  static_site_published_at: null,
  publications: [],
  auto_publish_error: null,
  auto_publish_attempts: [],
  created_at: '2026-09-01T12:00:00.000Z',
  updated_at: null,
  published_at: null,
  video: null,
};

const wordpressPublication: ArticleDetail['publications'][number] = {
  provider: 'wordpress',
  ref: '42',
  slug: 'original-guide',
  remote_url: 'https://customer.example/?p=42',
  published_at: '2026-08-10T10:00:00.000Z',
  updated_at: null,
};

const staticSitePublication: ArticleDetail['publications'][number] = {
  provider: 'static-site',
  ref: 'oldsha',
  slug: 'original-guide',
  remote_url: 'https://github.com/customer/repository/commit/oldsha',
  published_at: '2026-08-11T10:00:00.000Z',
  updated_at: null,
};

function queryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function setup({
  destinations = [wordpressTarget],
  articleOverrides = {},
  dirty = false,
  imageUploadBusy = false,
}: {
  destinations?: PublishingTarget[];
  articleOverrides?: Partial<ArticleDetail>;
  dirty?: boolean;
  imageUploadBusy?: boolean;
} = {}) {
  mocks.fetchPublishingTargets.mockResolvedValue({ destinations });
  const client = queryClient();
  const onPublished = vi.fn().mockResolvedValue(undefined);
  render(
    <QueryClientProvider client={client}>
      <ArticlePublishing
        article={{ ...article, ...articleOverrides }}
        dirty={dirty}
        imageUploadBusy={imageUploadBusy}
        onPublished={onPublished}
      />
    </QueryClientProvider>,
  );
  return { client, onPublished, user: userEvent.setup() };
}

async function confirm(user: ReturnType<typeof userEvent.setup>, label: string) {
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: label }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.publishToWordPress.mockResolvedValue({ success: true, post_id: 42, warnings: [] });
  mocks.updateWordPressPost.mockResolvedValue({ success: true, post_id: 42, warnings: [] });
  mocks.publishToStaticSite.mockResolvedValue({
    commit_sha: 'abc123',
    commit_url: 'https://github.com/customer/repository/commit/abc123',
    path: 'seopotion/articles/guide.md',
  });
});

afterEach(cleanup);

describe('publishing destinations', () => {
  test('renders a target-loading state without publishing actions', () => {
    mocks.fetchPublishingTargets.mockImplementation(() => new Promise(() => undefined));
    const client = queryClient();
    render(
      <QueryClientProvider client={client}>
        <ArticlePublishing
          article={article}
          dirty={false}
          imageUploadBusy={false}
          onPublished={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Loading publishing destinations…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /WordPress|custom site/i })).toBeNull();
  });

  test('surfaces target-query errors separately', async () => {
    mocks.fetchPublishingTargets.mockRejectedValue(new ApiError('not_found', 404));
    const client = queryClient();
    render(
      <QueryClientProvider client={client}>
        <ArticlePublishing
          article={article}
          dirty={false}
          imageUploadBusy={false}
          onPublished={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/record no longer exists/)).toBeTruthy();
    expect(screen.queryByText(/Could not publish/)).toBeNull();
  });

  test('shows an empty state when the org has no destinations', async () => {
    setup({ destinations: [] });
    expect(await screen.findByText(/no connected publishing destinations/)).toBeTruthy();
  });

  test('shows only the WordPress action for a WordPress destination', async () => {
    setup();
    expect(await screen.findByText('https://customer.example')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish to WordPress' })).toHaveProperty(
      'disabled',
      false,
    );
    expect(screen.queryByRole('button', { name: /custom site/i })).toBeNull();
    expect(screen.getByText('connected')).toBeTruthy();
    expect(screen.getByText('not published')).toBeTruthy();
  });

  test('shows only the custom-site action for a static-site destination', async () => {
    setup({ destinations: [staticSiteTarget] });
    expect(await screen.findByText('customer/repository@main')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish to custom site' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /WordPress/i })).toBeNull();
  });

  test('shows separate actions for both destinations', async () => {
    setup({ destinations: [wordpressTarget, staticSiteTarget] });
    expect(await screen.findByRole('button', { name: 'Publish to WordPress' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish to custom site' })).toBeTruthy();
  });

  test('uses publication records for update labels even after the slug changes', async () => {
    setup({
      destinations: [wordpressTarget, staticSiteTarget],
      articleOverrides: {
        slug: 'changed-guide',
        publications: [wordpressPublication, staticSitePublication],
      },
    });
    expect(await screen.findByRole('button', { name: 'Update WordPress post' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update custom site' })).toBeTruthy();
    expect(screen.getAllByText(/Previously published/)).toHaveLength(2);
  });

  test('uses the legacy WordPress post id as published state', async () => {
    setup({ articleOverrides: { wordpress_post_id: 42, publications: [] } });
    expect(await screen.findByRole('button', { name: 'Update WordPress post' })).toBeTruthy();
    expect(screen.getByText(/Post #42/)).toBeTruthy();
  });

  test('shows integration warnings with their readable error', async () => {
    setup({
      destinations: [
        {
          ...staticSiteTarget,
          last_error: { code: 'installation_suspended', at: '2026-09-01T12:00:00.000Z' },
        },
      ],
    });
    expect(await screen.findByText(/GitHub App installation is suspended/)).toBeTruthy();
  });
});

describe('publishing actions', () => {
  test.each([
    [{ images_status: 'pending' as const }, false],
    [{}, true],
  ])('disables actions when images or an upload are incomplete', async (articleOverrides, busy) => {
    setup({ articleOverrides, imageUploadBusy: busy });
    const button = (await screen.findByRole('button', {
      name: 'Publish to WordPress',
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  test('shows the generalized saved-version warning for a dirty editor', async () => {
    const { user } = setup({ dirty: true });
    await user.click(await screen.findByRole('button', { name: 'Publish to WordPress' }));
    expect(screen.getByText(/Publishing uses the last saved version/)).toBeTruthy();
    expect(screen.queryByText(/WordPress is sent/)).toBeNull();
  });

  test('cancels a confirmation without making a request', async () => {
    const { user } = setup({ destinations: [staticSiteTarget] });
    await user.click(await screen.findByRole('button', { name: 'Publish to custom site' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(mocks.publishToStaticSite).not.toHaveBeenCalled();
  });

  test('confirms only the selected provider and names the exact static target', async () => {
    const { user } = setup({ destinations: [wordpressTarget, staticSiteTarget] });
    await user.click(await screen.findByRole('button', { name: 'Publish to custom site' }));
    expect(within(screen.getByRole('dialog')).getByText(/customer\/repository@main/)).toBeTruthy();
    await confirm(user, 'Publish to custom site');
    await waitFor(() => expect(mocks.publishToStaticSite).toHaveBeenCalledWith('article'));
    expect(mocks.publishToWordPress).not.toHaveBeenCalled();
  });

  test('guards a provider from duplicate concurrent confirmation requests', async () => {
    mocks.fetchPublishingTargets.mockResolvedValue({ destinations: [staticSiteTarget] });
    mocks.publishToStaticSite.mockImplementation(() => new Promise(() => undefined));
    const client = queryClient();
    render(
      <QueryClientProvider client={client}>
        <ArticlePublishing
          article={article}
          dirty={false}
          imageUploadBusy={false}
          onPublished={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Publish to custom site' }));
    const confirmation = within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Publish to custom site',
    });
    fireEvent.click(confirmation);
    fireEvent.click(confirmation);
    await waitFor(() => expect(mocks.publishToStaticSite).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole('button', { name: 'Publishing to custom site…' }),
    ).toHaveProperty('disabled', true);
  });

  test('preserves WordPress post id and warnings and refreshes data', async () => {
    mocks.publishToWordPress.mockResolvedValue({
      success: true,
      post_id: 42,
      warnings: ['Featured image was skipped'],
    });
    const { client, onPublished, user } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await user.click(await screen.findByRole('button', { name: 'Publish to WordPress' }));
    await confirm(user, 'Publish to the live site');
    expect(await screen.findByText('Published as post #42.')).toBeTruthy();
    expect(screen.getByText('Featured image was skipped')).toBeTruthy();
    expect(onPublished).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['publishing-targets', 'article'] });
  });

  test('shows static publish output with a safe GitHub link and refreshes data', async () => {
    const { client, onPublished, user } = setup({ destinations: [staticSiteTarget] });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await user.click(await screen.findByRole('button', { name: 'Publish to custom site' }));
    await confirm(user, 'Publish to custom site');
    expect(await screen.findByText('Published to custom site.')).toBeTruthy();
    expect(screen.getByText('seopotion/articles/guide.md')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'View GitHub commit' });
    expect(link.getAttribute('href')).toBe('https://github.com/customer/repository/commit/abc123');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
    expect(onPublished).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['publishing-targets', 'article'] });
  });

  test('does not link an unexpected commit URL', async () => {
    mocks.publishToStaticSite.mockResolvedValue({
      commit_sha: 'abc123',
      commit_url: 'https://example.com/customer/repository/commit/abc123',
      path: 'seopotion/articles/guide.md',
    });
    const { user } = setup({ destinations: [staticSiteTarget] });
    await user.click(await screen.findByRole('button', { name: 'Publish to custom site' }));
    await confirm(user, 'Publish to custom site');
    expect(await screen.findByText('Published to custom site.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'View GitHub commit' })).toBeNull();
  });

  test('reports whether a static publication was updated', async () => {
    const { user } = setup({
      destinations: [staticSiteTarget],
      articleOverrides: { publications: [staticSitePublication] },
    });
    await user.click(await screen.findByRole('button', { name: 'Update custom site' }));
    await confirm(user, 'Update custom site');
    expect(await screen.findByText('Custom site updated.')).toBeTruthy();
  });

  test.each([
    ['wordpress', 'wordpress_request_failed', /WordPress site did not respond/],
    ['static-site', 'missing_write_permission', /does not have write access/],
  ] as const)('shows a readable %s failure without an old success', async (provider, code, text) => {
    const destination = provider === 'wordpress' ? wordpressTarget : staticSiteTarget;
    const mutation =
      provider === 'wordpress' ? mocks.publishToWordPress : mocks.publishToStaticSite;
    const action = provider === 'wordpress' ? 'Publish to WordPress' : 'Publish to custom site';
    const confirmLabel = provider === 'wordpress' ? 'Publish to the live site' : action;
    const { user } = setup({ destinations: [destination] });
    await user.click(await screen.findByRole('button', { name: action }));
    await confirm(user, confirmLabel);
    expect(await screen.findByText(/Published as post|Published to custom site/)).toBeTruthy();

    mutation.mockRejectedValueOnce(new ApiError(code, 422));
    await user.click(screen.getByRole('button', { name: action }));
    await confirm(user, confirmLabel);
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByText(/Published as post|Published to custom site/)).toBeNull();
  });
});

describe('article-list publishing badges', () => {
  test.each([
    [[], ['not published']],
    [['wordpress'], ['WordPress']],
    [['static-site'], ['Custom site']],
    [
      ['wordpress', 'static-site'],
      ['WordPress', 'Custom site'],
    ],
  ] as const)('renders completed publications for %j', async (publishedTo, labels) => {
    const providers = [...publishedTo] as ArticleListItem['published_to'];
    const listItem: ArticleListItem = {
      id: 'article',
      title: 'Guide',
      slug: 'guide',
      keyword: null,
      status: 'published',
      difficulty: null,
      search_volume: null,
      featured_image_url: '',
      created_at: '2026-09-01T12:00:00.000Z',
      published_at: '2026-09-02T12:00:00.000Z',
      images_status: 'complete',
      wordpress_post_id: providers.includes('wordpress') ? 42 : null,
      published_to: providers,
    };
    mocks.fetchArticles.mockResolvedValue({ articles: [listItem], total: 1 });
    const router = createMemoryRouter(
      [
        {
          path: '/orgs/:orgId',
          element: <Outlet context={{ org: { id: 'org1' } }} />,
          children: [{ path: 'articles', element: <ArticlesTab /> }],
        },
      ],
      { initialEntries: ['/orgs/org1/articles'] },
    );
    render(
      <QueryClientProvider client={queryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const row = await screen.findByRole('row', { name: /Guide/ });
    for (const label of labels) expect(within(row).getByText(label)).toBeTruthy();
    if (!providers.includes('wordpress')) expect(within(row).queryByText('WordPress')).toBeNull();
    if (!providers.includes('static-site')) {
      expect(within(row).queryByText('Custom site')).toBeNull();
    }
  });
});

test('the article header shows a badge for each completed provider', async () => {
  mocks.fetchArticle.mockResolvedValue({
    ...article,
    wordpress_post_id: 42,
    publications: [wordpressPublication, staticSitePublication],
  });
  mocks.fetchPublishingTargets.mockResolvedValue({
    destinations: [wordpressTarget, staticSiteTarget],
  });
  const router = createMemoryRouter([{ path: '/articles/:articleId', element: <ArticlePage /> }], {
    initialEntries: ['/articles/article'],
  });
  render(
    <QueryClientProvider client={queryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  expect(await screen.findByText('WordPress: published · #42')).toBeTruthy();
  expect(screen.getByText('Custom site: published')).toBeTruthy();
  expect(screen.queryByText(/WordPress: not published/)).toBeNull();
});

test('the article page invalidates article, targets, and list queries after publishing', async () => {
  mocks.fetchArticle.mockResolvedValue(article);
  mocks.fetchPublishingTargets.mockResolvedValue({ destinations: [staticSiteTarget] });
  const client = queryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const router = createMemoryRouter([{ path: '/articles/:articleId', element: <ArticlePage /> }], {
    initialEntries: ['/articles/article'],
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Publish to custom site' }));
  await confirm(user, 'Publish to custom site');
  await screen.findByText('Published to custom site.');

  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['article', 'article'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['publishing-targets', 'article'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['articles'] });
});
