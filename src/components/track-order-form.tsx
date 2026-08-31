'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './ui';

/**
 * Order-tracking lookup.
 *
 * The form posts to `/orders/track/lookup` as a plain GET, so it works with
 * JavaScript disabled or before hydration. When JS is available the submit is
 * intercepted so an unknown code is reported inline instead of via a redirect.
 */
export function TrackOrderForm({ initialError }: { initialError?: string | null }) {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    const value = token.trim();
    if (!value) {
      e.preventDefault();
      setError('کد پیگیری را وارد کنید.');
      return;
    }

    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/track/${encodeURIComponent(value)}`);
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        setError(body.message ?? 'سفارشی با این کد پیگیری یافت نشد.');
        return;
      }
      router.push(`/orders/track/${encodeURIComponent(value)}`);
    } catch {
      // Network trouble: fall back to the server-rendered lookup.
      window.location.assign(`/orders/track/lookup?token=${encodeURIComponent(value)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action="/orders/track/lookup" method="get" onSubmit={submit} className="space-y-3" noValidate>
      <div>
        <label htmlFor="tracking-token" className="label">کد پیگیری سفارش</label>
        <input
          id="tracking-token"
          name="token"
          value={token}
          onChange={(e) => { setToken(e.target.value); setError(null); }}
          className="field latin-id"
          dir="ltr"
          placeholder="مثال: 3Kq7xY…"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'tracking-error' : undefined}
        />
        {error && <p id="tracking-error" role="alert" className="error-text">{error}</p>}
      </div>
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
        {busy ? 'در حال بررسی…' : 'مشاهدهٔ وضعیت سفارش'}
      </Button>
    </form>
  );
}
