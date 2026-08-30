import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/session';
import { getDashboardSummary } from '@/application/order-service';
import { toPersianDigits } from '@/lib/fa';
import { BoxIcon, CarIcon, ShieldIcon, TruckIcon, UserIcon, WrenchIcon } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'پنل مدیریت', template: '%s | پنل مدیریت' },
  robots: { index: false, follow: false },
};

const NAV: { href: string; label: string; icon: typeof BoxIcon }[] = [
  { href: '/admin', label: 'داشبورد', icon: BoxIcon },
  { href: '/admin/orders', label: 'سفارش‌ها', icon: TruckIcon },
  { href: '/admin/products', label: 'کالاها', icon: WrenchIcon },
  { href: '/admin/inventory', label: 'انبار و موجودی', icon: BoxIcon },
  { href: '/admin/categories', label: 'دسته‌بندی‌ها', icon: CarIcon },
  { href: '/admin/brands', label: 'برندها', icon: CarIcon },
  { href: '/admin/shipping', label: 'روش‌های ارسال', icon: TruckIcon },
  { href: '/admin/customers', label: 'مشتریان', icon: UserIcon },
  { href: '/admin/imports', label: 'درون‌ریزی گروهی', icon: BoxIcon },
  { href: '/admin/audit', label: 'گزارش فعالیت', icon: ShieldIcon },
  { href: '/admin/settings', label: 'تنظیمات فروشگاه', icon: WrenchIcon },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // Authorization gate for the entire /admin subtree.
  if (!user) redirect('/login?next=/admin');
  if (user.role !== 'admin') redirect('/account');

  const summary = await getDashboardSummary().catch(() => null);

  return (
    <div className="container-page py-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          {/* Not an <h1>: each admin page supplies its own single page heading. */}
          <p className="text-lg font-extrabold text-steel-900 sm:text-xl">پنل مدیریت فروشگاه</p>
          <p className="text-xs text-muted">{user.fullName}</p>
        </div>
        <Link href="/" className="text-sm font-semibold text-steel-700 hover:underline">
          بازگشت به فروشگاه
        </Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-[14rem_1fr]">
        <aside className="lg:sticky lg:top-32 lg:self-start">
          {/* Horizontally scrollable tab strip on mobile, sidebar on desktop. */}
          <nav aria-label="منوی مدیریت" className="scroll-x no-scrollbar -mx-4 px-4 lg:mx-0 lg:px-0">
            <ul className="flex gap-1.5 lg:flex-col lg:gap-1">
              {NAV.map(({ href, label, icon: Icon }) => (
                <li key={href} className="shrink-0">
                  <Link
                    href={href}
                    className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-steel-700 transition-colors hover:bg-steel-50 lg:border-0 lg:bg-transparent"
                  >
                    <Icon className="size-4 text-steel-400" />
                    {label}
                    {href === '/admin/orders' && summary && summary.actionableCount > 0 && (
                      <span className="ms-auto rounded-full bg-accent-600 px-1.5 text-[0.6875rem] font-bold text-white">
                        {toPersianDigits(summary.actionableCount)}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
