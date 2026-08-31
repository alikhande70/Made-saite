import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { LogoutButton } from '@/components/logout-button';
import { BoxIcon, CarIcon, TruckIcon, UserIcon } from '@/components/ui';

export const dynamic = 'force-dynamic';

const LINKS = [
  { href: '/account', label: 'خلاصهٔ حساب', icon: UserIcon },
  { href: '/account/orders', label: 'سفارش‌های من', icon: BoxIcon },
  { href: '/account/garage', label: 'گاراژ من', icon: CarIcon },
  { href: '/account/addresses', label: 'آدرس‌ها', icon: TruckIcon },
  { href: '/account/profile', label: 'اطلاعات حساب', icon: UserIcon },
];

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/account');

  return (
    <div className="container-page py-6">
      <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
        <aside className="lg:sticky lg:top-32 lg:self-start">
          <div className="card p-4">
            <p className="mb-1 text-sm font-extrabold text-steel-900">{user.fullName}</p>
            <p className="latin-id mb-4 text-xs text-muted">{user.phone}</p>

            <nav aria-label="منوی حساب کاربری">
              <ul className="space-y-1">
                {LINKS.map(({ href, label, icon: Icon }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold text-steel-700 transition-colors hover:bg-steel-50"
                    >
                      <Icon className="size-4 text-steel-400" />
                      {label}
                    </Link>
                  </li>
                ))}
                {user.role === 'admin' && (
                  <li>
                    <Link
                      href="/admin"
                      className="flex items-center gap-2.5 rounded-lg bg-steel-800 px-3 py-2 text-sm font-semibold text-white hover:bg-steel-900"
                    >
                      پنل مدیریت
                    </Link>
                  </li>
                )}
              </ul>
            </nav>

            <div className="mt-3 border-t border-line pt-3">
              <LogoutButton />
            </div>
          </div>
        </aside>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
