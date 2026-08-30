import Link from 'next/link';
import type { Metadata } from 'next';
import { listOrdersForUser } from '@/application/order-service';
import { requireUser } from '@/lib/session';
import { ORDER_STATUS_LABEL_FA, type OrderStatus } from '@/domain/order-status';
import { formatDate, formatToman, toPersianDigits } from '@/lib/fa';
import { EmptyState, LatinId, LinkButton, SectionHeading, BoxIcon } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'سفارش‌های من', robots: { index: false, follow: false } };

const STATUS_TONE: Partial<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  PAID: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  PROCESSING: 'bg-steel-50 text-steel-800 ring-steel-600/20',
  PACKED: 'bg-steel-50 text-steel-800 ring-steel-600/20',
  SHIPPED: 'bg-sky-50 text-sky-800 ring-sky-600/20',
  DELIVERED: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  CANCELLED: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  REFUNDED: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

export default async function AccountOrdersPage() {
  const user = await requireUser();
  const orders = await listOrdersForUser(user.id);

  return (
    <>
      <SectionHeading title="سفارش‌های من" as="h1" subtitle={`${toPersianDigits(orders.length)} سفارش`} />

      {orders.length === 0 ? (
        <EmptyState
          title="هنوز سفارشی ثبت نکرده‌اید"
          icon={<BoxIcon className="size-10" />}
          action={<LinkButton href="/categories" variant="accent">شروع خرید</LinkButton>}
        />
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => (
            <li key={order.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-steel-900">
                    <LatinId>{order.orderNumber}</LatinId>
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {formatDate(order.placedAt)} · {toPersianDigits(order.itemCount)} کالا
                  </p>
                </div>
                <span className={`rounded-md px-2 py-1 text-xs font-bold ring-1 ring-inset ${STATUS_TONE[order.status] ?? ''}`}>
                  {ORDER_STATUS_LABEL_FA[order.status]}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                <p className="text-base font-extrabold tabular-nums text-steel-900">{formatToman(order.grandTotal)}</p>
                <div className="flex gap-2">
                  <Link href={`/account/orders/${order.id}`} className="text-sm font-semibold text-steel-700 hover:underline">
                    جزئیات سفارش
                  </Link>
                  <span className="text-line" aria-hidden>|</span>
                  <Link href={`/orders/track/${order.trackingToken}`} className="text-sm font-semibold text-steel-700 hover:underline">
                    پیگیری
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
