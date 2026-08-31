/**
 * Inventory rules (pure). The reservation model:
 *
 *   available = onHand − reserved
 *
 * `reserved` is raised when an order is placed and lowered when the order is
 * paid (converted to a deduction from `onHand`), cancelled, or expires.
 * `onHand` only ever changes on receive / adjust / fulfil / return.
 *
 * The database mirrors these rules with CHECK constraints so a bug in this layer
 * still cannot produce negative or oversold stock.
 */
export interface StockLevel {
  readonly quantityOnHand: number;
  readonly quantityReserved: number;
  readonly lowStockThreshold: number;
}

export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export const STOCK_STATUS_LABEL_FA: Readonly<Record<StockStatus, string>> = {
  IN_STOCK: 'موجود در انبار',
  LOW_STOCK: 'موجودی محدود',
  OUT_OF_STOCK: 'ناموجود',
};

export function availableQuantity(s: StockLevel): number {
  return Math.max(0, s.quantityOnHand - s.quantityReserved);
}

export function stockStatus(s: StockLevel): StockStatus {
  const available = availableQuantity(s);
  if (available <= 0) return 'OUT_OF_STOCK';
  if (available <= s.lowStockThreshold) return 'LOW_STOCK';
  return 'IN_STOCK';
}

export function canReserve(s: StockLevel, quantity: number): boolean {
  return quantity > 0 && availableQuantity(s) >= quantity;
}

/** Maximum units a single customer may put in the cart for one product. */
export const MAX_QUANTITY_PER_LINE = 20;

export function clampCartQuantity(requested: number, available: number): number {
  return Math.max(0, Math.min(requested, available, MAX_QUANTITY_PER_LINE));
}
