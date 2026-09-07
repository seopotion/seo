import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  type ArticleDetail,
  ArticleValidationError,
  createArticle,
  fetchArticle,
  fetchArticles,
} from '../src/lib/queries';
import { ArticlePage } from '../src/pages/ArticlePage';
import { CreateArticlePage } from '../src/pages/CreateArticlePage';
import { ArticlesTab } from '../src/pages/org/ArticlesTab';

const queryMocks = vi.hoisted(() => ({
  createArticle: vi.fn(),
  fetchArticle: vi.fn(),
  fetchArticles: vi.fn(),
}));

vi.mock('../src/lib/queries', async (importOriginal) => ({
  ...(await importOriginal()),
  ...queryMocks,
}));

function articleDetail(overrides: Partial<ArticleDetail> = {}): ArticleDetail {
  return {
    id: 'art1',
    keyword_id: null,
    keyword: null,
    title: 'Draft title',
    meta_title: 'Meta title',
    slug: 'draft-title',
    meta_description: 'A useful meta description for the standalone article.',
    featured_image_url: '',
    content: '## Body',
    status: 'generated',
    static_site_published_at: null,
    publications: [],
    auto_publish_error: null,
    auto_publish_attempts: [],
    images_status: 'complete',
    images: [],
    image_headings: ['Body'],
    created_at: '2026-09-04T10:00:00.000Z',
    updated_at: null,
    published_at: null,
    video: null,
    ...overrides,
  };
}

function WorkspaceOutlet() {
  return <Outlet context={{ org: { id: 'org1' } }} />;
}

function LocationPath() {
  const location = useLocation();
  return <p>{`${location.pathname}${location.search}`}</p>;
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderCreatePage() {
  const queryClient = createQueryClient();
  const router = createMemoryRouter(
    [
      {
        path: '/orgs/:orgId',
        element: <WorkspaceOutlet />,
        children: [
          { path: 'articles/new', element: <CreateArticlePage /> },
          { path: 'articles', element: <p>Article list</p> },
        ],
      },
      { path: '/articles/:articleId', element: <LocationPath /> },
    ],
    { initialEntries: ['/orgs/org1/articles/new'] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient, user: userEvent.setup() };
}

async function fillArticleFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Title'), 'Draft title');
  await user.type(screen.getByLabelText('Slug'), 'draft-title');
  await user.type(screen.getByLabelText(/Meta title/), 'Meta title');
  await user.type(screen.getByLabelText(/Meta description/), 'Meta description');
  await user.type(screen.getByLabelText(/Content/), '## Body');
}

async function openConfirmation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Create article' }));
  return screen.getByRole('dialog', { name: 'Create standalone article' });
}

async function confirmCreate(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await openConfirmation(user);
  await user.click(within(dialog).getByRole('button', { name: 'Create article' }));
}

beforeEach(() => {
  vi.mocked(createArticle).mockReset();
  vi.mocked(fetchArticle).mockReset();
  vi.mocked(fetchArticles).mockReset();
});

