'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDate, formatToman, toPersianDigits } from '@/lib/fa';
import { Alert, LatinId } from '../ui';

interface Customer {
  id: string; fullName: string; phone: string; email: string | null;
  isActive: boolean; createdAt: Date; orderCount: number; totalSpent: number;
}

export function CustomerTable({ customers }: { customers: Customer[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(customer: Customer) {
    setBusy(customer.id);
    setError(null);
    try {
      const res = await fetch('/api/admin/customers', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: customer.id, isActive: !customer.isActive }),
      });
      const body = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !body.ok) {
        setError(body.message ?? 'تغییر وضعیت مشتری انجام نشد.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error && <div className="mb-3"><Alert tone="error">{error}</Alert></div>}
      <div className="card scroll-x">
        <table className="w-full text-sm">
          <thead className="bg-steel-50 text-xs">
            <tr>
              <Th>نام</Th><Th>موبایل</Th><Th>ایمیل</Th><Th>سفارش‌ها</Th>
              <Th>مجموع خرید</Th><Th>عضویت</Th><Th>وضعیت</Th><Th>عملیات</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-steel-900">{customer.fullName}</td>
                <td className="px-3 py-2.5"><LatinId className="text-xs">{customer.phone}</LatinId></td>
                <td className="px-3 py-2.5">
                  {customer.email ? <LatinId className="text-xs text-muted">{customer.email}</LatinId> : <span className="text-muted">—</span>}
                </td>
                <td className="px-3 py-2.5 tabular-nums">
                  {customer.orderCount > 0 ? (
                    <Link href={`/admin/orders?q=${encodeURIComponent(customer.phone)}`} className="font-semibold text-steel-700 hover:underline">
                      {toPersianDigits(customer.orderCount)}
                    </Link>
                  ) : (
                    toPersianDigits(0)
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 font-semibold tabular-nums">{formatToman(customer.totalSpent)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">{formatDate(customer.createdAt)}</td>
                <td className="px-3 py-2.5">
                  <span className={`rounded px-2 py-0.5 text-xs font-bold ${
                    customer.isActive ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
                  }`}>
                    {customer.isActive ? 'فعال' : 'مسدود'}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <button type="button" disabled={busy === customer.id} onClick={() => toggle(customer)}
                    className={`text-xs font-semibold hover:underline disabled:opacity-50 ${
                      customer.isActive ? 'text-red-700' : 'text-emerald-700'
                    }`}>
                    {busy === customer.id ? '…' : customer.isActive ? 'مسدود کردن' : 'فعال‌سازی'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        مسدود کردن یک مشتری، همهٔ نشست‌های فعال او را باطل می‌کند و امکان ورود را می‌گیرد.
      </p>
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-start font-bold text-steel-800">{children}</th>;
}
