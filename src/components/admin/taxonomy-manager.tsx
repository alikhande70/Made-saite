'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toPersianDigits } from '@/lib/fa';
import { Alert, Button, CloseIcon, LatinId } from '../ui';

export interface TaxonomyRow {
  id: string;
  slug: string;
  nameFa: string;
  nameEn: string | null;
  parentId?: string | null;
  country?: string | null;
  description: string | null;
  isActive: boolean;
  sortOrder?: number;
  productCount: number;
}

type Kind = 'category' | 'brand';

/**
 * Shared CRUD surface for categories and brands — the two taxonomies share the
 * same shape, so they share the same editor rather than duplicating it.
 */
export function TaxonomyManager({
  kind, rows, parents,
}: { kind: Kind; rows: TaxonomyRow[]; parents?: TaxonomyRow[] }) {
  const router = useRouter();
  const endpoint = kind === 'category' ? '/api/admin/categories' : '/api/admin/brands';
  const noun = kind === 'category' ? 'دسته' : 'برند';

  const [editing, setEditing] = useState<TaxonomyRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [form, setForm] = useState({
    nameFa: '', nameEn: '', slug: '', parentId: '', country: '',
    description: '', imageUrl: '', isActive: true, sortOrder: '0',
    seoTitle: '', seoDescription: '',
  });

  function startCreate() {
    setEditing(null);
    setCreating(true);
    setError(null);
    setForm({
      nameFa: '', nameEn: '', slug: '', parentId: '', country: '',
      description: '', imageUrl: '', isActive: true, sortOrder: '0', seoTitle: '', seoDescription: '',
    });
  }

  function startEdit(row: TaxonomyRow) {
    setCreating(false);
    setEditing(row);
    setError(null);
    setForm({
      nameFa: row.nameFa,
      nameEn: row.nameEn ?? '',
      slug: row.slug,
      parentId: row.parentId ?? '',
      country: row.country ?? '',
      description: row.description ?? '',
      imageUrl: '',
      isActive: row.isActive,
      sortOrder: String(row.sortOrder ?? 0),
      seoTitle: '',
      seoDescription: '',
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload: Record<string, unknown> = {
        ...(editing ? { id: editing.id } : {}),
        nameFa: form.nameFa.trim(),
        nameEn: form.nameEn.trim() || undefined,
        slug: form.slug.trim() || undefined,
        description: form.description.trim() || undefined,
        isActive: form.isActive,
        seoTitle: form.seoTitle.trim() || undefined,
        seoDescription: form.seoDescription.trim() || undefined,
      };
      if (kind === 'category') {
        payload.parentId = form.parentId || undefined;
        payload.sortOrder = Number(form.sortOrder) || 0;
        payload.imageUrl = form.imageUrl.trim() || undefined;
      } else {
        payload.country = form.country.trim() || undefined;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !body.ok) {
        setError(body.message ?? `ذخیرهٔ ${noun} انجام نشد.`);
        return;
      }
      setNotice(editing ? `${noun} به‌روزرسانی شد.` : `${noun} جدید ثبت شد.`);
      setCreating(false);
      setEditing(null);
      router.refresh();
    } catch {
      setError('ارتباط با سرور برقرار نشد.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: TaxonomyRow) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${endpoint}?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' });
      const body = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !body.ok) {
        setError(body.message ?? `حذف ${noun} انجام نشد.`);
        return;
      }
      setNotice(`${noun} حذف شد.`);
      router.refresh();
    } catch {
      setError('ارتباط با سرور برقرار نشد.');
    } finally {
      setBusy(false);
    }
  }

  const open = creating || editing !== null;

  return (
    <>
      {error && <div className="mb-3"><Alert tone="error">{error}</Alert></div>}
      {notice && <div className="mb-3"><Alert tone="success">{notice}</Alert></div>}

      <div className="mb-4">
        <Button type="button" variant="signal" size="sm" onClick={startCreate}>
          افزودن {noun} جدید
        </Button>
      </div>

      {open && (
        <form onSubmit={save} className="card mb-5 space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-steel-900">
              {editing ? `ویرایش ${noun}: ${editing.nameFa}` : `${noun} جدید`}
            </h2>
            <button type="button" onClick={() => { setCreating(false); setEditing(null); }}
              aria-label="بستن فرم" className="rounded-lg p-1.5 text-steel-400 hover:bg-steel-50">
              <CloseIcon className="size-4" />
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="nameFa" label="نام فارسی" required>
              <input id="nameFa" className="field" value={form.nameFa}
                onChange={(e) => setForm((f) => ({ ...f, nameFa: e.target.value }))} />
            </Field>
            <Field id="nameEn" label="نام انگلیسی">
              <input id="nameEn" dir="ltr" className="field latin-id" value={form.nameEn}
                onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))} />
            </Field>
            <Field id="slug" label="نشانی یکتا (slug)" hint="خالی بگذارید تا از نام ساخته شود.">
              <input id="slug" className="field" value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} />
            </Field>

            {kind === 'category' ? (
              <>
                <Field id="parentId" label="دستهٔ والد">
                  <select id="parentId" className="field" value={form.parentId}
                    onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}>
                    <option value="">— دستهٔ اصلی —</option>
                    {(parents ?? []).filter((p) => p.id !== editing?.id).map((p) => (
                      <option key={p.id} value={p.id}>{p.nameFa}</option>
                    ))}
                  </select>
                </Field>
                <Field id="sortOrder" label="ترتیب نمایش">
                  <input id="sortOrder" inputMode="numeric" className="field tabular-nums" value={form.sortOrder}
                    onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} />
                </Field>
                <Field id="imageUrl" label="نشانی تصویر">
                  <input id="imageUrl" dir="ltr" className="field latin-id" value={form.imageUrl}
                    onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
                    placeholder="/demo/cat-filters.svg" />
                </Field>
              </>
            ) : (
              <Field id="country" label="کشور سازنده">
                <input id="country" className="field" value={form.country}
                  onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} />
              </Field>
            )}

            <div className="sm:col-span-2">
              <Field id="description" label="توضیحات">
                <textarea id="description" rows={2} className="field resize-y" value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field id="seoDescription" label="توضیحات متا (سئو)">
                <textarea id="seoDescription" rows={2} className="field resize-y" value={form.seoDescription}
                  onChange={(e) => setForm((f) => ({ ...f, seoDescription: e.target.value }))} />
              </Field>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              className="size-4 rounded border-steel-300 text-steel-700" />
            فعال (در فروشگاه نمایش داده شود)
          </label>

          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'در حال ذخیره…' : 'ذخیره'}
          </Button>
        </form>
      )}

      <div className="card scroll-x">
        <table className="w-full text-sm">
          <thead className="bg-steel-50 text-xs">
            <tr>
              <Th>نام</Th><Th>نشانی یکتا</Th>
              {kind === 'category' ? <Th>والد</Th> : <Th>کشور</Th>}
              <Th>تعداد کالا</Th><Th>وضعیت</Th><Th>عملیات</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.id} className={editing?.id === row.id ? 'bg-steel-50/70' : undefined}>
                <td className="px-3 py-2.5 font-semibold text-steel-900">
                  {row.parentId && <span className="me-1 text-muted">—</span>}
                  {row.nameFa}
                  {row.nameEn && <span className="latin-id ms-2 text-xs font-normal text-muted">{row.nameEn}</span>}
                </td>
                <td className="px-3 py-2.5"><LatinId className="text-xs text-muted">{row.slug}</LatinId></td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted">
                  {kind === 'category'
                    ? (rows.find((r) => r.id === row.parentId)?.nameFa ?? '—')
                    : (row.country ?? '—')}
                </td>
                <td className="px-3 py-2.5 tabular-nums">{toPersianDigits(row.productCount)}</td>
                <td className="px-3 py-2.5">
                  <span className={`rounded px-2 py-0.5 text-xs font-bold ${
                    row.isActive ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {row.isActive ? 'فعال' : 'غیرفعال'}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => startEdit(row)}
                      className="text-xs font-semibold text-steel-700 hover:underline">ویرایش</button>
                    <button type="button" onClick={() => remove(row)} disabled={busy || row.productCount > 0}
                      title={row.productCount > 0 ? `این ${noun} دارای کالا است و قابل حذف نیست.` : undefined}
                      className="text-xs font-semibold text-red-700 hover:underline disabled:cursor-not-allowed disabled:text-steel-300 disabled:no-underline">
                      حذف
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-start font-bold text-steel-800">{children}</th>;
}

function Field({
  id, label, hint, required, children,
}: { id: string; label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}{required && <span className="ms-1 text-red-600" aria-hidden>*</span>}
      </label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
