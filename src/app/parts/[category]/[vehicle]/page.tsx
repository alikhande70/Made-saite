import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  getVehicleLandingPage, LANDING_PAGE_MIN_PRODUCTS,
} from '@/application/catalog-service';
import { siteUrl } from '@/application/settings-service';
import { ProductListing, type RawSearchParams } from '@/components/product-listing';
import { JsonLd } from '@/components/json-ld';
import { Alert, Breadcrumbs, SectionHeading } from '@/components/ui';
import { toPersianDigits } from '@/lib/fa';

export const dynamic = 'force-dynamic';

interface RouteParams { category: string; vehicle: string }

async function load(params: Promise<RouteParams>) {
  const { category, vehicle } = await params;
  return getVehicleLandingPage(decodeURIComponent(category), decodeURIComponent(vehicle));
}

function pageTitle(page: { categoryNameFa: string; vehicleBrandNameFa: string; modelNameFa: string }) {
  return `${page.categoryNameFa} ${page.vehicleBrandNameFa} ${page.modelNameFa}`;
}

/**
 * Indexability is decided by real inventory, not by the URL existing.
 *
 * A pairing below the threshold is still served — a customer following a link
 * gets a working page — but it is `noindex, follow` and absent from the
 * sitemap, so a catalogue gap never becomes a thin page (ADR-004).
 */
export async function generateMetadata({ params }: { params: Promise<RouteParams> }): Promise<Metadata> {
  const page = await load(params);
  if (!page) return { title: 'صفحه یافت نشد', robots: { index: false, follow: false } };

  const indexable = page.productCount >= LANDING_PAGE_MIN_PRODUCTS;
  const title = pageTitle(page);
  const canonical = `/parts/${encodeURIComponent(page.categorySlug)}/${encodeURIComponent(page.modelSlug)}`;

  return {
    title,
    description: `خرید ${page.categoryNameFa} مناسب ${page.vehicleBrandNameFa} ${page.modelNameFa}؛ ${toPersianDigits(page.productCount)} کالای موجود با بررسی سازگاری.`,
    alternates: { canonical },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { type: 'website', title, url: `${siteUrl()}${canonical}` },
  };
}

export default async function VehicleCategoryPage({
  params, searchParams,
}: {
  params: Promise<RouteParams>;
  searchParams: Promise<RawSearchParams>;
}) {
  const page = await load(params);
  if (!page) notFound();

  const resolved = await searchParams;
  const title = pageTitle(page);
  const indexable = page.productCount >= LANDING_PAGE_MIN_PRODUCTS;

  const crumbs = [
    { label: 'خانه', href: '/' },
    { label: 'دسته‌بندی‌ها', href: '/categories' },
    { label: page.categoryNameFa, href: `/categories/${encodeURIComponent(page.categorySlug)}` },
    { label: `${page.vehicleBrandNameFa} ${page.modelNameFa}` },
  ];

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs
      .filter((c) => c.href)
      .map((c, i) => ({
        '@type': 'ListItem', position: i + 1, name: c.label, item: `${siteUrl()}${c.href}`,
      })),
  };

  return (
    <div className="container-page py-6">
      {indexable && <JsonLd data={breadcrumbLd} />}
      <Breadcrumbs items={crumbs} />

      <SectionHeading
        as="h1"
        title={title}
        subtitle={`${toPersianDigits(page.productCount)} کالای ثبت‌شده برای این خودرو. سازگاری هر قطعه با تیپ و موتور شما جداگانه بررسی می‌شود.`}
      />

      {page.productCount === 0 && (
        <div className="mb-5">
          <Alert tone="info" title="هنوز کالایی برای این ترکیب ثبت نشده است">
            می‌توانید{' '}
            <Link href={`/categories/${encodeURIComponent(page.categorySlug)}`} className="font-bold underline">
              همهٔ {page.categoryNameFa}
            </Link>{' '}
            را ببینید یا خودروی دیگری انتخاب کنید.
          </Alert>
        </div>
      )}

      <ProductListing
        searchParams={resolved}
        overrides={{ category: page.categorySlug, vehicleModel: page.modelSlug }}
        lockCategory
        lockVehicle
        emptyTitle="کالایی برای این خودرو یافت نشد"
        emptyDescription="فیلترها را تغییر دهید یا دستهٔ دیگری را انتخاب کنید."
      />
    </div>
  );
}
