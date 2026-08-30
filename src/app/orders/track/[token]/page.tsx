import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getOrderByTrackingToken } from '@/application/order-service';
import { OrderSummary } from '@/components/order-summary';
import { OrderTimeline } from '@/components/order-timeline';
import { Breadcrumbs, LatinId, LinkButton } from '@/components/ui';
import { ORDER_STATUS_HINT_FA, ORDER_STATUS_LABEL_FA } from '@/domain/order-status';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'پیگیری سفارش',
  robots: { index: false, follow: false },
};

export default async function TrackOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const order = await getOrderByTrackingToken(token);
  if (!order) notFound();

  return (
    <div className="container-page max-w-4xl py-6">
      <Breadcrumbs items={[{ label: 'خانه', href: '/' }, { label: 'پیگیری سفارش', href: '/orders/track' }, { label: order.orderNumber }]} />

      <header className="mb-5">
        <h1 className="text-xl font-extrabold text-steel-900 sm:text-2xl">
          سفارش <LatinId>{order.orderNumber}</LatinId>
        </h1>
        <p className="mt-1 text-sm text-muted">
          <span className="font-semibold text-steel-800">{ORDER_STATUS_LABEL_FA[order.status]}</span>
          {' — '}{ORDER_STATUS_HINT_FA[order.status]}
        </p>
      </header>

      <div className="card mb-5 p-5">
        <OrderTimeline status={order.status} events={order.events} />
      </div>

      <OrderSummary order={order} />

      {order.status === 'PENDING_PAYMENT' && (
        <div className="mt-6 text-center">
          <LinkButton href="/cart" variant="secondary">بازگشت به فروشگاه</LinkButton>
        </div>
      )}
    </div>
  );
}
