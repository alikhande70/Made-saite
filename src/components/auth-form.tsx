'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Button } from './ui';

type Mode = 'login' | 'register';

/** Sign-in / sign-up form. Errors come back from the API already in Persian. */
export function AuthForm({ mode, next }: { mode: Mode; next: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    setErrors({});

    const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const payload = mode === 'login'
      ? { phone: form.phone, password: form.password }
      : { fullName: form.fullName, phone: form.phone, email: form.email || undefined, password: form.password };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { ok: boolean; message?: string; fields?: Record<string, string> };
      if (!res.ok || !body.ok) {
        setFormError(body.message ?? 'انجام عملیات ممکن نشد.');
        if (body.fields) setErrors(body.fields);
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setFormError('ارتباط با سرور برقرار نشد.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {formError && <Alert tone="error">{formError}</Alert>}

      {mode === 'register' && (
        <div>
          <label htmlFor="fullName" className="label">نام و نام خانوادگی</label>
          <input
            id="fullName" name="fullName" autoComplete="name" className="field"
            value={form.fullName}
            onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
            aria-invalid={errors.fullName ? 'true' : undefined}
            placeholder="مثال: علی رضایی"
          />
          {errors.fullName && <p role="alert" className="error-text">{errors.fullName}</p>}
        </div>
      )}

      <div>
        <label htmlFor="phone" className="label">شمارهٔ موبایل</label>
        <input
          id="phone" name="phone" type="tel" inputMode="numeric" autoComplete="tel" dir="ltr"
          className="field latin-id"
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          aria-invalid={errors.phone ? 'true' : undefined}
          placeholder="09123456789"
        />
        {errors.phone && <p role="alert" className="error-text">{errors.phone}</p>}
      </div>

      {mode === 'register' && (
        <div>
          <label htmlFor="email" className="label">ایمیل (اختیاری)</label>
          <input
            id="email" name="email" type="email" autoComplete="email" dir="ltr"
            className="field latin-id"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            aria-invalid={errors.email ? 'true' : undefined}
            placeholder="name@example.com"
          />
          {errors.email && <p role="alert" className="error-text">{errors.email}</p>}
        </div>
      )}

      <div>
        <label htmlFor="password" className="label">رمز عبور</label>
        <input
          id="password" name="password" type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          className="field"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          aria-invalid={errors.password ? 'true' : undefined}
        />
        {errors.password && <p role="alert" className="error-text">{errors.password}</p>}
        {mode === 'register' && !errors.password && (
          <p className="hint">حداقل ۸ کاراکتر، شامل حرف و رقم.</p>
        )}
      </div>

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
        {busy ? 'لطفاً صبر کنید…' : mode === 'login' ? 'ورود به حساب' : 'ساخت حساب کاربری'}
      </Button>

      <p className="text-center text-sm text-muted">
        {mode === 'login' ? (
          <>حساب کاربری ندارید؟{' '}
            <Link href={`/register?next=${encodeURIComponent(next)}`} className="font-semibold text-steel-700 hover:underline">
              ثبت‌نام کنید
            </Link>
          </>
        ) : (
          <>قبلاً ثبت‌نام کرده‌اید؟{' '}
            <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-steel-700 hover:underline">
              وارد شوید
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
