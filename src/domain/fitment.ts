/**
 * Vehicle fitment evaluation — pure, no I/O.
 *
 * Answers "does this part fit this car?" as a **three-valued** result
 * (ADR-008). A two-valued answer would force missing data to be rendered as
 * either a false "fits" or a false "does not fit"; both cause returns, and the
 * first causes wrong-part installations.
 *
 * Matching is hierarchical, following the ACES model: a fitment recorded against
 * a broad configuration ("پژو ۲۰۶, any engine") covers a narrower customer
 * vehicle ("پژو ۲۰۶ تیپ ۵, TU5"), while a NULL narrowing field on the fitment
 * means "applies to every value of this field".
 */

export type FitmentType = 'DIRECT' | 'WITH_MODIFICATION' | 'NOT_COMPATIBLE';

export type CompatibilityVerdict =
  | 'COMPATIBLE'
  | 'COMPATIBLE_WITH_MODIFICATION'
  | 'INCOMPATIBLE'
  | 'UNKNOWN';

/** The customer's actual vehicle. Unknown fields are `null`. */
export interface VehicleSpec {
  modelId: string;
  generationId: string | null;
  trimId: string | null;
  engineId: string | null;
  /** Jalali year. */
  year: number | null;
}

/** A configuration a fitment was recorded against. NULL = unspecified. */
export interface ConfigurationSpec {
  modelId: string;
  generationId: string | null;
  trimId: string | null;
  engineId: string | null;
  yearFrom: number | null;
  yearTo: number | null;
}

export interface FitmentRecord {
  fitmentType: FitmentType;
  note: string | null;
  configuration: ConfigurationSpec;
}

/**
 * Whether a configuration covers a vehicle.
 *
 * `INDETERMINATE` is returned when the configuration narrows on a field the
 * customer has not told us about — we cannot confirm *or* deny, and saying
 * either would be a guess.
 */
export type Applicability = 'YES' | 'NO' | 'INDETERMINATE';

export function configurationApplies(
  configuration: ConfigurationSpec,
  vehicle: VehicleSpec,
): Applicability {
  if (configuration.modelId !== vehicle.modelId) return 'NO';

  let indeterminate = false;

  const narrowing: [string | null, string | null][] = [
    [configuration.generationId, vehicle.generationId],
    [configuration.trimId, vehicle.trimId],
    [configuration.engineId, vehicle.engineId],
  ];

  for (const [required, actual] of narrowing) {
    if (required === null) continue;          // applies to all values
    if (actual === null) { indeterminate = true; continue; }  // customer unknown
    if (required !== actual) return 'NO';
  }

  const hasYearWindow = configuration.yearFrom !== null || configuration.yearTo !== null;
  if (hasYearWindow) {
    if (vehicle.year === null) {
      indeterminate = true;
    } else {
      if (configuration.yearFrom !== null && vehicle.year < configuration.yearFrom) return 'NO';
      if (configuration.yearTo !== null && vehicle.year > configuration.yearTo) return 'NO';
    }
  }

  return indeterminate ? 'INDETERMINATE' : 'YES';
}

/** How many fields a configuration narrows on (0–4). Higher wins on conflict. */
export function specificity(configuration: ConfigurationSpec): number {
  return (
    (configuration.generationId !== null ? 1 : 0) +
    (configuration.trimId !== null ? 1 : 0) +
    (configuration.engineId !== null ? 1 : 0) +
    (configuration.yearFrom !== null || configuration.yearTo !== null ? 1 : 0)
  );
}

export interface CompatibilityResult {
  verdict: CompatibilityVerdict;
  /** The fitment the verdict came from, when there is one. */
  matched: FitmentRecord | null;
  /** Persian explanation, safe to show the customer. */
  reasonFa: string;
  /** True when a narrower answer is available if the customer supplies more detail. */
  needsMoreVehicleDetail: boolean;
}

const VERDICT_BY_TYPE: Record<FitmentType, CompatibilityVerdict> = {
  DIRECT: 'COMPATIBLE',
  WITH_MODIFICATION: 'COMPATIBLE_WITH_MODIFICATION',
  NOT_COMPATIBLE: 'INCOMPATIBLE',
};

