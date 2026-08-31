import { canonicalPath } from '@/domain/search-visibility';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  getProductBySlug, getRelatedProducts, getSimilarByVehicle, getVehicleTree,
} from '@/application/catalog-service';
import {
  evaluateProductForConfiguration, getConfiguration, listProductReferences,
} from '@/application/fitment-service';
import { getSelectedVehicleId } from '@/lib/session';
import { getShippingOptions } from '@/application/shipping-service';
import { siteUrl, getStoreProfile } from '@/application/settings-service';
import { JsonLd } from '@/components/json-ld';
import { breadcrumbJsonLd } from '@/lib/json-ld';
import { ProductGallery } from '@/components/product-gallery';
import { QuantityAndAdd } from '@/components/quantity-add';
import { ProductRail } from '@/components/product-card';
import { CompatibilityPanel, VerdictChip } from '@/components/compatibility';
import { VehicleSelector } from '@/components/vehicle-selector';
import {
  Breadcrumbs, LatinId, Price, SectionHeading, StockBadge, ShieldIcon, TruckIcon, WrenchIcon, BoxIcon,
} from '@/components/ui';
import { FITMENT_TYPE_LABEL_FA, REFERENCE_TYPE_LABEL_FA } from '@/domain/fitment';
import { formatDeliveryWindow, formatToman, formatYearRange, toPersianDigits } from '@/lib/fa';

export const dynamic = 'force-dynamic';

