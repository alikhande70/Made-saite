import Link from 'next/link';
import type { Metadata } from 'next';
import { listBrands } from '@/application/catalog-service';
import { Breadcrumbs, EmptyState } from '@/components/ui';
import { toPersianDigits } from '@/lib/fa';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'برندهای قطعات یدکی',
  description: 'فهرست برندهای قطعات یدکی خودرو موجود در فروشگاه، از تولیدکنندگان داخلی تا برندهای وارداتی.',
  alternates: { canonical: '/brands' },
};

export default async function BrandsPage() {
  const brands = await listBrands();

  return (
    <div className="container-page py-6">
      <Breadcrumbs items={[{ label: 'خانه', href: '/' }, { label: 'برندها' }]} />
      <h1 className="mb-1 text-xl font-extrabold text-steel-900 sm:text-2xl">برندها</h1>
      <p className="mb-6 text-sm text-muted">قطعات را بر اساس برند سازنده مرور کنید.</p>

      {brands.length === 0 ? (
        <EmptyState title="هنوز برندی ثبت نشده است" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {brands.map((brand) => (
            <Link
              key={brand.slug}
              href={`/brands/${encodeURIComponent(brand.slug)}`}
              className="card flex flex-col gap-1 p-4 transition-shadow hover:shadow-raised"
            >
              <span className="font-extrabold text-steel-900">{brand.nameFa}</span>
              {brand.nameEn && <span className="latin-id text-xs text-muted">{brand.nameEn}</span>}
              <span className="mt-1 text-xs text-muted">
                {brand.country ? `${brand.country} · ` : ''}
                {toPersianDigits(brand.productCount)} کالا
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
