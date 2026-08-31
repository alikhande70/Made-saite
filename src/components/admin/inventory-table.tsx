'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toLatinDigits, toPersianDigits } from '@/lib/fa';
import { Alert, Button, LatinId, Pagination } from '../ui';

interface Row {
  id: string;
  sku: string;
  titleFa: string;
  imageUrl: string | null;
  quantityOnHand: number;
  quantityReserved: number;
  lowStockThreshold: number;
  isActive: boolean;
}

/**
 * Stock adjustment grid. A reason is mandatory — every movement lands in
 * `inventory_events` as an audit record.
 */
export function InventoryTable({ items, page, totalPages }: { items: Row[]; page: number; totalPages: number }) {
  const router = useRouter();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [threshold, setThreshold] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(productId: string) {
    const parsedDelta = Number(toLatinDigits(delta).replace(/[^\d-]/g, ''));
    if (!Number.isInteger(parsedDelta) || parsedDelta === 0) {
      setError('مقدار تغییر باید عددی صحیح و مخالف صفر باشد (مثال: ۱۰ یا ‎-۳).');
      return;
    }
    if (reason.trim().length < 3) {
      setError('دلیل تغییر موجودی الزامی است.');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const parsedThreshold = threshold.trim()
        ? Number(toLatinDigits(threshold).replace(/\D/g, ''))
        : undefined;

      const res = await fetch('/api/admin/inventory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          productId, delta: parsedDelta, reason: reason.trim(),
          ...(parsedThreshold !== undefined && Number.isFinite(parsedThreshold) ? { lowStockThreshold: parsedThreshold } : {}),
        }),
      });
      const body = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !body.ok) {
        setError(body.message ?? 'تغییر موجودی انجام نشد.');
        return;
      }
      setNotice('موجودی به‌روزرسانی شد.');
      setOpenFor(null);
      setDelta('');
      setReason('');
      setThreshold('');
      router.refresh();
    } catch {
      setError('ارتباط با سرور برقرار نشد.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {notice && <div className="mb-3"><Alert tone="success">{notice}</Alert></div>}

      <div className="card scroll-x">
        <table className="w-full text-sm">
          <thead className="bg-steel-50 text-xs">
            <tr>
              <Th>کالا</Th><Th>کد</Th><Th>در انبار</Th><Th>رزرو‌شده</Th>
              <Th>قابل فروش</Th><Th>آستانه</Th><Th>عملیات</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((item) => {
              const available = Math.max(0, item.quantityOnHand - item.quantityReserved);
              const low = available <= item.lowStockThreshold;
              return (
                <tr key={item.id} className={openFor === item.id ? 'bg-steel-50/70' : undefined}>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      { }
                      <img src={item.imageUrl ?? '/demo/engine-part.svg'} alt="" loading="lazy"
                        className="size-9 shrink-0 rounded-md border border-line object-contain" />
                      <Link href={`/admin/products/${item.id}`} className="font-semibold text-steel-800 hover:underline">
                        {item.titleFa}
                      </Link>
                      {!item.isActive && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.625rem] font-bold text-slate-600">پیش‌نویس</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5"><LatinId className="text-xs">{item.sku}</LatinId></td>
                  <td className="px-3 py-2.5 tabular-nums">{toPersianDigits(item.quantityOnHand)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-muted">{toPersianDigits(item.quantityReserved)}</td>
                  <td className={`px-3 py-2.5 font-bold tabular-nums ${low ? 'text-amber-700' : 'text-steel-900'}`}>
                    {toPersianDigits(available)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-muted">{toPersianDigits(item.lowStockThreshold)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setOpenFor(openFor === item.id ? null : item.id);
                        setThreshold(String(item.lowStockThreshold));
                        setError(null);
                      }}
                      className="text-xs font-semibold text-steel-700 hover:underline"
                    >
                      {openFor === item.id ? 'بستن' : 'تغییر موجودی'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openFor && (
        <div className="card mt-4 p-5">
          <h3 className="mb-1 text-sm font-extrabold text-steel-900">ثبت تغییر موجودی</h3>
          <p className="mb-4 text-xs text-muted">
            {items.find((i) => i.id === openFor)?.titleFa}
          </p>

          {error && <div className="mb-3"><Alert tone="error">{error}</Alert></div>}

          <div className="grid gap-3 sm:grid-cols-[8rem_8rem_1fr_auto] sm:items-end">
            <div>
              <label htmlFor="inv-delta" className="label">مقدار تغییر</label>
              <input id="inv-delta" inputMode="numeric" className="field h-10 tabular-nums" value={delta}
                onChange={(e) => setDelta(e.target.value)} placeholder="۱۰ یا ‎-۳" />
            </div>
            <div>
              <label htmlFor="inv-threshold" className="label">آستانهٔ هشدار</label>
              <input id="inv-threshold" inputMode="numeric" className="field h-10 tabular-nums" value={threshold}
                onChange={(e) => setThreshold(e.target.value)} />
            </div>
            <div>
              <label htmlFor="inv-reason" className="label">دلیل (الزامی)</label>
              <input id="inv-reason" className="field h-10" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="مثال: ورود کالا از تأمین‌کننده / انبارگردانی / ضایعات" />
            </div>
            <Button type="button" variant="primary" disabled={busy} onClick={() => submit(openFor)}>
              {busy ? 'در حال ثبت…' : 'ثبت'}
            </Button>
          </div>
          <p className="hint mt-2">عدد مثبت به موجودی اضافه و عدد منفی از آن کم می‌کند. کاهش زیر مقدار رزروشده مجاز نیست.</p>
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} buildHref={(p) => `?page=${p}`} />
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-start font-bold text-steel-800">{children}</th>;
}
