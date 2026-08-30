'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { VehicleBrandNode } from '@/application/catalog-service';
import { Button, CarIcon } from './ui';
import { toPersianDigits } from '@/lib/fa';

interface Engine {
  id: string;
  code: string;
  nameFa: string;
}

/**
 * Vehicle → model → year → engine selector.
 *
 * Engines are fetched per model because the list depends on the selection;
 * the brand/model tree is small enough to ship with the page.
 */
export function VehiclePicker({
  vehicles,
  compact = false,
}: {
  vehicles: VehicleBrandNode[];
  compact?: boolean;
}) {
  const router = useRouter();
  const [brandSlug, setBrandSlug] = useState('');
  const [modelSlug, setModelSlug] = useState('');
  const [year, setYear] = useState('');
  const [engineCode, setEngineCode] = useState('');
  const [engines, setEngines] = useState<Engine[]>([]);
  const [loadingEngines, setLoadingEngines] = useState(false);

  const brand = useMemo(() => vehicles.find((b) => b.slug === brandSlug), [vehicles, brandSlug]);
  const model = useMemo(() => brand?.models.find((m) => m.slug === modelSlug), [brand, modelSlug]);

  const years = useMemo(() => {
    if (!model?.yearFrom || !model.yearTo) return [];
    const out: number[] = [];
    for (let y = model.yearTo; y >= model.yearFrom; y -= 1) out.push(y);
    return out;
  }, [model]);

  async function onModelChange(slug: string) {
    setModelSlug(slug);
    setYear('');
    setEngineCode('');
    setEngines([]);
    if (!slug) return;
    setLoadingEngines(true);
    try {
      const res = await fetch(`/api/vehicles/${encodeURIComponent(slug)}/engines`);
      if (res.ok) {
        const body = (await res.json()) as { data?: Engine[] };
        setEngines(body.data ?? []);
      }
    } catch {
      /* engine narrowing is optional; the model filter still works */
    } finally {
      setLoadingEngines(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!modelSlug) return;
    const params = new URLSearchParams({ vehicleModel: modelSlug });
    if (engineCode) params.set('vehicleEngine', engineCode);
    if (year) params.set('vehicleYear', year);
    router.push(`/products?${params.toString()}`);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-signal-100 text-signal-700">
          <CarIcon className="size-4.5" />
        </span>
        <div>
          <p className={`font-extrabold text-steel-900 ${compact ? 'text-sm' : 'text-base'}`}>
            انتخاب قطعه بر اساس خودرو
          </p>
          <p className="text-xs text-muted">فقط قطعات سازگار با خودروی شما نمایش داده می‌شود</p>
        </div>
      </div>

      <div className={compact ? 'space-y-2' : 'grid gap-2 sm:grid-cols-2'}>
        <label className="block">
          <span className="sr-only">برند خودرو</span>
          <select
            className="field text-sm"
            value={brandSlug}
            onChange={(e) => { setBrandSlug(e.target.value); setModelSlug(''); setYear(''); setEngineCode(''); setEngines([]); }}
          >
            <option value="">۱ — برند خودرو</option>
            {vehicles.map((b) => (
              <option key={b.slug} value={b.slug}>{b.nameFa}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="sr-only">مدل خودرو</span>
          <select
            className="field text-sm"
            value={modelSlug}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={!brand}
          >
            <option value="">۲ — مدل خودرو</option>
            {brand?.models.map((m) => (
              <option key={m.slug} value={m.slug}>{m.nameFa}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="sr-only">سال ساخت</span>
          <select
            className="field text-sm"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            disabled={years.length === 0}
          >
            <option value="">۳ — سال ساخت (اختیاری)</option>
            {years.map((y) => (
              <option key={y} value={y}>{toPersianDigits(y)}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="sr-only">موتور یا تیپ</span>
          <select
            className="field text-sm"
            value={engineCode}
            onChange={(e) => setEngineCode(e.target.value)}
            disabled={engines.length === 0}
          >
            <option value="">
              {loadingEngines ? 'در حال بارگذاری…' : '۴ — موتور / تیپ (اختیاری)'}
            </option>
            {engines.map((en) => (
              <option key={en.id} value={en.code}>{en.nameFa}</option>
            ))}
          </select>
        </label>
      </div>

      <Button type="submit" variant="signal" size={compact ? 'md' : 'lg'} className="w-full" disabled={!modelSlug}>
        نمایش قطعات سازگار
      </Button>
      {!modelSlug && <p className="hint text-center">برای ادامه، برند و مدل خودرو را انتخاب کنید.</p>}
    </form>
  );
}
