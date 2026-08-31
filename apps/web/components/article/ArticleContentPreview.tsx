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
    <article className="grid gap-4 wrap-break-word text-slate-800">
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
      className="font-medium text-sky-700 underline underline-offset-2 hover:text-sky-800"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="grid gap-2 border-slate-300 border-l-4 pl-4 text-slate-600 italic">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => (
    <code className={cn(className, 'rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-900')}>
      {children}
    </code>
  ),
  del: ({ children }) => <del className="text-slate-500">{children}</del>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => (
    <h1 className="font-semibold text-2xl text-slate-950 leading-tight">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="font-semibold text-lg text-slate-950 leading-snug">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="font-semibold text-base text-slate-950 leading-snug">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="font-semibold text-slate-950 text-sm leading-snug">{children}</h4>
  ),
  hr: () => <hr className="border-slate-200" />,
  img: ({ alt, src }) =>
    typeof src === 'string' ? (
      <Image
        src={src}
        alt={alt ?? ''}
        width={640}
        height={360}
        unoptimized
        className="aspect-video w-full rounded-md border border-slate-200 object-cover"
      />
    ) : null,
  li: ({ children }) => <li className="text-sm leading-7">{children}</li>,
  ol: ({ children }) => (
    <ol className="grid list-decimal gap-1 pl-5 marker:text-slate-500">{children}</ol>
  ),
  p: ({ children }) => <p className="text-sm leading-7">{children}</p>,
  // `[&_code]:` neutralizes the inline-code pill on the <code> inside a fence —
  // react-markdown 10 dropped the `inline` prop, so the parent decides instead.
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-slate-800 text-xs leading-6 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
      {children}
    </pre>
  ),
  strong: ({ children }) => <strong className="font-semibold text-slate-950">{children}</strong>,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  td: ({ children }) => (
    <td className="border-slate-200 border-b px-3 py-2 align-top">{children}</td>
  ),
  th: ({ children }) => (
    <th className="border-slate-200 border-b bg-slate-50 px-3 py-2 font-semibold text-slate-950">
      {children}
    </th>
  ),
  ul: ({ children }) => (
    <ul className="grid list-disc gap-1 pl-5 marker:text-slate-400">{children}</ul>
  ),
};
