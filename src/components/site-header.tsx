import Link from 'next/link';
import { getCategoryTree } from '@/application/catalog-service';
import { getCartItemCount } from '@/application/cart-service';
import { getCurrentUser, getAnonCartToken } from '@/lib/session';
import { getStoreProfile } from '@/application/settings-service';
import { toPersianDigits } from '@/lib/fa';
import { SearchBox } from './search-box';
import { MobileNav } from './mobile-nav';
import { CarIcon, CartIcon, ChevronDown, PhoneIcon, UserIcon, WrenchIcon } from './ui';

export async function SiteHeader() {
  const [tree, user, anonToken, store] = await Promise.all([
    getCategoryTree().catch(() => []),
    getCurrentUser().catch(() => null),
    getAnonCartToken(),
    getStoreProfile(),
  ]);

  const cartCount = await getCartItemCount({
    userId: user?.id ?? null,
    anonToken: anonToken ?? null,
  }).catch(() => 0);

  const navCategories = tree.slice(0, 10).map((c) => ({
    slug: c.slug,
    nameFa: c.nameFa,
    productCount: c.productCount,
    children: c.children.map((ch) => ({ slug: ch.slug, nameFa: ch.nameFa, productCount: ch.productCount })),
  }));

  return (
    <header className="sticky top-0 z-40 bg-steel-900 text-steel-50">
      {store.isDemo && (
        <div className="bg-signal-600 px-3 py-1.5 text-center text-xs font-semibold text-white sm:text-[0.8125rem]">
          {store.demoNotice}
        </div>
      )}

      {/* Utility bar — desktop only, keeps the mobile header short. */}
      <div className="hidden border-b border-steel-800/80 lg:block">
        <div className="container-page flex h-9 items-center justify-between text-xs text-steel-300">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <PhoneIcon className="size-3.5" />
              <span className="latin-id">{store.phone}</span>
            </span>
            <span>{store.workingHours}</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/orders/track" className="hover:text-white">پیگیری سفارش</Link>
            <Link href="/shipping" className="hover:text-white">شیوه‌های ارسال</Link>
            <Link href="/contact" className="hover:text-white">تماس با ما</Link>
          </div>
        </div>
      </div>

      <div className="container-page flex h-16 items-center gap-3">
        <MobileNav categories={navCategories} />

        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label={store.name}>
          <span className="grid size-9 place-items-center rounded-lg bg-signal-600 text-white">
            <WrenchIcon className="size-5" />
          </span>
          <span className="text-base font-extrabold leading-none text-white sm:text-lg">
            مِیدساخت
            <span className="mt-0.5 hidden text-[0.6875rem] font-normal text-steel-300 sm:block">
              قطعات یدکی خودرو
            </span>
          </span>
        </Link>

        <div className="mx-auto hidden max-w-xl flex-1 md:block">
          <SearchBox />
        </div>

        <div className="ms-auto flex items-center gap-1 md:ms-0">
          <Link
            href={user ? '/account' : '/login'}
            className="inline-flex h-10 items-center gap-2 rounded-lg px-2.5 text-sm font-semibold text-steel-100 hover:bg-steel-800 sm:px-3"
          >
            <UserIcon className="size-5" />
            <span className="hidden lg:inline">{user ? user.fullName.split(' ')[0] : 'ورود'}</span>
          </Link>

          <Link
            href="/cart"
            className="relative inline-flex h-10 items-center gap-2 rounded-lg bg-steel-800 px-2.5 text-sm font-semibold text-white hover:bg-steel-700 sm:px-3"
          >
            <CartIcon className="size-5" />
            <span className="hidden lg:inline">سبد خرید</span>
            {cartCount > 0 && (
              <span
                className="absolute -top-1 -end-1 grid min-w-5 place-items-center rounded-full bg-signal-500 px-1 text-[0.6875rem] font-bold text-white"
                aria-label={`${toPersianDigits(cartCount)} کالا در سبد خرید`}
              >
                {toPersianDigits(cartCount)}
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* Mobile search sits on its own row so the input keeps a usable width. */}
      <div className="container-page pb-3 md:hidden">
        <SearchBox />
      </div>

      {/* Desktop category bar */}
      <nav aria-label="دسته‌بندی قطعات" className="hidden border-t border-steel-800/80 lg:block">
        <div className="container-page flex h-11 items-center gap-1">
          <Link
            href="/categories"
            className="inline-flex items-center gap-1.5 rounded-md bg-steel-800 px-3 py-1.5 text-sm font-semibold text-white"
          >
            همهٔ دسته‌ها
            <ChevronDown className="size-4" />
          </Link>
          {navCategories.slice(0, 7).map((cat) => (
            <Link
              key={cat.slug}
              href={`/categories/${encodeURIComponent(cat.slug)}`}
              className="rounded-md px-3 py-1.5 text-sm text-steel-200 hover:bg-steel-800 hover:text-white"
            >
              {cat.nameFa}
            </Link>
          ))}
          <Link
            href="/vehicles"
            className="ms-auto inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold text-signal-300 hover:bg-steel-800"
          >
            <CarIcon className="size-4" />
            انتخاب قطعه بر اساس خودرو
          </Link>
        </div>
      </nav>
    </header>
  );
}
