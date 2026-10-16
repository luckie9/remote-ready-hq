import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JobBoard } from '@/components/JobBoard';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { loadLiveJobs } from '@/lib/load-jobs';
import {
  SEO_LOCATIONS,
  SEO_ROLES,
  getSeoLocation,
  getSeoRole,
  jobMatchesSeoLanding,
  seoDescription,
  seoHeadline,
  seoRolePath,
  siteUrl,
} from '@/lib/seo-landings';
import { getEffectiveSubscriberSession } from '@/lib/subscription';

export async function SeoJobLanding({
  category,
  location: locationSlug,
}: {
  category: string;
  location?: string;
}) {
  const role = getSeoRole(category);
  if (!role) notFound();
  const location = locationSlug ? getSeoLocation(locationSlug) : undefined;
  if (locationSlug && !location) notFound();

  const subscriber = await getEffectiveSubscriberSession();
  const { jobs, errorMessage } = await loadLiveJobs();
  const matched = jobs.filter((job) => jobMatchesSeoLanding(job, role, location));
  const headline = seoHeadline(role, location);
  const description = seoDescription(role, location);
  const pageUrl = `${siteUrl()}${seoRolePath(role, location)}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: headline,
    description,
    url: pageUrl,
    isPartOf: {
      '@type': 'WebSite',
      name: 'RemoteReady HQ',
      url: siteUrl(),
    },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: matched.length,
      itemListElement: matched.slice(0, 20).map((job, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: `${job.title} at ${job.company}`,
      })),
    },
  };

  return (
    <main className="flex-1 bg-slate-950 text-slate-100">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto max-w-5xl px-6 pb-8 pt-8 sm:pt-10">
        <SiteHeader />

        <header className="mx-auto max-w-3xl px-2 pt-12 pb-8 text-center sm:pt-14">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">
            Remote jobs
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-[1.85rem] sm:leading-snug">
            {headline}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
            {description}
          </p>
          <p className="mt-3 text-sm text-slate-500">
            <Link href="/" className="text-emerald-300 hover:text-emerald-200">
              All remote jobs
            </Link>
            {location ? (
              <>
                {' · '}
                <Link
                  href={seoRolePath(role)}
                  className="text-emerald-300 hover:text-emerald-200"
                >
                  All {role.label.toLowerCase()} locations
                </Link>
              </>
            ) : null}
          </p>
        </header>

        <nav aria-label="Locations" className="mb-8 flex flex-wrap justify-center gap-2">
          <Link
            href={seoRolePath(role)}
            className={
              location
                ? 'rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-400 hover:text-white'
                : 'rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-sm font-medium text-emerald-300'
            }
          >
            Any location
          </Link>
          {SEO_LOCATIONS.map((item) => {
            const active = item.slug === location?.slug;
            return (
              <Link
                key={item.slug}
                href={seoRolePath(role, item)}
                className={
                  active
                    ? 'rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-sm font-medium text-emerald-300'
                    : 'rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-400 hover:text-white'
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <section>
          {errorMessage ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-950/40 px-5 py-4 text-red-200">
              Failed to load jobs. Please check database connection.
              {process.env.NODE_ENV === 'development' && (
                <p className="mt-2 break-all font-mono text-sm text-red-300/80">
                  {errorMessage}
                </p>
              )}
            </div>
          ) : matched.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 px-6 py-16 text-center text-slate-400">
              No {headline.toLowerCase()} are live right now.{' '}
              <Link href="/" className="text-emerald-300 hover:text-emerald-200">
                Browse every remote role
              </Link>
              .
            </div>
          ) : (
            <JobBoard jobs={matched} isSubscriber={Boolean(subscriber)} hideCategories />
          )}
        </section>

        <nav aria-label="Other remote roles" className="mt-12">
          <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-slate-500">
            More remote roles
          </h2>
          <ul className="mt-4 flex flex-wrap justify-center gap-2">
            {SEO_ROLES.filter((item) => item.slug !== role.slug).map((item) => (
              <li key={item.slug}>
                <Link
                  href={seoRolePath(item, location)}
                  className="rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-300 hover:text-white"
                >
                  Remote {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <SiteFooter />
    </main>
  );
}
