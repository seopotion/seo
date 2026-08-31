import Image from 'next/image';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/**
 * The article body as it will publish. The generator writes GitHub-flavored
 * Markdown (packages/shared/generation/src/article.ts) and the WordPress client
 * publishes it through `marked` (apps/api/src/clients/wordpress.ts), so the
 * preview parses the same dialect rather than a hand-rolled subset of it.
 */
export function ArticleContentPreview({ content }: { content: string }) {
  return (
    <article className="grid gap-4 wrap-break-word text-foreground">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </Markdown>
    </article>
  );
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
