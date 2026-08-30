import Link from 'next/link';
import type { Metadata } from 'next';
import { Breadcrumbs, Alert } from '@/components/ui';
import { TrackOrderForm } from '@/components/track-order-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'پیگیری سفارش',
  description: 'وضعیت سفارش خود را با کد پیگیری دنبال کنید.',
  // The whole /orders subtree is transactional and is disallowed in robots.txt;
  // keeping the landing page noindex avoids contradicting that.
  robots: { index: false, follow: true },
};

const ERROR_MESSAGES: Record<string, string> = {
  notfound: 'سفارشی با این کد پیگیری یافت نشد.',
  empty: 'کد پیگیری را وارد کنید.',
  rate: 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.',
};

export default async function TrackLandingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const key = Array.isArray(params.error) ? params.error[0] : params.error;
  const initialError = key ? (ERROR_MESSAGES[key] ?? null) : null;

  return (
    <div className="container-page max-w-2xl py-8">
      <Breadcrumbs items={[{ label: 'خانه', href: '/' }, { label: 'پیگیری سفارش' }]} />
      <h1 className="mb-2 text-xl font-extrabold text-steel-900 sm:text-2xl">پیگیری سفارش</h1>
      <p className="mb-6 text-sm text-muted">
        کد پیگیری سفارش در صفحهٔ تأیید سفارش به شما نمایش داده شده است.
      </p>

      <div className="card p-5">
        <TrackOrderForm initialError={initialError} />
      </div>

      <div className="mt-5">
        <Alert tone="info">
          اگر با حساب کاربری خرید کرده‌اید، می‌توانید همهٔ سفارش‌ها را در{' '}
          <Link href="/account/orders">سفارش‌های من</Link> ببینید.
        </Alert>
      </div>
    </div>
  );
}
