import type { Metadata } from 'next';
import { listShippingMethodsAdmin, listShippingRatesAdmin } from '@/application/shipping-service';
import { SectionHeading } from '@/components/ui';
import { ShippingManager } from '@/components/admin/shipping-manager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'روش‌های ارسال' };

export default async function AdminShippingPage() {
  const methods = await listShippingMethodsAdmin();
  const rates = await Promise.all(
    methods.map(async (m) => ({ methodId: m.id, rows: await listShippingRatesAdmin(m.id) })),
  );

  return (
    <>
      <SectionHeading
        title="روش‌های ارسال" as="h1"
        subtitle="هزینهٔ ارسال = هزینهٔ پایه + (وزن به کیلوگرم، رو به بالا × نرخ هر کیلو) + اضافه‌بهای استانی."
      />
      <ShippingManager
        methods={methods.map((m) => ({
          id: m.id, code: m.code, kind: m.kind, nameFa: m.nameFa, description: m.description,
          baseCost: m.baseCost, perKgCost: m.perKgCost, freeOverSubtotal: m.freeOverSubtotal,
          estimatedDaysMin: m.estimatedDaysMin, estimatedDaysMax: m.estimatedDaysMax,
          availableProvinces: m.availableProvinces, isActive: m.isActive, sortOrder: m.sortOrder,
        }))}
        rates={rates.flatMap((r) =>
          r.rows.map((row) => ({
            id: row.id, methodId: row.methodId, province: row.province,
            costOverride: row.costOverride, surcharge: row.surcharge,
          })),
        )}
      />
    </>
  );
}
