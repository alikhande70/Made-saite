/**
 * «آیا این قطعه مناسب خودروی شماست؟»
 *
 * The verdict is computed server-side from recorded fitment rows — never from
 * prose in the product description. Four outcomes are possible and all four
 * are shown honestly:
 *
 *   ✓ سازگار              a fitment row definitively covers this vehicle
 *   ✓ سازگار با تغییر      it fits, but the row records a required modification
 *   ✕ ناسازگار            a row definitively excludes this vehicle
 *   ? اطلاعات کافی نیست    no row decides it — we say so instead of guessing
 *
 * The last case is the important one: absence of data is never rendered as
 * "does not fit", and never as "fits".
 */
import Link from 'next/link';
import type { CompatibilityResult, CompatibilityVerdict } from '@/domain/fitment';
import type { ResolvedConfiguration } from '@/application/fitment-service';
import { VERDICT_LABEL_FA } from '@/domain/fitment';
import { missingVehicleDetail, vehicleLabel } from '@/lib/vehicle-label';
import { CarIcon, CheckIcon, CloseIcon } from './ui';

const CHIP_CLASS: Record<CompatibilityVerdict, string> = {
  COMPATIBLE: 'verdict verdict-yes',
  COMPATIBLE_WITH_MODIFICATION: 'verdict verdict-maybe',
  INCOMPATIBLE: 'verdict verdict-no',
  UNKNOWN: 'verdict verdict-unknown',
};

/** Glyph, so the verdict never depends on colour alone. */
function VerdictGlyph({ verdict }: { verdict: CompatibilityVerdict }) {
  if (verdict === 'COMPATIBLE') return <CheckIcon className="size-4" />;
  if (verdict === 'INCOMPATIBLE') return <CloseIcon className="size-4" />;
  if (verdict === 'COMPATIBLE_WITH_MODIFICATION') {
    return <span aria-hidden className="text-sm font-black leading-none">!</span>;
  }
  return <span aria-hidden className="text-sm font-black leading-none">؟</span>;
}

export function VerdictChip({ verdict, className = '' }: { verdict: CompatibilityVerdict; className?: string }) {
  return (
    <span className={`${CHIP_CLASS[verdict]} ${className}`}>
      <VerdictGlyph verdict={verdict} />
      {VERDICT_LABEL_FA[verdict]}
    </span>
  );
}

const PANEL_CLASS: Record<CompatibilityVerdict, string> = {
  COMPATIBLE: 'border-emerald-300 bg-emerald-50/70',
  COMPATIBLE_WITH_MODIFICATION: 'border-amber-300 bg-amber-50/70',
  INCOMPATIBLE: 'border-red-300 bg-red-50/70',
  UNKNOWN: 'border-steel-200 bg-steel-50',
};

/**
 * The full PDP module. `result` is null when the shopper has not told us what
 * they drive — in which case we ask, rather than assuming.
 */
export function CompatibilityPanel({
  result,
  vehicle,
  children,
}: {
  result: CompatibilityResult | null;
  vehicle: ResolvedConfiguration | null;
  /** Vehicle selector, rendered when there is nothing selected yet. */
  children?: React.ReactNode;
}) {
  if (!result || !vehicle) {
    return (
      <section aria-labelledby="fitment-heading" className="card overflow-hidden">
        <div className="carbon-field px-5 py-4">
          <h2 id="fitment-heading" className="flex items-center gap-2 text-base font-extrabold text-white">
            <CarIcon className="size-5 text-accent-300" />
            آیا این قطعه مناسب خودروی شماست؟
          </h2>
          <p className="mt-1 text-sm text-steel-200">
            خودروی خود را انتخاب کنید تا سازگاری این قطعه بررسی شود.
          </p>
        </div>
        <div className="p-5">{children}</div>
      </section>
    );
  }

  const missing = missingVehicleDetail(vehicle);
  const needsDetail =
    result.verdict === 'UNKNOWN' && result.needsMoreVehicleDetail && missing.length > 0;

  return (
    <section aria-labelledby="fitment-heading" className="card overflow-hidden">
      <div className="carbon-field px-5 py-4">
        <h2 id="fitment-heading" className="flex items-center gap-2 text-base font-extrabold text-white">
          <CarIcon className="size-5 text-accent-300" />
          آیا این قطعه مناسب خودروی شماست؟
        </h2>
        <p className="mt-1 text-sm text-steel-200">
          بررسی‌شده برای: <span className="font-bold text-white">{vehicleLabel(vehicle)}</span>
        </p>
      </div>

      <div className={`border-t p-5 ${PANEL_CLASS[result.verdict]}`}>
        {/*
          * `role="status"` announces the verdict after a vehicle change without
          * stealing focus. `key` on the verdict re-runs the reveal whenever the
          * answer actually changes, so switching vehicles reads as a *new*
          * answer rather than a static panel that quietly rewrote itself —
          * this is the one place motion carries meaning rather than polish.
          * Under reduced motion the reveal resolves instantly and the words,
          * glyph and announcement are unchanged.
          */}
        <div
          key={result.verdict}
          role="status"
          className="motion-reveal flex flex-wrap items-center gap-3"
        >
          <VerdictChip verdict={result.verdict} className="text-sm" />
          <p className="min-w-48 flex-1 text-sm font-medium text-steel-800">
            {/* Name the fields we are actually missing rather than repeating the
                generic prompt the domain layer produced. */}
            {needsDetail ? `برای پاسخ قطعی، ${missing.join(' و ')} خودروی خود را مشخص کنید.` : result.reasonFa}
          </p>
        </div>

        {result.verdict === 'UNKNOWN' && !result.needsMoreVehicleDetail && (
          <p className="mt-3 text-xs text-steel-700">
            نبود اطلاعات به معنی ناسازگاری نیست. پیش از خرید با پشتیبانی هماهنگ کنید.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/account/garage" className="text-xs font-bold text-accent-700 hover:underline">
            تغییر خودرو در گاراژ من
          </Link>
          <span aria-hidden className="text-xs text-steel-300">|</span>
          <Link
            href={`/products?vehicleModel=${encodeURIComponent(vehicle.modelSlug)}`}
            className="text-xs font-bold text-accent-700 hover:underline"
          >
            همهٔ قطعات {vehicle.modelNameFa}
          </Link>
        </div>
      </div>
    </section>
  );
}
