import Link from 'next/link';
import type { Metadata } from 'next';
import { getDashboardSummary } from '@/application/order-service';
import { listLowStock } from '@/application/inventory-service';
import { getSalesByDay } from '@/application/admin-service';
import { getDb } from '@/infrastructure/db/client';
import { ORDER_STATUS_LABEL_FA, type OrderStatus } from '@/domain/order-status';
import { formatDate, formatToman, formatTomanCompact, toPersianDigits } from '@/lib/fa';
import { Alert, LatinId, SectionHeading } from '@/components/ui';
import { StatusPill } from '@/components/admin/status-pill';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'داشبورد' };

export default async function AdminDashboard() {
  const [summary, lowStock, sales] = await Promise.all([
    getDashboardSummary(),
    listLowStock(getDb(), 8),
    getSalesByDay(14),
  ]);

  const peakRevenue = Math.max(0, ...sales.map((s) => s.revenue));
  // Guard the division only; never present the guard value as a figure.
  const chartScale = Math.max(1, peakRevenue);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="mb-4 text-xl font-extrabold text-steel-900 sm:text-2xl">داشبورد فروشگاه</h1>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="سفارش‌های در انتظار پرداخت" value={toPersianDigits(summary.pendingCount)} tone="amber" />
          <Stat label="سفارش‌های نیازمند اقدام" value={toPersianDigits(summary.actionableCount)} tone="accent" />
          <Stat label="فروش ۳۰ روز اخیر" value={formatTomanCompact(summary.revenueLast30Days)} tone="emerald" />
          <Stat label="مشتریان ثبت‌نام‌شده" value={toPersianDigits(summary.customerCount)} />
        </div>
      </section>

      <section>
        <SectionHeading title="فروش ۱۴ روز اخیر" subtitle="سفارش‌های لغو‌شده و پرداخت‌نشده محاسبه نمی‌شوند" />
        <div className="card p-5">
          {/* Simple bar chart: no charting library needed for 14 values. */}
          <ol className="flex h-40 items-end gap-1.5" role="img" aria-label="نمودار فروش چهارده روز اخیر">
            {sales.map((day) => (
              <li key={day.day} className="flex flex-1 flex-col items-center justify-end gap-1.5">
                <span
                  className="w-full rounded-t bg-steel-600/85"
                  style={{ height: `${Math.max(2, (day.revenue / chartScale) * 100)}%` }}
                  title={`${day.day}: ${formatToman(day.revenue)}`}
                />
                <span className="text-[0.625rem] tabular-nums text-muted">
                  {toPersianDigits(Number(day.day.slice(-2)))}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
            {peakRevenue > 0
              ? `بیشترین فروش روزانه: ${formatToman(peakRevenue)}`
              : 'در دو هفتهٔ گذشته فروشی ثبت نشده است.'}
          </p>
        </div>
      </section>

      <section>
        <SectionHeading
          title="آخرین سفارش‌ها"
          action={<Link href="/admin/orders" className="text-sm font-semibold text-steel-700 hover:underline">همهٔ سفارش‌ها</Link>}
        />
        {summary.recentOrders.length === 0 ? (
          <Alert tone="info">هنوز سفارشی ثبت نشده است.</Alert>
        ) : (
          <div className="card scroll-x">
            <table className="w-full text-sm">
              <thead className="bg-steel-50 text-xs">
                <tr>
                  <Th>شمارهٔ سفارش</Th><Th>مشتری</Th><Th>مقصد</Th><Th>مبلغ</Th><Th>وضعیت</Th><Th>تاریخ</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {summary.recentOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-steel-50/60">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/orders/${order.id}`} className="font-semibold text-steel-800 hover:underline">
                        <LatinId>{order.orderNumber}</LatinId>
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">{order.customerFullName}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">{order.shippingProvince}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-semibold tabular-nums">{formatToman(order.grandTotal)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5"><StatusPill status={order.status} /></td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">{formatDate(order.placedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <SectionHeading
          title="کالاهای رو به اتمام"
          action={<Link href="/admin/inventory" className="text-sm font-semibold text-steel-700 hover:underline">مدیریت انبار</Link>}
        />
        {lowStock.length === 0 ? (
          <Alert tone="success">موجودی هیچ کالایی به آستانهٔ هشدار نرسیده است.</Alert>
        ) : (
          <div className="card scroll-x">
            <table className="w-full text-sm">
              <thead className="bg-steel-50 text-xs">
                <tr><Th>کالا</Th><Th>کد</Th><Th>موجود</Th><Th>رزرو‌شده</Th><Th>آستانه</Th><Th>وضعیت</Th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lowStock.map((item) => {
                  const available = item.quantityOnHand - item.quantityReserved;
                  return (
                    <tr key={item.productId}>
                      <td className="px-4 py-2.5">
                        <Link href={`/admin/products/${item.productId}`} className="font-semibold text-steel-800 hover:underline">
                          {item.titleFa}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5"><LatinId className="text-xs">{item.sku}</LatinId></td>
                      <td className="px-4 py-2.5 tabular-nums">{toPersianDigits(item.quantityOnHand)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted">{toPersianDigits(item.quantityReserved)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted">{toPersianDigits(item.lowStockThreshold)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded px-2 py-0.5 text-xs font-bold ${
                          available <= 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'
                        }`}>
                          {available <= 0 ? 'ناموجود' : `${toPersianDigits(available)} عدد`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <SectionHeading title="سفارش‌ها بر اساس وضعیت" />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {(Object.keys(ORDER_STATUS_LABEL_FA) as OrderStatus[]).map((status) => (
            <Link
              key={status}
              href={`/admin/orders?status=${status}`}
              className="card px-3 py-2.5 transition-shadow hover:shadow-raised"
            >
              <p className="text-xs text-muted">{ORDER_STATUS_LABEL_FA[status]}</p>
              <p className="mt-0.5 text-lg font-extrabold tabular-nums text-steel-900">
                {toPersianDigits(summary.byStatus[status] ?? 0)}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'amber' | 'accent' | 'emerald' }) {
  const accent = {
    amber: 'text-amber-700', accent: 'text-accent-700', emerald: 'text-emerald-700',
  }[tone ?? 'amber'];
  return (
    <div className="card p-4">
      <p className="text-xs leading-relaxed text-muted">{label}</p>
      <p className={`mt-1 text-xl font-extrabold tabular-nums ${tone ? accent : 'text-steel-900'}`}>{value}</p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">{children}</th>;
}
