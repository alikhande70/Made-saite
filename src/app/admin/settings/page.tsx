import type { Metadata } from 'next';
import { getStoreProfile } from '@/application/settings-service';
import { listAllProviders, getDefaultProviderId } from '@/application/payment/registry';
import { SectionHeading, Alert, LatinId } from '@/components/ui';
import { SettingsForm } from '@/components/admin/settings-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'تنظیمات فروشگاه' };

export default async function AdminSettingsPage() {
  const store = await getStoreProfile();
  const providers = listAllProviders();
  const activeProvider = getDefaultProviderId();
  const ttl = process.env.ORDER_PAYMENT_TTL_MINUTES ?? '30';

  return (
    <>
      <SectionHeading title="تنظیمات فروشگاه" as="h1" subtitle="اطلاعات تماس و نمایشی فروشگاه" />
      <SettingsForm store={store} />

      <section className="mt-8">
        <h2 className="mb-3 text-base font-extrabold text-steel-900">درگاه‌های پرداخت</h2>
        <div className="mb-3">
          <Alert tone="info">
            درگاه فعال با متغیر محیطی <LatinId>PAYMENT_PROVIDER</LatinId> تعیین می‌شود و از این صفحه قابل تغییر نیست —
            کلیدهای درگاه در محیط اجرا نگهداری می‌شوند، نه در پایگاه داده.
          </Alert>
        </div>
        <div className="card scroll-x">
          <table className="w-full text-sm">
            <thead className="bg-steel-50 text-xs">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">درگاه</th>
                <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">شناسه</th>
                <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">وضعیت پیکربندی</th>
                <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">توضیح</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {providers.map((provider) => (
                <tr key={provider.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-steel-900">
                    {provider.displayNameFa}
                    {provider.id === activeProvider && (
                      <span className="ms-2 rounded bg-steel-800 px-1.5 py-0.5 text-[0.625rem] font-bold text-white">پیش‌فرض</span>
                    )}
                    {provider.isSandbox && (
                      <span className="ms-2 rounded bg-amber-100 px-1.5 py-0.5 text-[0.625rem] font-bold text-amber-800">آزمایشی</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5"><LatinId className="text-xs">{provider.id}</LatinId></td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-xs font-bold ${
                      provider.isConfigured ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {provider.isConfigured ? 'پیکربندی‌شده' : 'پیکربندی نشده'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">{provider.descriptionFa}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-base font-extrabold text-steel-900">تنظیمات سفارش</h2>
        <div className="card p-5 text-sm">
          <dl className="space-y-2">
            <div className="flex justify-between">
              <dt className="text-muted">مهلت پرداخت سفارش (رزرو موجودی)</dt>
              <dd className="font-semibold">{ttl} دقیقه</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">واحد پول</dt>
              <dd className="font-semibold">تومان (IRT)</dd>
            </div>
          </dl>
          <p className="hint mt-3">
            این مقادیر از متغیرهای محیطی خوانده می‌شوند. برای تغییر، مقدار{' '}
            <LatinId>ORDER_PAYMENT_TTL_MINUTES</LatinId> را در محیط اجرا تنظیم کنید.
          </p>
        </div>
      </section>
    </>
  );
}
