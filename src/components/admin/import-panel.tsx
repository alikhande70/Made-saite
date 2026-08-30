'use client';

/**
 * Two-phase bulk import UI.
 *
 * The commit button is only reachable through a preview, and the preview
 * always shows the errors first. That ordering is intentional: an importer
 * that leads with "۱٬۹۴۰ ردیف آماده است" and buries the failures invites an
 * administrator to apply a file they have not actually read.
 */

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, LatinId } from '../ui';
import { formatDateTime, toPersianDigits } from '@/lib/fa';

interface RowError { line: number; column: string | null; message: string }

interface Preview {
  jobId: string;
  status: 'VALIDATED' | 'FAILED';
  totalRows: number;
  validRows: number;
  errorRows: number;
  willCreate: number;
  willUpdate: number;
  errors: RowError[];
  truncatedErrors: number;
  sample: { line: number; sku: string; titleFa: string | null; price: number | null; stock: number | null }[];
}

interface Job {
  id: string;
  filename: string | null;
  status: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  createdCount: number;
  updatedCount: number;
  createdAt: string | Date;
  committedAt: string | Date | null;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'در انتظار',
  VALIDATED: 'بررسی‌شده',
  COMMITTED: 'اعمال‌شده',
  FAILED: 'ناموفق / کنارگذاشته',
};

/** Refuses a file the server would reject anyway, before spending the upload. */
const MAX_BYTES = 4 * 1024 * 1024;