const CONDITION_LABEL: Record<string, string> = {
  new: 'نو',
  refurbished: 'بازسازی‌شده',
  used: 'کارکرده',
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(decodeURIComponent(slug));
  if (!product) return { title: 'محصول یافت نشد', robots: { index: false, follow: false } };

  const canonical = canonicalPath({ kind: 'product', slug: product.slug });
  const description =
    product.seoDescription ??
    product.descriptionFa?.slice(0, 300) ??
    `خرید ${product.titleFa} با کد کالا ${product.sku}.`;

  return {
    title: product.seoTitle ?? product.titleFa,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      title: product.titleFa,
      description,
      url: `${siteUrl()}${canonicalPath({ kind: 'product', slug: product.slug })}`,
      images: product.images[0] ? [{ url: `${siteUrl()}${product.images[0].url}` }] : undefined,
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(decodeURIComponent(slug));
  if (!product) notFound();

  const selectedVehicleId = await getSelectedVehicleId();

  const [related, similar, shipping, store, references, vehicle] = await Promise.all([
    getRelatedProducts(product.id, product.category?.id ?? null, 8),
    getSimilarByVehicle(product.id, 8),
    getShippingOptions('تهران', product.effectivePrice, product.weightGrams ?? 500),
    getStoreProfile(),
    listProductReferences(product.id),
    // A stale cookie (configuration deleted since) must not break the page.
    selectedVehicleId ? getConfiguration(selectedVehicleId).catch(() => null) : null,
  ]);

  /*
   * The verdict is computed here, on the server, from fitment rows — the page
   * never ships a rule the client could disagree with.
   */
  const compatibility = vehicle
    ? await evaluateProductForConfiguration(product.id, vehicle.id).catch(() => null)
    : null;

  const vehicleTree = vehicle ? [] : await getVehicleTree();

  const outOfStock = product.stockStatus === 'OUT_OF_STOCK';

  /*
   * Product structured data is generated from the row itself: real price, real
   * availability, real SKU. No rating or review markup is emitted because the
   * store has no review data — fabricating it would be both dishonest and a
   * Search policy violation.
   */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.titleFa,
    description: product.descriptionFa ?? undefined,
    sku: product.sku,
    mpn: product.mpn ?? undefined,
    ...(product.oemNumber ? { productID: product.oemNumber } : {}),
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand.nameFa } } : {}),
    ...(product.manufacturer ? { manufacturer: { '@type': 'Organization', name: product.manufacturer } } : {}),
    // Omitted entirely when there are no images: an empty `image` array is a
    // malformed Product, and inventing a placeholder would be fabricated data.
    ...(product.images.length > 0
      ? { image: product.images.map((i) => `${siteUrl()}${i.url}`) }
      : {}),
    ...(product.weightGrams
      ? { weight: { '@type': 'QuantitativeValue', value: product.weightGrams, unitCode: 'GRM' } }
      : {}),
    itemCondition:
      product.condition === 'new'
        ? 'https://schema.org/NewCondition'
        : product.condition === 'refurbished'
          ? 'https://schema.org/RefurbishedCondition'
          : 'https://schema.org/UsedCondition',
    offers: {
      '@type': 'Offer',
      url: `${siteUrl()}${canonicalPath({ kind: 'product', slug: product.slug })}`,
      priceCurrency: 'IRR',
      // schema.org expects the national currency; Rial = Toman × 10.
      price: product.effectivePrice * 10,
      availability: outOfStock ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
      itemCondition:
        product.condition === 'new' ? 'https://schema.org/NewCondition' : 'https://schema.org/UsedCondition',
      seller: { '@type': 'Organization', name: store.name },
    },
  };

  /*
   * One breadcrumb trail, two renderings. The visible trail and the
   * BreadcrumbList used to be built separately and had drifted apart — the
   * JSON-LD omitted the «دسته‌بندی‌ها» level the page showed, and omitted the
   * product itself. Structured data that contradicts the page is worse than
   * none, so both now derive from this array.
   */
  const crumbs: { label: string; href?: string }[] = [
    { label: 'خانه', href: '/' },
    { label: 'دسته‌بندی‌ها', href: '/categories' },
    ...(product.category?.parentSlug && product.category.parentNameFa
      ? [{ label: product.category.parentNameFa, href: canonicalPath({ kind: 'category', slug: product.category.parentSlug }) }]
      : []),
    ...(product.category
      ? [{ label: product.category.nameFa, href: canonicalPath({ kind: 'category', slug: product.category.slug }) }]
      : []),
    { label: product.titleFa },
  ];

  const breadcrumbLd = breadcrumbJsonLd(crumbs, siteUrl());

  return (
    <div className="container-page py-6">
      <JsonLd data={jsonLd} />
      <JsonLd data={breadcrumbLd} />

      <Breadcrumbs items={crumbs} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,44%)_1fr] lg:gap-10">
        <ProductGallery images={product.images} title={product.titleFa} />

        <div className="min-w-0">
          {product.brand && (
            <Link
              href={`/brands/${encodeURIComponent(product.brand.slug)}`}
              className="inline-block text-sm font-semibold text-steel-600 hover:text-steel-900 hover:underline"
            >
              {product.brand.nameFa}
              {product.brand.nameEn && <span className="latin-id ms-1.5 text-xs text-muted">{product.brand.nameEn}</span>}
            </Link>
          )}

          <h1 className="mt-1 text-xl font-extrabold leading-[1.6] text-steel-900 sm:text-2xl">{product.titleFa}</h1>
          {product.titleEn && <p className="latin-id mt-1 text-sm text-muted">{product.titleEn}</p>}

          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[0.8125rem]">
            <div className="flex gap-1.5">
              <dt className="text-muted">کد کالا:</dt>
              <dd><LatinId className="font-semibold">{product.sku}</LatinId></dd>
            </div>
            {product.oemNumber && (
              <div className="flex gap-1.5">
                <dt className="text-muted">شمارهٔ OEM:</dt>
                <dd><LatinId className="font-semibold">{product.oemNumber}</LatinId></dd>
              </div>
            )}
            {product.mpn && (
              <div className="flex gap-1.5">
                <dt className="text-muted">کد سازنده:</dt>
                <dd><LatinId className="font-semibold">{product.mpn}</LatinId></dd>
              </div>
            )}
          </dl>

          <div className="my-5 rounded-xl border border-line bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Price price={product.price} salePrice={product.salePrice} size="lg" />
              <div className="flex flex-wrap items-center gap-2">
                {compatibility && <VerdictChip verdict={compatibility.verdict} />}
                <StockBadge status={product.stockStatus} quantity={product.quantityAvailable} />
              </div>
            </div>

            <div className="mt-4">
              <QuantityAndAdd
                productId={product.id}
                available={product.quantityAvailable}
                disabled={outOfStock}
                titleFa={product.titleFa}
              />
            </div>

            {outOfStock && (
              <p className="mt-3 text-sm text-muted">
                این کالا فعلاً موجود نیست. می‌توانید{' '}
                <Link href="/contact" className="font-semibold text-steel-700 underline">با پشتیبانی تماس بگیرید</Link>{' '}
                یا کالاهای مشابه پایین صفحه را ببینید.
              </p>
            )}

            <ul className="mt-4 grid gap-2.5 border-t border-line pt-4 text-[0.8125rem] sm:grid-cols-2">
              {product.warrantyMonths ? (
                <FeatureRow icon={<ShieldIcon className="size-4" />}>
                  {toPersianDigits(product.warrantyMonths)} ماه ضمانت
                </FeatureRow>
              ) : null}
              {product.countryOfOrigin && (
                <FeatureRow icon={<BoxIcon className="size-4" />}>ساخت {product.countryOfOrigin}</FeatureRow>
              )}
              <FeatureRow icon={<WrenchIcon className="size-4" />}>وضعیت: {CONDITION_LABEL[product.condition]}</FeatureRow>
              {/* Pickup is free by definition, so quote the cheapest method that
                  actually ships — «ارسال از ۰ تومان» would be misleading. */}
              {(() => {
                const deliverable = shipping.filter((s) => s.kind !== 'PICKUP');
                if (deliverable.length === 0) return null;
                const cheapest = Math.min(...deliverable.map((s) => s.cost));
                return (
                  <FeatureRow icon={<TruckIcon className="size-4" />}>
                    {cheapest === 0 ? 'ارسال رایگان' : `ارسال از ${formatToman(cheapest)}`}
                  </FeatureRow>
                );
              })()}
            </ul>
          </div>

          <div className="mb-5">
            <CompatibilityPanel result={compatibility} vehicle={vehicle}>
              <VehicleSelector vehicles={vehicleTree} compact submitLabel="بررسی سازگاری" />
            </CompatibilityPanel>
          </div>

          {product.descriptionFa && (
            <section className="mb-5">
              <h2 className="mb-2 text-base font-extrabold text-steel-900">معرفی محصول</h2>
              <div className="space-y-2 text-sm leading-[1.9] text-steel-800">
                {product.descriptionFa.split('\n').filter(Boolean).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            </section>
          )}

          {product.installationNotes && (
            <section className="mb-5 rounded-lg bg-amber-50 p-4 ring-1 ring-inset ring-amber-600/20">
              <h2 className="mb-1.5 flex items-center gap-2 text-sm font-extrabold text-amber-900">
                <WrenchIcon className="size-4" /> نکات نصب
              </h2>
              <p className="text-[0.8125rem] leading-relaxed text-amber-900">{product.installationNotes}</p>
            </section>
          )}
        </div>
      </div>

      {/* Specifications */}
      {product.specs.length > 0 && (
        <section className="mt-10">
          <SectionHeading title="مشخصات فنی" />
          <div className="card scroll-x">
            <table className="spec-table">
              <caption className="sr-only">مشخصات فنی {product.titleFa}</caption>
              <tbody>
                {product.specs.map((spec) => (
                  <tr key={`${spec.specKey}-${spec.specValue}`}>
                    <th scope="row">{spec.specKey}</th>
                    <td>
                      {spec.specValue}
                      {spec.unit && <span className="ms-1 font-normal text-muted">{spec.unit}</span>}
                    </td>
                  </tr>
                ))}
                {product.weightGrams ? (
                  <tr>
                    <th scope="row">وزن</th>
                    <td>{toPersianDigits(product.weightGrams)} <span className="font-normal text-muted">گرم</span></td>
                  </tr>
                ) : null}
                {product.lengthMm || product.widthMm || product.heightMm ? (
                  <tr>
                    <th scope="row">ابعاد بسته</th>
                    <td>
                      {[product.lengthMm, product.widthMm, product.heightMm]
                        .filter((v): v is number => typeof v === 'number')
                        .map((v) => toPersianDigits(v))
                        .join(' × ')}
                      <span className="ms-1 font-normal text-muted">میلی‌متر</span>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Recorded fitment — the same rows the verdict above is computed from. */}
      <section className="mt-10">
        <SectionHeading
          title="خودروهای سازگار"
          subtitle="جدول زیر همان داده‌ای است که نتیجهٔ سازگاری از روی آن محاسبه می‌شود."
        />
        {product.compatibility.length === 0 ? (
          <div className="card p-5 text-sm text-muted">
            اطلاعات سازگاری این قطعه هنوز ثبت نشده است. پیش از خرید با پشتیبانی هماهنگ کنید.
          </div>
        ) : (
          <div className="card scroll-x">
            <table className="spec-table">
              <caption className="sr-only">فهرست خودروهای سازگار با {product.titleFa}</caption>
              <thead className="bg-steel-50 text-xs">
                <tr>
                  <th scope="col" className="font-bold text-steel-800">برند</th>
                  <th scope="col" className="font-bold text-steel-800">مدل</th>
                  <th scope="col" className="font-bold text-steel-800">نسل / تیپ</th>
                  <th scope="col" className="font-bold text-steel-800">موتور</th>
                  <th scope="col" className="font-bold text-steel-800">سال ساخت</th>
                  <th scope="col" className="font-bold text-steel-800">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {product.compatibility.map((fit, i) => (
                  <tr
                    key={`${fit.modelSlug}-${fit.trimName ?? ''}-${fit.engineCode ?? 'all'}-${i}`}
                    className={fit.fitmentType === 'NOT_COMPATIBLE' ? 'bg-red-50/60' : undefined}
                  >
                    <td className="whitespace-nowrap font-semibold">{fit.vehicleBrandName}</td>
                    <td className="whitespace-nowrap">
                      <Link
                        href={`/products?vehicleModel=${encodeURIComponent(fit.modelSlug)}`}
                        className="font-semibold text-steel-700 hover:underline"
                      >
                        {fit.modelName}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap font-normal text-muted">
                      {[fit.generationName, fit.trimName].filter(Boolean).join(' · ') || 'همهٔ تیپ‌ها'}
                    </td>
                    <td className="whitespace-nowrap font-normal text-muted">
                      {fit.engineCode ? (
                        <>
                          <LatinId className="font-semibold text-steel-800">{fit.engineCode}</LatinId>
                          {fit.engineName && <span className="ms-1.5 text-xs">{fit.engineName}</span>}
                        </>
                      ) : (
                        'همهٔ موتورها'
                      )}
                    </td>
                    <td className="whitespace-nowrap font-normal">{formatYearRange(fit.yearFrom, fit.yearTo)}</td>
                    <td className="font-normal">
                      <span
                        className={`verdict ${
                          fit.fitmentType === 'DIRECT'
                            ? 'verdict-yes'
                            : fit.fitmentType === 'WITH_MODIFICATION'
                              ? 'verdict-maybe'
                              : 'verdict-no'
                        }`}
                      >
                        {FITMENT_TYPE_LABEL_FA[fit.fitmentType]}
                      </span>
                      {fit.note && <span className="mt-1 block text-xs text-muted">{fit.note}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Part-number relationships: supersessions, alternates, cross-references. */}
      {references.length > 0 && (
        <section className="mt-10">
          <SectionHeading
            title="کدهای مرتبط و قطعات جایگزین"
            subtitle="شماره‌فنی‌های معادل و قطعاتی که جایگزین این کد می‌شوند"
          />
          <div className="card scroll-x">
            <table className="spec-table">
              <caption className="sr-only">کدهای مرتبط با {product.titleFa}</caption>
              <thead className="bg-steel-50 text-xs">
                <tr>
                  <th scope="col" className="font-bold text-steel-800">نوع ارتباط</th>
                  <th scope="col" className="font-bold text-steel-800">کد / قطعه</th>
                  <th scope="col" className="font-bold text-steel-800">سازنده</th>
                  <th scope="col" className="font-bold text-steel-800">توضیح</th>
                </tr>
              </thead>
              <tbody>
                {references.map((ref) => (
                  <tr key={ref.id}>
                    <td className="whitespace-nowrap font-semibold">{REFERENCE_TYPE_LABEL_FA[ref.relationType]}</td>
                    <td>
                      {/* Only link to a part we actually sell and still publish. */}
                      {ref.target && ref.target.isActive ? (
                        <Link
                          href={`/products/${encodeURIComponent(ref.target.slug)}`}
                          className="font-semibold text-accent-700 hover:underline"
                        >
                          {ref.target.titleFa}
                          <LatinId className="ms-1.5 text-xs text-muted">{ref.target.sku}</LatinId>
                        </Link>
                      ) : (
                        <LatinId className="font-semibold">{ref.targetNumber ?? ref.target?.sku ?? '—'}</LatinId>
                      )}
                    </td>
                    <td className="whitespace-nowrap font-normal text-muted">{ref.targetBrand ?? '—'}</td>
                    <td className="font-normal text-muted">{ref.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint mt-2">
            کدهای معادل صرفاً برای تطبیق شماره‌فنی است و جایگزین بررسی سازگاری با خودروی شما نمی‌شود.
          </p>
        </section>
      )}

      {/* Shipping */}
      <section className="mt-10">
        <SectionHeading title="شیوه‌های ارسال" subtitle="هزینهٔ نمونه برای مقصد تهران؛ هزینهٔ نهایی در سبد خرید محاسبه می‌شود." />
        <div className="card scroll-x">
          <table className="spec-table">
            <thead className="bg-steel-50 text-xs">
              <tr>
                <th scope="col" className="font-bold text-steel-800">روش ارسال</th>
                <th scope="col" className="font-bold text-steel-800">زمان تحویل</th>
                <th scope="col" className="font-bold text-steel-800">هزینه</th>
              </tr>
            </thead>
            <tbody>
              {shipping.map((option) => (
                <tr key={option.methodCode}>
                  <td className="font-semibold">
                    {option.methodName}
                    {option.description && <span className="mt-0.5 block text-xs font-normal text-muted">{option.description}</span>}
                  </td>
                  <td className="whitespace-nowrap font-normal text-muted">
                    {formatDeliveryWindow(option.estimatedDaysMin, option.estimatedDaysMax) ?? '—'}
                  </td>
                  <td className="whitespace-nowrap">
                    {option.isFree ? <span className="text-emerald-700">رایگان</span> : formatToman(option.cost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {similar.length > 0 && (
        <section className="mt-12">
          <SectionHeading title="قطعات دیگر برای همین خودروها" />
          <ProductRail products={similar} />
        </section>
      )}

      {related.length > 0 && (
        <section className="mt-12">
          <SectionHeading title={`کالاهای مشابه${product.category ? ` در ${product.category.nameFa}` : ''}`} />
          <ProductRail products={related} />
        </section>
      )}
    </div>
  );
}

function FeatureRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-steel-800">
      <span className="text-steel-500">{icon}</span>
      {children}
    </li>
  );
}
