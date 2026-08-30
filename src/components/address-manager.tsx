'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IRAN_PROVINCES } from '@/lib/provinces';
import { Alert, Button, LatinId, TrashIcon } from './ui';

export interface SavedAddress {
  id: string;
  label: string | null;
  fullName: string;
  phone: string;
  province: string;
  city: string;
  postalAddress: string;
  postalCode: string;
  isDefault: boolean;
}

export function AddressManager({
  initial, defaults,
}: { initial: SavedAddress[]; defaults: { fullName: string; phone: string } }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(initial.length === 0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    label: '', fullName: defaults.fullName, phone: defaults.phone,
    province: 'تهران', city: '', postalAddress: '', postalCode: '', isDefault: initial.length === 0,
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    setErrors({});
    try {
      const res = await fetch('/api/account/addresses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, label: form.label || undefined }),
      });
      const body = (await res.json()) as { ok: boolean; message?: string; fields?: Record<string, string> };
      if (!res.ok || !body.ok) {
        setFormError(body.message ?? 'ذخیرهٔ آدرس انجام نشد.');
        if (body.fields) setErrors(body.fields);
        return;
      }
      setShowForm(false);
      setForm((f) => ({ ...f, label: '', city: '', postalAddress: '', postalCode: '' }));
      router.refresh();
    } catch {
      setFormError('ارتباط با سرور برقرار نشد.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    await fetch(`/api/account/addresses?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {initial.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {initial.map((address) => (
            <li key={address.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-bold text-steel-900">
                    {address.label ?? address.fullName}
                    {address.isDefault && (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[0.6875rem] font-bold text-emerald-800">پیش‌فرض</span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {address.province}، {address.city}
                  </p>
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-steel-800">{address.postalAddress}</p>
                  <p className="mt-1 text-xs text-muted">
                    کد پستی: <LatinId>{address.postalCode}</LatinId> · <LatinId>{address.phone}</LatinId>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(address.id)}
                  disabled={busy}
                  aria-label={`حذف آدرس ${address.label ?? address.city}`}
                  className="shrink-0 rounded-lg p-2 text-steel-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  <TrashIcon className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!showForm ? (
        <Button type="button" variant="secondary" onClick={() => setShowForm(true)}>افزودن آدرس جدید</Button>
      ) : (
        <form onSubmit={save} className="card space-y-4 p-5" noValidate>
          <h2 className="text-base font-extrabold text-steel-900">آدرس جدید</h2>
          {formError && <Alert tone="error">{formError}</Alert>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="label" label="عنوان آدرس (اختیاری)" error={errors.label}>
              <input id="label" className="field" value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="مثال: خانه، محل کار" />
            </Field>
            <Field id="fullName" label="نام گیرنده" error={errors.fullName}>
              <input id="fullName" className="field" value={form.fullName}
                onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
            </Field>
            <Field id="phone" label="شمارهٔ موبایل" error={errors.phone}>
              <input id="phone" className="field latin-id" dir="ltr" inputMode="numeric" value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </Field>
            <Field id="province" label="استان" error={errors.province}>
              <select id="province" className="field" value={form.province}
                onChange={(e) => setForm((f) => ({ ...f, province: e.target.value }))}>
                {IRAN_PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field id="city" label="شهر" error={errors.city}>
              <input id="city" className="field" value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
            </Field>
            <Field id="postalCode" label="کد پستی" error={errors.postalCode}>
              <input id="postalCode" className="field latin-id" dir="ltr" inputMode="numeric" maxLength={12}
                value={form.postalCode} onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))} />
            </Field>
            <div className="sm:col-span-2">
              <Field id="postalAddress" label="نشانی کامل" error={errors.postalAddress}>
                <textarea id="postalAddress" rows={3} className="field resize-y" value={form.postalAddress}
                  onChange={(e) => setForm((f) => ({ ...f, postalAddress: e.target.value }))} />
              </Field>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isDefault}
              onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
              className="size-4 rounded border-steel-300 text-steel-700 focus:ring-steel-500" />
            این آدرس پیش‌فرض من باشد
          </label>

          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={busy}>{busy ? 'در حال ذخیره…' : 'ذخیرهٔ آدرس'}</Button>
            {initial.length > 0 && (
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>انصراف</Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {children}
      {error && <p role="alert" className="error-text">{error}</p>}
    </div>
  );
}
