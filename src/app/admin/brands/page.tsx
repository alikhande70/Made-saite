import type { Metadata } from 'next';
import { listBrandsAdmin } from '@/application/admin-service';
import { SectionHeading } from '@/components/ui';
import { TaxonomyManager } from '@/components/admin/taxonomy-manager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'برندها' };

export default async function AdminBrandsPage() {
  const rows = await listBrandsAdmin();
  return (
    <>
      <SectionHeading title="برندها" as="h1" subtitle="برند سازندهٔ قطعات؛ در فیلترهای فروشگاه و صفحهٔ محصول نمایش داده می‌شود." />
      <TaxonomyManager
        kind="brand"
        rows={rows.map((r) => ({
          id: r.id, slug: r.slug, nameFa: r.nameFa, nameEn: r.nameEn, country: r.country,
          description: r.description, isActive: r.isActive, productCount: r.productCount,
        }))}
      />
    </>
  );
}
