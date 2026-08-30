/**
 * Human-readable names for a vehicle configuration.
 *
 * Kept free of imports from the application layer so both server components
 * and client components can render the same label for the same vehicle.
 */
import { formatYearRange, toPersianDigits } from './fa';

export interface VehicleLabelParts {
  brandNameFa: string;
  modelNameFa: string;
  generationNameFa?: string | null;
  trimNameFa?: string | null;
  engineCode?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
}

/**
 * `پژو ۲۰۶ · تیپ ۵ · TU5 · ۱۳۹۸`
 *
 * The engine code stays Latin on purpose — it is a technical identifier and
 * converting its digits would make it wrong.
 */
export function vehicleLabel(v: VehicleLabelParts): string {
  const parts = [`${v.brandNameFa} ${v.modelNameFa}`];
  if (v.generationNameFa) parts.push(v.generationNameFa);
  if (v.trimNameFa) parts.push(v.trimNameFa);
  if (v.engineCode) parts.push(v.engineCode);

  /*
   * A customer's vehicle with no year is simply "a 206" — rendering the
   * catalogue's «همهٔ سال‌ها» here would read as a claim about their car.
   */
  if (v.yearFrom != null || v.yearTo != null) {
    parts.push(
      v.yearFrom != null && v.yearFrom === v.yearTo
        ? toPersianDigits(v.yearFrom)
        : formatYearRange(v.yearFrom ?? null, v.yearTo ?? null),
    );
  }

  return parts.join(' · ');
}

/** The narrowing the customer has not supplied yet, for a "tell us more" hint. */
export function missingVehicleDetail(v: VehicleLabelParts): string[] {
  const missing: string[] = [];
  if (!v.trimNameFa) missing.push('تیپ');
  if (!v.engineCode) missing.push('موتور');
  if (v.yearFrom == null) missing.push('سال ساخت');
  return missing;
}
