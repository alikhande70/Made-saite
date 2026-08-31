'use client';

import { useEffect } from 'react';
import { Button, LinkButton } from '@/components/ui';

/**
 * Global error boundary. The user sees a Persian message; the underlying error
 * goes to the server log, never to the page.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[app] render error:', error);
  }, [error]);

  return (
    <div className="container-page flex min-h-[60vh] max-w-lg flex-col items-center justify-center py-10 text-center">
      <h1 className="text-xl font-extrabold text-steel-900">خطای غیرمنتظره‌ای رخ داد</h1>
      <p className="mt-2 text-sm text-muted">
        مشکلی در نمایش این صفحه پیش آمد. لطفاً دوباره تلاش کنید؛ اگر تکرار شد با پشتیبانی تماس بگیرید.
      </p>
      {error.digest && (
        <p className="latin-id mt-2 text-xs text-muted">کد خطا: {error.digest}</p>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button type="button" variant="accent" onClick={reset}>تلاش دوباره</Button>
        <LinkButton href="/" variant="secondary">صفحهٔ اصلی</LinkButton>
      </div>
    </div>
  );
}
