/**
 * Pricing rules. Pure functions — the server always recomputes every figure from
 * database state; a price arriving from the client is never read.
 */
import { assertMoney, multiplyMoney, sumMoney } from './money';

export interface Priceable {
  readonly price: number;
  readonly salePrice: number | null;
}

/** The price actually charged: the sale price when one is set, else list price. */
export function effectivePrice(p: Priceable): number {
  const base = assertMoney(p.price, 'قیمت');
  if (p.salePrice === null || p.salePrice === undefined) return base;
  const sale = assertMoney(p.salePrice, 'قیمت فروش ویژه');
  // Defensive: a bad row must not raise the price above list.
  return sale < base ? sale : base;
}

export interface PricedLineInput {
  readonly unitPrice: number;
  readonly listPrice: number;
  readonly quantity: number;
}

export interface PricedLine {
  readonly unitPrice: number;
  readonly listPrice: number;
  readonly quantity: number;
  readonly lineTotal: number;
  /** Amount saved on this line versus list price. */
  readonly lineDiscount: number;
}

export function priceLine(input: PricedLineInput): PricedLine {
  const lineTotal = multiplyMoney(input.unitPrice, input.quantity);
  const listTotal = multiplyMoney(input.listPrice, input.quantity);
  return {
    unitPrice: input.unitPrice,
    listPrice: input.listPrice,
    quantity: input.quantity,
    lineTotal,
    lineDiscount: Math.max(0, listTotal - lineTotal),
  };
}

export interface OrderTotals {
  /** Sum of line totals at the *effective* (already discounted) price. */
  readonly subtotal: number;
  /** Total saved versus list price. Presentational — not subtracted again. */
  readonly discountTotal: number;
  readonly shippingTotal: number;
  readonly grandTotal: number;
  readonly itemCount: number;
}

export function computeTotals(lines: readonly PricedLine[], shippingTotal: number): OrderTotals {
  const subtotal = sumMoney(lines.map((l) => l.lineTotal));
  const discountTotal = sumMoney(lines.map((l) => l.lineDiscount));
  const shipping = assertMoney(shippingTotal, 'هزینه ارسال');
  return {
    subtotal,
    discountTotal,
    shippingTotal: shipping,
    grandTotal: subtotal + shipping,
    itemCount: lines.reduce((n, l) => n + l.quantity, 0),
  };
}

/** Total physical weight of a set of lines, used by weight-based shipping. */
export function totalWeightGrams(
  lines: readonly { quantity: number; weightGrams: number | null }[],
): number {
  return lines.reduce((sum, l) => sum + (l.weightGrams ?? 0) * l.quantity, 0);
}
