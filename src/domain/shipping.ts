/**
 * Shipping cost calculation. Pure; the caller supplies the admin-configured
 * method rows and the destination, and gets back a deterministic quote.
 */
import { assertMoney } from './money';

export type ShippingMethodKind = 'STANDARD' | 'COURIER' | 'POST' | 'PICKUP';

export const SHIPPING_KIND_LABEL_FA: Readonly<Record<ShippingMethodKind, string>> = {
  STANDARD: 'ارسال عادی',
  COURIER: 'پیک',
  POST: 'پست',
  PICKUP: 'تحویل حضوری',
};

export interface ShippingMethodConfig {
  readonly id: string;
  readonly code: string;
  readonly kind: ShippingMethodKind;
  readonly nameFa: string;
  readonly description: string | null;
  readonly baseCost: number;
  readonly perKgCost: number;
  readonly freeOverSubtotal: number | null;
  readonly estimatedDaysMin: number | null;
  readonly estimatedDaysMax: number | null;
  /** Empty = every province. */
  readonly availableProvinces: readonly string[];
  readonly isActive: boolean;
  readonly sortOrder: number;
}

export interface ProvinceRate {
  readonly methodId: string;
  readonly province: string;
  readonly costOverride: number | null;
  readonly surcharge: number;
}

export interface ShippingQuoteInput {
  readonly method: ShippingMethodConfig;
  readonly province: string;
  readonly subtotal: number;
  readonly totalWeightGrams: number;
  readonly rate?: ProvinceRate | undefined;
}

export interface ShippingQuote {
  readonly methodId: string;
  readonly methodCode: string;
  readonly methodName: string;
  readonly kind: ShippingMethodKind;
  readonly description: string | null;
  readonly cost: number;
  readonly isFree: boolean;
  readonly estimatedDaysMin: number | null;
  readonly estimatedDaysMax: number | null;
}

export function isMethodAvailableInProvince(
  method: ShippingMethodConfig,
  province: string,
): boolean {
  if (!method.isActive) return false;
  if (method.availableProvinces.length === 0) return true;
  return method.availableProvinces.includes(province);
}

/**
 * Cost = province override, or (base + ceil(kg) × perKg + province surcharge).
 * Free-shipping threshold is applied last and wins over everything.
 */
export function quoteShipping(input: ShippingQuoteInput): ShippingQuote {
  const { method, subtotal, totalWeightGrams, rate } = input;
  assertMoney(subtotal, 'جمع سبد');

  let cost: number;
  if (rate?.costOverride !== null && rate?.costOverride !== undefined) {
    cost = assertMoney(rate.costOverride, 'هزینه ارسال استانی');
  } else {
    const billableKg = Math.max(0, Math.ceil(totalWeightGrams / 1000));
    cost = method.baseCost + method.perKgCost * billableKg + (rate?.surcharge ?? 0);
  }

  const isFree =
    method.freeOverSubtotal !== null && method.freeOverSubtotal !== undefined
      ? subtotal >= method.freeOverSubtotal
      : false;

  if (isFree) cost = 0;

  return {
    methodId: method.id,
    methodCode: method.code,
    methodName: method.nameFa,
    kind: method.kind,
    description: method.description,
    cost: assertMoney(cost, 'هزینه ارسال'),
    isFree,
    estimatedDaysMin: method.estimatedDaysMin,
    estimatedDaysMax: method.estimatedDaysMax,
  };
}

export function quoteAll(
  methods: readonly ShippingMethodConfig[],
  rates: readonly ProvinceRate[],
  province: string,
  subtotal: number,
  totalWeightGrams: number,
): ShippingQuote[] {
  return methods
    .filter((m) => isMethodAvailableInProvince(m, province))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((method) =>
      quoteShipping({
        method,
        province,
        subtotal,
        totalWeightGrams,
        rate: rates.find((r) => r.methodId === method.id && r.province === province),
      }),
    );
}
