import type { Metadata } from 'next';
import { Alert, LinkButton } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'پرداخت ناموفق',
  robots: { index: false, follow: false },
};

export default async function PaymentFailedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawReason = Array.isArray(params.reason) ? params.reason[0] : params.reason;
  // Reflected text is rendered as a React child (auto-escaped) and length-capped.
  const reason = (rawReason ?? '').slice(0, 200);

  return (
    <div className="container-page flex min-h-[60vh] max-w-lg flex-col items-center justify-center py-10 text-center">
      <span className="mb-4 grid size-14 place-items-center rounded-full bg-red-100 text-2xl text-red-700" aria-hidden>
        ×
      </span>
      <h1 className="text-xl font-extrabold text-steel-900 sm:text-2xl">پرداخت ناموفق بود</h1>
      <p className="mt-2 text-sm text-muted">
        مبلغی از حساب شما کسر نشده است. در صورت کسر وجه، مبلغ ظرف ۷۲ ساعت به‌صورت خودکار بازگردانده می‌شود.
      </p>

      {reason && (
        <div className="mt-5 w-full">
          <Alert tone="error" title="دلیل">{reason}</Alert>
        </div>
      )}

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <LinkButton href="/cart" variant="signal">بازگشت به سبد خرید</LinkButton>
        <LinkButton href="/contact" variant="secondary">تماس با پشتیبانی</LinkButton>
      </div>
    </div>
  );
}
