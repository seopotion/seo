import type { RecordPublicationOptions } from '@shared/db';
import type { Article, Integration } from '@shared/schemas';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CommitFile, CommitPreparationContext } from '../src/clients/github';

const state = vi.hoisted(() => ({
  articles: [] as Article[],
  remote: new Map<string, string>(),
  head: 'base',
  commitCount: 0,
  leaseToken: null as string | null,
  beforeApply: null as null | (() => Promise<void>),
  preparedManifests: [] as string[],
  failRecordFor: null as string | null,
}));

const repos = vi.hoisted(() => ({
  listPublishedTo: vi.fn(async () =>
    state.articles.filter((article) =>
      article.publications.some((publication) => publication.provider === 'static-site'),
    ),
  ),
  recordPublication: vi.fn(
    async (
      id: string,
      entry: { provider: 'static-site'; ref: string; slug: string; remote_url: string | null },
      options: RecordPublicationOptions,
    ) => {
      if (state.failRecordFor === id) {
        state.failRecordFor = null;
        return false;
      }
      const article = state.articles.find((candidate) => candidate.id === id);
      if (!article) return false;
      const previous = article.publications.find(
        (publication) => publication.provider === 'static-site',
      );
      if (previous) Object.assign(previous, entry, { updated_at: options.updatedAt ?? null });
      else {
        article.publications.push({
          ...entry,
          published_at: options.publishedAt as Date,
          updated_at: options.updatedAt ?? null,
        });
      }
      return true;
    },
  ),
  claimPublishLease: vi.fn(async (_org: string, _provider: string, token: string) => {
    if (state.leaseToken) return false;
    state.leaseToken = token;
    return true;
  }),
  releasePublishLease: vi.fn(async (_org: string, _provider: string, token: string) => {
    if (state.leaseToken !== token) return false;
    state.leaseToken = null;
    return true;
  }),
}));

vi.mock('@shared/db', () => ({
  ArticleRepo: {
    listPublishedTo: repos.listPublishedTo,
    recordPublication: repos.recordPublication,
  },
  IntegrationRepo: {
    claimPublishLease: repos.claimPublishLease,
    releasePublishLease: repos.releasePublishLease,
  },
}));

const github = vi.hoisted(() => ({ commitFiles: vi.fn() }));
vi.mock('../src/clients/github', async (original) => ({
  ...(await original<typeof import('../src/clients/github')>()),
  commitFiles: github.commitFiles,
}));

import { publishStaticSiteArticle } from '../src/lib/publishers';
import { manifestEntry, renderArticle, renderManifest } from '../src/lib/static-site';

const integration: Extract<Integration, { provider: 'static-site' }> = {
  id: 'integration-1',
  org_id: 'org-1',
  provider: 'static-site',
  host: 'github',
  installation_id: 7,
  repo: 'acme/site',
  branch: 'main',
  content_path: 'seopotion/',
  post_url_base: 'https://acme.com',
  connected_at: new Date('2026-08-12T08:00:00.000Z'),
  last_error: null,
};

function article(id: string, slug: string): Article {
  return {
    id,
    org_id: 'org-1',
    keyword_id: `keyword-${id}`,
    title: `Guide ${id}`,
    meta_title: `Guide ${id}`,
    slug,
    keyword: `guide ${id}`,
    topic_cluster_id: null,
    topic_cluster_label: null,
    topic_role: null,
    topic_content_focus: null,
    topic_primary_keyword: null,
    meta_description: `Description ${id}`,
    featured_image_url: 'https://cdn.example/cover.webp',
    content: `## Guide ${id}\n\nBody.`,
    difficulty: 10,
    search_volume: 100,
    status: 'generated',
    created_at: new Date('2026-08-12T08:00:00.000Z'),
    published_at: null,
    publications: [],
    auto_publish: { preflight_error: null, attempts: [] },
    updated_at: null,
    images: [],
    images_status: 'complete',
    video: null,
    readability: null,
  };
}