export function ImportPanel({ initialJobs }: { initialJobs: Job[] }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [jobs, setJobs] = useState(initialJobs);

  async function refreshJobs() {
    const res = await fetch('/api/admin/imports');
    if (res.ok) {
      const body = (await res.json()) as { data?: Job[] };
      setJobs(body.data ?? []);
    }
    router.refresh();
  }

  async function onFile(file: File) {
    setError(null);
    setDone(null);
    setPreview(null);

    if (file.size > MAX_BYTES) {
      setError(`حجم فایل ${toPersianDigits(Math.round(file.size / 1024 / 1024))} مگابایت است؛ حداکثر ۴ مگابایت مجاز است.`);
      return;
    }

    setBusy(true);
    setFilename(file.name);
    try {
      const content = await file.text();
      const res = await fetch('/api/admin/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: file.name, content }),
      });
      const body = (await res.json()) as { data?: Preview; message?: string };
      if (!res.ok) throw new Error(body.message ?? 'بررسی فایل انجام نشد.');
      setPreview(body.data!);
      await refreshJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطای ناشناخته');
    } finally {
      setBusy(false);
    }
  }

  async function apply(action: 'commit' | 'discard') {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/imports', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: preview.jobId, action }),
      });
      const body = (await res.json()) as {
        data?: { created: number; updated: number; stockAdjusted: number };
        message?: string;
      };
      if (!res.ok) throw new Error(body.message ?? 'اعمال فایل انجام نشد.');

      setDone(
        action === 'discard'
          ? 'فایل بدون اعمال کنار گذاشته شد.'
          : `اعمال شد: ${toPersianDigits(body.data!.created)} کالای جدید، ${toPersianDigits(body.data!.updated)} به‌روزرسانی، ${toPersianDigits(body.data!.stockAdjusted)} تغییر موجودی.`,
      );
      setPreview(null);
      if (fileInput.current) fileInput.current.value = '';
      await refreshJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطای ناشناخته');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="card p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-extrabold text-steel-900">۱ — انتخاب فایل</h2>
        <p className="mb-3 text-xs text-muted">
          فایل CSV با جداکنندهٔ کاما، نقطه‌ویرگول یا تب. ستون «کد کالا» (SKU) الزامی است؛ ستون‌های ناشناخته نادیده گرفته می‌شوند.
          اعداد فارسی و جداکنندهٔ هزارگان به‌صورت خودکار تبدیل می‌شوند.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv,text/plain"
            disabled={busy}
            aria-label="فایل درون‌ریزی"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
            className="field max-w-sm text-sm file:me-3 file:rounded file:border-0 file:bg-steel-100 file:px-3 file:py-1 file:text-sm file:font-semibold"
          />
          <a
            href="/api/admin/imports/template"
            className="text-xs font-bold text-accent-700 hover:underline"
          >
            دریافت فایل نمونه
          </a>
        </div>

        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-steel-700">راهنمای ستون سازگاری و کدهای معادل</summary>
          <div className="mt-2 space-y-1.5 text-xs text-muted">
            <p>
              ستون <LatinId>fitment</LatinId>: هر ورودی با <LatinId>;</LatinId> جدا می‌شود و ساختار آن{' '}
              <LatinId>model|engine|trim|yearFrom-yearTo|type</LatinId> است. تنها مدل الزامی است؛ فیلد خالی یعنی «همه».
              نوع می‌تواند <LatinId>DIRECT</LatinId>، <LatinId>WITH_MODIFICATION</LatinId> یا <LatinId>NOT_COMPATIBLE</LatinId> باشد.
            </p>
            <p>
              ستون <LatinId>references</LatinId>: ساختار <LatinId>TYPE:number:brand</LatinId>، برای مثال{' '}
              <LatinId>CROSS_REFERENCE:W 712/52:MANN</LatinId>.
            </p>
            <p>مدل خودرو، موتور، تیپ، برند و دسته‌بندی باید از قبل تعریف شده باشند؛ درون‌ریزی هیچ‌کدام را نمی‌سازد.</p>
          </div>
        </details>
      </div>

      {busy && <Alert tone="info">در حال پردازش فایل…</Alert>}
      {error && <Alert tone="error" title="خطا">{error}</Alert>}
      {done && <Alert tone="success" title="انجام شد">{done}</Alert>}

      {preview && (
        <div className="card p-4 sm:p-5">
          <h2 className="mb-1 text-sm font-extrabold text-steel-900">
            ۲ — پیش‌نمایش {filename && <LatinId className="text-xs font-normal text-muted">{filename}</LatinId>}
          </h2>

          <dl className="my-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="کل ردیف‌ها" value={preview.totalRows} />
            <Stat label="ردیف معتبر" value={preview.validRows} tone="ok" />
            <Stat label="ردیف دارای خطا" value={preview.errorRows} tone={preview.errorRows > 0 ? 'bad' : undefined} />
            <Stat label="کالای جدید / ویرایش" value={`${toPersianDigits(preview.willCreate)} / ${toPersianDigits(preview.willUpdate)}`} />
          </dl>

          {preview.errors.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-sm font-bold text-red-800">
                خطاهای یافت‌شده — این ردیف‌ها اعمال نخواهند شد
              </p>
              <div className="scroll-x max-h-72 overflow-y-auto rounded-lg border border-red-200">
                <table className="spec-table">
                  <caption className="sr-only">فهرست خطاهای فایل</caption>
                  <thead className="sticky top-0 bg-red-50 text-xs">
                    <tr>
                      <th scope="col" className="font-bold text-red-900">ردیف</th>
                      <th scope="col" className="font-bold text-red-900">ستون</th>
                      <th scope="col" className="font-bold text-red-900">خطا</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.errors.map((e, i) => (
                      <tr key={`${e.line}-${i}`}>
                        <td className="whitespace-nowrap tabular-nums">{toPersianDigits(e.line)}</td>
                        <td className="whitespace-nowrap font-normal text-muted">{e.column ?? '—'}</td>
                        <td className="font-normal">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.truncatedErrors > 0 && (
                <p className="hint">{toPersianDigits(preview.truncatedErrors)} خطای دیگر نمایش داده نشده است.</p>
              )}
            </div>
          )}

          {preview.sample.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-sm font-bold text-steel-900">نمونهٔ ردیف‌های معتبر</p>
              <div className="scroll-x rounded-lg border border-line">
                <table className="spec-table">
                  <caption className="sr-only">نمونهٔ ردیف‌های معتبر فایل</caption>
                  <thead className="bg-steel-50 text-xs">
                    <tr>
                      <th scope="col" className="font-bold text-steel-800">ردیف</th>
                      <th scope="col" className="font-bold text-steel-800">کد کالا</th>
                      <th scope="col" className="font-bold text-steel-800">نام</th>
                      <th scope="col" className="font-bold text-steel-800">قیمت</th>
                      <th scope="col" className="font-bold text-steel-800">موجودی</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((row) => (
                      <tr key={row.line}>
                        <td className="whitespace-nowrap tabular-nums">{toPersianDigits(row.line)}</td>
                        <td className="whitespace-nowrap"><LatinId>{row.sku}</LatinId></td>
                        <td className="font-normal">{row.titleFa ?? <span className="text-muted">بدون تغییر</span>}</td>
                        <td className="whitespace-nowrap tabular-nums font-normal">
                          {row.price === null ? '—' : toPersianDigits(row.price)}
                        </td>
                        <td className="whitespace-nowrap tabular-nums font-normal">
                          {row.stock === null ? '—' : toPersianDigits(row.stock)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button
              type="button"
              variant="accent"
              disabled={busy || preview.validRows === 0}
              onClick={() => apply('commit')}
            >
              اعمال {toPersianDigits(preview.validRows)} ردیف معتبر
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => apply('discard')}>
              انصراف و کنار گذاشتن
            </Button>
          </div>
          {preview.validRows === 0 && (
            <p className="hint">هیچ ردیف معتبری در فایل نیست؛ خطاها را برطرف کرده و دوباره بارگذاری کنید.</p>
          )}
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-extrabold text-steel-900">سابقهٔ درون‌ریزی</h2>
        {jobs.length === 0 ? (
          <p className="card p-4 text-sm text-muted">هنوز فایلی درون‌ریزی نشده است.</p>
        ) : (
          <div className="card scroll-x">
            <table className="spec-table">
              <caption className="sr-only">سابقهٔ فایل‌های درون‌ریزی</caption>
              <thead className="bg-steel-50 text-xs">
                <tr>
                  <th scope="col" className="font-bold text-steel-800">زمان</th>
                  <th scope="col" className="font-bold text-steel-800">فایل</th>
                  <th scope="col" className="font-bold text-steel-800">وضعیت</th>
                  <th scope="col" className="font-bold text-steel-800">ردیف‌ها</th>
                  <th scope="col" className="font-bold text-steel-800">نتیجه</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="whitespace-nowrap font-normal text-muted">{formatDateTime(job.createdAt)}</td>
                    <td className="font-normal"><LatinId>{job.filename ?? '—'}</LatinId></td>
                    <td className="whitespace-nowrap">{STATUS_LABEL[job.status] ?? job.status}</td>
                    <td className="whitespace-nowrap font-normal tabular-nums">
                      {toPersianDigits(job.validRows)} / {toPersianDigits(job.totalRows)}
                      {job.errorRows > 0 && (
                        <span className="ms-1 text-xs text-red-700">({toPersianDigits(job.errorRows)} خطا)</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap font-normal tabular-nums">
                      {job.committedAt
                        ? `${toPersianDigits(job.createdCount)} جدید، ${toPersianDigits(job.updatedCount)} ویرایش`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'ok' | 'bad' }) {
  const color = tone === 'ok' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : 'text-steel-900';
  return (
    <div className="rounded-lg bg-steel-50 px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-0.5 text-lg font-extrabold tabular-nums ${color}`}>
        {typeof value === 'number' ? toPersianDigits(value) : value}
      </dd>
    </div>
  );
}
