import type { Metadata } from 'next';
import Link from 'next/link';
import { SectionHeading, Alert } from '@/components/ui';
import { toPersianDigits } from '@/lib/fa';
import { siteUrl } from '@/application/settings-service';
import {
  countGroup, getSeoHealth, listAdapters, summariseOutbox,
} from '@/application/search-visibility';
import { SITEMAP_GROUPS, sitemapPageCount, stripTrailingSlash } from '@/domain/search-visibility';
import { SubmissionActions } from '@/components/admin/submission-actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'دیده‌شدن در جست‌وجو' };

const GROUP_LABEL_FA: Record<string, string> = {
  static: 'صفحات ثابت',
  products: 'کالاها',
  categories: 'دسته‌بندی‌ها',
  brands: 'برندها',
  vehicles: 'صفحات خودرو × دسته',
};

const SEVERITY_STYLE: Record<string, { label: string; className: string }> = {
  ERROR: { label: 'خطا', className: 'bg-red-100 text-red-800' },
  WARNING: { label: 'هشدار', className: 'bg-amber-100 text-amber-900' },
  INFO: { label: 'اطلاع', className: 'bg-steel-100 text-steel-700' },
};

export default async function AdminSearchVisibilityPage() {
  const base = stripTrailingSlash(siteUrl());

  const [health, outbox, groupCounts] = await Promise.all([
    getSeoHealth(),
    summariseOutbox(),
    Promise.all(
      SITEMAP_GROUPS.map(async (group) => ({
        group,
        total: await countGroup(group),
      })),
    ),
  ]);

  const adapters = listAdapters().map((a) => ({
    id: a.id,
    displayNameFa: a.displayNameFa,
    supportsInstantSubmission: a.supportsInstantSubmission,
    config: a.validateConfiguration(),
  }));

  const totalIndexable = groupCounts.reduce((sum, g) => sum + g.total, 0);
  const scoreTone =
    health.score >= 90 ? 'text-emerald-700' : health.score >= 70 ? 'text-amber-700' : 'text-red-700';

  return (
    <>
      <SectionHeading
        title="دیده‌شدن در جست‌وجو" as="h1"
        subtitle="نقشهٔ سایت، وضعیت نمایه‌سازی و اطلاع‌رسانی تغییرات به موتورهای جست‌وجو."
      />

      {/* ── score + inventory ─────────────────────────────────────────── */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-steel-200 bg-white p-4">
          <p className="text-xs font-semibold text-steel-500">امتیاز سلامت سئو</p>
          <p className={`mt-1 text-3xl font-extrabold ${scoreTone}`}>
            {toPersianDigits(health.score)}
            <span className="text-base font-bold text-steel-400"> / ۱۰۰</span>
          </p>
          <p className="mt-1 text-xs text-steel-500">
            هر امتیاز کسرشده از یکی از موارد فهرست پایین می‌آید.
          </p>
        </div>
        <div className="rounded-lg border border-steel-200 bg-white p-4">
          <p className="text-xs font-semibold text-steel-500">نشانی‌های قابل نمایه‌سازی</p>
          <p className="mt-1 text-3xl font-extrabold text-steel-900">{toPersianDigits(totalIndexable)}</p>
          <p className="mt-1 text-xs text-steel-500">مجموع نشانی‌های داخل نقشهٔ سایت</p>
        </div>
        <div className="rounded-lg border border-steel-200 bg-white p-4">
          <p className="text-xs font-semibold text-steel-500">در صف ارسال</p>
          <p className="mt-1 text-3xl font-extrabold text-steel-900">{toPersianDigits(outbox.pending)}</p>
          <p className="mt-1 text-xs text-steel-500">
            {toPersianDigits(outbox.succeeded)} ارسال موفق تاکنون
          </p>
        </div>
        <div className="rounded-lg border border-steel-200 bg-white p-4">
          <p className="text-xs font-semibold text-steel-500">ارسال ناموفق</p>
          <p className={`mt-1 text-3xl font-extrabold ${outbox.failed > 0 ? 'text-red-700' : 'text-steel-900'}`}>
            {toPersianDigits(outbox.failed)}
          </p>
          <p className="mt-1 text-xs text-steel-500">پس از چند تلاش ناموفق کنار گذاشته شده</p>
        </div>
      </div>

      {/* ── sitemap ───────────────────────────────────────────────────── */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-extrabold text-steel-900">نقشهٔ سایت</h2>
        <div className="overflow-x-auto rounded-lg border border-steel-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-steel-50 text-xs text-steel-500">
              <tr>
                <th className="px-3 py-2 text-right font-semibold">گروه</th>
                <th className="px-3 py-2 text-right font-semibold">تعداد نشانی</th>
                <th className="px-3 py-2 text-right font-semibold">تعداد فایل</th>
                <th className="px-3 py-2 text-right font-semibold">نشانی</th>
              </tr>
            </thead>
            <tbody>
              {groupCounts.map(({ group, total }) => (
                <tr key={group} className="border-t border-steel-100">
                  <td className="px-3 py-2 font-semibold text-steel-800">{GROUP_LABEL_FA[group]}</td>
                  <td className="px-3 py-2 tabular-nums">{toPersianDigits(total)}</td>
                  <td className="px-3 py-2 tabular-nums">{toPersianDigits(sitemapPageCount(total))}</td>
                  <td className="px-3 py-2">
                    <a
                      href={`/sitemaps/${group}-1.xml`}
                      className="font-mono text-xs text-steel-600 underline"
                      target="_blank" rel="noreferrer"
                    >
                      /sitemaps/{group}-1.xml
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-steel-500">
          فهرست اصلی:{' '}
          <a href="/sitemap.xml" target="_blank" rel="noreferrer" className="font-mono underline">
            {base}/sitemap.xml
          </a>{' '}
          — همین نشانی در <span className="font-mono">robots.txt</span> اعلام شده است.
        </p>
      </section>

      {/* ── search engines ────────────────────────────────────────────── */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-extrabold text-steel-900">موتورهای جست‌وجو</h2>
        <div className="space-y-3">
          {adapters.map((adapter) => (
            <div key={adapter.id} className="rounded-lg border border-steel-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-steel-900">{adapter.displayNameFa}</p>
                  <p className="mt-0.5 text-xs text-steel-500">
                    شناسه: <span className="font-mono">{adapter.id}</span>
                  </p>
                </div>
                <span
                  className={`rounded px-2 py-1 text-xs font-bold ${
                    adapter.config.configured ? 'bg-emerald-100 text-emerald-800' : 'bg-steel-100 text-steel-600'
                  }`}
                >
                  {adapter.config.configured ? 'پیکربندی‌شده' : 'پیکربندی نشده'}
                </span>
              </div>
              {adapter.config.reasonFa && (
                <p className="mt-2 text-xs text-steel-600">{adapter.config.reasonFa}</p>
              )}
              <div className="mt-3">
                <SubmissionActions adapterId={adapter.id} disabled={!adapter.config.configured} />
              </div>
            </div>
          ))}
        </div>
        <Alert tone="info">
          <span className="text-xs">
            گوگل عضو IndexNow نیست و تغییرات را از طریق نقشهٔ سایت و Search Console می‌بیند؛
            بنابراین نقشهٔ سایت مسیر اصلی کشف است و IndexNow فقط آن را سریع‌تر می‌کند.
          </span>
        </Alert>
      </section>

      {/* ── recent failures ───────────────────────────────────────────── */}
      {outbox.recentFailures.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-extrabold text-steel-900">آخرین ارسال‌های ناموفق</h2>
          <div className="overflow-x-auto rounded-lg border border-steel-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-steel-50 text-xs text-steel-500">
                <tr>
                  <th className="px-3 py-2 text-right font-semibold">نشانی</th>
                  <th className="px-3 py-2 text-right font-semibold">رویداد</th>
                  <th className="px-3 py-2 text-right font-semibold">تلاش</th>
                  <th className="px-3 py-2 text-right font-semibold">خطا</th>
                </tr>
              </thead>
              <tbody>
                {outbox.recentFailures.map((f) => (
                  <tr key={f.url} className="border-t border-steel-100">
                    <td className="px-3 py-2 font-mono text-xs">{f.url}</td>
                    <td className="px-3 py-2 text-xs">{f.eventType}</td>
                    <td className="px-3 py-2 tabular-nums">{toPersianDigits(f.attemptCount)}</td>
                    <td className="px-3 py-2 text-xs text-red-700">{f.lastError ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── SEO issues ────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 text-sm font-extrabold text-steel-900">مواردی که می‌توان بهتر کرد</h2>
        {health.issues.length === 0 ? (
          <Alert tone="success">هیچ مشکل سئویی در داده‌های فعلی پیدا نشد.</Alert>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-steel-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-steel-50 text-xs text-steel-500">
                <tr>
                  <th className="px-3 py-2 text-right font-semibold">شدت</th>
                  <th className="px-3 py-2 text-right font-semibold">مورد</th>
                  <th className="px-3 py-2 text-right font-semibold">تعداد</th>
                  <th className="px-3 py-2 text-right font-semibold"> </th>
                </tr>
              </thead>
              <tbody>
                {health.issues.map((issue) => {
                  const style = SEVERITY_STYLE[issue.severity]!;
                  return (
                    <tr key={issue.code} className="border-t border-steel-100">
                      <td className="px-3 py-2">
                        <span className={`rounded px-2 py-0.5 text-xs font-bold ${style.className}`}>
                          {style.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-steel-800">{issue.titleFa}</td>
                      <td className="px-3 py-2 tabular-nums font-semibold">{toPersianDigits(issue.count)}</td>
                      <td className="px-3 py-2">
                        {issue.href && (
                          <Link href={issue.href} className="text-xs text-steel-600 underline">
                            رسیدگی
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
