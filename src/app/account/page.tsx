import Link from 'next/link';
import type { Metadata } from 'next';
import { listOrdersForUser } from '@/application/order-service';
import { requireUser } from '@/lib/session';
import { ORDER_STATUS_LABEL_FA } from '@/domain/order-status';
import { formatDate, formatToman, toPersianDigits } from '@/lib/fa';
import { EmptyState, LatinId, LinkButton, SectionHeading, BoxIcon } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'حساب کاربری', robots: { index: false, follow: false } };

export default async function AccountPage() {
  const user = await requireUser();
  const orders = await listOrdersForUser(user.id);

  const openOrders = orders.filter((o) => !['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(o.status));
  const spent = orders
    .filter((o) => !['CANCELLED', 'PENDING_PAYMENT'].includes(o.status))
    .reduce((sum, o) => sum + o.grandTotal, 0);

  return (
    <>
      <SectionHeading title={`سلام ${user.fullName.split(' ')[0]} 👋`} as="h1" subtitle="خلاصهٔ حساب کاربری شما" />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="کل سفارش‌ها" value={toPersianDigits(orders.length)} />
        <Stat label="سفارش‌های در جریان" value={toPersianDigits(openOrders.length)} />
        <Stat label="مجموع خرید" value={formatToman(spent)} wide />
      </div>

      <SectionHeading
        title="آخرین سفارش‌ها"
        action={orders.length > 0 ? (
          <Link href="/account/orders" className="text-sm font-semibold text-steel-700 hover:underline">مشاهدهٔ همه</Link>
        ) : undefined}
      />

      {orders.length === 0 ? (
        <EmptyState
          title="هنوز سفارشی ثبت نکرده‌اید"
          description="اولین قطعهٔ موردنیاز خودروی خود را پیدا کنید."
          icon={<BoxIcon className="size-10" />}
          action={<LinkButton href="/categories" variant="accent">شروع خرید</LinkButton>}
        />
      ) : (
        <ul className="space-y-3">
          {orders.slice(0, 5).map((order) => (
            <li key={order.id}>
              <Link href={`/account/orders/${order.id}`} className="card flex items-center gap-3 p-3 transition-shadow hover:shadow-raised">
                { }
                <img src={order.firstItemImage ?? '/demo/engine-part.svg'} alt="" loading="lazy" className="size-14 shrink-0 rounded-md border border-line object-contain" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-steel-900">{order.firstItemTitle ?? 'سفارش'}</p>
                  <p className="text-xs text-muted">
                    <LatinId>{order.orderNumber}</LatinId> · {formatDate(order.placedAt)} · {toPersianDigits(order.itemCount)} کالا
                  </p>
                </div>
                <div className="shrink-0 text-end">
                  <p className="text-sm font-extrabold tabular-nums">{formatToman(order.grandTotal)}</p>
                  <p className="text-xs text-muted">{ORDER_STATUS_LABEL_FA[order.status]}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`card p-4 ${wide ? 'col-span-2 sm:col-span-1' : ''}`}>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-extrabold tabular-nums text-steel-900">{value}</p>
    </div>
  );
}
