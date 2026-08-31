import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { getDb } from '@/infrastructure/db/client';
import { orders } from '@/infrastructure/db/schema';
import { signMockCallback } from '@/application/payment/mock-provider';
import { Alert, LatinId } from '@/components/ui';
import { formatToman } from '@/lib/fa';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'درگاه پرداخت آزمایشی',
  robots: { index: false, follow: false },
};

/**
 * Stand-in for a real payment gateway's hosted page.
 *
 * It exists so the full redirect → pay → callback loop can be exercised end to
 * end without real money. The return links carry an HMAC signature produced with
 * the gateway secret, exactly as a real gateway would sign its result — so the
 * callback verification path being tested here is the real one.
 */
export default async function SandboxGatewayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (k: string) => (Array.isArray(params[k]) ? params[k]![0] : params[k]) as string | undefined;

  const orderId = single('order');
  const providerRef = single('ref');
  const amount = Number(single('amount') ?? 0);

  if (!orderId || !providerRef || !Number.isFinite(amount)) notFound();

  const [order] = await getDb()
    .select({ orderNumber: orders.orderNumber, grandTotal: orders.grandTotal, status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) notFound();

  const callback = (outcome: 'SUCCEEDED' | 'FAILED' | 'CANCELLED') => {
    const search = new URLSearchParams({
      order: orderId,
      ref: providerRef,
      status: outcome,
      amount: String(amount),
      sig: signMockCallback(orderId, providerRef, outcome, amount),
    });
    return `/api/payments/mock/callback?${search.toString()}`;
  };

  return (
    <div className="container-page flex min-h-[70vh] items-center justify-center py-10">
      <div className="w-full max-w-md">
        <div className="card overflow-hidden">
          <div className="bg-steel-900 px-5 py-4 text-white">
            <p className="text-sm font-bold">درگاه پرداخت آزمایشی</p>
            <p className="mt-0.5 text-xs text-steel-300">Sandbox Payment Gateway — شبیه‌سازی درگاه بانکی</p>
          </div>

          <div className="space-y-4 p-5">
            <Alert tone="warning" title="این یک درگاه واقعی نیست">
              هیچ مبلغی از حساب شما کسر نمی‌شود. این صفحه فقط برای آزمایش فرایند سفارش ساخته شده است.
            </Alert>

            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">شمارهٔ سفارش</dt>
                <dd><LatinId className="font-bold">{order.orderNumber}</LatinId></dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">شناسهٔ تراکنش</dt>
                <dd><LatinId className="text-xs">{providerRef}</LatinId></dd>
              </div>
              <div className="flex justify-between border-t border-line pt-2">
                <dt className="font-bold">مبلغ قابل پرداخت</dt>
                <dd className="text-base font-extrabold tabular-nums">{formatToman(order.grandTotal)}</dd>
              </div>
            </dl>

            {order.status !== 'PENDING_PAYMENT' ? (
              <Alert tone="info">این سفارش پیش‌تر پردازش شده است.</Alert>
            ) : (
              <div className="space-y-2 pt-1">
                <p className="text-xs text-muted">نتیجهٔ پرداخت را برای آزمایش انتخاب کنید:</p>
                {/*
                  Plain links: the sandbox must not depend on client JS, and the
                  callback route accepts GET exactly as a real gateway return does.
                */}
                <a
                  href={callback('SUCCEEDED')}
                  className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-emerald-600 font-bold text-white hover:bg-emerald-700"
                >
                  پرداخت موفق
                </a>
                <a
                  href={callback('FAILED')}
                  className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-line bg-white font-semibold text-steel-800 hover:bg-steel-50"
                >
                  پرداخت ناموفق
                </a>
                <a
                  href={callback('CANCELLED')}
                  className="inline-flex h-11 w-full items-center justify-center rounded-lg font-semibold text-steel-600 hover:bg-steel-50"
                >
                  انصراف از پرداخت
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
