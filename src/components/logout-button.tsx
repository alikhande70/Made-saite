'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/auth/logout', { method: 'POST' });
        router.push('/');
        router.refresh();
      }}
      className="w-full rounded-lg px-3 py-2 text-start text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60"
    >
      {busy ? 'در حال خروج…' : 'خروج از حساب'}
    </button>
  );
}
