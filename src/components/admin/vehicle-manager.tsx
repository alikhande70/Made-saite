'use client';

/**
 * Vehicle taxonomy editor.
 *
 * Every row shows how many fitments and saved customer vehicles depend on it,
 * because the destructive action here is not obviously destructive: deleting a
 * model cascades through configurations to fitments, so a product that said
 * «سازگار» would start saying «اطلاعات کافی نیست» with nobody having decided
 * that. The server refuses such a delete; the UI shows the counts so the
 * refusal is never a surprise.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminVehicleBrand, AdminVehicleModel } from '@/application/vehicle-admin-service';
import { Alert, Button, ChevronDown, LatinId, TrashIcon } from '../ui';
import { formatYearRange, toPersianDigits } from '@/lib/fa';

type Kind = 'brand' | 'model' | 'generation' | 'trim' | 'engine';

interface Child { id: string; code: string; nameFa: string; isActive: boolean }
interface ModelDetail { generations: Child[]; trims: Child[]; engines: Child[] }

export function VehicleTaxonomyManager({ initialTaxonomy }: { initialTaxonomy: AdminVehicleBrand[] }) {
  const router = useRouter();
  const [taxonomy, setTaxonomy] = useState(initialTaxonomy);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openModelId, setOpenModelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ModelDetail | null>(null);
  const [addingBrand, setAddingBrand] = useState(false);
  const [addingModelFor, setAddingModelFor] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch('/api/admin/vehicles');
    if (res.ok) {
      const body = (await res.json()) as { data?: AdminVehicleBrand[] };
      setTaxonomy(body.data ?? []);
    }
    router.refresh();
  }

  async function send(body: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/vehicles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(payload.message ?? 'ثبت انجام نشد.');
      setNotice(successMessage);
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطای ناشناخته');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(kind: Kind, id: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/vehicles?kind=${kind}&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const payload = (await res.json()) as { message?: string };
      // A refusal carries the dependant counts, so it is shown verbatim.
      if (!res.ok) throw new Error(payload.message ?? 'حذف انجام نشد.');
      setNotice('حذف شد.');
      if (openModelId) await openModel(openModelId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطای ناشناخته');
    } finally {
      setBusy(false);
    }
  }

  async function openModel(modelId: string) {
    setOpenModelId(modelId);
    setDetail(null);
    const model = taxonomy.flatMap((b) => b.models).find((m) => m.id === modelId);
    if (!model) return;
    const res = await fetch(`/api/vehicles/${encodeURIComponent(model.slug)}`);
    if (res.ok) {
      const body = (await res.json()) as { data?: ModelDetail };
      setDetail(body.data ?? null);
    }
  }

  async function toggleActive(kind: 'brand' | 'model', row: AdminVehicleBrand | AdminVehicleModel, brandId?: string) {
    const base = kind === 'brand'
      ? { kind, id: row.id, nameFa: row.nameFa, nameEn: row.nameEn, isActive: !row.isActive }
      : {
          kind, id: row.id, vehicleBrandId: brandId!, nameFa: row.nameFa, nameEn: row.nameEn,
          yearFrom: (row as AdminVehicleModel).yearFrom, yearTo: (row as AdminVehicleModel).yearTo,
          isActive: !row.isActive,
        };
    await send(base, row.isActive ? 'غیرفعال شد.' : 'فعال شد.');
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error" title="انجام نشد">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="accent" onClick={() => setAddingBrand((v) => !v)}>
          {addingBrand ? 'انصراف' : 'افزودن برند خودرو'}
        </Button>
      </div>

      {addingBrand && (
        <EntityForm
          title="برند خودروی جدید"
          fields={[
            { key: 'nameFa', label: 'نام فارسی', required: true },
            { key: 'nameEn', label: 'نام انگلیسی (اختیاری)', ltr: true },
          ]}
          busy={busy}
          onSubmit={async (values) => {
            const ok = await send({ kind: 'brand', ...values }, 'برند ثبت شد.');
            if (ok) setAddingBrand(false);
          }}
        />
      )}

      {taxonomy.length === 0 ? (
        <p className="card p-5 text-sm text-muted">هنوز برند خودرویی ثبت نشده است.</p>
      ) : (
        <div className="space-y-4">
          {taxonomy.map((brand) => (
            <section key={brand.id} className="card overflow-hidden">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-steel-50 px-4 py-3">
                <div>
                  <h2 className="text-sm font-extrabold text-steel-900">
                    {brand.nameFa}
                    {brand.nameEn && <LatinId className="ms-2 text-xs font-normal text-muted">{brand.nameEn}</LatinId>}
                    {!brand.isActive && (
                      <span className="ms-2 rounded bg-steel-200 px-1.5 py-0.5 text-[0.6875rem] font-bold text-steel-700">
                        غیرفعال
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-muted">{toPersianDigits(brand.models.length)} مدل</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" size="sm" disabled={busy}
                    onClick={() => setAddingModelFor(addingModelFor === brand.id ? null : brand.id)}>
                    افزودن مدل
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={busy}
                    onClick={() => toggleActive('brand', brand)}>
                    {brand.isActive ? 'غیرفعال کردن' : 'فعال کردن'}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={busy}
                    onClick={() => remove('brand', brand.id)} aria-label={`حذف ${brand.nameFa}`}>
                    <TrashIcon className="size-4" />
                  </Button>
                </div>
              </header>

              {addingModelFor === brand.id && (
                <div className="border-b border-line p-4">
                  <EntityForm
                    title={`مدل جدید برای ${brand.nameFa}`}
                    fields={[
                      { key: 'nameFa', label: 'نام فارسی', required: true },
                      { key: 'nameEn', label: 'نام انگلیسی (اختیاری)', ltr: true },
                      { key: 'yearFrom', label: 'از سال (شمسی)', numeric: true },
                      { key: 'yearTo', label: 'تا سال (شمسی)', numeric: true },
                    ]}
                    busy={busy}
                    onSubmit={async (values) => {
                      const ok = await send({ kind: 'model', vehicleBrandId: brand.id, ...values }, 'مدل ثبت شد.');
                      if (ok) setAddingModelFor(null);
                    }}
                  />
                </div>
              )}

              {brand.models.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted">مدلی برای این برند ثبت نشده است.</p>
              ) : (
                <div className="scroll-x">
                  <table className="spec-table">
                    <caption className="sr-only">مدل‌های {brand.nameFa}</caption>
                    <thead className="text-xs">
                      <tr>
                        <th scope="col" className="font-bold text-steel-800">مدل</th>
                        <th scope="col" className="font-bold text-steel-800">سال‌های تولید</th>
                        <th scope="col" className="font-bold text-steel-800">نسل / تیپ / موتور</th>
                        <th scope="col" className="font-bold text-steel-800">رکورد سازگاری</th>
                        <th scope="col" className="font-bold text-steel-800">اقدام</th>
                      </tr>
                    </thead>
                    <tbody>
                      {brand.models.map((model) => (
                        <tr key={model.id} className={model.isActive ? undefined : 'opacity-60'}>
                          <td>
                            {model.nameFa}
                            <LatinId className="mt-0.5 block text-xs font-normal text-muted">{model.slug}</LatinId>
                          </td>
                          <td className="whitespace-nowrap font-normal text-muted">
                            {formatYearRange(model.yearFrom, model.yearTo)}
                          </td>
                          <td className="whitespace-nowrap font-normal tabular-nums text-muted">
                            {toPersianDigits(model.generationCount)} / {toPersianDigits(model.trimCount)} / {toPersianDigits(model.engineCount)}
                          </td>
                          <td className="whitespace-nowrap font-normal tabular-nums">
                            {model.fitmentCount > 0 ? (
                              <span className="font-bold text-steel-900">{toPersianDigits(model.fitmentCount)}</span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td>
                            <div className="flex flex-wrap gap-1">
                              <Button type="button" variant="ghost" size="sm"
                                onClick={() => (openModelId === model.id ? setOpenModelId(null) : openModel(model.id))}>
                                جزئیات
                                <ChevronDown className={`size-4 ${openModelId === model.id ? 'rotate-180' : ''}`} />
                              </Button>
                              <Button type="button" variant="ghost" size="sm" disabled={busy}
                                onClick={() => toggleActive('model', model, brand.id)}>
                                {model.isActive ? 'غیرفعال' : 'فعال'}
                              </Button>
                              <Button type="button" variant="ghost" size="sm" disabled={busy}
                                onClick={() => remove('model', model.id)} aria-label={`حذف ${model.nameFa}`}>
                                <TrashIcon className="size-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {openModelId && brand.models.some((m) => m.id === openModelId) && (
                <div className="border-t border-line bg-steel-50/60 p-4">
                  {detail === null ? (
                    <p className="text-sm text-muted">در حال بارگذاری…</p>
                  ) : (
                    <div className="grid gap-4 lg:grid-cols-3">
                      <ChildPanel
                        title="نسل‌ها" rows={detail.generations} busy={busy}
                        onAdd={async (v) => { await send({ kind: 'generation', vehicleModelId: openModelId, ...v }, 'نسل ثبت شد.'); }}
                        onRemove={(id) => remove('generation', id)}
                        extraFields={[
                          { key: 'yearFrom', label: 'از سال', numeric: true },
                          { key: 'yearTo', label: 'تا سال', numeric: true },
                        ]}
                      />
                      <ChildPanel
                        title="تیپ‌ها" rows={detail.trims} busy={busy}
                        onAdd={async (v) => { await send({ kind: 'trim', vehicleModelId: openModelId, ...v }, 'تیپ ثبت شد.'); }}
                        onRemove={(id) => remove('trim', id)}
                      />
                      <ChildPanel
                        title="موتورها" rows={detail.engines} busy={busy}
                        onAdd={async (v) => { await send({ kind: 'engine', vehicleModelId: openModelId, ...v }, 'موتور ثبت شد.'); }}
                        onRemove={(id) => remove('engine', id)}
                        extraFields={[
                          { key: 'displacementCc', label: 'حجم موتور (cc)', numeric: true },
                          { key: 'fuelType', label: 'نوع سوخت' },
                        ]}
                      />
                    </div>
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

interface Field { key: string; label: string; required?: boolean; numeric?: boolean; ltr?: boolean }

function EntityForm({
  title, fields, busy, onSubmit,
}: {
  title?: string;
  fields: Field[];
  busy: boolean;
  onSubmit: (values: Record<string, string | number | null>) => void | Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const out: Record<string, string | number | null> = {};
        for (const field of fields) {
          const raw = (values[field.key] ?? '').trim();
          // An empty optional field is null, not an empty string — the schema
          // distinguishes "not supplied" from "set to blank".
          out[field.key] = raw === '' ? null : field.numeric ? Number(raw) : raw;
        }
        void onSubmit(out);
        setValues({});
      }}
    >
      {title && <p className="text-sm font-bold text-steel-900">{title}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((field) => (
          <label key={field.key} className="block">
            <span className="label">{field.label}</span>
            <input
              className={`field text-sm ${field.ltr ? 'latin-id' : ''}`}
              inputMode={field.numeric ? 'numeric' : undefined}
              required={field.required}
              value={values[field.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <Button type="submit" variant="accent" size="sm" disabled={busy}>ثبت</Button>
    </form>
  );
}

function ChildPanel({
  title, rows, busy, onAdd, onRemove, extraFields = [],
}: {
  title: string;
  rows: Child[];
  busy: boolean;
  onAdd: (values: Record<string, string | number | null>) => void | Promise<void>;
  onRemove: (id: string) => void;
  extraFields?: Field[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-extrabold text-steel-900">{title}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={() => setAdding((v) => !v)}>
          {adding ? 'انصراف' : 'افزودن'}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted">موردی ثبت نشده است.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-steel-50">
              <span className="min-w-0">
                <LatinId className="font-bold">{row.code}</LatinId>
                <span className="ms-2 text-xs text-muted">{row.nameFa}</span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemove(row.id)}
                aria-label={`حذف ${row.nameFa}`}
                className="shrink-0 text-steel-400 hover:text-red-700 disabled:opacity-50"
              >
                <TrashIcon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="mt-3 border-t border-line pt-3">
          <EntityForm
            busy={busy}
            fields={[
              { key: 'code', label: 'کد فنی', required: true, ltr: true },
              { key: 'nameFa', label: 'نام فارسی', required: true },
              ...extraFields,
            ]}
            onSubmit={async (values) => { await onAdd(values); setAdding(false); }}
          />
        </div>
      )}
    </div>
  );
}
