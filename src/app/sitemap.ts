import type { MetadataRoute } from 'next';
import { seoSitemapEntries, siteUrl } from '@/lib/seo-landings';

const STATIC_PATHS = ['/', '/pricing', '/my-jobs', '/profile'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteUrl();
  const lastModified = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: path === '/' ? origin : `${origin}${path}`,
    lastModified,
    changeFrequency: path === '/' ? 'daily' : 'weekly',
    priority: path === '/' ? 1 : 0.5,
  }));

  const landingEntries: MetadataRoute.Sitemap = seoSitemapEntries().map((entry) => ({
    url: `${origin}${entry.path}`,
    lastModified,
    changeFrequency: 'daily',
    priority: entry.priority,
  }));

  return [...staticEntries, ...landingEntries];
}
