'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './ui';

/**
 * Adds a past order's lines back into the cart, one call per line so that a
 * single unavailable item does not block the rest.
 */
export function ReorderButton({
  items,
}: {
  items: { productId: string; quantity: number; titleFa: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function reorder() {
    setBusy(true);
    setMessage(null);
    const failed: string[] = [];

    for (const item of items) {
      try {
        const res = await fetch('/api/cart/items', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ productId: item.productId, quantity: item.quantity }),
        });
        if (!res.ok) failed.push(item.titleFa);
      } catch {
        failed.push(item.titleFa);
      }
    }

    setBusy(false);
    if (failed.length === items.length) {
      setMessage('هیچ‌کدام از کالاهای این سفارش در حال حاضر قابل خرید نیستند.');
      return;
    }
    if (failed.length > 0) {
      setMessage(`این کالاها اضافه نشدند: ${failed.join('، ')}`);
    }
    router.push('/cart');
    router.refresh();
  }

  return (
    <div>
      <Button type="button" variant="accent" size="sm" onClick={reorder} disabled={busy}>
        {busy ? 'در حال افزودن…' : 'سفارش مجدد'}
      </Button>
      {message && <p role="alert" className="error-text max-w-xs">{message}</p>}
    </div>
  );
}
