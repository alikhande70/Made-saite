'use client';

import { useState } from 'react';
import { AddToCartButton } from './add-to-cart';
import { toPersianDigits } from '@/lib/fa';
import { MAX_QUANTITY_PER_LINE } from '@/domain/inventory';

/** Quantity stepper + add-to-cart, used on the product detail page. */
export function QuantityAndAdd({
  productId, available, disabled,
}: { productId: string; available: number; disabled: boolean }) {
  const [quantity, setQuantity] = useState(1);
  const max = Math.max(1, Math.min(available, MAX_QUANTITY_PER_LINE));

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
      <div className="flex items-center rounded-lg border border-line bg-white" role="group" aria-label="تعداد">
        <button
          type="button"
          onClick={() => setQuantity((q) => Math.max(1, q - 1))}
          disabled={disabled || quantity <= 1}
          aria-label="کاهش تعداد"
          className="grid size-11 place-items-center text-lg font-bold text-steel-700 disabled:text-steel-300"
        >
          −
        </button>
        <span
          className="min-w-12 text-center text-base font-bold tabular-nums text-steel-900"
          aria-live="polite"
          aria-label={`تعداد: ${toPersianDigits(quantity)}`}
        >
          {toPersianDigits(quantity)}
        </span>
        <button
          type="button"
          onClick={() => setQuantity((q) => Math.min(max, q + 1))}
          disabled={disabled || quantity >= max}
          aria-label="افزایش تعداد"
          className="grid size-11 place-items-center text-lg font-bold text-steel-700 disabled:text-steel-300"
        >
          +
        </button>
      </div>

      <div className="flex-1">
        <AddToCartButton
          productId={productId}
          available={available}
          quantity={quantity}
          disabled={disabled}
          size="lg"
        />
      </div>
    </div>
  );
}
