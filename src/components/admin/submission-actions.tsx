'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';

/**
 * The two actions an operator needs when submissions go wrong: put failures
 * back in the queue, and drain it now instead of waiting for the next sweep.
 *
 * Neither is destructive, so neither asks for confirmation — but both report
 * what actually happened rather than assuming success, because "retried" with
 * nothing requeued is the answer to a different question than "retried 12".
 */
export function SubmissionActions({
  adapterId,
  disabled,
}: {
  adapterId: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function run(action: 'retryFailed' | 'drainNow') {
    setMessage(null);
    try {
      const response = await fetch('/api/admin/search-visibility', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, adapter: adapterId }),
      });
      const body = (await response.json()) as {
        ok: boolean;
        message?: string;
        data?: { requeued?: number; succeeded?: number; failed?: number };
      };
      if (!response.ok || !body.ok) {
        setMessage({ tone: 'error', text: body.message ?? 'انجام نشد.' });
        return;
      }
      const text =
        action === 'retryFailed'
          ? `${body.data?.requeued ?? 0} ارسال دوباره در صف قرار گرفت.`
          : `صف پردازش شد: ${body.data?.succeeded ?? 0} موفق، ${body.data?.failed ?? 0} ناموفق.`;
      setMessage({ tone: 'ok', text });
      startTransition(() => router.refresh());
    } catch {
      setMessage({ tone: 'error', text: 'ارتباط با سرور برقرار نشد.' });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button" variant="secondary" size="sm" disabled={disabled || pending}
        onClick={() => void run('drainNow')}
      >
        پردازش صف
      </Button>
      <Button
        type="button" variant="ghost" size="sm" disabled={disabled || pending}
        onClick={() => void run('retryFailed')}
      >
        تلاش دوباره برای ناموفق‌ها
      </Button>
      {message && (
        <span
          role="status"
          className={`text-xs ${message.tone === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}
        >
          {message.text}
        </span>
      )}
    </div>
  );
}
