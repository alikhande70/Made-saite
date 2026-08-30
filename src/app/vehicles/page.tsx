import Link from 'next/link';
import type { Metadata } from 'next';
import { getVehicleTree, listVehicleLandingPages } from '@/application/catalog-service';
import { VehicleSelector } from '@/components/vehicle-selector';
import { Breadcrumbs, CarIcon, SectionHeading } from '@/components/ui';
import { formatYearRange, toPersianDigits } from '@/lib/fa';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'انتخاب قطعه بر اساس خودرو',
  description: 'برند، مدل، سال ساخت و موتور خودروی خود را انتخاب کنید تا فقط قطعات سازگار نمایش داده شود.',
  alternates: { canonical: '/vehicles' },
};

export default async function VehiclesPage() {
  const [vehicles, landingPages] = await Promise.all([
    getVehicleTree(),
    // The curated, indexable pairings — the same set the sitemap advertises.
    listVehicleLandingPages().catch(() => []),
  ]);

  return (
    <div className="container-page py-6">
      <Breadcrumbs items={[{ label: 'خانه', href: '/' }, { label: 'انتخاب بر اساس خودرو' }]} />

      <div className="grid gap-6 lg:grid-cols-[24rem_1fr] lg:gap-10">
        <div className="card h-fit p-5 lg:sticky lg:top-32">
          <VehicleSelector vehicles={vehicles} compact submitLabel="نمایش قطعات سازگار" redirectTo="/products" />
        </div>

        <div>
          <h1 className="mb-1 text-xl font-extrabold text-steel-900 sm:text-2xl">خودروی خود را پیدا کنید</h1>
          <p className="mb-6 text-sm text-muted">
            روی مدل خودرو بزنید تا همهٔ قطعات سازگار با آن را ببینید.
          </p>

          <div className="space-y-6">
            {vehicles.map((brand) => (
              <section key={brand.slug}>
                <h2 className="mb-3 flex items-center gap-2 text-base font-extrabold text-steel-900">
                  <span className="grid size-8 place-items-center rounded-lg bg-steel-50 text-steel-700">
                    <CarIcon className="size-4" />
                  </span>
                  {brand.nameFa}
                </h2>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                  {brand.models.map((model) => (
                    <Link
                      key={model.slug}
                      href={`/products?vehicleModel=${encodeURIComponent(model.slug)}`}
                      className="card flex flex-col gap-0.5 px-3 py-2.5 transition-shadow hover:shadow-raised"
                    >
                      <span className="text-sm font-bold text-steel-900">{model.nameFa}</span>
                      <span className="text-xs text-muted">{formatYearRange(model.yearFrom, model.yearTo)}</span>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {landingPages.length > 0 && (
            <section className="mt-10">
              <SectionHeading
                title="پرجست‌وجوترین ترکیب‌ها"
                subtitle="صفحه‌های آمادهٔ دسته‌بندی × خودرو، بر اساس قطعات موجود در انبار"
              />
              <ul className="flex flex-wrap gap-2">
                {landingPages.slice(0, 24).map((page) => (
                  <li key={`${page.categorySlug}-${page.modelSlug}`}>
                    <Link
                      href={`/parts/${encodeURIComponent(page.categorySlug)}/${encodeURIComponent(page.modelSlug)}`}
                      className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold text-steel-800 transition-colors hover:border-accent-300 hover:bg-accent-50"
                    >
                      {page.categoryNameFa} {page.modelNameFa}
                      <span className="rounded-full bg-steel-100 px-1.5 text-[0.6875rem] font-bold text-steel-600 tabular-nums">
                        {toPersianDigits(page.productCount)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
