import type { Metadata } from 'next';
import { SeoJobLanding } from '@/components/SeoJobLanding';
import { SEO_LOCATIONS, SEO_ROLES, metadataForSeoLanding } from '@/lib/seo-landings';

type Props = { params: Promise<{ category: string; location: string }> };

export const revalidate = 0;
export const dynamicParams = false;

export function generateStaticParams() {
  return SEO_ROLES.flatMap((role) =>
    SEO_LOCATIONS.map((location) => ({
      category: role.slug,
      location: location.slug,
    }))
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category, location } = await params;
  return metadataForSeoLanding(category, location);
}

export default async function JobCategoryLocationPage({ params }: Props) {
  const { category, location } = await params;
  return <SeoJobLanding category={category} location={location} />;
}
