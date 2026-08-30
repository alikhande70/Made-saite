import type { Metadata } from 'next';
import { Breadcrumbs, EmptyState, LinkButton, SearchIcon } from '@/components/ui';
import { ProductListing, type RawSearchParams } from '@/components/product-listing';
import { SearchBox } from '@/components/search-box';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ searchParams }: { searchParams: Promise<RawSearchParams> }): Promise<Metadata> {
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q : '';
  return {
    title: q ? `نتایج جست‌وجو برای «${q}»` : 'جست‌وجوی قطعات',
    // Search result pages carry no unique content worth indexing.
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const params = await searchParams;
  const q = (typeof params.q === 'string' ? params.q : '').trim();

  return (
    <div className="container-page py-6">
      <Breadcrumbs items={[{ label: 'خانه', href: '/' }, { label: 'جست‌وجو' }]} />

      <div className="mb-6 max-w-2xl">
        <h1 className="mb-3 text-xl font-extrabold text-steel-900 sm:text-2xl">
          {q ? <>نتایج جست‌وجو برای «{q}»</> : 'جست‌وجوی قطعات'}
        </h1>
        <SearchBox initialQuery={q} autoFocus={!q} />
        <p className="hint mt-2">
          می‌توانید نام قطعه، کد کالا، شمارهٔ <span className="latin-id">OEM</span>، برند یا نام خودرو را وارد کنید.
        </p>
      </div>

      {q ? (
        <ProductListing
          searchParams={params}
          emptyTitle={`نتیجه‌ای برای «${q}» پیدا نشد`}
          emptyDescription="املای عبارت را بررسی کنید، از کلمات کوتاه‌تر استفاده کنید، یا قطعه را بر اساس خودرو پیدا کنید."
        />
      ) : (
        <EmptyState
          title="عبارتی برای جست‌وجو وارد کنید"
          description="نام قطعه، کد فنی یا مدل خودرو را بنویسید."
          icon={<SearchIcon className="size-10" />}
          action={<LinkButton href="/categories" variant="secondary">مرور دسته‌بندی‌ها</LinkButton>}
        />
      )}
    </div>
  );
}
