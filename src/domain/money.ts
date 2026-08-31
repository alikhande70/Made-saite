/**
 * Money handling.
 *
 * The store's canonical unit is the **Toman (IRT)**, stored everywhere as a
 * non-negative integer. Iranian retail quotes prices in whole Toman and has no
 * circulating sub-unit, so integers remove floating-point error entirely.
 * (1 Toman = 10 Rial; conversion happens only at gateway boundaries that demand
 * Rial — see `toRial`.)
 */
export const CURRENCY_CODE = 'IRT' as const;
export const CURRENCY_LABEL_FA = 'تومان' as const;

/** Guards against NaN/Infinity/fractional amounts reaching the database. */
export function assertMoney(value: number, label = 'مبلغ'): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${label} باید یک عدد صحیح باشد (دریافت‌شده: ${value}).`);
  }
  if (value < 0) throw new Error(`${label} نمی‌تواند منفی باشد (دریافت‌شده: ${value}).`);
  if (value > Number.MAX_SAFE_INTEGER) throw new Error(`${label} بیش از حد بزرگ است.`);
  return value;
}

export function sumMoney(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + assertMoney(v), 0);
}

export function multiplyMoney(unit: number, quantity: number): number {
  assertMoney(unit, 'قیمت واحد');
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error('تعداد باید عدد صحیح نامنفی باشد.');
  return unit * quantity;
}

/** Iranian gateways settle in Rial. Only cross this boundary at the adapter. */
export function toRial(toman: number): number {
  return assertMoney(toman) * 10;
}

export function fromRial(rial: number): number {
  if (rial % 10 !== 0) throw new Error('مبلغ ریالی باید مضربی از ۱۰ باشد.');
  return rial / 10;
}

/** Percentage discount, rounded down so the customer is never overcharged. */
export function applyPercentDiscount(amount: number, percent: number): number {
  assertMoney(amount);
  if (percent < 0 || percent > 100) throw new Error('درصد تخفیف باید بین ۰ تا ۱۰۰ باشد.');
  return amount - Math.floor((amount * percent) / 100);
}

export function discountPercent(price: number, salePrice: number): number {
  if (price <= 0 || salePrice >= price) return 0;
  return Math.round(((price - salePrice) / price) * 100);
}
