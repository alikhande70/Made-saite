'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, CartIcon, CheckIcon } from './ui';
import { useToast } from './ui/toast';
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
  titleFa,
}: {
  productId: string;
  disabled?: boolean;
  available: number;
  quantity?: number;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  variant?: 'accent' | 'primary';
  /** Named in the confirmation, so a listing tells you *which* part landed. */
  titleFa?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<'idle' | 'added' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

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
        const failure = body.message ?? 'افزودن به سبد خرید انجام نشد.';
        setState('error');
        // Inline *and* toast: a stock conflict on a listing card can otherwise
        // scroll out of view before the customer notices it.
        setMessage(failure);
        toast.show(failure, 'error');
        return;
      }
      setState('added');
      setMessage(null);
      toast.show(`${titleFa ?? 'کالا'} به سبد خرید اضافه شد.`, 'success');
      startTransition(() => router.refresh());
      setTimeout(() => setState('idle'), 2500);
    } catch {
      const offline = 'ارتباط با سرور برقرار نشد. اتصال اینترنت خود را بررسی کنید.';
      setState('error');
      setMessage(offline);
      toast.show(offline, 'error');
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
        loading={busy || pending}
        loadingLabel="در حال افزودن…"
        variant={state === 'added' ? 'primary' : variant}
        size={size}
        className="w-full"
      >
        {state === 'added' ? (
          // `motion-pop` marks the moment the item landed. The words carry the
          // meaning; the movement only draws the eye to them.
          <span className="motion-pop inline-flex items-center gap-2">
            <CheckIcon className="size-4" /> به سبد اضافه شد
          </span>
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
