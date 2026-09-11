import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ArticleImages } from '../src/components/ArticleImages';
import { ApiError } from '../src/lib/api';
import type { ArticleDetail } from '../src/lib/queries';
import { ArticlePage } from '../src/pages/ArticlePage';

const mocks = vi.hoisted(() => ({
  prepareImageUpload: vi.fn(),
  uploadImageFile: vi.fn(),
  finalizeImageUpload: vi.fn(),
  removeArticleImage: vi.fn(),
  optimizeImage: vi.fn(),
  fetchArticle: vi.fn(),
  fetchPublishingTargets: vi.fn(),
}));
vi.mock('../src/lib/image-uploads', () => mocks);
vi.mock('../src/lib/optimize-image', () => ({ optimizeImage: mocks.optimizeImage }));
vi.mock('../src/lib/queries', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchArticle: mocks.fetchArticle,
}));
const article: ArticleDetail = {
  id: 'article',
  keyword_id: null,
  keyword: null,
  title: 'Guide',
  slug: 'guide',
  meta_title: 'Guide',
  meta_description: 'A guide',
  content: '## First\n\nBody',
  featured_image_url: '',
  status: 'generated',
  images_status: 'complete',
  images: [],
  image_headings: ['First'],
  static_site_published_at: null,
  publications: [],
  auto_publish_error: null,
  auto_publish_attempts: [],
  created_at: '2026-09-01T12:00:00Z',
  updated_at: null,
  published_at: null,
  video: null,
};
const image = {
  role: 'inline' as const,
  section_heading: 'First',
  alt: 'Mountain lake',
  url: 'https://cdn.example.com/inline.png',
  prompt: '',
  model: null,
  seed: null,
  generated_at: null,
  width: 1,
  height: 1,
};
const uploaded: ArticleDetail = {
  ...article,
  images: [image],
  content: `## First\n\n![Mountain lake](${image.url})\n\nBody`,
};
const onUploaded = vi.fn();
const onBusy = vi.fn();
const optimizedFile = new File([new Uint8Array(90_000)], 'lake.webp', { type: 'image/webp' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepareImageUpload.mockResolvedValue({
    upload_url: 'https://s3.example.com/key',
    headers: { 'Content-Type': 'image/webp' },
    upload_token: 'token',
  });
  mocks.uploadImageFile.mockImplementation(async (_url, _headers, _file, progress) =>
    progress(100),
  );
  mocks.finalizeImageUpload.mockResolvedValue(uploaded);
  mocks.optimizeImage.mockResolvedValue({ file: optimizedFile, width: 1200, height: 800 });
  mocks.removeArticleImage.mockResolvedValue(article);
  mocks.fetchArticle.mockResolvedValue(article);
  mocks.fetchPublishingTargets.mockResolvedValue({ destinations: [] });
});
afterEach(cleanup);

function setup(overrides: Partial<ArticleDetail> = {}, disabled = false) {
  render(
    <ArticleImages
      article={{ ...article, ...overrides }}
      disabled={disabled}
      onBusy={onBusy}
      onUploaded={onUploaded}
    />,
  );
  return userEvent.setup({ applyAccept: false });
}
async function selectFile(
  user: ReturnType<typeof userEvent.setup>,
  file = new File(['png'], 'lake.png', { type: 'image/png' }),
) {
  await user.upload(screen.getByLabelText('Image file'), file);
  await user.type(screen.getByLabelText('Descriptive alt text'), 'Mountain lake');
}

test('uploads a cover with required alt, reports progress and returns finalized article', async () => {
  const user = setup();
  expect((screen.getByRole('button', { name: 'Upload image' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await selectFile(user);
  let resolveUpload: () => void = () => {};
  mocks.uploadImageFile.mockImplementationOnce((_url, _headers, _file, progress) => {
    progress(42);
    return new Promise<void>((resolve) => {
      resolveUpload = resolve;
    });
  });
  await user.click(screen.getByRole('button', { name: 'Upload image' }));
  expect(await screen.findByText('Uploading: 42%')).toBeTruthy();
  expect(mocks.prepareImageUpload).toHaveBeenCalledWith('article', {
    role: 'cover',
    section_heading: null,
    alt: 'Mountain lake',
    content_type: 'image/webp',
    size: 90_000,
  });
  expect(mocks.uploadImageFile).toHaveBeenCalledWith(
    'https://s3.example.com/key',
    { 'Content-Type': 'image/webp' },
    optimizedFile,
    expect.any(Function),
  );
  resolveUpload();
  await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(uploaded));
  expect(mocks.finalizeImageUpload).toHaveBeenCalledWith('article', 'token');
  expect(onBusy.mock.calls).toEqual([[true], [false]]);
  expect(screen.getByText('Optimized: 1200 × 800 px · 90.0 KB · WebP')).toBeTruthy();
});

test('optimizes a large original before preparing or uploading any bytes', async () => {
  const user = setup();
  const source = new File([new Uint8Array(2_500_000)], 'large.png', { type: 'image/png' });
  let finishOptimization: (result: unknown) => void = () => {};
  mocks.optimizeImage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOptimization = resolve;
      }),
  );
  await selectFile(user, source);
  await user.click(screen.getByRole('button', { name: 'Upload image' }));
  expect(await screen.findByText('Optimizing…')).toBeTruthy();
  expect(mocks.optimizeImage).toHaveBeenCalledWith(source);
  expect(mocks.prepareImageUpload).not.toHaveBeenCalled();
  expect(mocks.uploadImageFile).not.toHaveBeenCalled();
  finishOptimization({ file: optimizedFile, width: 1200, height: 800 });
  await waitFor(() => expect(onUploaded).toHaveBeenCalled());
  expect(mocks.uploadImageFile.mock.calls[0]?.[2]).toBe(optimizedFile);
});

