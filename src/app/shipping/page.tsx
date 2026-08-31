import type { Metadata } from 'next';
import { getShippingOptions, listShippingMethodsAdmin } from '@/application/shipping-service';
import { Breadcrumbs, Alert } from '@/components/ui';
import { SHIPPING_KIND_LABEL_FA, type ShippingMethodKind } from '@/domain/shipping';
import { formatDeliveryWindow, formatToman, toPersianDigits } from '@/lib/fa';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'شیوه‌ها و هزینهٔ ارسال',
  description: 'روش‌های ارسال سفارش، زمان تحویل و نحوهٔ محاسبهٔ هزینهٔ ارسال بر اساس وزن و استان مقصد.',
  alternates: { canonical: '/shipping' },
};

export default async function ShippingInfoPage() {
  const [methods, tehranQuotes] = await Promise.all([
    listShippingMethodsAdmin(),
    getShippingOptions('تهران', 1_000_000, 1_000),
  ]);
  const active = methods.filter((m) => m.isActive);

  return (
    <div className="container-page max-w-4xl py-6">
      <Breadcrumbs items={[{ label: 'خانه', href: '/' }, { label: 'شیوه‌های ارسال' }]} />
      <h1 className="mb-2 text-xl font-extrabold text-steel-900 sm:text-2xl">شیوه‌ها و هزینهٔ ارسال</h1>
      <p className="mb-6 text-sm leading-relaxed text-muted">
        هزینهٔ ارسال بر اساس وزن مرسوله و استان مقصد محاسبه می‌شود و پیش از پرداخت، مبلغ دقیق در صفحهٔ تکمیل سفارش
        نمایش داده می‌شود.
      </p>

      <div className="card scroll-x mb-6">
        <table className="w-full text-sm">
          <caption className="sr-only">جدول روش‌های ارسال</caption>
          <thead className="bg-steel-50 text-xs">
            <tr>
              <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">روش ارسال</th>
              <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">نوع</th>
              <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">هزینهٔ پایه</th>
              <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">هر کیلوگرم</th>
              <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">زمان تحویل</th>
              <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">ارسال رایگان از</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {active.map((method) => (
              <tr key={method.id}>
                <td className="px-4 py-2.5">
                  <span className="font-semibold text-steel-900">{method.nameFa}</span>
                  {method.description && <span className="mt-0.5 block text-xs text-muted">{method.description}</span>}
                  {method.availableProvinces.length > 0 && (
                    <span className="mt-0.5 block text-xs text-amber-800">
                      فقط: {method.availableProvinces.join('، ')}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                  {SHIPPING_KIND_LABEL_FA[method.kind as ShippingMethodKind]}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                  {method.baseCost === 0 ? 'رایگان' : formatToman(method.baseCost)}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted">
                  {method.perKgCost === 0 ? '—' : formatToman(method.perKgCost)}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                  {formatDeliveryWindow(method.estimatedDaysMin, method.estimatedDaysMax) ?? '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted">
                  {method.freeOverSubtotal === null ? '—' : formatToman(method.freeOverSubtotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mb-6">
        <h2 className="mb-2 text-base font-extrabold text-steel-900">نحوهٔ محاسبهٔ هزینه</h2>
        <p className="text-sm leading-relaxed text-steel-800">
          هزینهٔ ارسال = هزینهٔ پایه + (وزن مرسوله به کیلوگرم، گرد‌شده به بالا × نرخ هر کیلوگرم) + اضافه‌بهای استان مقصد.
          اگر جمع سبد خرید از آستانهٔ «ارسال رایگان» بیشتر باشد، هزینهٔ ارسال صفر می‌شود.
        </p>
        <p className="mt-3 text-sm text-muted">
          نمونهٔ محاسبه برای مرسوله‌ای به وزن {toPersianDigits(1)} کیلوگرم به مقصد تهران با سبد {formatToman(1_000_000)}:
        </p>
        <ul className="mt-2 space-y-1 text-sm">
          {tehranQuotes.map((quote) => (
            <li key={quote.methodCode} className="flex justify-between border-b border-line py-1.5">
              <span>{quote.methodName}</span>
              <span className="font-semibold tabular-nums">
                {quote.isFree ? 'رایگان' : formatToman(quote.cost)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Alert tone="info" title="پیگیری مرسوله">
        پس از ارسال سفارش، کد رهگیری مرسوله در صفحهٔ پیگیری سفارش و در بخش «سفارش‌های من» نمایش داده می‌شود.
      </Alert>
    </div>
  );
}
