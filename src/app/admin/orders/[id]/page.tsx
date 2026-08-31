import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getOrderAdmin } from '@/application/order-service';
import { allowedTransitions, ORDER_STATUS_LABEL_FA } from '@/domain/order-status';
import { OrderSummary } from '@/components/order-summary';
import { OrderActions } from '@/components/admin/order-actions';
import { StatusPill } from '@/components/admin/status-pill';
import { Breadcrumbs, LatinId } from '@/components/ui';
import { formatDateTime } from '@/lib/fa';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'جزئیات سفارش' };

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrderAdmin(id);
  if (!order) notFound();

  return (
    <>
      <Breadcrumbs items={[{ label: 'پنل مدیریت', href: '/admin' }, { label: 'سفارش‌ها', href: '/admin/orders' }, { label: order.orderNumber }]} />

      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-extrabold text-steel-900 sm:text-xl">
            سفارش <LatinId>{order.orderNumber}</LatinId>
            <StatusPill status={order.status} />
          </h1>
          <p className="mt-1 text-xs text-muted">ثبت‌شده در {formatDateTime(order.placedAt)}</p>
        </div>
      </header>

      <div className="mb-5">
        <OrderActions
          orderId={order.id}
          status={order.status}
          allowed={[...allowedTransitions(order.status)]}
          labels={ORDER_STATUS_LABEL_FA}
          trackingCode={order.shipment?.trackingCode ?? null}
          carrier={order.shipment?.carrier ?? null}
          paymentProvider={order.paymentProvider}
          paymentStatus={order.payment?.status ?? null}
        />
      </div>

      <OrderSummary order={order} />

      <section className="mt-6">
        <h2 className="mb-3 text-base font-extrabold text-steel-900">تاریخچهٔ کامل سفارش</h2>
        <div className="card scroll-x">
          <table className="w-full text-sm">
            <thead className="bg-steel-50 text-xs">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">رویداد</th>
                <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">توضیح</th>
                <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">عامل</th>
                <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">زمان</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {order.events.map((event, i) => (
                <tr key={`${event.eventType}-${i}`}>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <LatinId className="text-xs font-semibold">{event.eventType}</LatinId>
                    {!event.isPublic && (
                      <span className="ms-2 rounded bg-slate-100 px-1.5 py-0.5 text-[0.625rem] font-bold text-slate-600">داخلی</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">{event.message}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">{event.actorType}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">{formatDateTime(event.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
