import Link from 'next/link';
import type { Metadata } from 'next';
import { listOrdersAdmin } from '@/application/order-service';
import { ORDER_STATUSES, ORDER_STATUS_LABEL_FA, isOrderStatus } from '@/domain/order-status';
import { formatDateTime, formatToman, toPersianDigits } from '@/lib/fa';
import { EmptyState, LatinId, Pagination, SectionHeading } from '@/components/ui';
import { StatusPill } from '@/components/admin/status-pill';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'سفارش‌ها' };

export default async function AdminOrdersPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const single = (k: string) => (Array.isArray(params[k]) ? params[k]![0] : params[k]);

  const statusParam = single('status');
  const status = statusParam && isOrderStatus(statusParam) ? statusParam : undefined;
  const q = single('q');
  const page = Math.max(1, Number(single('page') ?? 1) || 1);

  const result = await listOrdersAdmin({ status, q, page, perPage: 20 });

  const href = (patch: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    if (patch.status ?? status) sp.set('status', (patch.status ?? status)!);
    if (patch.q ?? q) sp.set('q', (patch.q ?? q)!);
    if (patch.page) sp.set('page', patch.page);
    return sp.toString() ? `?${sp.toString()}` : '?';
  };

  return (
    <>
      <SectionHeading title="سفارش‌ها" as="h1" subtitle={`${toPersianDigits(result.total)} سفارش`} />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor="q" className="label">جست‌وجو</label>
          <input
            id="q" name="q" defaultValue={q ?? ''} className="field h-10"
            placeholder="شمارهٔ سفارش، نام یا موبایل مشتری"
          />
        </div>
        <div>
          <label htmlFor="status" className="label">وضعیت</label>
          <select id="status" name="status" defaultValue={status ?? ''} className="field h-10 w-44">
            <option value="">همهٔ وضعیت‌ها</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{ORDER_STATUS_LABEL_FA[s]}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="h-10 rounded-lg bg-steel-800 px-4 text-sm font-semibold text-white hover:bg-steel-900">
          اعمال
        </button>
        {(status || q) && (
          <Link href="/admin/orders" className="h-10 content-center px-2 text-sm font-semibold text-signal-700 hover:underline">
            حذف فیلترها
          </Link>
        )}
      </form>

      {result.items.length === 0 ? (
        <EmptyState title="سفارشی با این فیلترها یافت نشد" />
      ) : (
        <>
          <div className="card scroll-x">
            <table className="w-full text-sm">
              <thead className="bg-steel-50 text-xs">
                <tr>
                  <Th>شمارهٔ سفارش</Th><Th>مشتری</Th><Th>موبایل</Th><Th>مقصد</Th>
                  <Th>اقلام</Th><Th>مبلغ</Th><Th>وضعیت</Th><Th>تاریخ</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {result.items.map((order) => (
                  <tr key={order.id} className="hover:bg-steel-50/60">
                    <td className="px-3 py-2.5">
                      <Link href={`/admin/orders/${order.id}`} className="font-semibold text-steel-800 hover:underline">
                        <LatinId>{order.orderNumber}</LatinId>
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">{order.customerFullName}</td>
                    <td className="px-3 py-2.5"><LatinId className="text-xs">{order.customerPhone}</LatinId></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-muted">{order.shippingProvince}</td>
                    <td className="px-3 py-2.5 tabular-nums">{toPersianDigits(order.itemCount)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-semibold tabular-nums">{formatToman(order.grandTotal)}</td>
                    <td className="px-3 py-2.5"><StatusPill status={order.status} /></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">{formatDateTime(order.placedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={result.page} totalPages={result.totalPages} buildHref={(p) => href({ page: String(p) })} />
        </>
      )}
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-start font-bold text-steel-800">{children}</th>;
}
