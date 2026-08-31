import Link from 'next/link';
import { getConfiguration } from '@/application/fitment-service';
import { getSelectedVehicleId } from '@/lib/session';
import { vehicleLabel } from '@/lib/vehicle-label';
import { CarIcon } from './ui';
import { ClearVehicleButton } from './clear-vehicle-button';

/**
 * A persistent strip naming the vehicle the storefront is filtering for.
 *
 * Rendered on every page: an active vehicle silently changes what the customer
 * sees, so it must never be invisible state.
 */
export async function ActiveVehicleBar() {
  const configurationId = await getSelectedVehicleId().catch(() => null);
  const vehicle = configurationId ? await getConfiguration(configurationId).catch(() => null) : null;

  if (!vehicle) {
    return (
      <div className="border-b border-line bg-steel-50">
        <div className="container-page flex h-10 items-center justify-between gap-3 text-xs">
          <span className="flex min-w-0 items-center gap-1.5 text-muted">
            <CarIcon className="size-4 shrink-0 text-steel-400" />
            <span className="truncate">خودرویی انتخاب نشده است</span>
          </span>
          <Link href="/vehicles" className="shrink-0 font-bold text-accent-700 hover:underline">
            انتخاب خودرو
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-accent-200 bg-accent-50">
      <div className="container-page flex h-10 items-center justify-between gap-3 text-xs">
        <span className="flex min-w-0 items-center gap-1.5 text-accent-900">
          <CarIcon className="size-4 shrink-0 text-accent-700" />
          <span className="hidden shrink-0 sm:inline">خودروی فعال:</span>
          <span className="truncate font-bold">{vehicleLabel(vehicle)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <Link href="/vehicles" className="font-bold text-accent-800 hover:underline">تغییر</Link>
          <ClearVehicleButton />
        </span>
      </div>
    </div>
  );
}
