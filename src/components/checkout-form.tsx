'use client';

import Link from 'next/link';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ShippingQuote } from '@/domain/shipping';
import { IRAN_PROVINCES } from '@/lib/provinces';
import { formatDeliveryWindow, formatToman } from '@/lib/fa';
import { Alert, Button } from './ui';

interface PaymentOption {
  id: string;
  displayNameFa: string;
  descriptionFa: string;
  isSandbox: boolean;
  confirmsWithoutPayment: boolean;
}

interface Props {
  initialProvince: string;
  shippingOptions: ShippingQuote[];
  paymentProviders: PaymentOption[];
  subtotal: number;
  discountTotal: number;
  defaults: {
    fullName: string;
    phone: string;
    email: string;
    city: string;
    postalAddress: string;
    postalCode: string;
  };
  savedAddresses: {
    id: string; label: string | null; fullName: string; phone: string;
    province: string; city: string; postalAddress: string; postalCode: string;
  }[];
}

/**
 * Checkout form.
 *
 * Shipping prices are re-fetched from the server whenever the province or the
 * method changes; the totals shown here are always server-computed. The order
 * itself is priced again inside the placement transaction, so nothing rendered
 * on this page is trusted at submit time.
 */
export function CheckoutForm({
  initialProvince, shippingOptions, paymentProviders, subtotal, discountTotal, defaults, savedAddresses,
}: Props) {
  const router = useRouter();

  const [form, setForm] = useState({
    fullName: defaults.fullName,
    phone: defaults.phone,
    email: defaults.email,
    province: initialProvince,
    city: defaults.city,
    postalAddress: defaults.postalAddress,
    postalCode: defaults.postalCode,
    deliveryNotes: '',
  });

  const [options, setOptions] = useState<ShippingQuote[]>(shippingOptions);
  const [methodCode, setMethodCode] = useState(shippingOptions[0]?.methodCode ?? '');
  const [providerId, setProviderId] = useState(paymentProviders[0]?.id ?? 'mock');
  const [shippingTotal, setShippingTotal] = useState(shippingOptions[0]?.cost ?? 0);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Re-quote whenever the destination changes; the price depends on the province.
  useEffect(() => {
    let cancelled = false;
    async function quote() {
      setQuoting(true);
      try {
        const params = new URLSearchParams({ province: form.province });
        if (methodCode) params.set('method', methodCode);
        const res = await fetch(`/api/shipping/quote?${params.toString()}`);
        if (!res.ok) return;
        const body = (await res.json()) as {
          data?: { shippingOptions: ShippingQuote[]; selectedShipping: ShippingQuote | null; shippingTotal: number };
        };
        if (cancelled || !body.data) return;
        setOptions(body.data.shippingOptions);
        const stillValid = body.data.shippingOptions.some((o) => o.methodCode === methodCode);
        const chosen = stillValid
          ? body.data.shippingOptions.find((o) => o.methodCode === methodCode)!
          : body.data.shippingOptions[0];
        setMethodCode(chosen?.methodCode ?? '');
        setShippingTotal(chosen?.cost ?? 0);
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }
    void quote();
    return () => { cancelled = true; };
  }, [form.province, methodCode]);

  const grandTotal = subtotal + shippingTotal;
  const selectedProvider = paymentProviders.find((p) => p.id === providerId);

  function applySavedAddress(id: string) {
    const addr = savedAddresses.find((a) => a.id === id);
    if (!addr) return;
    setForm((f) => ({
      ...f,
      fullName: addr.fullName, phone: addr.phone, province: addr.province,
      city: addr.city, postalAddress: addr.postalAddress, postalCode: addr.postalCode,
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, shippingMethodCode: methodCode, paymentProvider: providerId }),
      });
      const body = (await res.json()) as {
        ok: boolean; message?: string; fields?: Record<string, string>;
        data?: { redirectUrl: string };
      };

      if (!res.ok || !body.ok) {
        setFormError(body.message ?? 'ثبت سفارش انجام نشد.');
        if (body.fields) setFieldErrors(body.fields);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      const target = body.data!.redirectUrl;
      if (target.startsWith('http')) window.location.assign(target);
      else router.push(target);
    } catch {
      setFormError('ارتباط با سرور برقرار نشد. لطفاً دوباره تلاش کنید.');
    } finally {
      setSubmitting(false);
    }
  }

  const field = (name: keyof typeof form) => ({
    id: name,
    value: form[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [name]: e.target.value })),
    'aria-invalid': fieldErrors[name] ? ('true' as const) : undefined,
    'aria-describedby': fieldErrors[name] ? `${name}-error` : undefined,
  });

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_21rem] lg:items-start" noValidate>
      <div className="space-y-5">
        {formError && <Alert tone="error" title="ثبت سفارش انجام نشد">{formError}</Alert>}

        {savedAddresses.length > 0 && (
          <section className="card p-5">
            <h2 className="mb-3 text-base font-extrabold text-steel-900">آدرس‌های ذخیره‌شده</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {savedAddresses.map((addr) => (
                <button
                  key={addr.id}
                  type="button"
                  onClick={() => applySavedAddress(addr.id)}
                  className="rounded-lg border border-line p-3 text-start text-sm transition-colors hover:border-steel-300 hover:bg-steel-50"
                >
                  <span className="block font-bold text-steel-900">{addr.label ?? addr.fullName}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {addr.province}، {addr.city} — {addr.postalAddress.slice(0, 40)}…
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="card p-5">
          <h2 className="mb-4 text-base font-extrabold text-steel-900">اطلاعات گیرنده</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نام و نام خانوادگی" name="fullName" error={fieldErrors.fullName} required>
              <input {...field('fullName')} name="fullName" autoComplete="name" className="field" placeholder="مثال: علی رضایی" />
            </Field>

            <Field label="شمارهٔ موبایل" name="phone" error={fieldErrors.phone} required
              hint="برای هماهنگی ارسال و پیگیری سفارش استفاده می‌شود.">
              <input
                {...field('phone')} name="phone" type="tel" inputMode="numeric" autoComplete="tel"
                className="field latin-id" placeholder="09123456789" dir="ltr"
              />
            </Field>

            <Field label="ایمیل (اختیاری)" name="email" error={fieldErrors.email}>
              <input {...field('email')} name="email" type="email" autoComplete="email" className="field latin-id" dir="ltr" placeholder="name@example.com" />
            </Field>

            <Field label="استان" name="province" error={fieldErrors.province} required>
              <select {...field('province')} name="province" className="field">
                {IRAN_PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>

            <Field label="شهر" name="city" error={fieldErrors.city} required>
              <input {...field('city')} name="city" autoComplete="address-level2" className="field" placeholder="مثال: تهران" />
            </Field>

            <Field label="کد پستی" name="postalCode" error={fieldErrors.postalCode} required hint="۱۰ رقم، بدون خط تیره">
              <input
                {...field('postalCode')} name="postalCode" inputMode="numeric" autoComplete="postal-code"
                className="field latin-id" dir="ltr" placeholder="1234567890" maxLength={12}
              />
            </Field>

            <div className="sm:col-span-2">
              <Field label="نشانی پستی" name="postalAddress" error={fieldErrors.postalAddress} required>
                <textarea
                  {...field('postalAddress')} name="postalAddress" rows={3} autoComplete="street-address"
                  className="field resize-y" placeholder="خیابان، کوچه، پلاک، واحد"
                />
              </Field>
            </div>

            <div className="sm:col-span-2">
              <Field label="توضیحات تحویل (اختیاری)" name="deliveryNotes" error={fieldErrors.deliveryNotes}>
                <textarea {...field('deliveryNotes')} name="deliveryNotes" rows={2} className="field resize-y" placeholder="مثال: تحویل در ساعات اداری" />
              </Field>
            </div>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-1 text-base font-extrabold text-steel-900">روش ارسال</h2>
          <p className="mb-4 text-xs text-muted">
            هزینه بر اساس استان مقصد و وزن مرسوله محاسبه می‌شود.
            {quoting && <span className="ms-2 text-steel-600">در حال محاسبه…</span>}
          </p>

          {options.length === 0 ? (
            <Alert tone="warning">برای استان انتخاب‌شده روش ارسالی تعریف نشده است. لطفاً با پشتیبانی تماس بگیرید.</Alert>
          ) : (
            <ul className="space-y-2">
              {options.map((option) => (
                <li key={option.methodCode}>
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                      methodCode === option.methodCode ? 'border-steel-600 bg-steel-50' : 'border-line hover:border-steel-300'
                    }`}
                  >
                    <input
                      type="radio" name="shippingMethodCode" value={option.methodCode}
                      checked={methodCode === option.methodCode}
                      onChange={() => { setMethodCode(option.methodCode); setShippingTotal(option.cost); }}
                      className="mt-1 size-4 text-steel-700 focus:ring-steel-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-bold text-steel-900">{option.methodName}</span>
                        <span className="text-sm font-extrabold tabular-nums text-steel-900">
                          {option.isFree ? <span className="text-emerald-700">رایگان</span> : formatToman(option.cost)}
                        </span>
                      </span>
                      {option.description && <span className="mt-0.5 block text-xs text-muted">{option.description}</span>}
                      {formatDeliveryWindow(option.estimatedDaysMin, option.estimatedDaysMax) && (
                        <span className="mt-0.5 block text-xs text-steel-600">
                          زمان تقریبی: {formatDeliveryWindow(option.estimatedDaysMin, option.estimatedDaysMax)}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="mb-4 text-base font-extrabold text-steel-900">روش پرداخت</h2>
          <ul className="space-y-2">
            {paymentProviders.map((provider) => (
              <li key={provider.id}>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                    providerId === provider.id ? 'border-steel-600 bg-steel-50' : 'border-line hover:border-steel-300'
                  }`}
                >
                  <input
                    type="radio" name="paymentProvider" value={provider.id}
                    checked={providerId === provider.id}
                    onChange={() => setProviderId(provider.id)}
                    className="mt-1 size-4 text-steel-700 focus:ring-steel-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-steel-900">{provider.displayNameFa}</span>
                      {provider.isSandbox && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[0.6875rem] font-bold text-amber-800">
                          آزمایشی
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">{provider.descriptionFa}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          {selectedProvider?.isSandbox && (
            <div className="mt-3">
              <Alert tone="warning" title="درگاه آزمایشی">
                این درگاه هیچ تراکنش مالی واقعی انجام نمی‌دهد و فقط برای آزمایش فرایند سفارش است.
              </Alert>
            </div>
          )}
        </section>
      </div>

      <aside className="card sticky top-32 p-5">
        <h2 className="mb-4 text-base font-extrabold text-steel-900">صورتحساب</h2>
        <dl className="space-y-2.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">جمع کالاها</dt>
            <dd className="font-semibold tabular-nums">{formatToman(subtotal + discountTotal)}</dd>
          </div>
          {discountTotal > 0 && (
            <div className="flex justify-between text-red-700">
              <dt>تخفیف</dt>
              <dd className="font-semibold tabular-nums">−{formatToman(discountTotal)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted">هزینهٔ ارسال</dt>
            <dd className="font-semibold tabular-nums">
              {shippingTotal === 0 ? <span className="text-emerald-700">رایگان</span> : formatToman(shippingTotal)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between border-t border-line pt-3">
            <dt className="text-base font-bold">مبلغ قابل پرداخت</dt>
            <dd className="text-lg font-extrabold tabular-nums text-steel-900">{formatToman(grandTotal)}</dd>
          </div>
        </dl>

        {/*
          * The button disables itself the instant it is pressed, so a
          * double-click cannot become a second request. That is a courtesy,
          * not the guarantee: the authority is the server-side cart lock in
          * `placeOrder`, which serialises duplicate submits no matter what the
          * client does (ADR-013). Client-side prevention alone would be
          * defeated by a second tab, a replayed request, or a disabled script.
          */}
        <Button
          type="submit"
          variant="accent"
          size="lg"
          className="mt-5 w-full"
          disabled={quoting || options.length === 0}
          loading={submitting}
          loadingLabel="در حال ثبت سفارش…"
        >
          {selectedProvider?.confirmsWithoutPayment ? 'ثبت نهایی سفارش' : 'پرداخت و ثبت سفارش'}
        </Button>

        {/*
          * Announced politely while the order is in flight. Placing an order is
          * the one action in the shop a customer is most afraid of repeating,
          * so silence here is the expensive kind.
          */}
        {submitting && (
          <p role="status" className="hint mt-2 text-center">
            سفارش شما در حال ثبت است؛ لطفاً صفحه را نبندید و دوباره کلیک نکنید.
          </p>
        )}

        <p className="hint mt-3 text-center">
          با ثبت سفارش، <Link href="/terms" className="font-semibold text-steel-700 underline">قوانین فروشگاه</Link> را می‌پذیرید.
        </p>
      </aside>
    </form>
  );
}

function Field({
  label, name, error, hint, required, children,
}: {
  label: string; name: string; error?: string | undefined; hint?: string;
  required?: boolean; children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={name} className="label">
        {label}
        {required && <span className="ms-1 text-red-600" aria-hidden>*</span>}
      </label>
      {children}
      {hint && !error && <p className="hint">{hint}</p>}
      {error && <p id={`${name}-error`} role="alert" className="error-text">{error}</p>}
    </div>
  );
}
