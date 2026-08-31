import type { Metadata } from 'next';
import { listVehicleTaxonomy } from '@/application/vehicle-admin-service';
import { VehicleTaxonomyManager } from '@/components/admin/vehicle-manager';
import { SectionHeading } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'خودروها' };

export default async function AdminVehiclesPage() {
  const taxonomy = await listVehicleTaxonomy();
  return (
    <div>
      <SectionHeading
        as="h1"
        title="پایگاه خودروها"
        subtitle="برند، مدل، نسل، تیپ و موتور. درون‌ریزی گروهی خودرو نمی‌سازد، بنابراین هر خودروی جدید از اینجا اضافه می‌شود."
      />
      <VehicleTaxonomyManager initialTaxonomy={taxonomy} />
    </div>
  );
}
