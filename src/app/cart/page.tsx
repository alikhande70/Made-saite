import Link from 'next/link';
import type { Metadata } from 'next';
import { getCartView } from '@/application/cart-service';
import { getShippingOptions } from '@/application/shipping-service';
import { getAnonCartToken, getCurrentUser } from '@/lib/session';
import { CartLineRow } from '@/components/cart-line';
import { Alert, Breadcrumbs, CartIcon, EmptyState, LinkButton, SectionHeading, TruckIcon } from '@/components/ui';
import { formatToman, toPersianDigits } from '@/lib/fa';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'سبد خرید',
  robots: { index: false, follow: false },
};

export default async function CartPage() {
  const user = await getCurrentUser();
  const anonToken = await getAnonCartToken();
  const cart = await getCartView({ userId: user?.id ?? null, anonToken: anonToken ?? null });

  // Indicative only — the real figure is computed at checkout for the chosen
  // destination and again, authoritatively, when the order is placed.
  const shippingSample = cart.lines.length > 0
    ? await getShippingOptions('تهران', cart.subtotal, cart.totalWeightGrams)
    : [];
  // Exclude in-store pickup: it is always free and would understate delivery cost.
  const deliverable = shippingSample.filter((s) => s.kind !== 'PICKUP');
  const cheapest = deliverable.length > 0 ? Math.min(...deliverable.map((s) => s.cost)) : null;

  if (cart.lines.length === 0) {
    return (
      <div className="container-page py-6">
        <Breadcrumbs items={[{ label: 'خانه', href: '/' }, { label: 'سبد خرید' }]} />
        <EmptyState
          title="سبد خرید شما خالی است"
          description="از دسته‌بندی‌ها یا جست‌وجو، قطعهٔ موردنیاز خودروی خود را پیدا کنید."
          icon={<CartIcon className="size-10" />}
          action={<LinkButton href="/categories" variant="signal">شروع خرید</LinkButton>}
        />
      </div>
    );
  }

  const blocked = cart.lines.some((l) => l.hasStockIssue);

  return (
    <div className="container-page py-6">
      <Breadcrumbs items={[{ label: 'خانه', href: '/' }, { label: 'سبد خرید' }]} />
      <SectionHeading title="سبد خرید" subtitle={`${toPersianDigits(cart.itemCount)} کالا`} />

      {cart.issues.length > 0 && (
        <div className="mb-4">
          <Alert tone="warning" title="سبد خرید نیاز به بررسی دارد">
            <ul className="list-inside list-disc space-y-1">
              {cart.issues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
          </Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_21rem] lg:items-start">
        <div className="card px-4 sm:px-5">
          <ul className="divide-y divide-line">
            {cart.lines.map((line) => <CartLineRow key={line.productId} line={line} />)}
          </ul>
        </div>

        <aside className="card sticky top-32 p-5">
          <h2 className="mb-4 text-base font-extrabold text-steel-900">خلاصهٔ سفارش</h2>

          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">جمع کالاها</dt>
              <dd className="font-semibold tabular-nums">{formatToman(cart.subtotal + cart.discountTotal)}</dd>
            </div>
            {cart.discountTotal > 0 && (
              <div className="flex justify-between text-red-700">
                <dt>تخفیف</dt>
                <dd className="font-semibold tabular-nums">−{formatToman(cart.discountTotal)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-muted">هزینهٔ ارسال</dt>
              <dd className="text-xs font-semibold text-steel-700">
                {cheapest === null
                  ? 'در مرحلهٔ بعد'
                  : cheapest === 0
                    ? 'رایگان'
                    : `از ${formatToman(cheapest)}`}
              </dd>
            </div>
            <div className="flex justify-between border-t border-line pt-3 text-base">
              <dt className="font-bold">جمع کل کالاها</dt>
              <dd className="font-extrabold tabular-nums text-steel-900">{formatToman(cart.subtotal)}</dd>
            </div>
          </dl>

          <p className="mt-2 text-xs text-muted">
            هزینهٔ نهایی ارسال پس از انتخاب استان و روش ارسال محاسبه می‌شود.
          </p>

          <div className="mt-4">
            {blocked ? (
              <>
                <LinkButton href="/cart" variant="secondary" size="lg" className="pointer-events-none w-full opacity-60">
                  ادامهٔ خرید ممکن نیست
                </LinkButton>
                <p className="hint mt-2">ابتدا مشکلات بالا را برطرف کنید.</p>
              </>
            ) : (
              <LinkButton href="/checkout" variant="signal" size="lg" className="w-full">
                ادامه و تکمیل سفارش
              </LinkButton>
            )}
          </div>

          <Link href="/products" className="mt-3 block text-center text-sm font-semibold text-steel-700 hover:underline">
            ادامهٔ خرید
          </Link>

          <div className="mt-5 flex items-start gap-2 border-t border-line pt-4 text-xs text-muted">
            <TruckIcon className="size-4 shrink-0 text-steel-400" />
            <p>وزن تقریبی مرسوله: {toPersianDigits(Math.max(1, Math.ceil(cart.totalWeightGrams / 1000)))} کیلوگرم</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
