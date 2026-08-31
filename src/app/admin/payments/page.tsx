import Link from 'next/link';
import type { Metadata } from 'next';
import { listPayments } from '@/application/admin-service';
import { PAYMENT_STATUS_LABEL_FA, type PaymentStatus } from '@/domain/order-status';
import { EmptyState, LatinId, SectionHeading } from '@/components/ui';
import { StatusFilter } from '@/components/admin/status-filter';
import { formatDateTime, formatToman, toPersianDigits } from '@/lib/fa';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'پرداخت‌ها' };

const TONE: Record<PaymentStatus, string> = {
  SUCCEEDED: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  INITIATED: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  FAILED: 'bg-red-50 text-red-800 ring-red-600/20',
  CANCELLED: 'bg-steel-100 text-steel-700 ring-steel-400/25',
  REFUNDED: 'bg-accent-50 text-accent-800 ring-accent-600/20',
};

export default async function AdminPaymentsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const single = (key: string) => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };
  const status = single('status') ?? '';
  const page = Math.max(1, Number(single('page') ?? 1) || 1);

  const result = await listPayments({ status: status || undefined, page });

  return (
    <div>
      <SectionHeading
        as="h1"
        title="پرداخت‌ها"
        subtitle="گزارش فقط‌خواندنی از تلاش‌های پرداخت. وضعیت پرداخت تنها توسط بازگشت درگاه و زیر قفل سفارش نوشته می‌شود."
      />

      <StatusFilter
        label="فیلتر بر اساس وضعیت پرداخت"
        options={Object.entries(PAYMENT_STATUS_LABEL_FA)}
        selected={status}
      />

      {result.items.length === 0 ? (
        <EmptyState title="پرداختی ثبت نشده است" description="با اولین سفارش، تلاش‌های پرداخت اینجا نمایش داده می‌شوند." />
      ) : (
        <div className="card scroll-x">
          <table className="spec-table">
            <caption className="sr-only">فهرست تلاش‌های پرداخت</caption>
            <thead className="bg-steel-50 text-xs">
              <tr>
                <th scope="col" className="font-bold text-steel-800">زمان</th>
                <th scope="col" className="font-bold text-steel-800">سفارش</th>
                <th scope="col" className="font-bold text-steel-800">مشتری</th>
                <th scope="col" className="font-bold text-steel-800">درگاه</th>
                <th scope="col" className="font-bold text-steel-800">مبلغ</th>
                <th scope="col" className="font-bold text-steel-800">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((payment) => (
                <tr key={payment.id}>
                  <td className="whitespace-nowrap font-normal text-muted">{formatDateTime(payment.createdAt)}</td>
                  <td className="whitespace-nowrap">
                    <Link href={`/admin/orders/${payment.orderId}`} className="font-bold text-accent-700 hover:underline">
                      <LatinId>{payment.orderNumber}</LatinId>
                    </Link>
                  </td>
                  <td className="whitespace-nowrap font-normal">{payment.customerName}</td>
                  <td className="whitespace-nowrap font-normal text-muted"><LatinId>{payment.provider}</LatinId></td>
                  <td className="whitespace-nowrap tabular-nums">{formatToman(payment.amount)}</td>
                  <td>
                    <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${TONE[payment.status as PaymentStatus]}`}>
                      {PAYMENT_STATUS_LABEL_FA[payment.status as PaymentStatus]}
                    </span>
                    {payment.failureReason && (
                      <span className="mt-1 block text-xs font-normal text-muted">{payment.failureReason}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.totalPages > 1 && (
        <p className="mt-3 text-xs text-muted">
          صفحهٔ {toPersianDigits(result.page)} از {toPersianDigits(result.totalPages)} — مجموع {toPersianDigits(result.total)} پرداخت
        </p>
      )}
    </div>
  );
}