test('optimization failure does not prepare, upload, or finalize', async () => {
  const user = setup();
  mocks.optimizeImage.mockRejectedValueOnce(new ApiError('image_compression_limit', 0));
  await selectFile(user);
  await user.click(screen.getByRole('button', { name: 'Upload image' }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining('could not be reduced to 100 KB'),
  );
  expect(mocks.prepareImageUpload).not.toHaveBeenCalled();
  expect(mocks.uploadImageFile).not.toHaveBeenCalled();
  expect(mocks.finalizeImageUpload).not.toHaveBeenCalled();
  expect(onBusy.mock.calls).toEqual([[true], [false]]);
});

test('allows H2 selection and previews existing generated images without upload controls', async () => {
  const user = setup();
  await selectFile(user);
  await user.selectOptions(screen.getByLabelText('Image placement'), 'h2:First');
  await user.click(screen.getByRole('button', { name: 'Upload image' }));
  await waitFor(() =>
    expect(mocks.prepareImageUpload).toHaveBeenCalledWith(
      'article',
      expect.objectContaining({ role: 'inline', section_heading: 'First' }),
    ),
  );
  cleanup();
  setup({ keyword_id: 'planner', images: [image] });
  expect(screen.getByRole('img', { name: 'Mountain lake' }).getAttribute('src')).toBe(image.url);
  expect(screen.queryByLabelText('Image file')).toBeNull();
});

test.each([
  new File(['svg'], 'image.svg', { type: 'image/svg+xml' }),
  new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }),
])('rejects unsupported or oversized files in the browser', async (file) => {
  const user = setup();
  await selectFile(user, file);
  await user.click(screen.getByRole('button', { name: 'Upload image' }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Choose a WebP, JPEG, or PNG file up to 5 MiB.',
  );
  expect(mocks.prepareImageUpload).not.toHaveBeenCalled();
});

test('retains a successful upload token to retry finalization after a network error', async () => {
  const user = setup();
  mocks.finalizeImageUpload.mockRejectedValueOnce(new ApiError('article_changed', 409));
  await selectFile(user);
  await user.click(screen.getByRole('button', { name: 'Upload image' }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining('article changed'),
  );
  await user.click(screen.getByRole('button', { name: 'Retry finalization' }));
  await waitFor(() => expect(onUploaded).toHaveBeenCalled());
  expect(mocks.prepareImageUpload).toHaveBeenCalledTimes(1);
  expect(mocks.optimizeImage).toHaveBeenCalledTimes(1);
  expect(mocks.uploadImageFile).toHaveBeenCalledTimes(1);
  expect(mocks.finalizeImageUpload).toHaveBeenCalledTimes(2);
});

test.each([
  ['image_upload_failed', 403, 'HTTP 403'],
  ['image_upload_network_error', 0, 'storage CORS allows this admin app address'],
] as const)('shows %s after preparation succeeds without finalizing the article', async (code, status, message) => {
  const user = setup();
  mocks.uploadImageFile.mockRejectedValueOnce(new ApiError(code, status));
  await selectFile(user);
  await user.click(screen.getByRole('button', { name: 'Upload image' }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining(message),
  );
  expect(mocks.prepareImageUpload).toHaveBeenCalledTimes(1);
  expect(mocks.finalizeImageUpload).not.toHaveBeenCalled();
  expect(onUploaded).not.toHaveBeenCalled();
});

test('blocks unsaved edits and a ninth image while allowing replacements', () => {
  setup(
    {
      images: Array.from({ length: 8 }, (_, i) => ({
        ...image,
        section_heading: i === 0 ? 'First' : `Section ${i}`,
        url: `image-${i}`,
      })),
      image_headings: ['First', 'Second', 'Third'],
    },
    true,
  );
  expect(screen.getByText('Save your edits before uploading or removing images.')).toBeTruthy();
  expect(screen.getByText('8 of 8 images uploaded.')).toBeTruthy();
  expect((screen.getByRole('option', { name: 'Cover' }) as HTMLOptionElement).disabled).toBe(true);
  expect(
    (screen.getByRole('option', { name: 'After H2: Third' }) as HTMLOptionElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole('option', { name: 'After H2: First' }) as HTMLOptionElement).disabled,
  ).toBe(false);
});

test('allows an eighth image after the former two-inline limit', async () => {
  const user = setup({
    images: Array.from({ length: 7 }, (_, i) => ({
      ...image,
      section_heading: `Section ${i}`,
      url: `image-${i}`,
    })),
  });
  expect(screen.getByText('7 of 8 images uploaded.')).toBeTruthy();
  await selectFile(user);
  await user.selectOptions(screen.getByLabelText('Image placement'), 'h2:First');
  await user.click(screen.getByRole('button', { name: 'Upload image' }));
  await waitFor(() => expect(onUploaded).toHaveBeenCalled());
});

test('the article editor refreshes its draft and preview after inline finalization', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/articles/:articleId', element: <ArticlePage /> }], {
    initialEntries: ['/articles/article'],
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await screen.findByLabelText('Image file');
  await selectFile(user);
  await user.selectOptions(screen.getByLabelText('Image placement'), 'h2:First');
  mocks.fetchArticle.mockResolvedValue(uploaded);
  await user.click(screen.getByRole('button', { name: 'Upload image' }));
  await waitFor(() =>
    expect((screen.getByLabelText(/Content/) as HTMLTextAreaElement).value).toBe(uploaded.content),
  );
  expect(await screen.findByRole('img', { name: image.alt })).toBeTruthy();
  expect(screen.queryByText('Unsaved changes')).toBeNull();
  expect(mocks.fetchArticle).toHaveBeenCalledTimes(2);
});

test('removal requires confirmation and cancel leaves the image intact', async () => {
  const user = setup(uploaded);
  await user.click(screen.getByRole('button', { name: 'Remove image: Mountain lake' }));
  expect(screen.getByRole('dialog', { name: 'Remove image?' })).toBeTruthy();
  expect(mocks.removeArticleImage).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('img', { name: image.alt })).toBeTruthy();
  expect(mocks.removeArticleImage).not.toHaveBeenCalled();
});

test('removes the selected image and blocks uploads and other removals while pending', async () => {
  const user = setup(uploaded);
  let finishRemoval: (result: ArticleDetail) => void = () => {};
  mocks.removeArticleImage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRemoval = resolve;
      }),
  );
  await user.click(screen.getByRole('button', { name: 'Remove image: Mountain lake' }));
  await user.click(screen.getByRole('button', { name: 'Remove image' }));
  expect(await screen.findByText('Removing image…')).toBeTruthy();
  expect(mocks.removeArticleImage).toHaveBeenCalledWith(article.id, image.url);
  expect(screen.getByRole('button', { name: 'Remove image: Mountain lake' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(screen.getByLabelText('Image file').closest('fieldset')).toHaveProperty('disabled', true);
  expect(onBusy).toHaveBeenCalledWith(true);
  finishRemoval(article);
  await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(article));
  expect(onBusy.mock.calls).toEqual([[true], [false]]);
});

