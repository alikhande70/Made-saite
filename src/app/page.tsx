import Link from 'next/link';
import type { Metadata } from 'next';
import {
  getCategoryTree, getVehicleTree, listFeatured, listVehicleLandingPages, searchProducts,
} from '@/application/catalog-service';
import { getStoreProfile } from '@/application/settings-service';
import { productQuerySchema } from '@/lib/validation';
import { ProductRail } from '@/components/product-card';
import { VehicleSelector } from '@/components/vehicle-selector';
import { LinkButton, SectionHeading, ChevronEnd, ShieldIcon, TruckIcon, WrenchIcon, BoxIcon } from '@/components/ui';
import { toPersianDigits } from '@/lib/fa';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const store = await getStoreProfile();
  return {
    title: `${store.name} — خرید آنلاین قطعات یدکی`,
    description:
      'خرید آنلاین قطعات یدکی خودروهای ایرانی و وارداتی: فیلتر، لنت ترمز، قطعات موتور، جلوبندی، برق خودرو، روغن و باتری. جست‌وجو بر اساس کد فنی، شمارهٔ OEM یا مدل خودرو.',
    alternates: { canonical: '/' },
  };
}

export default async function HomePage() {
  const [categories, featured, newest, vehicles, landingPages] = await Promise.all([
    getCategoryTree(),
    listFeatured(8),
    searchProducts(productQuerySchema.parse({ sort: 'newest', perPage: 8, inStock: true })),
    getVehicleTree(),
    // The curated, indexable pairings — real inventory, not a hand-written list.
    listVehicleLandingPages().catch(() => []),
  ]);

  return (
    <>
      {/*
        * Hero: choosing a vehicle is the primary task, so it leads.
        *
        * This is one of the four surfaces allowed to use frosted glass. The
        * selector panel itself stays opaque white — it holds form controls,
        * and legibility of a control beats the effect behind it.
        */}
      <section className="carbon-field text-white">
        <div className="container-page grid gap-8 py-10 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:py-14">
          <div>
            <p className="glass-dark mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold text-accent-300">
              <WrenchIcon className="size-3.5" />
              بیش از {toPersianDigits(categories.reduce((n, c) => n + c.productCount, 0))} قطعه در انبار
            </p>
            <h1 className="text-2xl font-extrabold leading-[1.5] sm:text-3xl lg:text-4xl lg:leading-[1.4]">
              قطعهٔ درست برای خودروی شما،
              <span className="text-accent-400"> بدون حدس و خطا</span>
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-steel-200 sm:text-base">
              خودرو، سال ساخت و موتور خود را انتخاب کنید تا فقط قطعاتی را ببینید که دقیقاً روی آن نصب می‌شوند.
              جست‌وجو با نام قطعه، کد فنی یا شمارهٔ OEM هم پشتیبانی می‌شود.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <LinkButton href="/categories" variant="accent" size="lg">
                مشاهدهٔ دسته‌بندی‌ها
                <ChevronEnd className="size-4" />
              </LinkButton>
              <LinkButton href="/orders/track" variant="secondary" size="lg">پیگیری سفارش</LinkButton>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-white p-4 text-ink shadow-pop sm:p-5">
            <VehicleSelector vehicles={vehicles} submitLabel="نمایش قطعات سازگار" redirectTo="/products" />
          </div>
        </div>
      </section>

      {/* Trust strip — factual claims only, no invented statistics. */}
      <section className="border-b border-line bg-white">
        <div className="container-page grid grid-cols-2 gap-4 py-5 lg:grid-cols-4">
          {[
            [ShieldIcon, 'ضمانت اصالت', 'فاکتور رسمی برای همهٔ سفارش‌ها'],
            [TruckIcon, 'ارسال سراسری', 'پست، باربری و پیک تهران'],
            [BoxIcon, 'بسته‌بندی ایمن', 'مناسب قطعات حساس'],
            [WrenchIcon, 'مشخصات فنی کامل', 'ابعاد، سازگاری و ضمانت'],
          ].map(([Icon, title, text]) => {
            const IconComponent = Icon as typeof ShieldIcon;
            return (
              <div key={title as string} className="flex items-center gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-steel-50 text-steel-700">
                  <IconComponent className="size-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[0.8125rem] font-bold text-steel-900">{title as string}</p>
                  <p className="truncate text-xs text-muted">{text as string}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="container-page space-y-12 py-10">
        {/* Categories */}
        <section>
          <SectionHeading
            title="دسته‌بندی قطعات"
            subtitle="از فیلتر و لنت تا برق خودرو و بدنه"
            action={
              <Link href="/categories" className="inline-flex items-center gap-1 text-sm font-semibold text-steel-700 hover:underline">
                همهٔ دسته‌ها <ChevronEnd className="size-4" />
              </Link>
            }
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {categories.slice(0, 10).map((cat) => (
              <Link
                key={cat.slug}
                href={`/categories/${encodeURIComponent(cat.slug)}`}
                className="card group flex flex-col items-center gap-2 p-3 text-center transition-shadow hover:shadow-raised sm:p-4"
              >
                { }
                <img
                  src={cat.imageUrl ?? '/demo/engine-part.svg'}
                  alt=""
                  loading="lazy"
                  className="size-16 rounded-lg object-cover transition-transform group-hover:scale-105 sm:size-20"
                />
                <span className="text-[0.8125rem] font-bold text-steel-900">{cat.nameFa}</span>
                <span className="text-xs text-muted">{toPersianDigits(cat.productCount)} کالا</span>
              </Link>
            ))}
          </div>
        </section>

        {landingPages.length > 0 && (
          <section>
            <SectionHeading
              title="قطعات پرتقاضا بر اساس خودرو"
              subtitle="ترکیب‌هایی که در انبار موجودی کافی دارند"
              action={
                <Link href="/vehicles" className="inline-flex items-center gap-1 text-sm font-semibold text-steel-700 hover:underline">
                  همهٔ خودروها <ChevronEnd className="size-4" />
                </Link>
              }
            />
            <ul className="flex flex-wrap gap-2">
              {landingPages.slice(0, 12).map((page) => (
                <li key={`${page.categorySlug}-${page.modelSlug}`}>
                  <Link
                    href={`/parts/${encodeURIComponent(page.categorySlug)}/${encodeURIComponent(page.modelSlug)}`}
                    className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3.5 py-2 text-sm font-semibold text-steel-800 transition-colors hover:border-accent-300 hover:bg-accent-50"
                  >
                    {page.categoryNameFa} {page.modelNameFa}
                    <span className="rounded-full bg-steel-100 px-1.5 text-xs font-bold tabular-nums text-steel-600">
                      {toPersianDigits(page.productCount)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {featured.length > 0 && (
          <section>
            <SectionHeading title="پیشنهاد فروشگاه" subtitle="قطعات موجود با قیمت ویژه" />
            <ProductRail products={featured} />
          </section>
        )}

        {newest.items.length > 0 && (
          <section>
            <SectionHeading
              title="تازه‌ترین کالاها"
              action={
                <Link href="/products?sort=newest" className="inline-flex items-center gap-1 text-sm font-semibold text-steel-700 hover:underline">
                  مشاهدهٔ همه <ChevronEnd className="size-4" />
                </Link>
              }
            />
            <ProductRail products={newest.items} />
          </section>
        )}

        {/* Search-by-part-number explainer */}
        <section className="card grid gap-5 p-5 sm:p-7 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h2 className="text-lg font-extrabold text-steel-900 sm:text-xl">کد فنی قطعه را دارید؟</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              کافی است شمارهٔ روی قطعهٔ قدیمی یا شمارهٔ <span className="latin-id">OEM</span> را در نوار جست‌وجو وارد کنید.
              جست‌وجو ارقام فارسی و انگلیسی را یکسان می‌بیند و کد ناقص را هم پیدا می‌کند.
            </p>
            <p className="mt-2 text-xs text-muted">
              نمونه: <span className="latin-id font-semibold">1109AY</span> ·{' '}
              <span className="latin-id font-semibold">BRK-PAD-206F</span> · «لنت ترمز پژو ۲۰۶»
            </p>
          </div>
          <LinkButton href="/products" variant="primary" size="lg">جست‌وجوی پیشرفته</LinkButton>
        </section>
      </div>
    </>
  );
}
