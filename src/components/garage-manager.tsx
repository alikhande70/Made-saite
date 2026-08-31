'use client';

/**
 * «گاراژ من» — add, remove and switch between saved vehicles.
 *
 * The list is server-rendered first and then kept in sync client-side, so the
 * page is useful before hydration. Every mutation goes through the API, which
 * scopes ownership in its WHERE clause — the ids rendered here are not a
 * permission grant.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { VehicleBrandNode } from '@/application/catalog-service';
import type { GarageVehicle } from '@/application/garage-service';
import { VehicleSelector } from './vehicle-selector';
import { Alert, Button, CarIcon, CheckIcon, EmptyState, TrashIcon } from './ui';
import { vehicleLabel } from '@/lib/vehicle-label';
import { toPersianDigits } from '@/lib/fa';

export function GarageManager({
  initialGarage,
  vehicles,
  maxVehicles,
}: {
  initialGarage: GarageVehicle[];
  vehicles: VehicleBrandNode[];
  maxVehicles: number;
}) {
  const router = useRouter();
  const [garage, setGarage] = useState(initialGarage);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(initialGarage.length === 0);

  const full = garage.length >= maxVehicles;

  async function refresh() {
    const res = await fetch('/api/account/garage');
    if (res.ok) {
      const body = (await res.json()) as { data?: GarageVehicle[] };
      setGarage(body.data ?? []);
    }
    router.refresh();
  }

  async function makeDefault(vehicleId: string) {
    setBusyId(vehicleId);
    setError(null);
    try {
      const res = await fetch('/api/account/garage', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vehicleId }),
      });
      if (!res.ok) throw new Error('تغییر خودروی فعال انجام نشد.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطای ناشناخته');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(vehicleId: string) {
    setBusyId(vehicleId);
    setError(null);
    try {
      const res = await fetch(`/api/account/garage?id=${encodeURIComponent(vehicleId)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('حذف خودرو انجام نشد.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطای ناشناخته');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      {error && <Alert tone="error">{error}</Alert>}

      {garage.length === 0 ? (
        <EmptyState
          title="هنوز خودرویی ذخیره نکرده‌اید"
          description="با افزودن خودرو، سازگاری هر قطعه با خودروی شما به‌صورت خودکار بررسی می‌شود."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {garage.map((v) => (
            <li
              key={v.id}
              className={`card lift p-4 ${v.isDefault ? 'ring-2 ring-accent-600' : ''}`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                    v.isDefault ? 'bg-accent-600 text-white' : 'bg-steel-100 text-steel-500'
                  }`}
                >
                  <CarIcon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  {v.nickname && (
                    <p className="truncate text-sm font-extrabold text-steel-900">{v.nickname}</p>
                  )}
                  <p className={`text-sm ${v.nickname ? 'text-muted' : 'font-extrabold text-steel-900'}`}>
                    {vehicleLabel(v.configuration)}
                  </p>
                  {v.isDefault && (
                    <p className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-accent-700">
                      <CheckIcon className="size-3.5" />
                      خودروی فعال
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                {!v.isDefault && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={busyId === v.id}
                    onClick={() => makeDefault(v.id)}
                  >
                    انتخاب به‌عنوان خودروی فعال
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busyId === v.id}
                  onClick={() => remove(v.id)}
                  aria-label={`حذف ${v.nickname ?? vehicleLabel(v.configuration)}`}
                >
                  <TrashIcon className="size-4" />
                  حذف
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {full ? (
        <Alert tone="info">
          حداکثر {toPersianDigits(maxVehicles)} خودرو می‌توانید ذخیره کنید. برای افزودن خودروی جدید، یکی را حذف کنید.
        </Alert>
      ) : adding ? (
        <div className="card p-4 sm:p-5">
          <VehicleSelector
            vehicles={vehicles}
            mode="garage"
            showNickname
            submitLabel="ذخیره در گاراژ"
            onSaved={() => { void refresh(); setAdding(garage.length === 0); }}
          />
        </div>
      ) : (
        <Button type="button" variant="accent" onClick={() => setAdding(true)}>
          افزودن خودروی جدید
        </Button>
      )}
    </div>
  );
}