test('failed removal keeps the preview and allows retry', async () => {
  const user = setup(uploaded);
  mocks.removeArticleImage.mockRejectedValueOnce(new ApiError('article_changed', 409));
  await user.click(screen.getByRole('button', { name: 'Remove image: Mountain lake' }));
  await user.click(screen.getByRole('button', { name: 'Remove image' }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining('article changed'),
  );
  expect(screen.getByRole('img', { name: image.alt })).toBeTruthy();
  expect(onUploaded).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Remove image: Mountain lake' }));
  await user.click(screen.getByRole('button', { name: 'Remove image' }));
  await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(article));
});

test('disables removal for unsaved edits and hides it for generated articles', () => {
  setup(uploaded, true);
  expect(screen.getByRole('button', { name: 'Remove image: Mountain lake' })).toHaveProperty(
    'disabled',
    true,
  );
  cleanup();
  setup({ ...uploaded, keyword_id: 'planner' });
  expect(screen.queryByRole('button', { name: /Remove image/ })).toBeNull();
});

test('the article editor refreshes Markdown, preview and count after removal without publishing', async () => {
  mocks.fetchArticle.mockResolvedValue(uploaded);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/articles/:articleId', element: <ArticlePage /> }], {
    initialEntries: ['/articles/article'],
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Remove image: Mountain lake' }));
  mocks.fetchArticle.mockResolvedValue(article);
  await user.click(screen.getByRole('button', { name: 'Remove image' }));
  await waitFor(() =>
    expect((screen.getByLabelText(/Content/) as HTMLTextAreaElement).value).toBe(article.content),
  );
  expect(screen.queryByRole('img', { name: image.alt })).toBeNull();
  expect(screen.getByText('0 of 8 images uploaded.')).toBeTruthy();
  expect(screen.queryByText('Unsaved changes')).toBeNull();
});
