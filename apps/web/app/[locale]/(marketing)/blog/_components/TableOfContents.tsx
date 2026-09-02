import type { Heading } from '../source';

/**
 * Anchors are plain `<a>`: these are same-page fragments, so routing them
 * through next-intl's `Link` would only add a locale prefix they don't want.
 * The ids come from the same slugger `rehype-slug` runs on the rendered
 * headings — see `source.ts`.
 */
export function TableOfContents({ headings }: { headings: Heading[] }) {
  // Two entries is a list, not an outline — it costs a rail and earns nothing.
  if (headings.length < 3) return null;

  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
        On this page
      </p>
      <ol className="mt-3 grid gap-2 border-border border-l pl-4">
        {headings.map((heading) => (
          <li className={heading.depth === 3 ? 'pl-3' : undefined} key={heading.id}>
            <a
              className="text-muted-foreground no-underline transition-colors hover:text-amber-700"
              href={`#${heading.id}`}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
