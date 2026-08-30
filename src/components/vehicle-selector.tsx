'use client';

/**
 * The vehicle cascade: برند → مدل → نسل → تیپ → موتور → سال.
 *
 * Two behaviours share the cascade because the fields are identical:
 *  - `mode="activate"` sets the vehicle the whole storefront filters by
 *    (cookie-backed, so guests get it too);
 *  - `mode="garage"`  saves the vehicle to «گاراژ من» for a signed-in customer.
 *
 * Narrowing beyond the model is optional at every step. That is deliberate:
 * a customer who only knows "پژو ۲۰۶" still gets a useful answer, and the
 * compatibility engine reports «اطلاعات کافی نیست» instead of guessing.
 */

import { useEffect, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { VehicleBrandNode } from '@/application/catalog-service';
import { Alert, Button, CarIcon } from './ui';
import { toPersianDigits } from '@/lib/fa';

interface Named { id: string; nameFa: string }
interface Engine extends Named { code: string }
interface Generation extends Named { yearFrom: number | null; yearTo: number | null }

interface ModelDetail {
  generations: Generation[];
  trims: Named[];
  engines: Engine[];
}

export function VehicleSelector({
  vehicles,
  mode = 'activate',
  compact = false,
  submitLabel,
  redirectTo,
  onSaved,
  showNickname = false,
}: {
  vehicles: VehicleBrandNode[];
  mode?: 'activate' | 'garage';
  compact?: boolean;
  submitLabel?: string;
  /** Navigate here after a successful save. Omit to just refresh in place. */
  redirectTo?: string;
  onSaved?: () => void;
  showNickname?: boolean;
}) {
  const router = useRouter();
  const fieldId = useId();
  const [brandSlug, setBrandSlug] = useState('');
  const [modelSlug, setModelSlug] = useState('');
  const [generationId, setGenerationId] = useState('');
  const [trimId, setTrimId] = useState('');
  const [engineId, setEngineId] = useState('');
  const [year, setYear] = useState('');
  const [nickname, setNickname] = useState('');
  const [detail, setDetail] = useState<ModelDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const brand = useMemo(() => vehicles.find((b) => b.slug === brandSlug), [vehicles, brandSlug]);
  const model = useMemo(() => brand?.models.find((m) => m.slug === modelSlug), [brand, modelSlug]);

  const years = useMemo(() => {
    const generation = detail?.generations.find((g) => g.id === generationId);
    const from = generation?.yearFrom ?? model?.yearFrom;
    const to = generation?.yearTo ?? model?.yearTo;
    if (!from || !to) return [];
    const out: number[] = [];
    for (let y = to; y >= from; y -= 1) out.push(y);
    return out;
  }, [detail, generationId, model]);

  // Narrowing options depend on the model, so they are fetched on change.
  useEffect(() => {
    if (!modelSlug) { setDetail(null); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/vehicles/${encodeURIComponent(modelSlug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('load'))))
      .then((body: { data?: ModelDetail }) => { if (!cancelled) setDetail(body.data ?? null); })
      .catch(() => { if (!cancelled) setDetail(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [modelSlug]);

  function resetBelowModel() {
    setGenerationId(''); setTrimId(''); setEngineId(''); setYear('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!model || saving) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        vehicleModelId: model.id,
        vehicleGenerationId: generationId || null,
        vehicleTrimId: trimId || null,
        vehicleEngineId: engineId || null,
        ...(mode === 'garage'
          ? {
              yearFrom: year ? Number(year) : null,
              yearTo: year ? Number(year) : null,
              nickname: nickname.trim() || undefined,
              makeDefault: true,
            }
          : { year: year ? Number(year) : null }),
      };
      const res = await fetch(mode === 'garage' ? '/api/account/garage' : '/api/vehicle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? 'ثبت خودرو انجام نشد. دوباره تلاش کنید.');
      }
      if (mode === 'garage') { setNickname(''); }
      onSaved?.();
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطای ناشناخته');
    } finally {
      setSaving(false);
    }
  }

  const gridClass = compact ? 'space-y-2' : 'grid gap-2 sm:grid-cols-2';

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-strong">
          <CarIcon className="size-4.5" />
        </span>
        <div>
          <p className={`font-extrabold text-steel-900 ${compact ? 'text-sm' : 'text-base'}`}>
            {mode === 'garage' ? 'افزودن خودرو به گاراژ' : 'خودروی خود را انتخاب کنید'}
          </p>
          <p className="text-xs text-muted">
            {mode === 'garage'
              ? 'خودروهای ذخیره‌شده در همهٔ صفحات فروشگاه اعمال می‌شوند.'
              : 'سازگاری قطعات با همین خودرو بررسی می‌شود.'}
          </p>
        </div>
      </div>

      <div className={gridClass}>
        <label className="block">
          <span className="sr-only">برند خودرو</span>
          <select
            id={`${fieldId}-brand`}
            className="field text-sm"
            value={brandSlug}
            onChange={(e) => { setBrandSlug(e.target.value); setModelSlug(''); resetBelowModel(); }}
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
            id={`${fieldId}-model`}
            className="field text-sm"
            value={modelSlug}
            onChange={(e) => { setModelSlug(e.target.value); resetBelowModel(); }}
            disabled={!brand}
          >
            <option value="">۲ — مدل خودرو</option>
            {brand?.models.map((m) => (
              <option key={m.slug} value={m.slug}>{m.nameFa}</option>
            ))}
          </select>
        </label>

        {(detail?.generations.length ?? 0) > 0 && (
          <label className="block">
            <span className="sr-only">نسل خودرو</span>
            <select
              id={`${fieldId}-generation`}
              className="field text-sm"
              value={generationId}
              onChange={(e) => { setGenerationId(e.target.value); setYear(''); }}
            >
              <option value="">نسل (اختیاری)</option>
              {detail?.generations.map((g) => (
                <option key={g.id} value={g.id}>{g.nameFa}</option>
              ))}
            </select>
          </label>
        )}

        {(detail?.trims.length ?? 0) > 0 && (
          <label className="block">
            <span className="sr-only">تیپ خودرو</span>
            <select
              id={`${fieldId}-trim`}
              className="field text-sm"
              value={trimId}
              onChange={(e) => setTrimId(e.target.value)}
            >
              <option value="">تیپ (اختیاری)</option>
              {detail?.trims.map((t) => (
                <option key={t.id} value={t.id}>{t.nameFa}</option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="sr-only">موتور خودرو</span>
          <select
            id={`${fieldId}-engine`}
            className="field text-sm"
            value={engineId}
            onChange={(e) => setEngineId(e.target.value)}
            disabled={!detail || detail.engines.length === 0}
          >
            <option value="">{loading ? 'در حال بارگذاری…' : 'موتور (اختیاری)'}</option>
            {detail?.engines.map((en) => (
              <option key={en.id} value={en.id}>{en.nameFa}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="sr-only">سال ساخت</span>
          <select
            id={`${fieldId}-year`}
            className="field text-sm"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            disabled={years.length === 0}
          >
            <option value="">سال ساخت (اختیاری)</option>
            {years.map((y) => (
              <option key={y} value={y}>{toPersianDigits(y)}</option>
            ))}
          </select>
        </label>

        {showNickname && (
          <label className="block sm:col-span-2">
            <span className="sr-only">نام دلخواه خودرو</span>
            <input
              id={`${fieldId}-nickname`}
              className="field text-sm"
              placeholder="نام دلخواه — مثلاً «۲۰۶ سفید» (اختیاری)"
              value={nickname}
              maxLength={80}
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
        )}
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <Button type="submit" variant="accent" size={compact ? 'md' : 'lg'} className="w-full" disabled={!model || saving}>
        {saving ? 'در حال ثبت…' : (submitLabel ?? (mode === 'garage' ? 'ذخیره در گاراژ' : 'اعمال خودرو'))}
      </Button>
      {!model && <p className="hint text-center">برای ادامه، برند و مدل خودرو را انتخاب کنید.</p>}
    </form>
  );
}
