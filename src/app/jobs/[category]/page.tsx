import type { Metadata } from 'next';
import { SeoJobLanding } from '@/components/SeoJobLanding';
import { SEO_ROLES, metadataForSeoLanding } from '@/lib/seo-landings';

type Props = { params: Promise<{ category: string }> };

export const revalidate = 0;
export const dynamicParams = false;

export function generateStaticParams() {
  return SEO_ROLES.map((role) => ({ category: role.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;
  return metadataForSeoLanding(category);
}

export default async function JobCategoryPage({ params }: Props) {
  const { category } = await params;
  return <SeoJobLanding category={category} />;
}
