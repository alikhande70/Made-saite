import Link from 'next/link';
import type { Metadata } from 'next';
import { listCategoriesAdmin, listProductsAdmin } from '@/application/admin-service';
import { formatToman, toPersianDigits } from '@/lib/fa';
import { EmptyState, LatinId, LinkButton, Pagination, SectionHeading } from '@/components/ui';
import { ProductActiveToggle } from '@/components/admin/product-active-toggle';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'مدیریت کالاها' };

export default async function AdminProductsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const single = (k: string) => (Array.isArray(params[k]) ? params[k]![0] : params[k]);

  const q = single('q');
  const categoryId = single('categoryId');
  const statusRaw = single('status');
  const status = statusRaw === 'active' || statusRaw === 'inactive' ? statusRaw : undefined;
  const lowStock = single('lowStock') === '1';
  const page = Math.max(1, Number(single('page') ?? 1) || 1);

  const [result, categories] = await Promise.all([
    listProductsAdmin({ q, categoryId, status, lowStock, page, perPage: 20 }),
    listCategoriesAdmin(),
  ]);

  const buildHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (categoryId) sp.set('categoryId', categoryId);
    if (status) sp.set('status', status);
    if (lowStock) sp.set('lowStock', '1');
    if (p > 1) sp.set('page', String(p));
    return sp.toString() ? `?${sp.toString()}` : '?';
  };

  return (
    <>
      <SectionHeading
        title="مدیریت کالاها" as="h1"
        subtitle={`${toPersianDigits(result.total)} کالا`}
        action={<LinkButton href="/admin/products/new" variant="signal" size="sm">افزودن کالای جدید</LinkButton>}
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor="q" className="label">جست‌وجو</label>
          <input id="q" name="q" defaultValue={q ?? ''} className="field h-10" placeholder="عنوان، SKU یا OEM" />
        </div>
        <div>
          <label htmlFor="categoryId" className="label">دسته</label>
          <select id="categoryId" name="categoryId" defaultValue={categoryId ?? ''} className="field h-10 w-44">
            <option value="">همهٔ دسته‌ها</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.nameFa}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="status" className="label">وضعیت</label>
          <select id="status" name="status" defaultValue={status ?? ''} className="field h-10 w-36">
            <option value="">همه</option>
            <option value="active">منتشرشده</option>
            <option value="inactive">پیش‌نویس</option>
          </select>
        </div>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" name="lowStock" value="1" defaultChecked={lowStock}
            className="size-4 rounded border-steel-300 text-steel-700" />
          فقط رو به اتمام
        </label>
        <button type="submit" className="h-10 rounded-lg bg-steel-800 px-4 text-sm font-semibold text-white hover:bg-steel-900">
          اعمال
        </button>
      </form>

      {result.items.length === 0 ? (
        <EmptyState
          title="کالایی یافت نشد"
          action={<LinkButton href="/admin/products/new" variant="signal">افزودن کالای جدید</LinkButton>}
        />
      ) : (
        <>
          <div className="card scroll-x">
            <table className="w-full text-sm">
              <thead className="bg-steel-50 text-xs">
                <tr>
                  <Th>کالا</Th><Th>کد کالا</Th><Th>دسته</Th><Th>برند</Th>
                  <Th>قیمت</Th><Th>موجودی</Th><Th>وضعیت</Th><Th>عملیات</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {result.items.map((product) => (
                  <tr key={product.id} className="hover:bg-steel-50/60">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        { }
                        <img src={product.imageUrl ?? '/demo/engine-part.svg'} alt="" loading="lazy"
                          className="size-10 shrink-0 rounded-md border border-line object-contain" />
                        <Link href={`/admin/products/${product.id}`} className="font-semibold text-steel-800 hover:underline">
                          {product.titleFa}
                        </Link>
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><LatinId className="text-xs">{product.sku}</LatinId></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-muted">{product.categoryName ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-muted">{product.brandName ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                      {product.salePrice !== null ? (
                        <>
                          <span className="block text-xs text-muted line-through">{formatToman(product.price)}</span>
                          <span className="font-semibold text-red-700">{formatToman(product.salePrice)}</span>
                        </>
                      ) : (
                        <span className="font-semibold">{formatToman(product.price)}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                      <span className={product.quantityAvailable <= product.lowStockThreshold ? 'font-bold text-amber-700' : ''}>
                        {toPersianDigits(product.quantityAvailable)}
                      </span>
                      {product.quantityReserved > 0 && (
                        <span className="ms-1 text-xs text-muted">({toPersianDigits(product.quantityReserved)} رزرو)</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded px-2 py-0.5 text-xs font-bold ${
                        product.isActive ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {product.isActive ? 'منتشرشده' : 'پیش‌نویس'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Link href={`/admin/products/${product.id}`} className="text-xs font-semibold text-steel-700 hover:underline">
                          ویرایش
                        </Link>
                        <ProductActiveToggle productId={product.id} isActive={product.isActive} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={result.page} totalPages={result.totalPages} buildHref={buildHref} />
        </>
      )}
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-start font-bold text-steel-800">{children}</th>;
}