describe('CreateArticlePage', () => {
  test('renders the keyword and shared article fields with counters and the markdown hint', () => {
    renderCreatePage();

    expect(screen.getByRole('heading', { name: 'Create article' })).toBeTruthy();
    expect(screen.getByText(/optional focus keyword/)).toBeTruthy();
    expect(screen.getByText(/not linked to the planner or published automatically/)).toBeTruthy();
    expect(screen.getByLabelText(/Focus keyword/)).toBeTruthy();
    expect(screen.getByLabelText('Title')).toBeTruthy();
    expect(screen.getByLabelText('Slug')).toBeTruthy();
    expect(screen.getByLabelText(/Meta title/)).toBeTruthy();
    expect(screen.getByLabelText(/Meta description/)).toBeTruthy();
    expect(screen.getByLabelText(/Content/)).toBeTruthy();
    expect(screen.getByText(/Markdown/)).toBeTruthy();
  });

  test('submits a blank keyword as null and disables submission while creating', async () => {
    vi.mocked(createArticle).mockImplementation(() => new Promise(() => undefined));
    const { user } = renderCreatePage();
    await fillArticleFields(user);

    await confirmCreate(user);

    expect(createArticle).toHaveBeenCalledWith(
      'org1',
      expect.objectContaining({ keyword: null, title: 'Draft title' }),
    );
    const creating = screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement;
    expect(creating.disabled).toBe(true);
  });

  test('trims a nonblank keyword before submission', async () => {
    vi.mocked(createArticle).mockImplementation(() => new Promise(() => undefined));
    const { user } = renderCreatePage();
    await user.type(screen.getByLabelText(/Focus keyword/), '  focus keyword  ');
    await fillArticleFields(user);

    await confirmCreate(user);

    expect(createArticle).toHaveBeenCalledWith(
      'org1',
      expect.objectContaining({ keyword: 'focus keyword' }),
    );
  });

  test('canceling confirmation retains the draft', async () => {
    const { user } = renderCreatePage();
    await user.type(screen.getByLabelText('Title'), 'Keep this title');

    const dialog = await openConfirmation(user);
    expect(
      within(dialog).getByText(/appears immediately in the customer’s Content History/),
    ).toBeTruthy();
    expect(within(dialog).getByText(/It is not published/)).toBeTruthy();
    expect(within(dialog).getByText(/cannot currently be deleted/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(createArticle).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Keep this title');
  });

  test('renders field validation messages', async () => {
    vi.mocked(createArticle).mockRejectedValue(
      new ArticleValidationError({ slug: 'Slug is required' }),
    );
    const { user } = renderCreatePage();
    await user.type(screen.getByLabelText('Title'), 'Draft title');

    await confirmCreate(user);

    expect(await screen.findByText(/Slug is required/)).toBeTruthy();
    expect(screen.getByText(/Some fields are invalid/)).toBeTruthy();
  });

  test('retains every field after a failed request', async () => {
    vi.mocked(createArticle).mockRejectedValue(new TypeError('offline'));
    const { user } = renderCreatePage();
    await user.type(screen.getByLabelText(/Focus keyword/), 'focus');
    await fillArticleFields(user);

    await confirmCreate(user);

    expect(await screen.findByText('Could not create the article.')).toBeTruthy();
    expect((screen.getByLabelText(/Focus keyword/) as HTMLInputElement).value).toBe('focus');
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Draft title');
    expect((screen.getByLabelText(/Content/) as HTMLTextAreaElement).value).toBe('## Body');
  });

  test('invalidates article and org data and redirects to the created article', async () => {
    vi.mocked(createArticle).mockResolvedValue(articleDetail({ id: 'created1' }));
    const { queryClient, user } = renderCreatePage();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await fillArticleFields(user);

    await confirmCreate(user);

    expect(await screen.findByText('/articles/created1?org=org1')).toBeTruthy();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['articles'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['org', 'org1'] });
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  test('uses the leave guard when canceling a dirty draft', async () => {
    const { user } = renderCreatePage();
    await user.type(screen.getByLabelText('Title'), 'Dirty title');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    const dialog = screen.getByRole('dialog', { name: 'Discard this draft?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Dirty title');
  });
});

test('the empty article list advertises both creation paths', async () => {
  vi.mocked(fetchArticles).mockResolvedValue({ articles: [], total: 0 });
  const router = createMemoryRouter(
    [
      {
        path: '/orgs/:orgId',
        element: <WorkspaceOutlet />,
        children: [{ path: 'articles', element: <ArticlesTab /> }],
      },
    ],
    { initialEntries: ['/orgs/org1/articles'] },
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  expect(
    await screen.findByText(/add one manually above or generate one from the planner/),
  ).toBeTruthy();
});

test('nullable article list and detail values use explicit fallbacks', async () => {
  vi.mocked(fetchArticles).mockResolvedValue({
    articles: [
      {
        id: 'art1',
        title: 'Standalone',
        slug: 'standalone',
        keyword: null,
        status: 'generated',
        difficulty: null,
        search_volume: null,
        featured_image_url: '',
        created_at: '2026-09-04T10:00:00.000Z',
        published_at: null,
        images_status: 'complete',
        wordpress_post_id: null,
      },
    ],
    total: 1,
  });
  const listRouter = createMemoryRouter(
    [
      {
        path: '/orgs/:orgId',
        element: <WorkspaceOutlet />,
        children: [{ path: 'articles', element: <ArticlesTab /> }],
      },
    ],
    { initialEntries: ['/orgs/org1/articles'] },
  );
  const list = render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={listRouter} />
    </QueryClientProvider>,
  );
  const row = await screen.findByRole('row', { name: /Standalone/ });
  const cells = within(row).getAllByRole('cell');
  expect(cells[1]?.textContent).toBe('—');
  expect(cells[2]?.textContent).toBe('—');
  list.unmount();
  cleanup();

  vi.mocked(fetchArticle).mockResolvedValue(articleDetail());
  const detailRouter = createMemoryRouter(
    [{ path: '/articles/:articleId', element: <ArticlePage /> }],
    { initialEntries: ['/articles/art1'] },
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={detailRouter} />
    </QueryClientProvider>,
  );

  expect(await screen.findByText(/keyword: No focus keyword/)).toBeTruthy();
  expect(screen.queryByText(/keyword: null/)).toBeNull();
});
