'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IRAN_PROVINCES } from '@/lib/provinces';
import { SHIPPING_KIND_LABEL_FA, type ShippingMethodKind } from '@/domain/shipping';
import { formatDeliveryWindow, formatToman, toLatinDigits, toPersianDigits } from '@/lib/fa';
import { Alert, Button, CloseIcon, LatinId } from '../ui';

interface Method {
  id: string; code: string; kind: ShippingMethodKind; nameFa: string; description: string | null;
  baseCost: number; perKgCost: number; freeOverSubtotal: number | null;
  estimatedDaysMin: number | null; estimatedDaysMax: number | null;
  availableProvinces: string[]; isActive: boolean; sortOrder: number;
}

interface Rate {
  id: string; methodId: string; province: string; costOverride: number | null; surcharge: number;
}

const int = (v: string): number => Number(toLatinDigits(v).replace(/[^\d-]/g, '')) || 0;
const intOrNull = (v: string): number | null => {
  const cleaned = toLatinDigits(v).replace(/[^\d-]/g, '');
  return cleaned === '' ? null : Number(cleaned);
};

export function ShippingManager({ methods, rates }: { methods: Method[]; rates: Rate[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Method | null>(null);
  const [creating, setCreating] = useState(false);
  const [ratesFor, setRatesFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const blank = {
    code: '', methodKind: 'POST' as ShippingMethodKind, nameFa: '', description: '',
    baseCost: '0', perKgCost: '0', freeOverSubtotal: '',
    estimatedDaysMin: '', estimatedDaysMax: '', availableProvinces: [] as string[],
    isActive: true, sortOrder: '0',
  };
  const [form, setForm] = useState(blank);

  const [rateForm, setRateForm] = useState({ province: 'تهران', costOverride: '', surcharge: '0' });

  async function post(body: unknown, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/shipping', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !payload.ok) {
        setError(payload.message ?? 'ذخیره انجام نشد.');
        return false;
      }
      setNotice(message);
      router.refresh();
      return true;
    } catch {
      setError('ارتباط با سرور برقرار نشد.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(query: string, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/shipping?${query}`, { method: 'DELETE' });
      const payload = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !payload.ok) {
        setError(payload.message ?? 'حذف انجام نشد.');
        return;
      }
      setNotice(message);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveMethod(e: React.FormEvent) {
    e.preventDefault();
    const ok = await post(
      {
        kind: 'method',
        ...(editing ? { id: editing.id } : {}),
        code: form.code.trim(),
        methodKind: form.methodKind,
        nameFa: form.nameFa.trim(),
        description: form.description.trim() || undefined,
        baseCost: int(form.baseCost),
        perKgCost: int(form.perKgCost),
        freeOverSubtotal: intOrNull(form.freeOverSubtotal),
        estimatedDaysMin: intOrNull(form.estimatedDaysMin),
        estimatedDaysMax: intOrNull(form.estimatedDaysMax),
        availableProvinces: form.availableProvinces,
        isActive: form.isActive,
        sortOrder: int(form.sortOrder),
      },
      editing ? 'روش ارسال به‌روزرسانی شد.' : 'روش ارسال جدید ثبت شد.',
    );
    if (ok) { setCreating(false); setEditing(null); setForm(blank); }
  }

  function startEdit(method: Method) {
    setCreating(false);
    setEditing(method);
    setForm({
      code: method.code, methodKind: method.kind, nameFa: method.nameFa,
      description: method.description ?? '',
      baseCost: String(method.baseCost), perKgCost: String(method.perKgCost),
      freeOverSubtotal: method.freeOverSubtotal === null ? '' : String(method.freeOverSubtotal),
      estimatedDaysMin: method.estimatedDaysMin === null ? '' : String(method.estimatedDaysMin),
      estimatedDaysMax: method.estimatedDaysMax === null ? '' : String(method.estimatedDaysMax),
      availableProvinces: [...method.availableProvinces],
      isActive: method.isActive, sortOrder: String(method.sortOrder),
    });
  }

  return (
    <>
      {error && <div className="mb-3"><Alert tone="error">{error}</Alert></div>}
      {notice && <div className="mb-3"><Alert tone="success">{notice}</Alert></div>}

      <div className="mb-4">
        <Button type="button" variant="signal" size="sm"
          onClick={() => { setEditing(null); setCreating(true); setForm(blank); }}>
          افزودن روش ارسال
        </Button>
      </div>

      {(creating || editing) && (
        <form onSubmit={saveMethod} className="card mb-5 space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-steel-900">
              {editing ? `ویرایش «${editing.nameFa}»` : 'روش ارسال جدید'}
            </h2>
            <button type="button" onClick={() => { setCreating(false); setEditing(null); }}
              aria-label="بستن" className="rounded-lg p-1.5 text-steel-400 hover:bg-steel-50">
              <CloseIcon className="size-4" />
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field id="nameFa" label="نام نمایشی" required>
              <input id="nameFa" className="field" value={form.nameFa}
                onChange={(e) => setForm((f) => ({ ...f, nameFa: e.target.value }))} placeholder="پست پیشتاز" />
            </Field>
            <Field id="code" label="کد یکتا" required hint="حروف کوچک لاتین، رقم و خط تیره">
              <input id="code" dir="ltr" className="field latin-id" value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="post-pishtaz" />
            </Field>
            <Field id="methodKind" label="نوع">
              <select id="methodKind" className="field" value={form.methodKind}
                onChange={(e) => setForm((f) => ({ ...f, methodKind: e.target.value as ShippingMethodKind }))}>
                {(Object.keys(SHIPPING_KIND_LABEL_FA) as ShippingMethodKind[]).map((k) => (
                  <option key={k} value={k}>{SHIPPING_KIND_LABEL_FA[k]}</option>
                ))}
              </select>
            </Field>
            <Field id="baseCost" label="هزینهٔ پایه (تومان)" hint={formatToman(int(form.baseCost))}>
              <input id="baseCost" inputMode="numeric" className="field tabular-nums" value={form.baseCost}
                onChange={(e) => setForm((f) => ({ ...f, baseCost: e.target.value }))} />
            </Field>
            <Field id="perKgCost" label="هزینهٔ هر کیلوگرم (تومان)" hint={formatToman(int(form.perKgCost))}>
              <input id="perKgCost" inputMode="numeric" className="field tabular-nums" value={form.perKgCost}
                onChange={(e) => setForm((f) => ({ ...f, perKgCost: e.target.value }))} />
            </Field>
            <Field id="freeOverSubtotal" label="ارسال رایگان از (تومان)" hint="خالی = بدون ارسال رایگان">
              <input id="freeOverSubtotal" inputMode="numeric" className="field tabular-nums" value={form.freeOverSubtotal}
                onChange={(e) => setForm((f) => ({ ...f, freeOverSubtotal: e.target.value }))} />
            </Field>
            <Field id="estimatedDaysMin" label="حداقل روز کاری">
              <input id="estimatedDaysMin" inputMode="numeric" className="field tabular-nums" value={form.estimatedDaysMin}
                onChange={(e) => setForm((f) => ({ ...f, estimatedDaysMin: e.target.value }))} />
            </Field>
            <Field id="estimatedDaysMax" label="حداکثر روز کاری">
              <input id="estimatedDaysMax" inputMode="numeric" className="field tabular-nums" value={form.estimatedDaysMax}
                onChange={(e) => setForm((f) => ({ ...f, estimatedDaysMax: e.target.value }))} />
            </Field>
            <Field id="sortOrder" label="ترتیب نمایش">
              <input id="sortOrder" inputMode="numeric" className="field tabular-nums" value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} />
            </Field>
            <div className="sm:col-span-2 lg:col-span-3">
              <Field id="description" label="توضیح کوتاه">
                <input id="description" className="field" value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </Field>
            </div>
          </div>

          <fieldset>
            <legend className="label">استان‌های تحت پوشش</legend>
            <p className="hint mb-2">هیچ استانی انتخاب نشود = ارسال به همهٔ استان‌ها.</p>
            <div className="scroll-x max-h-40 overflow-y-auto rounded-lg border border-line p-2">
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4">
                {IRAN_PROVINCES.map((province) => (
                  <label key={province} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={form.availableProvinces.includes(province)}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        availableProvinces: e.target.checked
                          ? [...f.availableProvinces, province]
                          : f.availableProvinces.filter((p) => p !== province),
                      }))}
                      className="size-3.5 rounded border-steel-300 text-steel-700"
                    />
                    {province}
                  </label>
                ))}
              </div>
            </div>
          </fieldset>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              className="size-4 rounded border-steel-300 text-steel-700" />
            فعال
          </label>

          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'در حال ذخیره…' : 'ذخیره'}</Button>
        </form>
      )}

      <div className="card scroll-x">
        <table className="w-full text-sm">
          <thead className="bg-steel-50 text-xs">
            <tr>
              <Th>روش</Th><Th>کد</Th><Th>پایه</Th><Th>هر کیلو</Th>
              <Th>ارسال رایگان از</Th><Th>زمان</Th><Th>استان‌ها</Th><Th>وضعیت</Th><Th>عملیات</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {methods.map((method) => (
              <tr key={method.id} className={editing?.id === method.id ? 'bg-steel-50/70' : undefined}>
                <td className="px-3 py-2.5">
                  <span className="font-semibold text-steel-900">{method.nameFa}</span>
                  <span className="mt-0.5 block text-xs text-muted">{SHIPPING_KIND_LABEL_FA[method.kind]}</span>
                </td>
                <td className="px-3 py-2.5"><LatinId className="text-xs">{method.code}</LatinId></td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{formatToman(method.baseCost)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted">
                  {method.perKgCost === 0 ? '—' : formatToman(method.perKgCost)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted">
                  {method.freeOverSubtotal === null ? '—' : formatToman(method.freeOverSubtotal)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted">
                  {formatDeliveryWindow(method.estimatedDaysMin, method.estimatedDaysMax) ?? '—'}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted">
                  {method.availableProvinces.length === 0
                    ? 'همهٔ استان‌ها'
                    : `${toPersianDigits(method.availableProvinces.length)} استان`}
                </td>
                <td className="px-3 py-2.5">
                  <span className={`rounded px-2 py-0.5 text-xs font-bold ${
                    method.isActive ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {method.isActive ? 'فعال' : 'غیرفعال'}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => startEdit(method)}
                      className="text-xs font-semibold text-steel-700 hover:underline">ویرایش</button>
                    <button type="button" onClick={() => setRatesFor(ratesFor === method.id ? null : method.id)}
                      className="text-xs font-semibold text-steel-700 hover:underline">
                      نرخ استانی ({toPersianDigits(rates.filter((r) => r.methodId === method.id).length)})
                    </button>
                    <button type="button" disabled={busy}
                      onClick={() => remove(`methodId=${encodeURIComponent(method.id)}`, 'روش ارسال حذف شد.')}
                      className="text-xs font-semibold text-red-700 hover:underline disabled:opacity-50">حذف</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ratesFor && (
        <div className="card mt-4 p-5">
          <h3 className="mb-3 text-sm font-extrabold text-steel-900">
            نرخ استانی — {methods.find((m) => m.id === ratesFor)?.nameFa}
          </h3>

          <ul className="mb-4 space-y-1.5">
            {rates.filter((r) => r.methodId === ratesFor).map((rate) => (
              <li key={rate.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                <span className="font-semibold text-steel-900">{rate.province}</span>
                {rate.costOverride !== null ? (
                  <span className="text-muted">هزینهٔ ثابت: {formatToman(rate.costOverride)}</span>
                ) : (
                  <span className={rate.surcharge < 0 ? 'text-emerald-700' : 'text-muted'}>
                    {rate.surcharge < 0 ? 'تخفیف' : 'اضافه‌بها'}: {formatToman(Math.abs(rate.surcharge))}
                  </span>
                )}
                <button type="button" disabled={busy}
                  onClick={() => remove(`rateId=${encodeURIComponent(rate.id)}`, 'نرخ استانی حذف شد.')}
                  className="ms-auto text-xs font-semibold text-red-700 hover:underline disabled:opacity-50">حذف</button>
              </li>
            ))}
            {rates.filter((r) => r.methodId === ratesFor).length === 0 && (
              <li className="text-sm text-muted">هیچ نرخ استانی اختصاصی تعریف نشده است.</li>
            )}
          </ul>

          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <Field id="rate-province" label="استان">
              <select id="rate-province" className="field h-10" value={rateForm.province}
                onChange={(e) => setRateForm((f) => ({ ...f, province: e.target.value }))}>
                {IRAN_PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field id="rate-override" label="هزینهٔ ثابت (تومان)" hint="خالی = محاسبهٔ عادی">
              <input id="rate-override" inputMode="numeric" className="field h-10 tabular-nums" value={rateForm.costOverride}
                onChange={(e) => setRateForm((f) => ({ ...f, costOverride: e.target.value }))} />
            </Field>
            <Field id="rate-surcharge" label="اضافه‌بها (تومان)" hint="عدد منفی = تخفیف">
              <input id="rate-surcharge" inputMode="numeric" className="field h-10 tabular-nums" value={rateForm.surcharge}
                onChange={(e) => setRateForm((f) => ({ ...f, surcharge: e.target.value }))} />
            </Field>
            <Button type="button" variant="primary" disabled={busy}
              onClick={() => post({
                kind: 'rate', methodId: ratesFor, province: rateForm.province,
                costOverride: intOrNull(rateForm.costOverride), surcharge: int(rateForm.surcharge),
              }, 'نرخ استانی ذخیره شد.')}>
              ذخیره
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-start font-bold text-steel-800">{children}</th>;
}

function Field({
  id, label, hint, required, children,
}: { id: string; label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}{required && <span className="ms-1 text-red-600" aria-hidden>*</span>}
      </label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
