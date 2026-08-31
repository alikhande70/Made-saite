import Link from 'next/link';
import type { Metadata } from 'next';
import { listShipments } from '@/application/admin-service';
import { SHIPMENT_STATUS_LABEL_FA, type ShipmentStatus } from '@/domain/order-status';
import { EmptyState, LatinId, SectionHeading } from '@/components/ui';
import { StatusFilter } from '@/components/admin/status-filter';
import { formatDate, formatToman, toPersianDigits } from '@/lib/fa';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'مرسوله‌ها' };

const TONE: Record<ShipmentStatus, string> = {
  DELIVERED: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  IN_TRANSIT: 'bg-accent-50 text-accent-800 ring-accent-600/20',
  READY: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  PENDING: 'bg-steel-100 text-steel-700 ring-steel-400/25',
  RETURNED: 'bg-red-50 text-red-800 ring-red-600/20',
};

export default async function AdminShipmentsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const single = (key: string) => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };
  const status = single('status') ?? '';
  const page = Math.max(1, Number(single('page') ?? 1) || 1);

  const result = await listShipments({ status: status || undefined, page });

  return (
    <div>
      <SectionHeading
        as="h1"
        title="مرسوله‌ها"
        subtitle="مرسوله‌های ثبت‌شده برای سفارش‌ها. کد رهگیری از صفحهٔ همان سفارش ثبت می‌شود."
      />

      <StatusFilter
        label="فیلتر بر اساس وضعیت مرسوله"
        options={Object.entries(SHIPMENT_STATUS_LABEL_FA)}
        selected={status}
      />

      {result.items.length === 0 ? (
        <EmptyState title="مرسوله‌ای ثبت نشده است" description="با ارسال اولین سفارش، مرسوله‌ها اینجا فهرست می‌شوند." />
      ) : (
        <div className="card scroll-x">
          <table className="spec-table">
            <caption className="sr-only">فهرست مرسوله‌ها</caption>
            <thead className="bg-steel-50 text-xs">
              <tr>
                <th scope="col" className="font-bold text-steel-800">سفارش</th>
                <th scope="col" className="font-bold text-steel-800">مشتری</th>
                <th scope="col" className="font-bold text-steel-800">مقصد</th>
                <th scope="col" className="font-bold text-steel-800">روش ارسال</th>
                <th scope="col" className="font-bold text-steel-800">کد رهگیری</th>
                <th scope="col" className="font-bold text-steel-800">هزینه</th>
                <th scope="col" className="font-bold text-steel-800">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((shipment) => (
                <tr key={shipment.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/admin/orders/${shipment.orderId}`} className="font-bold text-accent-700 hover:underline">
                      <LatinId>{shipment.orderNumber}</LatinId>
                    </Link>
                  </td>
                  <td className="whitespace-nowrap font-normal">{shipment.customerName}</td>
                  <td className="whitespace-nowrap font-normal text-muted">
                    {shipment.province}
                    {shipment.city && shipment.city !== shipment.province && ` — ${shipment.city}`}
                  </td>
                  <td className="whitespace-nowrap font-normal text-muted">
                    {shipment.carrier ?? <LatinId>{shipment.methodCode}</LatinId>}
                  </td>
                  <td className="whitespace-nowrap">
                    {shipment.trackingCode
                      ? <LatinId className="font-bold">{shipment.trackingCode}</LatinId>
                      : <span className="font-normal text-muted">—</span>}
                  </td>
                  <td className="whitespace-nowrap tabular-nums font-normal">
                    {shipment.cost === 0 ? 'رایگان' : formatToman(shipment.cost)}
                  </td>
                  <td>
                    <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${TONE[shipment.status as ShipmentStatus]}`}>
                      {SHIPMENT_STATUS_LABEL_FA[shipment.status as ShipmentStatus]}
                    </span>
                    {shipment.shippedAt && (
                      <span className="mt-1 block text-xs font-normal text-muted">
                        ارسال: {formatDate(shipment.shippedAt)}
                      </span>
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
          صفحهٔ {toPersianDigits(result.page)} از {toPersianDigits(result.totalPages)} — مجموع {toPersianDigits(result.total)} مرسوله
        </p>
      )}
    </div>
  );
}
