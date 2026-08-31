import type { Metadata } from 'next';
import { listImportJobs } from '@/application/import-service';
import { ImportPanel } from '@/components/admin/import-panel';
import { SectionHeading } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'درون‌ریزی گروهی' };

export default async function ImportsPage() {
  const jobs = await listImportJobs();
  return (
    <div>
      <SectionHeading
        as="h1"
        title="درون‌ریزی گروهی کالاها"
        subtitle="فایل را بررسی کنید، پیش‌نمایش تغییرات را ببینید و سپس اعمال کنید. تا زمان اعمال، هیچ تغییری در کاتالوگ ثبت نمی‌شود."
      />
      <ImportPanel initialJobs={jobs} />
    </div>
  );
}
