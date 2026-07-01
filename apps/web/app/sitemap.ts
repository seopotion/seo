import type { MetadataRoute } from 'next';
import { absoluteUrl } from '../lib/seo';

const lastModified = new Date('2026-07-01');

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: absoluteUrl('/'),
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: absoluteUrl('/pricing'),
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
  ];
}
