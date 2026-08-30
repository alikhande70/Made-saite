import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getBrandBySlug } from '@/application/catalog-service';
import { Breadcrumbs } from '@/components/ui';
import { ProductListing, type RawSearchParams } from '@/components/product-listing';
import { siteUrl } from '@/application/settings-service';
import { listingRobots } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<RawSearchParams>;
}): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const brand = await getBrandBySlug(decodeURIComponent(slug));
  if (!brand) return { title: 'برند یافت نشد' };

  return {
    title: brand.seoTitle ?? `قطعات ${brand.nameFa}`,
    description: brand.seoDescription ?? brand.description ?? `خرید قطعات یدکی برند ${brand.nameFa}.`,
    alternates: { canonical: `/brands/${encodeURIComponent(brand.slug)}` },
    // Filtered variants of a brand listing are noindex, follow (ADR-004).
    robots: listingRobots(query),
    openGraph: {
      title: `قطعات ${brand.nameFa}`,
      description: brand.description ?? undefined,
      url: `${siteUrl()}/brands/${encodeURIComponent(brand.slug)}`,
    },
  };
}

export default async function BrandPage({
  params, searchParams,
}: { params: Promise<{ slug: string }>; searchParams: Promise<RawSearchParams> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const brand = await getBrandBySlug(decodeURIComponent(slug));
  if (!brand || !brand.isActive) notFound();

  return (
    <div className="container-page py-6">
      <Breadcrumbs items={[{ label: 'خانه', href: '/' }, { label: 'برندها', href: '/brands' }, { label: brand.nameFa }]} />

      <header className="mb-6">
        <h1 className="text-xl font-extrabold text-steel-900 sm:text-2xl">
          قطعات {brand.nameFa}
          {brand.nameEn && <span className="latin-id ms-2 text-base font-normal text-muted">{brand.nameEn}</span>}
        </h1>
        {brand.country && <p className="mt-1 text-sm text-muted">کشور سازنده: {brand.country}</p>}
        {brand.description && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{brand.description}</p>}
      </header>

      <ProductListing
        searchParams={query}
        overrides={{ brand: [brand.slug] }}
        lockBrand
        emptyTitle={`فعلاً کالایی از «${brand.nameFa}» موجود نیست`}
      />
    </div>
  );
}
