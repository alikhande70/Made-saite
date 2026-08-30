import Link from 'next/link';
import type { OrderDetail } from '@/application/order-service';
import { formatDateTime, formatToman, toPersianDigits } from '@/lib/fa';
import { ORDER_STATUS_LABEL_FA } from '@/domain/order-status';
import { LatinId } from './ui';

/** Read-only order panel shared by the confirmation, tracking and account pages. */
export function OrderSummary({ order, showAddress = true }: { order: OrderDetail; showAddress?: boolean }) {
  return (
    <div className="space-y-5">
      <div className="card scroll-x">
        <table className="w-full text-sm">
          <caption className="sr-only">اقلام سفارش {order.orderNumber}</caption>
          <thead className="bg-steel-50 text-xs">
            <tr>
              <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">کالا</th>
              <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">تعداد</th>
              <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">قیمت واحد</th>
              <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">جمع</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {order.items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    { }
                    <img
                      src={item.imageUrl ?? '/demo/engine-part.svg'}
                      alt=""
                      loading="lazy"
                      className="size-12 shrink-0 rounded-md border border-line object-contain"
                    />
                    <div className="min-w-0">
                      {item.productSlug ? (
                        <Link href={`/products/${encodeURIComponent(item.productSlug)}`} className="font-semibold text-steel-900 hover:underline">
                          {item.titleFa}
                        </Link>
                      ) : (
                        <span className="font-semibold text-steel-900">{item.titleFa}</span>
                      )}
                      <span className="mt-0.5 block text-xs text-muted">
                        {item.brandName ? `${item.brandName} · ` : ''}
                        <LatinId>{item.sku}</LatinId>
                      </span>
                    </div>
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums">{toPersianDigits(item.quantity)}</td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted">{formatToman(item.unitPrice)}</td>
                <td className="whitespace-nowrap px-4 py-3 font-bold tabular-nums">{formatToman(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-extrabold text-steel-900">صورتحساب</h3>
          <dl className="space-y-2 text-sm">
            <Row label="جمع کالاها" value={formatToman(order.subtotal + order.discountTotal)} />
            {order.discountTotal > 0 && (
              <Row label="تخفیف" value={`−${formatToman(order.discountTotal)}`} tone="discount" />
            )}
            <Row label={`ارسال (${order.shippingMethodName})`} value={order.shippingTotal === 0 ? 'رایگان' : formatToman(order.shippingTotal)} />
            <div className="flex items-baseline justify-between border-t border-line pt-2.5">
              <dt className="font-bold">مبلغ کل</dt>
              <dd className="text-base font-extrabold tabular-nums text-steel-900">{formatToman(order.grandTotal)}</dd>
            </div>
          </dl>
          <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs text-muted">
            <Row label="وضعیت" value={ORDER_STATUS_LABEL_FA[order.status]} small />
            <Row label="تاریخ ثبت" value={formatDateTime(order.placedAt)} small />
            {order.paidAt && <Row label="تاریخ پرداخت" value={formatDateTime(order.paidAt)} small />}
          </dl>
        </div>

        {showAddress && (
          <div className="card p-5">
            <h3 className="mb-3 text-sm font-extrabold text-steel-900">اطلاعات ارسال</h3>
            <dl className="space-y-2 text-sm">
              <Row label="گیرنده" value={order.customerFullName} />
              <Row label="موبایل" value={<LatinId>{order.customerPhone}</LatinId>} />
              <Row label="استان / شهر" value={`${order.shippingProvince} — ${order.shippingCity}`} />
              <div>
                <dt className="text-muted">نشانی</dt>
                <dd className="mt-0.5 leading-relaxed">{order.shippingAddress}</dd>
              </div>
              <Row label="کد پستی" value={<LatinId>{order.shippingPostalCode}</LatinId>} />
              {order.deliveryNotes && <Row label="توضیحات" value={order.deliveryNotes} />}
            </dl>

            {order.shipment?.trackingCode && (
              <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2.5 ring-1 ring-inset ring-emerald-600/20">
                <p className="text-xs font-semibold text-emerald-900">کد رهگیری مرسوله</p>
                <LatinId className="mt-0.5 block text-base font-extrabold text-emerald-900">
                  {order.shipment.trackingCode}
                </LatinId>
                {order.shipment.carrier && <p className="mt-0.5 text-xs text-emerald-800">{order.shipment.carrier}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label, value, tone, small,
}: { label: string; value: React.ReactNode; tone?: 'discount'; small?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={small ? 'text-muted' : 'text-muted'}>{label}</dt>
      <dd className={`text-end font-semibold tabular-nums ${tone === 'discount' ? 'text-red-700' : ''}`}>{value}</dd>
    </div>
  );
}
