import type { Metadata } from 'next';
import { categorizeJob, matchesRegion, type Job, type JobCategory, type RegionFilter } from '@/lib/jobs';

export type SeoRole = {
  slug: string;
  category: Exclude<JobCategory, 'All'>;
  /** Short role name used in titles, e.g. "Customer Support". */
  label: string;
  /** Extra title match on top of the board category. */
  titlePattern?: RegExp;
  blurb: string;
};

export type SeoLocation = {
  slug: string;
  label: string;
  region: Exclude<RegionFilter, 'any'>;
  /** Phrase appended to the H1, e.g. "in the United States". */
  phrase: string;
};

export const SEO_ROLES: SeoRole[] = [
  {
    slug: 'remote-customer-support',
    category: 'Support',
    label: 'Customer Support',
    titlePattern:
      /\b(support|customer success|customer service|help ?desk|service desk|technical support|client success|care specialist)\b/i,
    blurb:
      'Browse active remote customer support, customer success, and help desk jobs from vetted employers.',
  },
  {
    slug: 'remote-software-engineer',
    category: 'Engineering',
    label: 'Software Engineer',
    titlePattern:
      /\b(engineer|developer|software|frontend|backend|full[- ]?stack|devops|sre|react|python)\b/i,
    blurb:
      'Browse active remote software engineer jobs, including frontend, backend, and full-stack roles.',
  },
  {
    slug: 'remote-marketing',
    category: 'Marketing',
    label: 'Marketing',
    blurb:
      'Browse active remote marketing, content, SEO, and growth jobs from vetted employers.',
  },
  {
    slug: 'remote-sales',
    category: 'Sales',
    label: 'Sales',
    blurb:
      'Browse active remote sales, account executive, and business development jobs.',
  },
  {
    slug: 'remote-design',
    category: 'Design',
    label: 'Design',
    blurb: 'Browse active remote product design, UX, and visual design jobs.',
  },
  {
    slug: 'remote-product',
    category: 'Product',
    label: 'Product',
    blurb: 'Browse active remote product manager and product owner jobs.',
  },
  {
    slug: 'remote-operations',
    category: 'Operations',
    label: 'Operations',
    blurb: 'Browse active remote operations, coordinator, and people-ops jobs.',
  },
];

export const SEO_LOCATIONS: SeoLocation[] = [
  {
    slug: 'worldwide',
    label: 'Worldwide',
    region: 'worldwide',
    phrase: 'Worldwide',
  },
  {
    slug: 'united-states',
    label: 'United States',
    region: 'us',
    phrase: 'in the United States',
  },
  {
    slug: 'europe',
    label: 'Europe',
    region: 'europe',
    phrase: 'in Europe',
  },
  {
    slug: 'latam',
    label: 'Latin America',
    region: 'latam',
    phrase: 'in Latin America',
  },
  {
    slug: 'apac',
    label: 'Asia Pacific',
    region: 'apac',
    phrase: 'in Asia Pacific',
  },
];

const ROLE_BY_SLUG = new Map(SEO_ROLES.map((role) => [role.slug, role]));
const LOCATION_BY_SLUG = new Map(SEO_LOCATIONS.map((location) => [location.slug, location]));

export function siteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
  if (fromEnv && !/localhost|127\.0\.0\.1/.test(fromEnv)) return fromEnv;
  return 'https://remotereadyhq.com';
}

export function getSeoRole(slug: string): SeoRole | undefined {
  return ROLE_BY_SLUG.get(slug);
}

export function getSeoLocation(slug: string): SeoLocation | undefined {
  return LOCATION_BY_SLUG.get(slug);
}

export function seoRolePath(role: SeoRole, location?: SeoLocation): string {
  return location ? `/jobs/${role.slug}/${location.slug}` : `/jobs/${role.slug}`;
}

export function seoHeadline(role: SeoRole, location?: SeoLocation): string {
  const base = `Remote ${role.label} Jobs`;
  return location ? `${base} ${location.phrase}` : base;
}

export function seoDescription(role: SeoRole, location?: SeoLocation): string {
  const place = location ? ` Hiring ${location.phrase.toLowerCase()}.` : '';
  return `${role.blurb}${place} Direct employer application links, updated daily on RemoteReady HQ.`;
}

export function jobMatchesSeoLanding(
  job: Pick<Job, 'title' | 'description' | 'location'>,
  role: SeoRole,
  location?: SeoLocation
): boolean {
  if (categorizeJob(job.title, job.description) !== role.category) return false;
  if (role.titlePattern && !role.titlePattern.test(job.title)) return false;
  if (location && !matchesRegion(job.location, location.region)) return false;
  return true;
}

export function metadataForSeoLanding(
  category: string,
  locationSlug?: string
): Metadata {
  const role = getSeoRole(category);
  const location = locationSlug ? getSeoLocation(locationSlug) : undefined;
  if (!role || (locationSlug && !location)) {
    return { title: 'Remote Jobs | RemoteReady HQ' };
  }

  const title = `${seoHeadline(role, location)} | RemoteReady HQ`;
  const description = seoDescription(role, location);
  const url = `${siteUrl()}${seoRolePath(role, location)}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: 'RemoteReady HQ',
      type: 'website',
      locale: 'en_US',
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
}

export type SeoSitemapEntry = {
  path: string;
  priority: number;
};

/** Every indexable category and category/location path. */
export function seoSitemapEntries(): SeoSitemapEntry[] {
  const entries: SeoSitemapEntry[] = [];
  for (const role of SEO_ROLES) {
    entries.push({ path: seoRolePath(role), priority: 0.8 });
    for (const location of SEO_LOCATIONS) {
      entries.push({ path: seoRolePath(role, location), priority: 0.6 });
    }
  }
  return entries;
}
