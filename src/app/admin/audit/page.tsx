import type { Metadata } from 'next';
import { listAudit, listAuditActions } from '@/application/audit-service';
import { AUDIT_ACTION_LABEL_FA } from '@/domain/audit';
import { LatinId, SectionHeading, EmptyState } from '@/components/ui';
import { AuditFilters } from '@/components/admin/audit-filters';
import { formatDateTime, toPersianDigits } from '@/lib/fa';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'گزارش فعالیت' };

export default async function AuditPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const action = single('action') ?? '';
  const page = Math.max(1, Number(single('page') ?? 1) || 1);

  const [entries, actions] = await Promise.all([
    listAudit({ action: action || undefined, page, perPage: 50 }),
    listAuditActions(),
  ]);

  return (
    <div>
      <SectionHeading
        as="h1"
        title="گزارش فعالیت مدیران"
        subtitle="هر تغییر مدیریتی با زمان، کاربر و خلاصهٔ تغییر ثبت می‌شود. این گزارش فقط‌خواندنی است."
      />

      <AuditFilters actions={actions} selected={action} />

      {entries.items.length === 0 ? (
        <EmptyState title="رویدادی ثبت نشده است" description="با انجام اولین تغییر مدیریتی، این گزارش پر می‌شود." />
      ) : (
        <div className="card scroll-x">
          <table className="spec-table">
            <caption className="sr-only">فهرست رویدادهای مدیریتی</caption>
            <thead className="bg-steel-50 text-xs">
              <tr>
                <th scope="col" className="font-bold text-steel-800">زمان</th>
                <th scope="col" className="font-bold text-steel-800">کاربر</th>
                <th scope="col" className="font-bold text-steel-800">رویداد</th>
                <th scope="col" className="font-bold text-steel-800">شرح</th>
              </tr>
            </thead>
            <tbody>
              {entries.items.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap font-normal text-muted">{formatDateTime(entry.createdAt)}</td>
                  <td className="whitespace-nowrap">
                    {entry.actorName ?? '—'}
                    {entry.actorPhone && <LatinId className="mt-0.5 block text-xs text-muted">{entry.actorPhone}</LatinId>}
                  </td>
                  <td className="whitespace-nowrap font-semibold">
                    {AUDIT_ACTION_LABEL_FA[entry.action as keyof typeof AUDIT_ACTION_LABEL_FA] ?? entry.action}
                  </td>
                  <td className="font-normal">{entry.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {entries.totalPages > 1 && (
        <p className="mt-3 text-xs text-muted">
          صفحهٔ {toPersianDigits(entries.page)} از {toPersianDigits(entries.totalPages)} —{' '}
          مجموع {toPersianDigits(entries.total)} رویداد
        </p>
      )}
    </div>
  );
}
