import type { Metadata } from 'next';
import { listProductsAdmin } from '@/application/admin-service';
import { SectionHeading, Alert } from '@/components/ui';
import { InventoryTable } from '@/components/admin/inventory-table';
import { toPersianDigits } from '@/lib/fa';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'انبار و موجودی' };

export default async function AdminInventoryPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const single = (k: string) => (Array.isArray(params[k]) ? params[k]![0] : params[k]);

  const q = single('q');
  const lowStock = single('lowStock') === '1';
  const page = Math.max(1, Number(single('page') ?? 1) || 1);

  const result = await listProductsAdmin({ q, lowStock, page, perPage: 25 });
  const lowCount = result.items.filter((p) => p.quantityAvailable <= p.lowStockThreshold).length;

  return (
    <>
      <SectionHeading
        title="انبار و موجودی" as="h1"
        subtitle="هر تغییر موجودی با دلیل ثبت می‌شود و در تاریخچهٔ کالا باقی می‌ماند."
      />

      {lowCount > 0 && (
        <div className="mb-4">
          <Alert tone="warning">
            {toPersianDigits(lowCount)} کالا در این صفحه به آستانهٔ هشدار موجودی رسیده است.
          </Alert>
        </div>
      )}

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor="q" className="label">جست‌وجو</label>
          <input id="q" name="q" defaultValue={q ?? ''} className="field h-10" placeholder="عنوان یا کد کالا" />
        </div>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" name="lowStock" value="1" defaultChecked={lowStock}
            className="size-4 rounded border-steel-300 text-steel-700" />
          فقط رو به اتمام
        </label>
        <button type="submit" className="h-10 rounded-lg bg-steel-800 px-4 text-sm font-semibold text-white hover:bg-steel-900">
          اعمال
        </button>
      </form>

      <InventoryTable
        items={result.items.map((p) => ({
          id: p.id, sku: p.sku, titleFa: p.titleFa, imageUrl: p.imageUrl,
          quantityOnHand: p.quantityOnHand, quantityReserved: p.quantityReserved,
          lowStockThreshold: p.lowStockThreshold, isActive: p.isActive,
        }))}
        page={result.page}
        totalPages={result.totalPages}
      />
    </>
  );
}