async function applyCommit(options: {
  prepare(context: {
    headCommitSha: string;
    readFile(path: string): Promise<string | null>;
  }): Promise<Array<{ path: string; content: string | null }>>;
}) {
  const files = await options.prepare({
    headCommitSha: state.head,
    readFile: async (path) => state.remote.get(path) ?? null,
  });
  const manifest = files.find((file) => file.path.endsWith('manifest.json'))?.content;
  if (manifest) state.preparedManifests.push(manifest);
  if (state.beforeApply) await state.beforeApply();
  const changed = files.some((file) =>
    file.content === null
      ? state.remote.has(file.path)
      : state.remote.get(file.path) !== file.content,
  );
  if (!changed) return state.head;
  for (const file of files) {
    if (file.content === null) state.remote.delete(file.path);
    else state.remote.set(file.path, file.content);
  }
  state.commitCount++;
  state.head = `sha-${state.commitCount}`;
  return state.head;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.articles.length = 0;
  state.remote.clear();
  state.head = 'base';
  state.commitCount = 0;
  state.leaseToken = null;
  state.beforeApply = null;
  state.preparedManifests.length = 0;
  state.failRecordFor = null;
  github.commitFiles.mockImplementation(applyCommit);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('static-site aggregate concurrency', () => {
  test('different-slug concurrent attempts converge with both articles in the manifest', async () => {
    const first = article('article-a', 'alpha');
    const second = article('article-b', 'beta');
    state.articles.push(first, second);
    let entered: (() => void) | undefined;
    let resume: (() => void) | undefined;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    state.beforeApply = async () => {
      entered?.();
      await gate;
      state.beforeApply = null;
    };

    const firstPublish = publishStaticSiteArticle({ article: first, integration });
    await inside;
    await expect(publishStaticSiteArticle({ article: second, integration })).rejects.toMatchObject({
      error: { code: 'static_publish_in_progress' },
    });
    resume?.();
    await firstPublish;
    await publishStaticSiteArticle({ article: second, integration });

    const manifest = JSON.parse(state.remote.get('seopotion/manifest.json') ?? '{}');
    expect(manifest.articles.map((entry: { slug: string }) => entry.slug).sort()).toEqual([
      'alpha',
      'beta',
    ]);
  });

  test('same-slug concurrent attempts converge to one owner and one slug conflict', async () => {
    const first = article('article-a', 'same');
    const second = article('article-b', 'same');
    state.articles.push(first, second);
    let entered: (() => void) | undefined;
    let resume: (() => void) | undefined;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    state.beforeApply = async () => {
      entered?.();
      await gate;
      state.beforeApply = null;
    };

    const firstPublish = publishStaticSiteArticle({ article: first, integration });
    await inside;
    await expect(publishStaticSiteArticle({ article: second, integration })).rejects.toMatchObject({
      error: { code: 'static_publish_in_progress' },
    });
    resume?.();
    await firstPublish;
    await expect(publishStaticSiteArticle({ article: second, integration })).rejects.toMatchObject({
      error: { code: 'slug_conflict' },
    });

    const manifest = JSON.parse(state.remote.get('seopotion/manifest.json') ?? '{}');
    expect(manifest.articles).toHaveLength(1);
    expect(manifest.articles[0]).toMatchObject({ source_article_id: 'article-a', slug: 'same' });
    expect(second.publications).toEqual([]);
  });

  test('a ref retry recomputes semantics against the new remote manifest', async () => {
    const current = article('article-b', 'beta');
    const winner = article('article-a', 'alpha');
    state.articles.push(current);
    github.commitFiles.mockImplementationOnce(
      async (options: { prepare(context: CommitPreparationContext): Promise<CommitFile[]> }) => {
        const firstFiles = await options.prepare({
          headCommitSha: 'base',
          readFile: async () => null,
        });
        const firstManifest = firstFiles.find((file) =>
          file.path.endsWith('manifest.json'),
        )?.content;
        state.remote.set(
          'seopotion/manifest.json',
          renderManifest(
            [
              {
                article: winner,
                slug: winner.slug,
                published_at: new Date('2026-08-12T09:00:00.000Z'),
                updated_at: null,
              },
            ],
            integration.content_path,
            new Date('2026-08-12T09:00:00.000Z'),
          ),
        );
        const secondFiles = await options.prepare({
          headCommitSha: 'winner',
          readFile: async (path) => state.remote.get(path) ?? null,
        });
        const secondManifest = secondFiles.find((file) =>
          file.path.endsWith('manifest.json'),
        )?.content;
        expect(JSON.parse(firstManifest ?? '{}').articles).toHaveLength(1);
        expect(
          JSON.parse(secondManifest ?? '{}').articles.map((entry: { slug: string }) => entry.slug),
        ).toEqual(expect.arrayContaining(['alpha', 'beta']));
        for (const file of secondFiles) {
          if (file.content !== null) state.remote.set(file.path, file.content);
        }
        return 'sha-recomputed';
      },
    );

    await publishStaticSiteArticle({ article: current, integration });
    expect(repos.recordPublication).toHaveBeenCalledWith(
      current.id,
      expect.objectContaining({ ref: 'sha-recomputed' }),
      { publishedAt: expect.any(Date), updatedAt: null },
    );
  });

  test('a ref retry records timestamps from the final exact head only', async () => {
    const firstPublishedAt = new Date('2026-08-12T10:00:00.000Z');
    const finalPublishedAt = new Date('2026-08-12T09:00:00.000Z');
    const finalUpdatedAt = new Date('2026-08-12T11:00:00.000Z');
    const currentUpdatedAt = new Date('2026-08-12T12:00:00.000Z');
    const current = article('article-a', 'alpha');
    current.content = '## Guide article-a\n\nCurrent body.';
    current.updated_at = currentUpdatedAt;
    const old = { ...current, content: '## Guide article-a\n\nOld body.' };
    state.articles.push(current);
    state.remote.set(
      'seopotion/manifest.json',
      renderManifest(
        [
          {
            article: old,
            slug: old.slug,
            published_at: firstPublishedAt,
            updated_at: null,
          },
        ],
        integration.content_path,
        firstPublishedAt,
      ),
    );
    state.remote.set(
      'seopotion/articles/alpha.md',
      renderArticle({
        article: old,
        slug: old.slug,
        published_at: firstPublishedAt,
        updated_at: null,
      }),
    );
    github.commitFiles.mockImplementationOnce(
      async (options: { prepare(context: CommitPreparationContext): Promise<CommitFile[]> }) => {
        const firstFiles = await options.prepare({
          headCommitSha: 'first-head',
          readFile: async (path) => state.remote.get(path) ?? null,
        });
        expect(
          JSON.parse(
            firstFiles.find((file) => file.path.endsWith('manifest.json'))?.content ?? '{}',
          ).articles[0],
        ).toMatchObject({
          published_at: firstPublishedAt.toISOString(),
          updated_at: currentUpdatedAt.toISOString(),
        });

        state.remote.set(
          'seopotion/manifest.json',
          renderManifest(
            [
              {
                article: current,
                slug: current.slug,
                published_at: finalPublishedAt,
                updated_at: finalUpdatedAt,
              },
            ],
            integration.content_path,
            finalUpdatedAt,
          ),
        );
        state.remote.set(
          'seopotion/articles/alpha.md',
          renderArticle({
            article: current,
            slug: current.slug,
            published_at: finalPublishedAt,
            updated_at: finalUpdatedAt,
          }),
        );
        await options.prepare({
          headCommitSha: 'final-head',
          readFile: async (path) => state.remote.get(path) ?? null,
        });
        return 'final-head';
      },
    );

    const result = await publishStaticSiteArticle({
      article: current,
      integration,
      at: firstPublishedAt,
    });

    expect(result.published_at).toEqual(finalPublishedAt);
    expect(repos.recordPublication).toHaveBeenCalledWith(
      current.id,
      expect.objectContaining({ ref: 'final-head' }),
      { publishedAt: finalPublishedAt, updatedAt: finalUpdatedAt },
    );
  });

  test('a later manual request recovers the remote timestamp and creates no second commit', async () => {
    vi.useFakeTimers();
    const firstAt = new Date('2026-08-12T10:00:00.000Z');
    const retryAt = new Date('2026-08-12T12:00:00.000Z');
    const first = article('article-a', 'alpha');
    state.articles.push(first);
    state.failRecordFor = first.id;
    vi.setSystemTime(firstAt);

    await expect(publishStaticSiteArticle({ article: first, integration })).rejects.toMatchObject({
      error: { code: 'record_failed' },
    });
    expect(state.commitCount).toBe(1);
    const landedHead = state.head;
    const landedFiles = new Map(state.remote);
    vi.setSystemTime(retryAt);

    const recovered = await publishStaticSiteArticle({ article: first, integration });

    expect(state.commitCount).toBe(1);
    expect(state.remote).toEqual(landedFiles);
    expect(recovered).toMatchObject({ ref: landedHead, published_at: firstAt });
    expect(first.publications[0]).toMatchObject({
      ref: landedHead,
      published_at: firstAt,
      updated_at: null,
    });
    expect(repos.recordPublication).toHaveBeenLastCalledWith(
      first.id,
      expect.objectContaining({ ref: landedHead }),
      { publishedAt: firstAt, updatedAt: null },
    );
  });

  test('manual recovery after another article preserves both without an extra commit', async () => {
    vi.useFakeTimers();
    const firstAt = new Date('2026-08-12T10:00:00.000Z');
    const otherAt = new Date('2026-08-12T11:00:00.000Z');
    const retryAt = new Date('2026-08-12T12:00:00.000Z');
    const first = article('article-a', 'alpha');
    const second = article('article-b', 'beta');
    state.articles.push(first, second);
    state.failRecordFor = first.id;
    vi.setSystemTime(firstAt);

    await expect(publishStaticSiteArticle({ article: first, integration })).rejects.toMatchObject({
      error: { code: 'record_failed' },
    });
    vi.setSystemTime(otherAt);
    await publishStaticSiteArticle({ article: second, integration });
    expect(state.commitCount).toBe(2);
    const headAfterOther = state.head;
    const filesAfterOther = new Map(state.remote);
    vi.setSystemTime(retryAt);

    await publishStaticSiteArticle({ article: first, integration });

    expect(state.commitCount).toBe(2);
    expect(state.remote).toEqual(filesAfterOther);
    const manifest = JSON.parse(state.remote.get('seopotion/manifest.json') ?? '{}');
    expect(manifest.articles.map((entry: { slug: string }) => entry.slug).sort()).toEqual([
      'alpha',
      'beta',
    ]);
    expect(first.publications[0]).toMatchObject({
      ref: headAfterOther,
      published_at: firstAt,
      updated_at: null,
    });
  });

  test('changed content after an orphaned commit is a real republish with the original date', async () => {
    vi.useFakeTimers();
    const firstAt = new Date('2026-08-12T10:00:00.000Z');
    const updateAt = new Date('2026-08-12T12:00:00.000Z');
    const current = article('article-a', 'alpha');
    state.articles.push(current);
    state.failRecordFor = current.id;
    vi.setSystemTime(firstAt);

    await expect(publishStaticSiteArticle({ article: current, integration })).rejects.toMatchObject(
      {
        error: { code: 'record_failed' },
      },
    );
    const originalMarkdown = state.remote.get('seopotion/articles/alpha.md');
    current.content = '## Guide article-a\n\nChanged body.';
    current.updated_at = updateAt;
    vi.setSystemTime(updateAt);

    const updated = await publishStaticSiteArticle({ article: current, integration });

    expect(state.commitCount).toBe(2);
    expect(state.remote.get('seopotion/articles/alpha.md')).not.toBe(originalMarkdown);
    const manifest = JSON.parse(state.remote.get('seopotion/manifest.json') ?? '{}');
    expect(manifest.articles[0]).toMatchObject({
      source_article_id: current.id,
      published_at: firstAt.toISOString(),
      updated_at: updateAt.toISOString(),
    });
    expect(updated.published_at).toEqual(firstAt);
    expect(current.publications[0]).toMatchObject({
      ref: 'sha-2',
      published_at: firstAt,
      updated_at: updateAt,
    });
    expect(repos.recordPublication).toHaveBeenLastCalledWith(
      current.id,
      expect.objectContaining({ ref: 'sha-2' }),
      { publishedAt: firstAt, updatedAt: updateAt },
    );
  });

  test('automatic retry records a durable edit timestamp after an orphaned first commit', async () => {
    const requestedAt = new Date('2026-08-12T10:00:00.000Z');
    const editedAt = new Date('2026-08-12T12:00:00.000Z');
    const laterAt = new Date('2026-08-12T13:00:00.000Z');
    const current = article('article-a', 'alpha');
    const later = article('article-b', 'beta');
    state.articles.push(current, later);
    state.failRecordFor = current.id;

    await expect(
      publishStaticSiteArticle({ article: current, integration, at: requestedAt }),
    ).rejects.toMatchObject({ error: { code: 'record_failed' } });
    expect(state.commitCount).toBe(1);

    current.content = '## Guide article-a\n\nEdited after the first remote commit.';
    current.updated_at = editedAt;
    const updated = await publishStaticSiteArticle({
      article: current,
      integration,
      at: requestedAt,
    });

    expect(state.commitCount).toBe(2);
    expect(state.remote.get('seopotion/articles/alpha.md')).toContain(
      'Edited after the first remote commit.',
    );
    let manifest = JSON.parse(state.remote.get('seopotion/manifest.json') ?? '{}');
    const updatedEntry = manifest.articles.find(
      (entry: { source_article_id: string }) => entry.source_article_id === current.id,
    );
    expect(updatedEntry).toMatchObject({
      published_at: requestedAt.toISOString(),
      updated_at: editedAt.toISOString(),
    });
    expect(current.publications[0]).toMatchObject({
      published_at: requestedAt,
      updated_at: editedAt,
    });
    expect(updated.published_at).toEqual(requestedAt);
    expect(repos.recordPublication).toHaveBeenLastCalledWith(
      current.id,
      expect.objectContaining({ ref: 'sha-2' }),
      { publishedAt: requestedAt, updatedAt: editedAt },
    );

    const stableEntry = JSON.stringify(updatedEntry);
    await publishStaticSiteArticle({ article: later, integration, at: laterAt });

    expect(state.commitCount).toBe(3);
    manifest = JSON.parse(state.remote.get('seopotion/manifest.json') ?? '{}');
    expect(
      JSON.stringify(
        manifest.articles.find(
          (entry: { source_article_id: string }) => entry.source_article_id === current.id,
        ),
      ),
    ).toBe(stableEntry);
  });

  test('exact automatic retry preserves null updated_at and creates no second commit', async () => {
    const requestedAt = new Date('2026-08-12T10:00:00.000Z');
    const current = article('article-a', 'alpha');
    state.articles.push(current);
    state.failRecordFor = current.id;

    await expect(
      publishStaticSiteArticle({ article: current, integration, at: requestedAt }),
    ).rejects.toMatchObject({ error: { code: 'record_failed' } });
    const landedFiles = new Map(state.remote);

    const recovered = await publishStaticSiteArticle({
      article: current,
      integration,
      at: requestedAt,
    });

    expect(state.commitCount).toBe(1);
    expect(state.remote).toEqual(landedFiles);
    expect(recovered.published_at).toEqual(requestedAt);
    expect(current.publications[0]).toMatchObject({
      published_at: requestedAt,
      updated_at: null,
    });
    expect(repos.recordPublication).toHaveBeenLastCalledWith(
      current.id,
      expect.objectContaining({ ref: 'sha-1' }),
      { publishedAt: requestedAt, updatedAt: null },
    );
  });

  test('orphaned changed content without a newer edit time uses a stable non-null fallback', async () => {
    const requestedAt = new Date('2026-08-12T10:00:00.000Z');
    const current = article('article-a', 'alpha');
    state.articles.push(current);
    state.failRecordFor = current.id;

    await expect(
      publishStaticSiteArticle({ article: current, integration, at: requestedAt }),
    ).rejects.toMatchObject({ error: { code: 'record_failed' } });
    current.content = '## Guide article-a\n\nChanged without a durable editor timestamp.';
    state.failRecordFor = current.id;

    await expect(
      publishStaticSiteArticle({ article: current, integration, at: requestedAt }),
    ).rejects.toMatchObject({ error: { code: 'record_failed' } });
    expect(state.commitCount).toBe(2);
    let manifest = JSON.parse(state.remote.get('seopotion/manifest.json') ?? '{}');
    expect(manifest.articles[0]).toMatchObject({
      published_at: requestedAt.toISOString(),
      updated_at: requestedAt.toISOString(),
    });

    await publishStaticSiteArticle({ article: current, integration, at: requestedAt });

    expect(state.commitCount).toBe(2);
    manifest = JSON.parse(state.remote.get('seopotion/manifest.json') ?? '{}');
    expect(manifest.articles[0]).toMatchObject({
      published_at: requestedAt.toISOString(),
      updated_at: requestedAt.toISOString(),
    });
    expect(current.publications[0]).toMatchObject({
      published_at: requestedAt,
      updated_at: requestedAt,
    });
  });

  test('a landed desired tree reconciles the current head without another commit', async () => {
    const current = article('article-a', 'alpha');
    state.articles.push(current);
    const at = new Date('2026-08-12T10:00:00.000Z');
    const entry = manifestEntry(
      { article: current, slug: current.slug, published_at: at, updated_at: null },
      integration.content_path,
    );
    state.remote.set(
      'seopotion/manifest.json',
      `${JSON.stringify({ version: 1, generated_at: at.toISOString(), articles: [entry] }, null, 2)}\n`,
    );
    state.remote.set(
      'seopotion/articles/alpha.md',
      renderArticle({ article: current, slug: current.slug, published_at: at, updated_at: null }),
    );
    await publishStaticSiteArticle({ article: current, integration, at });
    expect(state.commitCount).toBe(0);
    expect(repos.recordPublication).toHaveBeenCalledWith(
      current.id,
      expect.objectContaining({ ref: 'base' }),
      { publishedAt: at, updatedAt: null },
    );
  });
});
