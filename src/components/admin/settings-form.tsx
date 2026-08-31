'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StoreProfile } from '@/application/settings-service';
import { Alert, Button } from '../ui';

export function SettingsForm({ store }: { store: StoreProfile }) {
  const router = useRouter();
  const [form, setForm] = useState(store);
  const [state, setState] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setState(null);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = (await res.json()) as { ok: boolean; message?: string };
      setState(res.ok && body.ok
        ? { tone: 'success', text: 'تنظیمات ذخیره شد.' }
        : { tone: 'error', text: body.message ?? 'ذخیرهٔ تنظیمات انجام نشد.' });
      if (res.ok && body.ok) router.refresh();
    } catch {
      setState({ tone: 'error', text: 'ارتباط با سرور برقرار نشد.' });
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof StoreProfile>(key: K, value: StoreProfile[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <form onSubmit={save} className="card space-y-4 p-5">
      {state && <Alert tone={state.tone}>{state.text}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="نام فروشگاه">
          <input id="name" className="field" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field id="tagline" label="شعار / توضیح کوتاه">
          <input id="tagline" className="field" value={form.tagline} onChange={(e) => set('tagline', e.target.value)} />
        </Field>
        <Field id="phone" label="تلفن تماس">
          <input id="phone" className="field" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field id="email" label="ایمیل">
          <input id="email" dir="ltr" className="field latin-id" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field id="workingHours" label="ساعات کاری">
          <input id="workingHours" className="field" value={form.workingHours} onChange={(e) => set('workingHours', e.target.value)} />
        </Field>
        <Field id="address" label="نشانی">
          <input id="address" className="field" value={form.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field id="demoNotice" label="پیام نوار نمایشی">
            <input id="demoNotice" className="field" value={form.demoNotice} onChange={(e) => set('demoNotice', e.target.value)} />
          </Field>
        </div>
      </div>

      <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm ring-1 ring-inset ring-amber-600/20">
        <input type="checkbox" checked={form.isDemo} onChange={(e) => set('isDemo', e.target.checked)}
          className="mt-0.5 size-4 rounded border-steel-300 text-steel-700" />
        <span>
          <span className="font-bold text-amber-900">حالت نمایشی</span>
          <span className="mt-0.5 block text-xs text-amber-900">
            وقتی فعال است، نوار هشدار «فروشگاه نمایشی» در بالای همهٔ صفحات نمایش داده می‌شود.
            پیش از راه‌اندازی واقعی فروشگاه، این گزینه را غیرفعال کنید.
          </span>
        </span>
      </label>

      <Button type="submit" variant="primary" disabled={busy}>{busy ? 'در حال ذخیره…' : 'ذخیرهٔ تنظیمات'}</Button>
    </form>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {children}
    </div>
  );
}
