import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getProductForEdit, listBrandsAdmin, listCategoriesAdmin } from '@/application/admin-service';
import { getVehicleTree } from '@/application/catalog-service';
import { listInventoryEvents } from '@/application/inventory-service';
import { getDb } from '@/infrastructure/db/client';
import { ProductForm } from '@/components/admin/product-form';
import { Breadcrumbs, LatinId, SectionHeading } from '@/components/ui';
import { formatDateTime, toPersianDigits } from '@/lib/fa';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'ویرایش کالا' };

const EVENT_LABEL: Record<string, string> = {
  RECEIVE: 'ورود کالا', ADJUST: 'اصلاح دستی', RESERVE: 'رزرو',
  RELEASE: 'آزادسازی رزرو', FULFILL: 'خروج از انبار', RETURN: 'مرجوعی',
};

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getProductForEdit(id);
  if (!data) notFound();

  const [categories, brands, vehicles, events] = await Promise.all([
    listCategoriesAdmin(), listBrandsAdmin(), getVehicleTree(), listInventoryEvents(getDb(), id, 20),
  ]);

  const { product, images, specs, fitments, references, stock } = data;
  const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

  return (
    <>
      <Breadcrumbs items={[
        { label: 'پنل مدیریت', href: '/admin' },
        { label: 'کالاها', href: '/admin/products' },
        { label: product.titleFa },
      ]} />

      <SectionHeading
        title="ویرایش کالا" as="h1"
        subtitle={product.sku}
        action={
          product.isActive ? (
            <Link href={`/products/${encodeURIComponent(product.slug)}`} className="text-sm font-semibold text-steel-700 hover:underline">
              مشاهده در فروشگاه
            </Link>
          ) : undefined
        }
      />

      <ProductForm
        productId={product.id}
        categories={categories.map((c) => ({ id: c.id, nameFa: c.nameFa, parentId: c.parentId }))}
        brands={brands.map((b) => ({ id: b.id, nameFa: b.nameFa }))}
        vehicles={vehicles}
        currentStock={stock ? { onHand: stock.quantityOnHand, reserved: stock.quantityReserved } : null}
        initialValues={{
          sku: product.sku,
          oemNumber: product.oemNumber ?? '',
          mpn: product.mpn ?? '',
          slug: product.slug,
          titleFa: product.titleFa,
          titleEn: product.titleEn ?? '',
          descriptionFa: product.descriptionFa ?? '',
          categoryId: product.categoryId ?? '',
          brandId: product.brandId ?? '',
          manufacturer: product.manufacturer ?? '',
          price: String(product.price),
          salePrice: str(product.salePrice),
          weightGrams: str(product.weightGrams),
          lengthMm: str(product.lengthMm),
          widthMm: str(product.widthMm),
          heightMm: str(product.heightMm),
          warrantyMonths: str(product.warrantyMonths),
          countryOfOrigin: product.countryOfOrigin ?? '',
          condition: product.condition,
          installationNotes: product.installationNotes ?? '',
          tags: product.tags.join('، '),
          productFamily: product.productFamily ?? '',
          allowBackorder: product.allowBackorder,
          seoTitle: product.seoTitle ?? '',
          seoDescription: product.seoDescription ?? '',
          isActive: product.isActive,
        }}
        initialImages={images.map((i) => ({ url: i.url, alt: i.alt ?? '' }))}
        initialSpecs={specs.map((s) => ({ specKey: s.specKey, specValue: s.specValue, unit: s.unit ?? '' }))}
        initialFitments={fitments.map((f) => ({
          vehicleModelId: f.configuration.modelId,
          vehicleTrimId: f.configuration.trimId ?? '',
          vehicleEngineId: f.configuration.engineId ?? '',
          yearFrom: str(f.configuration.yearFrom),
          yearTo: str(f.configuration.yearTo),
          fitmentType: f.fitmentType,
          note: f.note ?? '',
        }))}
        initialReferences={references.map((r) => ({
          relationType: r.relationType,
          targetNumber: r.targetNumber ?? '',
          targetBrand: r.targetBrand ?? '',
          note: r.note ?? '',
        }))}
      />

      <section className="mt-8">
        <h2 className="mb-3 text-base font-extrabold text-steel-900">تاریخچهٔ موجودی</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted">هنوز حرکتی برای این کالا ثبت نشده است.</p>
        ) : (
          <div className="card scroll-x">
            <table className="w-full text-sm">
              <thead className="bg-steel-50 text-xs">
                <tr>
                  <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">نوع</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">تغییر</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">موجودی پس از تغییر</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">دلیل</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-bold text-steel-800">زمان</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {events.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 font-semibold">{EVENT_LABEL[event.type] ?? event.type}</td>
                    <td className={`whitespace-nowrap px-4 py-2.5 font-bold tabular-nums ${event.delta > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {event.delta > 0 ? '+' : '−'}{toPersianDigits(Math.abs(event.delta))}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                      {toPersianDigits(event.quantityOnHandAfter)}
                      {event.quantityReservedAfter > 0 && (
                        <span className="ms-1 text-xs text-muted">({toPersianDigits(event.quantityReservedAfter)} رزرو)</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted">
                      {event.reason}
                      {event.orderId && (
                        <Link href={`/admin/orders/${event.orderId}`} className="ms-2 text-xs font-semibold text-steel-700 hover:underline">
                          <LatinId>سفارش</LatinId>
                        </Link>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">{formatDateTime(event.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
