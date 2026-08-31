import Link from 'next/link';
import type { Metadata } from 'next';
import { getCategoryTree } from '@/application/catalog-service';
import { Breadcrumbs } from '@/components/ui';
import { toPersianDigits } from '@/lib/fa';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'دسته‌بندی قطعات یدکی',
  description: 'مرور دسته‌بندی‌های قطعات یدکی خودرو: فیلتر، ترمز، موتور، جلوبندی، برق، بدنه، روغن، تسمه، شمع و باتری.',
  alternates: { canonical: '/categories' },
};

export default async function CategoriesPage() {
  const tree = await getCategoryTree();

  return (
    <div className="container-page py-6">
      <Breadcrumbs items={[{ label: 'خانه', href: '/' }, { label: 'دسته‌بندی‌ها' }]} />
      <h1 className="mb-1 text-xl font-extrabold text-steel-900 sm:text-2xl">دسته‌بندی قطعات</h1>
      <p className="mb-6 text-sm text-muted">برای دیدن قطعات هر گروه روی آن بزنید.</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tree.map((cat) => (
          <section key={cat.slug} className="card p-4 sm:p-5">
            <Link href={`/categories/${encodeURIComponent(cat.slug)}`} className="group flex items-center gap-3">
              { }
              <img
                src={cat.imageUrl ?? '/demo/engine-part.svg'}
                alt=""
                loading="lazy"
                className="size-16 shrink-0 rounded-lg object-cover"
              />
              <div className="min-w-0">
                <h2 className="font-extrabold text-steel-900 group-hover:text-steel-700">{cat.nameFa}</h2>
                <p className="text-xs text-muted">{toPersianDigits(cat.productCount)} کالا</p>
              </div>
            </Link>

            {cat.description && <p className="mt-3 line-clamp-2 text-[0.8125rem] leading-relaxed text-muted">{cat.description}</p>}

            {cat.children.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
                {cat.children.map((child) => (
                  <li key={child.slug}>
                    <Link
                      href={`/categories/${encodeURIComponent(child.slug)}`}
                      className="inline-block rounded-md bg-steel-50 px-2.5 py-1 text-xs font-semibold text-steel-700 hover:bg-steel-100"
                    >
                      {child.nameFa}
                      <span className="ms-1 font-normal text-muted">{toPersianDigits(child.productCount)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
