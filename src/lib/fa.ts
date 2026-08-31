/**
 * Persian (fa-IR) presentation helpers.
 *
 * This module has **no imports** and no I/O — it is pure formatting, which is
 * why the domain layer is allowed to depend on it for user-facing messages.
 *
 * Rule of thumb used across the UI:
 *   • Human quantities, prices and dates  → Persian digits (۱۲۳)
 *   • Identifiers people copy or type     → Latin digits (SKU, OEM, tracking,
 *     postal code, phone), because they are matched character-for-character
 *     against printed parts and courier systems.
 */
export const LOCALE = 'fa-IR' as const;
export const TIME_ZONE = 'Asia/Tehran' as const;

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;

/** ۱۲۳ → 123. Also folds Arabic-Indic ٠-٩. Used on every user-typed field. */
export function toLatinDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/** 123 → ۱۲۳. */
export function toPersianDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]!);
}

const numberFormatter = new Intl.NumberFormat(LOCALE);

/** 1250000 → «۱٬۲۵۰٬۰۰۰» */
export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/** 1250000 → «۱٬۲۵۰٬۰۰۰ تومان» */
export function formatToman(value: number): string {
  return `${numberFormatter.format(value)} تومان`;
}

/** Compact form for tight spaces, e.g. cards: «۱٫۲۵ میلیون تومان». */
export function formatTomanCompact(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    const text = millions >= 10 ? Math.round(millions).toString() : millions.toFixed(2).replace(/\.?0+$/, '');
    return `${toPersianDigits(text.replace('.', '٫'))} میلیون تومان`;
  }
  if (value >= 1000) return `${toPersianDigits(Math.round(value / 1000))} هزار تومان`;
  return formatToman(value);
}

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: 'medium',
  timeZone: TIME_ZONE,
});
const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: TIME_ZONE,
});

/** Jalali date, e.g. «۷ شهریور ۱۴۰۵». `fa-IR` uses the Persian calendar. */
export function formatDate(value: Date | string | number): string {
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value: Date | string | number): string {
  return dateTimeFormatter.format(new Date(value));
}

/** «۳ روز پیش» / «هم‌اکنون» */
export function formatRelative(value: Date | string | number, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(value).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'هم‌اکنون';
  if (minutes < 60) return `${toPersianDigits(minutes)} دقیقه پیش`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${toPersianDigits(hours)} ساعت پیش`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${toPersianDigits(days)} روز پیش`;
  return formatDate(value);
}

/** «۲ تا ۴ روز کاری» */
export function formatDeliveryWindow(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min !== max)
    return `${toPersianDigits(min)} تا ${toPersianDigits(max)} روز کاری`;
  const single = max ?? min!;
  return `${toPersianDigits(single)} روز کاری`;
}

/** Jalali year of a Date, for vehicle year defaults. */
export function currentJalaliYear(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
    year: 'numeric',
    timeZone: TIME_ZONE,
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  return Number(toLatinDigits(year).replace(/\D/g, ''));
}

/** Renders a Jalali year range like «۱۳۹۰ تا ۱۴۰۲» / «از ۱۳۹۵» / «همه سال‌ها». */
export function formatYearRange(from: number | null, to: number | null): string {
  if (from === null && to === null) return 'همهٔ سال‌ها';
  if (from !== null && to !== null)
    return from === to ? toPersianDigits(from) : `${toPersianDigits(from)} تا ${toPersianDigits(to)}`;
  if (from !== null) return `از ${toPersianDigits(from)}`;
  return `تا ${toPersianDigits(to!)}`;
}

/** «۳ مورد» */
export function formatCount(n: number, unit = 'مورد'): string {
  return `${toPersianDigits(n)} ${unit}`;
}
