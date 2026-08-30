import type { Metadata } from 'next';
import { listCustomers } from '@/application/admin-service';
import { SectionHeading, EmptyState, Pagination } from '@/components/ui';
import { CustomerTable } from '@/components/admin/customer-table';
import { toPersianDigits } from '@/lib/fa';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'مشتریان' };

export default async function AdminCustomersPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const single = (k: string) => (Array.isArray(params[k]) ? params[k]![0] : params[k]);
  const q = single('q');
  const page = Math.max(1, Number(single('page') ?? 1) || 1);

  const result = await listCustomers({ q, page, perPage: 25 });

  return (
    <>
      <SectionHeading title="مشتریان" as="h1" subtitle={`${toPersianDigits(result.total)} مشتری ثبت‌نام‌شده`} />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor="q" className="label">جست‌وجو</label>
          <input id="q" name="q" defaultValue={q ?? ''} className="field h-10" placeholder="نام، موبایل یا ایمیل" />
        </div>
        <button type="submit" className="h-10 rounded-lg bg-steel-800 px-4 text-sm font-semibold text-white hover:bg-steel-900">
          جست‌وجو
        </button>
      </form>

      {result.items.length === 0 ? (
        <EmptyState title="مشتری‌ای یافت نشد" />
      ) : (
        <>
          <CustomerTable customers={result.items.map((c) => ({
            id: c.id, fullName: c.fullName, phone: c.phone, email: c.email,
            isActive: c.isActive, createdAt: c.createdAt, orderCount: c.orderCount, totalSpent: c.totalSpent,
          }))} />
          <Pagination page={result.page} totalPages={result.totalPages}
            buildHref={(p) => (q ? `?q=${encodeURIComponent(q)}&page=${p}` : `?page=${p}`)} />
        </>
      )}
    </>
  );
}
