'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Clears the browsing vehicle. The cookie is cleared server-side by DELETE. */
export function ClearVehicleButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function clear() {
    setBusy(true);
    try {
      await fetch('/api/vehicle', { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={clear}
      disabled={busy}
      className="font-bold text-steel-600 hover:text-steel-900 disabled:opacity-50"
    >
      حذف
    </button>
  );
}
