import type { Metadata } from 'next';
import { Breadcrumbs } from '@/components/ui';
import { ProductListing, type RawSearchParams } from '@/components/product-listing';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'همهٔ قطعات یدکی',
  description: 'فهرست کامل قطعات یدکی خودرو با فیلتر بر اساس دسته‌بندی، برند، خودرو، قیمت و موجودی.',
  alternates: { canonical: '/products' },
};

export default async function ProductsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const params = await searchParams;
  return (
    <div className="container-page py-6">
      <Breadcrumbs items={[{ label: 'خانه', href: '/' }, { label: 'همهٔ قطعات' }]} />
      <h1 className="mb-5 text-xl font-extrabold text-steel-900 sm:text-2xl">همهٔ قطعات یدکی</h1>
      <ProductListing searchParams={params} />
    </div>
  );
}
