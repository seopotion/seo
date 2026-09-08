import Image from 'next/image';
import Markdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/**
 * The article body as it will publish. The generator writes GitHub-flavored
 * Markdown (packages/shared/generation/src/article.ts) and the WordPress client
 * publishes it through `marked` (apps/api/src/clients/wordpress.ts), so the
 * preview parses the same dialect rather than a hand-rolled subset of it.
 *
 * The body also carries raw HTML: the YouTube embed is injected as an
 * `<iframe>` (packages/shared/generation/src/video.ts) and publishes verbatim.
 * Raw HTML is parsed, then sanitized to GitHub's default schema plus `iframe`;
 * the `iframe` component below only mounts YouTube embed URLs.
 */
export function ArticleContentPreview({ title, content }: { title: string; content: string }) {
  return (
    <article className="grid gap-4 wrap-break-word text-foreground">
      {/* The body carries no H1: the page renders `title`, here as on the customer's site. */}
      <h1 className="font-semibold text-2xl text-foreground leading-tight">{title}</h1>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={components}
      >
        {content}
      </Markdown>
    </article>
  );
}

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'iframe'],
  attributes: { ...defaultSchema.attributes, iframe: ['src', 'title'] },
};

const YOUTUBE_EMBED_HOSTS = new Set(['www.youtube-nocookie.com', 'www.youtube.com']);

function isYouTubeEmbed(src: unknown): src is string {
  if (typeof src !== 'string') return false;
  try {
    const url = new URL(src);
    return YOUTUBE_EMBED_HOSTS.has(url.hostname) && url.pathname.startsWith('/embed/');
  } catch {
    return false;
  }
}

const components: Components = {
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-info underline underline-offset-2 hover:text-info"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="grid gap-2 border-border border-l-4 pl-4 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => (
    <code className={cn(className, 'rounded bg-muted px-1 py-0.5 font-mono text-foreground')}>
      {children}
    </code>
  ),
  del: ({ children }) => <del className="text-muted-foreground">{children}</del>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => (
    <h1 className="font-semibold text-2xl text-foreground leading-tight">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="font-semibold text-lg text-foreground leading-snug">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="font-semibold text-base text-foreground leading-snug">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="font-semibold text-foreground text-sm leading-snug">{children}</h4>
  ),
  hr: () => <hr className="border-border" />,
  iframe: ({ src, title }) =>
    isYouTubeEmbed(src) ? (
      <iframe
        src={src}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
        className="aspect-video w-full rounded-md border border-border"
      />
    ) : null,
  img: ({ alt, src }) =>
    typeof src === 'string' ? (
      <Image
        src={src}
        alt={alt ?? ''}
        width={640}
        height={360}
        unoptimized
        className="aspect-video w-full rounded-md border border-border object-cover"
      />
    ) : null,
  li: ({ children }) => <li className="text-sm leading-7">{children}</li>,
  ol: ({ children }) => (
    <ol className="grid list-decimal gap-1 pl-5 marker:text-muted-foreground">{children}</ol>
  ),
  p: ({ children }) => <p className="text-sm leading-7">{children}</p>,
  // `[&_code]:` neutralizes the inline-code pill on the <code> inside a fence —
  // react-markdown 10 dropped the `inline` prop, so the parent decides instead.
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-foreground text-xs leading-6 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
      {children}
    </pre>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  td: ({ children }) => <td className="border-border border-b px-3 py-2 align-top">{children}</td>,
  th: ({ children }) => (
    <th className="border-border border-b bg-muted/50 px-3 py-2 font-semibold text-foreground">
      {children}
    </th>
  ),
  ul: ({ children }) => (
    <ul className="grid list-disc gap-1 pl-5 marker:text-muted-foreground">{children}</ul>
  ),
};
