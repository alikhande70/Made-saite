'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OrderStatus } from '@/domain/order-status';
import { Alert, Button, LatinId } from '../ui';

/**
 * Admin order controls. The buttons offered come from the domain state machine
 * (`allowedTransitions`), and the server validates the move again — the UI is a
 * convenience, never the authority.
 */
export function OrderActions({
  orderId, status, allowed, labels, trackingCode, carrier, paymentProvider, paymentStatus,
}: {
  orderId: string;
  status: OrderStatus;
  allowed: OrderStatus[];
  labels: Record<OrderStatus, string>;
  trackingCode: string | null;
  carrier: string | null;
  paymentProvider: string;
  paymentStatus: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tracking, setTracking] = useState(trackingCode ?? '');
  const [carrierName, setCarrierName] = useState(carrier ?? '');

  async function post(body: unknown, successMessage: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as { ok: boolean; message?: string; data?: { trackingCode?: string | null } };
      if (!res.ok || !payload.ok) {
        setError(payload.message ?? 'انجام عملیات ممکن نشد.');
        return;
      }
      if (payload.data?.trackingCode) setTracking(payload.data.trackingCode);
      setNotice(successMessage);
      router.refresh();
    } catch {
      setError('ارتباط با سرور برقرار نشد.');
    } finally {
      setBusy(false);
    }
  }

  const destructive = new Set<OrderStatus>(['CANCELLED', 'REFUNDED']);
  const showCashSettle = paymentProvider === 'cod' && paymentStatus === 'INITIATED';

  return (
    <div className="card space-y-4 p-5">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div>
        <h2 className="mb-2 text-sm font-extrabold text-steel-900">تغییر وضعیت سفارش</h2>
        {allowed.length === 0 ? (
          <p className="text-sm text-muted">
            این سفارش در وضعیت نهایی «{labels[status]}» است و تغییر وضعیت دیگری ندارد.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {allowed.map((next) => (
              <Button
                key={next}
                type="button"
                size="sm"
                variant={destructive.has(next) ? 'danger' : 'primary'}
                disabled={busy}
                onClick={() => post({ action: 'transition', status: next }, `وضعیت سفارش به «${labels[next]}» تغییر کرد.`)}
              >
                {labels[next]}
              </Button>
            ))}
          </div>
        )}
      </div>

      {showCashSettle && (
        <div className="border-t border-line pt-4">
          <h2 className="mb-2 text-sm font-extrabold text-steel-900">پرداخت در محل</h2>
          <p className="mb-2 text-xs text-muted">مبلغ این سفارش هنوز دریافت نشده است.</p>
          <Button
            type="button" size="sm" variant="secondary" disabled={busy}
            onClick={() => post({ action: 'settle-cash' }, 'دریافت وجه ثبت شد.')}
          >
            ثبت دریافت وجه
          </Button>
        </div>
      )}

      <div className="border-t border-line pt-4">
        <h2 className="mb-2 text-sm font-extrabold text-steel-900">کد رهگیری مرسوله</h2>
        {tracking && (
          <p className="mb-2 text-sm">
            کد فعلی: <LatinId className="font-bold">{tracking}</LatinId>
          </p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1">
            <label htmlFor="carrier" className="label">شرکت حمل</label>
            <input id="carrier" className="field h-10" value={carrierName}
              onChange={(e) => setCarrierName(e.target.value)} placeholder="مثال: پست پیشتاز" />
          </div>
          <div className="min-w-40 flex-1">
            <label htmlFor="tracking" className="label">کد رهگیری</label>
            <input id="tracking" dir="ltr" className="field latin-id h-10" value={tracking}
              onChange={(e) => setTracking(e.target.value)} placeholder="۱۶ رقم" />
          </div>
          <Button
            type="button" size="md" variant="secondary" disabled={busy}
            onClick={() => post({ action: 'tracking', carrier: carrierName, trackingCode: tracking }, 'کد رهگیری ذخیره شد.')}
          >
            ذخیره
          </Button>
          <Button
            type="button" size="md" variant="ghost" disabled={busy}
            onClick={() => post({ action: 'tracking', carrier: carrierName, generate: true }, 'کد رهگیری تولید شد.')}
          >
            تولید خودکار
          </Button>
        </div>
      </div>
    </div>
  );
}
