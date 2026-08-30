/**
 * Domain errors. Every one carries a Persian, user-safe `message` plus a stable
 * machine `code`. Nothing here leaks internals — handlers map these straight to
 * HTTP responses.
 */
export type DomainErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'OUT_OF_STOCK'
  | 'INSUFFICIENT_STOCK'
  | 'PRODUCT_UNAVAILABLE'
  | 'CART_EMPTY'
  | 'INVALID_TRANSITION'
  | 'PAYMENT_FAILED'
  | 'RATE_LIMITED'
  | 'PRICE_CHANGED';

import { toPersianDigits } from '@/lib/fa';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: DomainErrorCode, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const errors = {
  validation: (message = 'اطلاعات ارسال‌شده معتبر نیست.', details?: unknown) =>
    new DomainError('VALIDATION_FAILED', message, 422, details),
  notFound: (message = 'موردی یافت نشد.') => new DomainError('NOT_FOUND', message, 404),
  unauthenticated: (message = 'برای ادامه باید وارد حساب کاربری شوید.') =>
    new DomainError('UNAUTHENTICATED', message, 401),
  forbidden: (message = 'شما به این بخش دسترسی ندارید.') => new DomainError('FORBIDDEN', message, 403),
  conflict: (message = 'این عملیات با وضعیت فعلی سازگار نیست.') => new DomainError('CONFLICT', message, 409),
  outOfStock: (title: string) =>
    new DomainError('OUT_OF_STOCK', `موجودی «${title}» به پایان رسیده است.`, 409),
  insufficientStock: (title: string, available: number) =>
    new DomainError(
      'INSUFFICIENT_STOCK',
      `موجودی «${title}» کافی نیست. تنها ${toPersianDigits(available)} عدد در انبار موجود است.`,
      409,
      { available },
    ),
  productUnavailable: (title: string) =>
    new DomainError('PRODUCT_UNAVAILABLE', `محصول «${title}» در حال حاضر قابل سفارش نیست.`, 409),
  cartEmpty: () => new DomainError('CART_EMPTY', 'سبد خرید شما خالی است.', 409),
  invalidTransition: (message: string) => new DomainError('INVALID_TRANSITION', message, 409),
  paymentFailed: (message = 'پرداخت ناموفق بود.') => new DomainError('PAYMENT_FAILED', message, 402),
  rateLimited: (message = 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.') =>
    new DomainError('RATE_LIMITED', message, 429),
  priceChanged: () =>
    new DomainError('PRICE_CHANGED', 'قیمت برخی از اقلام سبد خرید تغییر کرده است. لطفاً سبد را بازبینی کنید.', 409),
};

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
