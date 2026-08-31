import { describe, expect, it } from 'vitest';
import {
  assertMoney, sumMoney, multiplyMoney, toRial, fromRial,
  applyPercentDiscount, discountPercent,
} from '@/domain/money';
import {
  ORDER_STATUSES, allowedTransitions, assertTransition, canTransition,
  customerMayCancel, holdsReservation, isTerminal, ORDER_STATUS_LABEL_FA,
} from '@/domain/order-status';
import { computeTotals, effectivePrice, priceLine, totalWeightGrams } from '@/domain/pricing';
import { availableQuantity, canReserve, clampCartQuantity, stockStatus } from '@/domain/inventory';
import { isMethodAvailableInProvince, quoteAll, quoteShipping, type ShippingMethodConfig } from '@/domain/shipping';
import { DomainError } from '@/domain/errors';

describe('money', () => {
  it('rejects non-integer, negative and non-finite amounts', () => {
    expect(() => assertMoney(1.5)).toThrow();
    expect(() => assertMoney(-1)).toThrow();
    expect(() => assertMoney(Number.NaN)).toThrow();
    expect(() => assertMoney(Number.POSITIVE_INFINITY)).toThrow();
    expect(assertMoney(0)).toBe(0);
  });

  it('sums and multiplies without floating point drift', () => {
    expect(sumMoney([329_000, 1_290_000, 869_000])).toBe(2_488_000);
    expect(multiplyMoney(329_000, 3)).toBe(987_000);
    expect(multiplyMoney(0, 5)).toBe(0);
  });

  it('converts Toman to Rial only at the gateway boundary', () => {
    expect(toRial(1_250_000)).toBe(12_500_000);
    expect(fromRial(12_500_000)).toBe(1_250_000);
    expect(() => fromRial(125)).toThrow();
  });

  it('rounds percent discounts in the customer’s favour', () => {
    expect(applyPercentDiscount(999, 10)).toBe(900); // floor(99.9)=99 removed
    expect(applyPercentDiscount(1000, 0)).toBe(1000);
    expect(applyPercentDiscount(1000, 100)).toBe(0);
    expect(() => applyPercentDiscount(1000, 101)).toThrow();
  });

  it('computes a display discount percentage', () => {
    expect(discountPercent(1_000_000, 900_000)).toBe(10);
    expect(discountPercent(1_000_000, 1_000_000)).toBe(0);
    expect(discountPercent(0, 0)).toBe(0);
  });
});

describe('order state machine', () => {
  it('allows only the documented transitions', () => {
    expect(canTransition('PENDING_PAYMENT', 'PAID')).toBe(true);
    expect(canTransition('PENDING_PAYMENT', 'CANCELLED')).toBe(true);
    expect(canTransition('PENDING_PAYMENT', 'SHIPPED')).toBe(false);
    expect(canTransition('PAID', 'PROCESSING')).toBe(true);
    expect(canTransition('SHIPPED', 'DELIVERED')).toBe(true);
    expect(canTransition('SHIPPED', 'CANCELLED')).toBe(false);
    expect(canTransition('DELIVERED', 'REFUNDED')).toBe(true);
  });

  it('treats CANCELLED and REFUNDED as terminal', () => {
    expect(allowedTransitions('CANCELLED')).toHaveLength(0);
    expect(allowedTransitions('REFUNDED')).toHaveLength(0);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('PAID')).toBe(false);
  });

  it('throws a Persian DomainError on an illegal move', () => {
    try {
      assertTransition('DELIVERED', 'PENDING_PAYMENT');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe('INVALID_TRANSITION');
      expect((e as DomainError).message).toContain('مجاز نیست');
      expect((e as DomainError).status).toBe(409);
    }
  });

  it('rejects a no-op transition', () => {
    expect(() => assertTransition('PAID', 'PAID')).toThrow(DomainError);
  });

  it('never lets a status escape into an unknown state', () => {
    for (const from of ORDER_STATUSES) {
      for (const to of allowedTransitions(from)) {
        expect(ORDER_STATUSES).toContain(to);
      }
    }
  });

  it('holds a stock reservation only before payment', () => {
    expect(holdsReservation('PENDING_PAYMENT')).toBe(true);
    expect(holdsReservation('PAID')).toBe(false);
    expect(customerMayCancel('PENDING_PAYMENT')).toBe(true);
    expect(customerMayCancel('SHIPPED')).toBe(false);
  });

  it('has a Persian label for every status', () => {
    for (const s of ORDER_STATUSES) {
      expect(ORDER_STATUS_LABEL_FA[s]).toMatch(/[؀-ۿ]/);
    }
  });
});

