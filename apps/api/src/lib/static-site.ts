import type { Article } from '@shared/schemas';

/**
 * The bytes we write into a client repo: YAML frontmatter + Markdown per
 * article, and one manifest.json index. Frozen contract — see
 * design/static-site-integration.md § The contract. Pure functions, no I/O:
 * the publish route hands the result to `clients/github.ts`.
 */

/** Contract version carried in the manifest. Adapters fail loudly on an unknown major. */
export const MANIFEST_VERSION = 1;

/**
 * One article as it currently stands on the client's site. `slug` is the slug
 * the file is **actually committed under**, which is not `article.slug`: the
 * editor can rename an article after publishing, and until it republishes the
 * repo still holds the old filename (design/integrations-model.md).
 */
export interface PublishedArticle {
  article: Article;
  slug: string;
  published_at: Date;
  updated_at: Date | null;
}

/** `content_path` -> a prefix with exactly one trailing slash, or '' for the repo root. */
function root(contentPath: string): string {
  const trimmed = contentPath.replace(/^\/+/, '').replace(/\/+$/, '');
  return trimmed ? `${trimmed}/` : '';
}

export function articlePath(contentPath: string, slug: string): string {
  return `${root(contentPath)}articles/${slug}.md`;
}

export function manifestPath(contentPath: string): string {
  return `${root(contentPath)}manifest.json`;
}

/**
 * Every string scalar goes through JSON.stringify, because JSON is a subset of
 * YAML 1.2's double-quoted style — so this is a correct escape for quotes,
 * colons, newlines and unicode without hand-rolling one or taking a dependency.
 *
 * Quoting *everything* is deliberate, not lazy: an unquoted title containing
 * ": " ends the key, and YAML 1.1 (which js-yaml still defaults to) reads a bare
 * `no` as boolean false. A slug like `no` is not hypothetical.
 */
const yamlString = (value: string): string => JSON.stringify(value);

const yamlNumber = (value: number | null): string => (value === null ? 'null' : String(value));

function coverOf(article: Article): { alt: string; width: number | null; height: number | null } {
  const slot = article.images.find((i) => i.role === 'cover');
  // Intrinsic pixels as the provider reported them at generation (#176). Still
  // nullable: articles imaged before #178 have none, and the contract's own
  // answer for that is null — the adapter omits the attributes rather than guess.
  return { alt: slot?.alt ?? '', width: slot?.width ?? null, height: slot?.height ?? null };
}

interface InlineImage {
  src: string;
  alt: string;
  width: number | null;
  height: number | null;
}

/**
 * Inline slots, in body order. An unfilled slot would emit a broken `src`, so
 * drop it. Emitted into **both** the frontmatter and the manifest, from this one
 * function, so the two can never disagree — and so an adapter can fix inline CLS
 * from the manifest alone, without parsing YAML. Dimensions carry the same
 * pre-#178 null caveat as the cover (see coverOf).
 */
function inlineImages(article: Article): InlineImage[] {
  return article.images
    .filter((i) => i.role === 'inline' && i.url)
    .map((i) => ({ src: i.url, alt: i.alt, width: i.width, height: i.height }));
}

/** One manifest entry, in the order the contract documents. */
function manifestEntry(entry: PublishedArticle, contentPath: string) {
  const { article } = entry;
  const cover = coverOf(article);
  return {
    slug: entry.slug,
    title: article.title,
    meta_title: article.meta_title,
    meta_description: article.meta_description,
    keyword: article.keyword,
    cover: article.featured_image_url,
    cover_alt: cover.alt,
    cover_width: cover.width,
    cover_height: cover.height,
    // Repeated from the frontmatter so a manifest-only adapter can add
    // width/height to inline `<img>`s — Markdown image syntax carries neither.
    images: inlineImages(article),
    published_at: entry.published_at.toISOString(),
    updated_at: entry.updated_at ? entry.updated_at.toISOString() : null,
    // Repo-root-relative, so an adapter never reconstructs `content_path` itself.
    path: articlePath(contentPath, entry.slug),
  };
}

/**
 * The article file: frontmatter + the body **verbatim**. The body already holds
 * absolute CDN image URLs and the YouTube iframe, so there is nothing to
 * rewrite (design/static-site-integration.md § Publish semantics).
 */
export function renderArticle(entry: PublishedArticle): string {
  const { article } = entry;
  const cover = coverOf(article);
  const images = inlineImages(article);
  const updatedAt = entry.updated_at ? yamlString(entry.updated_at.toISOString()) : 'null';

  const lines = [
    '---',
    `slug: ${yamlString(entry.slug)}`,
    `title: ${yamlString(article.title)}`,
    `meta_title: ${yamlString(article.meta_title)}`,
    `meta_description: ${yamlString(article.meta_description)}`,
    `keyword: ${yamlString(article.keyword)}`,
    // Quoted so every parser hands back a string rather than coercing to its
    // own date type.
    `published_at: ${yamlString(entry.published_at.toISOString())}`,
    `updated_at: ${updatedAt}`,
    `cover: ${yamlString(article.featured_image_url)}`,
    `cover_alt: ${yamlString(cover.alt)}`,
    `cover_width: ${yamlNumber(cover.width)}`,
    `cover_height: ${yamlNumber(cover.height)}`,
  ];

  if (images.length === 0) {
    lines.push('images: []');
  } else {
    lines.push('images:');
    for (const image of images) {
      lines.push(`  - src: ${yamlString(image.src)}`);
      lines.push(`    alt: ${yamlString(image.alt)}`);
      lines.push(`    width: ${yamlNumber(image.width)}`);
      lines.push(`    height: ${yamlNumber(image.height)}`);
    }
  }

  if (article.video) {
    lines.push('video:');
    lines.push(`  id: ${yamlString(article.video.video_id)}`);
    lines.push(`  title: ${yamlString(article.video.title)}`);
  } else {
    lines.push('video: null');
  }

  lines.push('---');
  // The body starts at `##` — the H1 is `title`, and rendering it is the page's job.
  return `${lines.join('\n')}\n\n${article.content.trimEnd()}\n`;
}

/**
 * The whole index, rebuilt from what the database says is published. Sorted by
 * `published_at` descending so a naive adapter that renders the array in order
 * gets a correct reverse-chronological blog index for free; slug breaks ties so
 * the committed bytes are a function of the data and nothing else.
 */
export function renderManifest(
  entries: PublishedArticle[],
  contentPath: string,
  generatedAt: Date,
): string {
  const articles = [...entries]
    .sort(
      (a, b) => b.published_at.getTime() - a.published_at.getTime() || a.slug.localeCompare(b.slug),
    )
    .map((entry) => manifestEntry(entry, contentPath));

  const manifest = {
    version: MANIFEST_VERSION,
    generated_at: generatedAt.toISOString(),
    articles,
  };
  // Trailing newline: this file lands in someone else's `git diff`.
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
