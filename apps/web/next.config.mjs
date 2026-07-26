import createMDX from '@next/mdx';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

// Docs prose lives in `content/docs/{locale}/{slug}.mdx`. Plugins are named by
// string because Turbopack (the default bundler in Next 16) serializes this
// config across processes and cannot carry function references.
// `rehype-slug` gives headings stable ids so the product can deep-link into a
// section ("Learn more →" next to a settings panel or an error state).
const withMDX = createMDX({
  options: {
    remarkPlugins: [['remark-frontmatter'], ['remark-mdx-frontmatter', { name: 'frontmatter' }]],
    rehypePlugins: [['rehype-slug']],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Shared workspace packages ship TS source, so Next must transpile them.
  transpilePackages: ['@shared/clients', '@shared/schemas', '@shared/types'],
};

export default withNextIntl(withMDX(nextConfig));
