import type { Metadata } from 'next';
import { getVehicleTree } from '@/application/catalog-service';
import { listGarage, MAX_GARAGE_VEHICLES } from '@/application/garage-service';
import { requireUser } from '@/lib/session';
import { GarageManager } from '@/components/garage-manager';
import { SectionHeading } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'گاراژ من',
  description: 'خودروهای ذخیره‌شدهٔ شما؛ سازگاری قطعات بر اساس این خودروها بررسی می‌شود.',
  robots: { index: false, follow: false },
};

export default async function GaragePage() {
  const user = await requireUser();
  const [garage, vehicles] = await Promise.all([listGarage(user.id), getVehicleTree()]);

  return (
    <div>
      <SectionHeading
        as="h1"
        title="گاراژ من"
        subtitle="خودروهای ذخیره‌شده در همهٔ صفحات فروشگاه برای بررسی سازگاری استفاده می‌شوند."
      />
      <GarageManager
        initialGarage={garage}
        vehicles={vehicles}
        maxVehicles={MAX_GARAGE_VEHICLES}
      />
    </div>
  );
}
