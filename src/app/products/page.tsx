import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Breadcrumbs } from '@/components/ui';
import { ListingSkeleton } from '@/components/listing-skeleton';
import { ProductListing, type RawSearchParams } from '@/components/product-listing';
import { listingRobots } from '@/lib/seo';

export const dynamic = 'force-dynamic';

/**
 * The bare `/products` URL is indexable; every filtered or sorted variant is
 * `noindex, follow` and canonicalises back here (ADR-004).
 */
export async function generateMetadata(
  { searchParams }: { searchParams: Promise<RawSearchParams> },
): Promise<Metadata> {
  return {
    title: 'همهٔ قطعات یدکی',
    description: 'فهرست کامل قطعات یدکی خودرو با فیلتر بر اساس دسته‌بندی، برند، خودرو، قیمت و موجودی.',
    alternates: { canonical: '/products' },
    robots: listingRobots(await searchParams),
  };
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const params = await searchParams;
  return (
    <div className="container-page py-6">
      <Breadcrumbs items={[{ label: 'خانه', href: '/' }, { label: 'همهٔ قطعات' }]} />
      <h1 className="mb-5 text-xl font-extrabold text-steel-900 sm:text-2xl">همهٔ قطعات یدکی</h1>
      {/*
        * Suspense here rather than a `loading.tsx`: a loading file in this
        * segment would also wrap `/products/[slug]`, flush that route's
        * response early, and turn every missing product into a soft 404.
        */}
      <Suspense fallback={<ListingSkeleton />}>
        <ProductListing searchParams={params} />
      </Suspense>
    </div>
  );
}
