import { ImageResponse } from 'next/og';
import { loadPostFrontmatter } from '../content';
import { BLOG_LOCALE, POST_SLUGS } from '../registry';

/**
 * Per-post social card, rendered at build time — one fewer asset to produce for
 * every post, and link previews stop falling back to the 192px site logo.
 *
 * `generateMetadata` on the page deliberately leaves `openGraph.images` unset so
 * Next merges this file in. Satori (what `ImageResponse` runs on) supports a
 * subset of CSS: every element with more than one child needs an explicit
 * `display`, and there is no text truncation — hence `clamp()` below.
 */

export const alt = 'Seopotion blog post';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export function generateStaticParams() {
  return POST_SLUGS.map((slug) => ({ locale: BLOG_LOCALE, slug }));
}

/**
 * Satori has no text truncation, so overlong copy would silently overflow the
 * card. These are the same limits `blog-content.test.ts` enforces on
 * frontmatter, so in practice this never fires — it is the backstop for a post
 * that somehow gets past the test.
 */
const MAX_TITLE = 60;
const MAX_DESCRIPTION = 160;

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}

export default async function OpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { title, description, author } = await loadPostFrontmatter(slug);

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        padding: 80,
        backgroundColor: '#ffffff',
        borderTop: '16px solid #fb923c',
      }}
    >
      <div
        style={{
          display: 'flex',
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: 4,
          color: '#d97706',
        }}
      >
        SEOPOTION
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            fontSize: 62,
            fontWeight: 700,
            lineHeight: 1.15,
            color: '#111827',
          }}
        >
          {clamp(title, MAX_TITLE)}
        </div>
        <div style={{ display: 'flex', marginTop: 28, fontSize: 28, color: '#4b5563' }}>
          {clamp(description, MAX_DESCRIPTION)}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 24,
          color: '#6b7280',
        }}
      >
        <span>{author}</span>
        <span>seopotion.co/blog</span>
      </div>
    </div>,
    size,
  );
}
