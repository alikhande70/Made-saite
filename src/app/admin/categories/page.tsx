import type { Metadata } from 'next';
import { listCategoriesAdmin } from '@/application/admin-service';
import { SectionHeading } from '@/components/ui';
import { TaxonomyManager } from '@/components/admin/taxonomy-manager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'دسته‌بندی‌ها' };

export default async function AdminCategoriesPage() {
  const rows = await listCategoriesAdmin();

  // Parents sorted so root categories come first in the tree view.
  const ordered = [
    ...rows.filter((r) => !r.parentId),
    ...rows.filter((r) => r.parentId),
  ].sort((a, b) => {
    const aRoot = a.parentId ?? a.id;
    const bRoot = b.parentId ?? b.id;
    if (aRoot === bRoot) return (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0);
    return 0;
  });

  return (
    <>
      <SectionHeading title="دسته‌بندی‌ها" as="h1" subtitle="ساختار درختی دسته‌ها؛ هر دسته می‌تواند زیرمجموعه داشته باشد." />
      <TaxonomyManager
        kind="category"
        rows={ordered.map((r) => ({
          id: r.id, slug: r.slug, nameFa: r.nameFa, nameEn: r.nameEn, parentId: r.parentId,
          description: r.description, isActive: r.isActive, sortOrder: r.sortOrder, productCount: r.productCount,
        }))}
        parents={rows.filter((r) => !r.parentId).map((r) => ({
          id: r.id, slug: r.slug, nameFa: r.nameFa, nameEn: r.nameEn, parentId: r.parentId,
          description: r.description, isActive: r.isActive, sortOrder: r.sortOrder, productCount: r.productCount,
        }))}
      />
    </>
  );
}
