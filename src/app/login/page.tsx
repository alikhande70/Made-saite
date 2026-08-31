import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { Breadcrumbs } from '@/components/ui';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'ورود به حساب کاربری',
  robots: { index: false, follow: true },
};

/** Only same-origin relative paths are accepted, so `next` cannot be an open redirect. */
function safeNext(value: string | undefined): string {
  if (!value) return '/account';
  if (!value.startsWith('/') || value.startsWith('//')) return '/account';
  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const raw = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = safeNext(raw);

  if (user) redirect(next);

  return (
    <div className="container-page max-w-md py-8">
      <Breadcrumbs items={[{ label: 'خانه', href: '/' }, { label: 'ورود به حساب کاربری' }]} />
      <div className="card p-6">
        <h1 className="mb-1 text-xl font-extrabold text-steel-900">ورود به حساب کاربری</h1>
        <p className="mb-5 text-sm text-muted">برای مشاهدهٔ سفارش‌ها و آدرس‌های ذخیره‌شده وارد شوید.</p>
        <AuthForm mode="login" next={next} />
      </div>
    </div>
  );
}
