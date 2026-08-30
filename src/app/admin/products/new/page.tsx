import type { Metadata } from 'next';
import { listBrandsAdmin, listCategoriesAdmin } from '@/application/admin-service';
import { getVehicleTree } from '@/application/catalog-service';
import { ProductForm } from '@/components/admin/product-form';
import { Breadcrumbs, SectionHeading } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'افزودن کالای جدید' };

export default async function NewProductPage() {
  const [categories, brands, vehicles] = await Promise.all([
    listCategoriesAdmin(), listBrandsAdmin(), getVehicleTree(),
  ]);

  return (
    <>
      <Breadcrumbs items={[{ label: 'پنل مدیریت', href: '/admin' }, { label: 'کالاها', href: '/admin/products' }, { label: 'کالای جدید' }]} />
      <SectionHeading title="افزودن کالای جدید" as="h1" subtitle="کالا پس از ذخیره تنها در صورت فعال بودن «انتشار» در فروشگاه دیده می‌شود." />
      <ProductForm
        categories={categories.map((c) => ({ id: c.id, nameFa: c.nameFa, parentId: c.parentId }))}
        brands={brands.map((b) => ({ id: b.id, nameFa: b.nameFa }))}
        vehicles={vehicles}
      />
    </>
  );
}
