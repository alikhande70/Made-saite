'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, CartIcon, CheckIcon } from './ui';
import { toPersianDigits } from '@/lib/fa';

/**
 * Add-to-cart control. Posts to the JSON API and refreshes server components so
 * the header badge and cart page stay in step. Errors from the server are shown
 * verbatim — they are already Persian and user-safe.
 */
export function AddToCartButton({
  productId,
  disabled = false,
  available,
  quantity = 1,
  size = 'md',
  label = 'افزودن به سبد خرید',
  variant = 'accent',
}: {
  productId: string;
  disabled?: boolean;
  available: number;
  quantity?: number;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  variant?: 'accent' | 'primary';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<'idle' | 'added' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/cart/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId, quantity }),
      });
      const body = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !body.ok) {
        setState('error');
        setMessage(body.message ?? 'افزودن به سبد خرید انجام نشد.');
        return;
      }
      setState('added');
      setMessage(null);
      startTransition(() => router.refresh());
      setTimeout(() => setState('idle'), 2500);
    } catch {
      setState('error');
      setMessage('ارتباط با سرور برقرار نشد. اتصال اینترنت خود را بررسی کنید.');
    } finally {
      setBusy(false);
    }
  }

  if (disabled) {
    return (
      <Button type="button" variant="secondary" size={size} disabled className="w-full">
        ناموجود
      </Button>
    );
  }

  return (
    <div className="w-full">
      <Button
        type="button"
        onClick={add}
        disabled={busy || pending}
        variant={state === 'added' ? 'primary' : variant}
        size={size}
        className="w-full"
        aria-live="polite"
      >
        {state === 'added' ? (
          <>
            <CheckIcon className="size-4" /> به سبد اضافه شد
          </>
        ) : busy || pending ? (
          'در حال افزودن…'
        ) : (
          <>
            <CartIcon className="size-4" /> {label}
          </>
        )}
      </Button>
      {message && (
        <p role="alert" className="error-text">{message}</p>
      )}
      {available > 0 && available <= 3 && !message && (
        <p className="hint">تنها {toPersianDigits(available)} عدد موجود است.</p>
      )}
    </div>
  );
}
