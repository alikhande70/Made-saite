import type { Metadata } from 'next';
import { getStoreProfile } from '@/application/settings-service';
import { Breadcrumbs, LatinId, PhoneIcon, Alert } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تماس با ما',
  description: 'راه‌های ارتباط با پشتیبانی فروشگاه قطعات یدکی.',
  alternates: { canonical: '/contact' },
};

export default async function ContactPage() {
  const store = await getStoreProfile();

  return (
    <div className="container-page max-w-3xl py-6">
      <Breadcrumbs items={[{ label: 'خانه', href: '/' }, { label: 'تماس با ما' }]} />
      <h1 className="mb-2 text-xl font-extrabold text-steel-900 sm:text-2xl">تماس با ما</h1>
      <p className="mb-6 text-sm text-muted">
        برای پرسش دربارهٔ سازگاری قطعه، وضعیت سفارش یا مرجوعی با ما در تماس باشید.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-base font-extrabold text-steel-900">
            <PhoneIcon className="size-4 text-steel-500" /> تلفن پشتیبانی
          </h2>
          <p className="latin-id text-lg font-extrabold text-steel-900">{store.phone}</p>
          <p className="mt-1 text-sm text-muted">{store.workingHours}</p>
        </div>

        <div className="card p-5">
          <h2 className="mb-3 text-base font-extrabold text-steel-900">ایمیل</h2>
          <p className="latin-id text-sm font-semibold text-steel-900">{store.email}</p>
          <p className="mt-1 text-sm text-muted">پاسخ‌گویی در ساعات کاری</p>
        </div>

        <div className="card p-5 sm:col-span-2">
          <h2 className="mb-3 text-base font-extrabold text-steel-900">نشانی</h2>
          <p className="text-sm leading-relaxed text-steel-800">{store.address}</p>
        </div>
      </div>

      {store.isDemo && (
        <div className="mt-5">
          <Alert tone="warning" title="اطلاعات نمایشی">
            شمارهٔ تماس، ایمیل و نشانی بالا نمونه‌اند و متعلق به کسب‌وکار واقعی نیستند.
          </Alert>
        </div>
      )}

      <div className="mt-6 card p-5">
        <h2 className="mb-2 text-base font-extrabold text-steel-900">پیش از تماس</h2>
        <p className="text-sm leading-relaxed text-steel-800">
          برای پیگیری سریع‌تر سفارش، شمارهٔ سفارش خود را آماده داشته باشید. شمارهٔ سفارش با{' '}
          <LatinId className="font-semibold">MS-</LatinId> شروع می‌شود و در صفحهٔ تأیید سفارش نمایش داده شده است.
        </p>
      </div>
    </div>
  );
}
