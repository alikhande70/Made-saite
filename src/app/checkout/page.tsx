import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { eq, desc } from 'drizzle-orm';
import { quoteCheckout } from '@/application/checkout-service';
import { getAnonCartToken, getCurrentUser } from '@/lib/session';
import { getDb } from '@/infrastructure/db/client';
import { addresses } from '@/infrastructure/db/schema';
import { CheckoutForm } from '@/components/checkout-form';
import { Alert, Breadcrumbs, LatinId } from '@/components/ui';
import { formatToman, toPersianDigits } from '@/lib/fa';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تکمیل سفارش',
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  const user = await getCurrentUser();
  const anonToken = await getAnonCartToken();
  const identity = { userId: user?.id ?? null, anonToken: anonToken ?? null };

  const savedAddresses = user
    ? await getDb()
        .select()
        .from(addresses)
        .where(eq(addresses.userId, user.id))
        .orderBy(desc(addresses.isDefault), desc(addresses.createdAt))
    : [];

  const defaultAddress = savedAddresses[0];
  const province = defaultAddress?.province ?? 'تهران';

  const quote = await quoteCheckout(identity, province, null);

  // Nothing to check out — bounce back rather than render an empty form.
  if (quote.cart.lines.length === 0) redirect('/cart');
  if (quote.cart.lines.some((l) => l.hasStockIssue)) redirect('/cart');

  return (
    <div className="container-page py-6">
      <Breadcrumbs items={[{ label: 'خانه', href: '/' }, { label: 'سبد خرید', href: '/cart' }, { label: 'تکمیل سفارش' }]} />
      <h1 className="mb-5 text-xl font-extrabold text-steel-900 sm:text-2xl">تکمیل سفارش</h1>

      {!user && (
        <div className="mb-5">
          <Alert tone="info">
            بدون ثبت‌نام هم می‌توانید سفارش دهید. با{' '}
            <Link href="/login?next=/checkout">ورود به حساب کاربری</Link> سفارش‌هایتان ذخیره می‌شود و آدرس‌ها را دوباره وارد نمی‌کنید.
          </Alert>
        </div>
      )}

      {/* Order lines are shown read-only here; quantities change in the cart. */}
      <details className="card mb-5 p-4 lg:hidden">
        <summary className="cursor-pointer text-sm font-bold text-steel-900">
          {toPersianDigits(quote.cart.itemCount)} کالا — {formatToman(quote.cart.subtotal)}
        </summary>
        <ul className="mt-3 divide-y divide-line text-sm">
          {quote.cart.lines.map((line) => (
            <li key={line.productId} className="flex items-start justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block font-semibold text-steel-900">{line.titleFa}</span>
                <LatinId className="text-xs text-muted">{line.sku}</LatinId>
                <span className="ms-2 text-xs text-muted">× {toPersianDigits(line.quantity)}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{formatToman(line.lineTotal)}</span>
            </li>
          ))}
        </ul>
      </details>

      <CheckoutForm
        initialProvince={province}
        shippingOptions={quote.shippingOptions}
        paymentProviders={quote.paymentProviders}
        subtotal={quote.subtotal}
        discountTotal={quote.discountTotal}
        defaults={{
          fullName: defaultAddress?.fullName ?? user?.fullName ?? '',
          phone: defaultAddress?.phone ?? user?.phone ?? '',
          email: user?.email ?? '',
          city: defaultAddress?.city ?? '',
          postalAddress: defaultAddress?.postalAddress ?? '',
          postalCode: defaultAddress?.postalCode ?? '',
        }}
        savedAddresses={savedAddresses.map((a) => ({
          id: a.id, label: a.label, fullName: a.fullName, phone: a.phone,
          province: a.province, city: a.city, postalAddress: a.postalAddress, postalCode: a.postalCode,
        }))}
      />
    </div>
  );
}
