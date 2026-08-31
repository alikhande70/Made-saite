import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getOrderForUser } from '@/application/order-service';
import { requireUser } from '@/lib/session';
import { OrderSummary } from '@/components/order-summary';
import { OrderTimeline } from '@/components/order-timeline';
import { ReorderButton } from '@/components/reorder-button';
import { Breadcrumbs, LatinId, LinkButton } from '@/components/ui';
import { ORDER_STATUS_HINT_FA, ORDER_STATUS_LABEL_FA } from '@/domain/order-status';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'جزئیات سفارش', robots: { index: false, follow: false } };

export default async function AccountOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  // Ownership is enforced in the query itself — another customer's id yields null.
  const order = await getOrderForUser(id, user.id);
  if (!order) notFound();

  const reorderable = order.items
    .filter((i) => i.productId !== null)
    .map((i) => ({ productId: i.productId!, quantity: i.quantity, titleFa: i.titleFa }));

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'حساب کاربری', href: '/account' },
          { label: 'سفارش‌های من', href: '/account/orders' },
          { label: order.orderNumber },
        ]}
      />

      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold text-steel-900 sm:text-xl">
            سفارش <LatinId>{order.orderNumber}</LatinId>
          </h1>
          <p className="mt-1 text-sm text-muted">
            <span className="font-semibold text-steel-800">{ORDER_STATUS_LABEL_FA[order.status]}</span>
            {' — '}{ORDER_STATUS_HINT_FA[order.status]}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {order.status === 'PENDING_PAYMENT' && (
            <LinkButton href="/cart" variant="secondary" size="sm">بازگشت به فروشگاه</LinkButton>
          )}
          <LinkButton href={`/orders/track/${order.trackingToken}`} variant="secondary" size="sm">
            پیگیری مرسوله
          </LinkButton>
          {reorderable.length > 0 && <ReorderButton items={reorderable} />}
        </div>
      </header>

      <div className="card mb-5 p-5">
        <OrderTimeline status={order.status} events={order.events} />
      </div>

      <OrderSummary order={order} />
    </>
  );
}
