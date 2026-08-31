'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Publish / unpublish a product from the list without opening the edit form. */
export function ProductActiveToggle({ productId, isActive }: { productId: string; isActive: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/admin/products/${productId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isActive: !isActive }),
        });
        setBusy(false);
        router.refresh();
      }}
      className={`text-xs font-semibold hover:underline disabled:opacity-50 ${
        isActive ? 'text-slate-600' : 'text-emerald-700'
      }`}
    >
      {busy ? '…' : isActive ? 'پیش‌نویس' : 'انتشار'}
    </button>
  );
}
