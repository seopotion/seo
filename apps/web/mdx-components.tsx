import type { MDXComponents } from 'mdx/types';

/**
 * Element styling for docs MDX. Tailwind has no typography plugin here, so the
 * prose scale is defined once in this map rather than repeated per page.
 */
const components: MDXComponents = {
  h2: (props) => (
    <h2
      className="mt-12 scroll-mt-24 border-gray-100 border-b pb-2 font-bold text-2xl text-gray-900 first:mt-0"
      {...props}
    />
  ),
  h3: (props) => (
    <h3 className="mt-8 scroll-mt-24 font-semibold text-gray-900 text-xl" {...props} />
  ),
  h4: (props) => (
    <h4 className="mt-6 scroll-mt-24 font-semibold text-base text-gray-900" {...props} />
  ),
  p: (props) => <p className="mt-4 text-gray-600 leading-relaxed" {...props} />,
  a: (props) => (
    <a
      className="font-medium text-amber-700 underline underline-offset-2 hover:text-amber-800"
      {...props}
    />
  ),
  ul: (props) => <ul className="mt-4 grid gap-2 pl-5 [&>li]:list-disc" {...props} />,
  ol: (props) => <ol className="mt-4 grid gap-2 pl-5 [&>li]:list-decimal" {...props} />,
  li: (props) => (
    <li className="pl-1 text-gray-600 leading-relaxed marker:text-amber-500" {...props} />
  ),
  strong: (props) => <strong className="font-semibold text-gray-900" {...props} />,
  blockquote: (props) => (
    <blockquote
      className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-gray-600 text-sm leading-relaxed [&>p]:mt-0"
      {...props}
    />
  ),
  code: (props) => (
    <code
      className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.85em] text-gray-800"
      {...props}
    />
  ),
  pre: (props) => (
    <pre
      className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-4 text-gray-800 text-sm [&>code]:bg-transparent [&>code]:p-0"
      {...props}
    />
  ),
  hr: (props) => <hr className="mt-10 border-gray-100" {...props} />,
  table: (props) => (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm" {...props} />
    </div>
  ),
  th: (props) => (
    <th
      className="border-gray-200 border-b bg-gray-50 px-3 py-2 font-semibold text-gray-900"
      {...props}
    />
  ),
  td: (props) => (
    <td className="border-gray-100 border-b px-3 py-2 align-top text-gray-600" {...props} />
  ),
};

export function useMDXComponents(existing: MDXComponents): MDXComponents {
  return { ...existing, ...components };
}
