import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getOrderByTrackingToken } from '@/application/order-service';
import { OrderSummary } from '@/components/order-summary';
import { OrderTimeline } from '@/components/order-timeline';
import { Alert, CheckIcon, LatinId, LinkButton } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'سفارش شما ثبت شد',
  robots: { index: false, follow: false },
};

export default async function OrderConfirmationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const order = await getOrderByTrackingToken(token);
  if (!order) notFound();

  const awaitingPayment = order.status === 'PENDING_PAYMENT';
  const isCod = order.paymentProvider === 'cod';

  return (
    <div className="container-page max-w-4xl py-8">
      <div className="mb-6 text-center">
        <span
          className={`mx-auto mb-3 grid size-14 place-items-center rounded-full ${
            awaitingPayment ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
          }`}
        >
          <CheckIcon className="size-7" />
        </span>
        <h1 className="text-xl font-extrabold text-steel-900 sm:text-2xl">
          {awaitingPayment ? 'سفارش شما ثبت شد و در انتظار پرداخت است' : 'سفارش شما با موفقیت ثبت شد'}
        </h1>
        <p className="mt-2 text-sm text-muted">
          شمارهٔ سفارش: <LatinId className="font-bold text-steel-800">{order.orderNumber}</LatinId>
        </p>
      </div>

      {isCod && !awaitingPayment && (
        <div className="mb-5">
          <Alert tone="info" title="پرداخت در محل">
            مبلغ سفارش هنگام تحویل کالا دریافت می‌شود. لطفاً وجه را آمادهٔ پرداخت داشته باشید.
          </Alert>
        </div>
      )}

      {awaitingPayment && (
        <div className="mb-5">
          <Alert tone="warning" title="پرداخت تکمیل نشده است">
            موجودی کالاهای این سفارش برای مدت محدودی رزرو شده است. در صورت عدم پرداخت، سفارش به‌صورت خودکار لغو
            و موجودی آزاد می‌شود.
          </Alert>
        </div>
      )}

      <div className="card mb-5 p-5">
        <h2 className="mb-4 text-base font-extrabold text-steel-900">وضعیت سفارش</h2>
        <OrderTimeline status={order.status} events={order.events} />
      </div>

      <OrderSummary order={order} />

      <div className="mt-6 rounded-lg bg-steel-50 p-4 text-center">
        <p className="text-sm text-steel-800">
          این نشانی را برای پیگیری سفارش خود نگه دارید:
        </p>
        <LatinId className="mt-1.5 block break-all text-xs font-semibold text-steel-700">
          /orders/track/{order.trackingToken}
        </LatinId>
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <LinkButton href={`/orders/track/${order.trackingToken}`} variant="primary">پیگیری سفارش</LinkButton>
        <LinkButton href="/products" variant="secondary">ادامهٔ خرید</LinkButton>
      </div>

      <p className="mt-6 text-center text-xs text-muted">
        سؤالی دارید؟ <Link href="/contact" className="font-semibold text-steel-700 underline">با پشتیبانی تماس بگیرید</Link>
      </p>
    </div>
  );
}