describe('pricing', () => {
  it('uses the sale price when present and lower', () => {
    expect(effectivePrice({ price: 1_000_000, salePrice: 850_000 })).toBe(850_000);
    expect(effectivePrice({ price: 1_000_000, salePrice: null })).toBe(1_000_000);
  });

  it('never lets a bad sale price raise the charged amount', () => {
    expect(effectivePrice({ price: 500_000, salePrice: 900_000 })).toBe(500_000);
  });

  it('computes line totals and the saving versus list price', () => {
    const line = priceLine({ unitPrice: 850_000, listPrice: 1_000_000, quantity: 3 });
    expect(line.lineTotal).toBe(2_550_000);
    expect(line.lineDiscount).toBe(450_000);
  });

  it('adds shipping to the subtotal, not to the discount', () => {
    const lines = [
      priceLine({ unitPrice: 850_000, listPrice: 1_000_000, quantity: 2 }),
      priceLine({ unitPrice: 145_000, listPrice: 145_000, quantity: 1 }),
    ];
    const totals = computeTotals(lines, 85_000);
    expect(totals.subtotal).toBe(1_845_000);
    expect(totals.discountTotal).toBe(300_000);
    expect(totals.shippingTotal).toBe(85_000);
    expect(totals.grandTotal).toBe(1_930_000);
    expect(totals.itemCount).toBe(3);
  });

  it('sums line weights for weight-based shipping', () => {
    expect(totalWeightGrams([{ quantity: 2, weightGrams: 1250 }, { quantity: 1, weightGrams: null }])).toBe(2500);
  });
});

describe('inventory rules', () => {
  const level = (onHand: number, reserved: number, threshold = 3) => ({
    quantityOnHand: onHand, quantityReserved: reserved, lowStockThreshold: threshold,
  });

  it('reports available as on-hand minus reserved, never negative', () => {
    expect(availableQuantity(level(10, 3))).toBe(7);
    expect(availableQuantity(level(2, 5))).toBe(0);
  });

  it('classifies stock status against the threshold', () => {
    expect(stockStatus(level(10, 0))).toBe('IN_STOCK');
    expect(stockStatus(level(3, 0))).toBe('LOW_STOCK');
    expect(stockStatus(level(5, 5))).toBe('OUT_OF_STOCK');
  });

  it('refuses to reserve more than is available', () => {
    expect(canReserve(level(5, 4), 1)).toBe(true);
    expect(canReserve(level(5, 4), 2)).toBe(false);
    expect(canReserve(level(5, 0), 0)).toBe(false);
  });

  it('clamps cart quantity by availability and the per-line cap', () => {
    expect(clampCartQuantity(50, 100)).toBe(20);
    expect(clampCartQuantity(5, 3)).toBe(3);
    expect(clampCartQuantity(-1, 10)).toBe(0);
  });
});

describe('shipping quotes', () => {
  const method = (o: Partial<ShippingMethodConfig> = {}): ShippingMethodConfig => ({
    id: 'm1', code: 'post', kind: 'POST', nameFa: 'پست پیشتاز', description: null,
    baseCost: 85_000, perKgCost: 18_000, freeOverSubtotal: null,
    estimatedDaysMin: 2, estimatedDaysMax: 5, availableProvinces: [],
    isActive: true, sortOrder: 10, ...o,
  });

  it('charges base plus rounded-up kilograms', () => {
    const q = quoteShipping({ method: method(), province: 'تهران', subtotal: 1_000_000, totalWeightGrams: 2_100 });
    expect(q.cost).toBe(85_000 + 18_000 * 3);
  });

  it('applies a province surcharge', () => {
    const q = quoteShipping({
      method: method(), province: 'هرمزگان', subtotal: 1_000_000, totalWeightGrams: 500,
      rate: { methodId: 'm1', province: 'هرمزگان', costOverride: null, surcharge: 45_000 },
    });
    expect(q.cost).toBe(85_000 + 18_000 + 45_000);
  });

  it('lets a province override replace the computed cost entirely', () => {
    const q = quoteShipping({
      method: method(), province: 'تهران', subtotal: 1_000_000, totalWeightGrams: 9_000,
      rate: { methodId: 'm1', province: 'تهران', costOverride: 50_000, surcharge: 999_999 },
    });
    expect(q.cost).toBe(50_000);
  });

  it('makes shipping free above the configured threshold', () => {
    const m = method({ freeOverSubtotal: 8_000_000 });
    expect(quoteShipping({ method: m, province: 'تهران', subtotal: 8_000_000, totalWeightGrams: 5_000 }).cost).toBe(0);
    expect(quoteShipping({ method: m, province: 'تهران', subtotal: 7_999_999, totalWeightGrams: 500 }).isFree).toBe(false);
  });

  it('restricts methods to their configured provinces', () => {
    const courier = method({ code: 'courier', availableProvinces: ['تهران', 'البرز'] });
    expect(isMethodAvailableInProvince(courier, 'تهران')).toBe(true);
    expect(isMethodAvailableInProvince(courier, 'فارس')).toBe(false);
    expect(isMethodAvailableInProvince(method(), 'فارس')).toBe(true);
    expect(isMethodAvailableInProvince(method({ isActive: false }), 'تهران')).toBe(false);
  });

  it('returns province-eligible methods in sort order', () => {
    const quotes = quoteAll(
      [method({ id: 'a', code: 'post', sortOrder: 20 }), method({ id: 'b', code: 'courier', sortOrder: 5, availableProvinces: ['تهران'] })],
      [], 'تهران', 1_000_000, 500,
    );
    expect(quotes.map((q) => q.methodCode)).toEqual(['courier', 'post']);
  });
});