/**
 * Resolves a set of fitment records against one vehicle.
 *
 * Precedence:
 *  1. Only records that definitively apply (`YES`) can decide the verdict.
 *  2. Among those, the **most specific** wins — an exclusion recorded for
 *     "پژو ۲۰۶ TU3" correctly overrides a broad "fits پژو ۲۰۶".
 *  3. At equal specificity a `NOT_COMPATIBLE` wins, because claiming a fit the
 *     data contradicts is the more damaging error.
 *  4. With no definitive match the answer is UNKNOWN, never "does not fit".
 */
export function evaluateCompatibility(
  fitments: readonly FitmentRecord[],
  vehicle: VehicleSpec,
): CompatibilityResult {
  const definitive: { record: FitmentRecord; rank: number }[] = [];
  let sawIndeterminate = false;

  for (const record of fitments) {
    const applies = configurationApplies(record.configuration, vehicle);
    if (applies === 'YES') definitive.push({ record, rank: specificity(record.configuration) });
    else if (applies === 'INDETERMINATE') sawIndeterminate = true;
  }

  if (definitive.length === 0) {
    return {
      verdict: 'UNKNOWN',
      matched: null,
      reasonFa: sawIndeterminate
        ? 'برای پاسخ دقیق، تیپ و موتور خودروی خود را کامل کنید.'
        : 'اطلاعات سازگاری این قطعه با خودروی شما ثبت نشده است.',
      needsMoreVehicleDetail: sawIndeterminate,
    };
  }

  const topRank = Math.max(...definitive.map((d) => d.rank));
  const contenders = definitive.filter((d) => d.rank === topRank);
  // At equal specificity, a recorded exclusion outranks a recorded fit.
  const decisive =
    contenders.find((d) => d.record.fitmentType === 'NOT_COMPATIBLE') ?? contenders[0]!;

  const verdict = VERDICT_BY_TYPE[decisive.record.fitmentType];
  return {
    verdict,
    matched: decisive.record,
    reasonFa: REASON_FA[verdict](decisive.record.note),
    needsMoreVehicleDetail: false,
  };
}

const REASON_FA: Record<CompatibilityVerdict, (note: string | null) => string> = {
  COMPATIBLE: () => 'این قطعه با خودروی انتخابی شما سازگار است.',
  COMPATIBLE_WITH_MODIFICATION: (note) =>
    note
      ? `نصب این قطعه روی خودروی شما نیازمند تغییر است: ${note}`
      : 'این قطعه با خودروی شما سازگار است اما نصب آن نیازمند تغییر است.',
  INCOMPATIBLE: (note) =>
    note
      ? `این قطعه با خودروی انتخابی شما سازگار نیست: ${note}`
      : 'این قطعه با خودروی انتخابی شما سازگار نیست.',
  UNKNOWN: () => 'اطلاعات سازگاری این قطعه با خودروی شما ثبت نشده است.',
};

export const VERDICT_LABEL_FA: Record<CompatibilityVerdict, string> = {
  COMPATIBLE: 'سازگار',
  COMPATIBLE_WITH_MODIFICATION: 'سازگار با تغییر',
  INCOMPATIBLE: 'ناسازگار',
  UNKNOWN: 'اطلاعات کافی نیست',
};

export const FITMENT_TYPE_LABEL_FA: Record<FitmentType, string> = {
  DIRECT: 'سازگار',
  WITH_MODIFICATION: 'سازگار با تغییر',
  NOT_COMPATIBLE: 'ناسازگار',
};

/** Part-number relationship types (ADR-003). */
export type ProductReferenceType = 'SUPERSEDES' | 'SUPERSEDED_BY' | 'ALTERNATE' | 'CROSS_REFERENCE';

export const REFERENCE_TYPE_LABEL_FA: Record<ProductReferenceType, string> = {
  SUPERSEDES: 'جایگزین قطعهٔ قدیمی',
  SUPERSEDED_BY: 'جایگزین‌شده با',
  ALTERNATE: 'قطعهٔ معادل',
  CROSS_REFERENCE: 'کد معادل سازندهٔ دیگر',
};
