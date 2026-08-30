/**
 * Order lifecycle. The transition table is the single source of truth; every
 * status change — customer, admin or gateway initiated — goes through
 * `assertTransition`. Nothing mutates `orders.status` directly.
 */
import { DomainError, errors } from './errors';

export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'PACKED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['PROCESSING', 'CANCELLED', 'REFUNDED'],
  PROCESSING: ['PACKED', 'CANCELLED', 'REFUNDED'],
  PACKED: ['SHIPPED', 'CANCELLED', 'REFUNDED'],
  SHIPPED: ['DELIVERED', 'REFUNDED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

export const ORDER_STATUS_LABEL_FA: Readonly<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: 'در انتظار پرداخت',
  PAID: 'پرداخت‌شده',
  PROCESSING: 'در حال آماده‌سازی',
  PACKED: 'بسته‌بندی‌شده',
  SHIPPED: 'ارسال‌شده',
  DELIVERED: 'تحویل‌شده',
  CANCELLED: 'لغو‌شده',
  REFUNDED: 'مرجوع‌شده',
};

/** Short customer-facing explanation shown on the tracking timeline. */
export const ORDER_STATUS_HINT_FA: Readonly<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: 'سفارش ثبت شد و منتظر تکمیل پرداخت است.',
  PAID: 'پرداخت با موفقیت انجام شد.',
  PROCESSING: 'سفارش شما در حال آماده‌سازی در انبار است.',
  PACKED: 'اقلام سفارش بسته‌بندی و آمادهٔ ارسال شد.',
  SHIPPED: 'سفارش تحویل شرکت حمل شد و در مسیر است.',
  DELIVERED: 'سفارش به شما تحویل داده شد.',
  CANCELLED: 'این سفارش لغو شده است.',
  REFUNDED: 'مبلغ این سفارش بازگردانده شده است.',
};

/** Ordered steps rendered as the customer-facing progress bar. */
export const ORDER_PROGRESS_STEPS: readonly OrderStatus[] = [
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'PACKED',
  'SHIPPED',
  'DELIVERED',
];

export const TERMINAL_STATUSES: readonly OrderStatus[] = ['DELIVERED', 'CANCELLED', 'REFUNDED'];

export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === 'string' && (ORDER_STATUSES as readonly string[]).includes(v);
}

export function allowedTransitions(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Throws a Persian `DomainError` when the transition is not permitted. */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (from === to) {
    throw errors.invalidTransition(
      `سفارش هم‌اکنون در وضعیت «${ORDER_STATUS_LABEL_FA[to]}» است.`,
    );
  }
  if (!canTransition(from, to)) {
    throw errors.invalidTransition(
      `تغییر وضعیت از «${ORDER_STATUS_LABEL_FA[from]}» به «${ORDER_STATUS_LABEL_FA[to]}» مجاز نیست.`,
    );
  }
}

/** Statuses in which the customer may still cancel the order themselves. */
export function customerMayCancel(status: OrderStatus): boolean {
  return status === 'PENDING_PAYMENT';
}

/**
 * Whether stock is still *reserved* (held but not yet deducted) in this status.
 * Reservation is created at placement and converted to a deduction on payment.
 */
export function holdsReservation(status: OrderStatus): boolean {
  return status === 'PENDING_PAYMENT';
}

export class InvalidTransitionError extends DomainError {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(
      'INVALID_TRANSITION',
      `تغییر وضعیت از «${ORDER_STATUS_LABEL_FA[from]}» به «${ORDER_STATUS_LABEL_FA[to]}» مجاز نیست.`,
      409,
    );
  }
}
