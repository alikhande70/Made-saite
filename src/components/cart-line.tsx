'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { CartLine as CartLineData } from '@/application/cart-service';
import { formatToman, toPersianDigits } from '@/lib/fa';
import { MAX_QUANTITY_PER_LINE } from '@/domain/inventory';
import { LatinId, TrashIcon } from './ui';

/**
 * One cart row with a quantity stepper. Every change round-trips to the server,
 * which re-validates stock and returns the authoritative line totals.
 */
export function CartLineRow({ line }: { line: CartLineData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const max = Math.min(Math.max(line.quantityAvailable, 0), MAX_QUANTITY_PER_LINE);

  async function setQuantity(quantity: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/cart/items', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId: line.productId, quantity }),
      });
      const body = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !body.ok) {
        setError(body.message ?? 'به‌روزرسانی سبد خرید انجام نشد.');
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError('ارتباط با سرور برقرار نشد.');
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || pending;

  return (
    <li className="flex gap-3 py-4 sm:gap-4">
      <Link
        href={`/products/${encodeURIComponent(line.slug)}`}
        className="size-20 shrink-0 overflow-hidden rounded-lg border border-line bg-white sm:size-24"
      >
        { }
        <img src={line.imageUrl ?? '/demo/engine-part.svg'} alt="" loading="lazy" className="size-full object-contain" />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {line.brandName && <p className="text-xs font-semibold text-steel-500">{line.brandName}</p>}
            <h3 className="text-sm font-bold leading-6 text-steel-900">
              <Link href={`/products/${encodeURIComponent(line.slug)}`} className="line-clamp-2 hover:underline">
                {line.titleFa}
              </Link>
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              کد کالا: <LatinId>{line.sku}</LatinId>
            </p>
          </div>

          <button
            type="button"
            onClick={() => setQuantity(0)}
            disabled={disabled}
            aria-label={`حذف ${line.titleFa} از سبد خرید`}
            className="shrink-0 rounded-lg p-2 text-steel-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          >
            <TrashIcon className="size-4.5" />
          </button>
        </div>

        {!line.isActive && (
          <p role="alert" className="error-text">این کالا دیگر در فروشگاه موجود نیست؛ لطفاً آن را حذف کنید.</p>
        )}
        {line.isActive && line.quantityAvailable < line.quantity && (
          <p role="alert" className="error-text">
            تنها {toPersianDigits(line.quantityAvailable)} عدد موجود است.
          </p>
        )}
        {error && <p role="alert" className="error-text">{error}</p>}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center rounded-lg border border-line bg-white" role="group" aria-label={`تعداد ${line.titleFa}`}>
            <button
              type="button"
              onClick={() => setQuantity(line.quantity - 1)}
              disabled={disabled || line.quantity <= 1}
              aria-label="کاهش تعداد"
              className="grid size-9 place-items-center font-bold text-steel-700 disabled:text-steel-300"
            >
              −
            </button>
            <span className="min-w-9 text-center text-sm font-bold tabular-nums" aria-live="polite">
              {toPersianDigits(line.quantity)}
            </span>
            <button
              type="button"
              onClick={() => setQuantity(line.quantity + 1)}
              disabled={disabled || line.quantity >= max}
              aria-label="افزایش تعداد"
              className="grid size-9 place-items-center font-bold text-steel-700 disabled:text-steel-300"
            >
              +
            </button>
          </div>

          <div className="text-end">
            {line.listPrice > line.unitPrice && (
              <p className="text-xs text-muted line-through">{formatToman(line.listPrice * line.quantity)}</p>
            )}
            <p className="text-base font-extrabold text-steel-900">{formatToman(line.lineTotal)}</p>
            {line.quantity > 1 && (
              <p className="text-xs text-muted">هر عدد {formatToman(line.unitPrice)}</p>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
