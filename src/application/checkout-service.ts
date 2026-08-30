/**
 * Checkout.
 *
 * Trust boundary: the browser sends *what* to buy (product ids, quantities), a
 * destination and a shipping method **code**. Everything with a price attached —
 * unit prices, line totals, shipping cost, grand total — is recomputed here from
 * database rows inside the same transaction that reserves the stock. A tampered
 * price, a stale price, or a sale that ended between page load and submit all
 * resolve to the current server-side value.
 *
 * Ordering of work inside `placeOrder`:
 *   1. re-read cart lines and lock nothing yet;
 *   2. re-price from live product rows, rejecting inactive products;
 *   3. quote shipping server-side;
 *   4. insert the order + immutable item snapshot;
 *   5. reserve stock — this takes the `FOR UPDATE` row locks and is the step
 *      that fails, and rolls the whole order back, when someone else won the
 *      race for the last unit;
 *   6. record the payment intent, the audit event, and empty the cart.
 *
 * The gateway call happens *after* commit: holding database locks across a
 * network round-trip would serialise the whole shop behind one slow gateway.
 */
import { eq, sql } from 'drizzle-orm';
import { getDb, withTransaction, type Database } from '@/infrastructure/db/client';
import {
  cartItems,
  orderEvents,
  orderItems,
  orders,
  payments,
  shipments,
} from '@/infrastructure/db/schema';
import { errors } from '@/domain/errors';
import { computeTotals, effectivePrice, priceLine, type PricedLine } from '@/domain/pricing';
import { generateOrderNumber, randomToken } from '@/lib/crypto';
import { findCartId, getCartView, type CartIdentity, type CartView } from './cart-service';
import { getShippingOptions, quoteMethodOrThrow } from './shipping-service';
import { reserveStock } from './inventory-service';
import { getPaymentProvider, getDefaultProviderId, listAvailableProviders } from './payment/registry';
import type { ShippingQuote } from '@/domain/shipping';
import { markOrderPaid } from './order-service';

export interface CheckoutQuote {
  cart: CartView;
  shippingOptions: ShippingQuote[];
  selectedShipping: ShippingQuote | null;
  paymentProviders: {
    id: string;
    displayNameFa: string;
    descriptionFa: string;
    isSandbox: boolean;
    confirmsWithoutPayment: boolean;
  }[];
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  grandTotal: number;
}

/** Priced preview for the checkout page. Never persists anything. */
export async function quoteCheckout(
  identity: CartIdentity,
  province: string | null,
  shippingMethodCode: string | null,
  db: Database = getDb(),
): Promise<CheckoutQuote> {
  const cart = await getCartView(identity, db);
  const shippingOptions = province
    ? await getShippingOptions(province, cart.subtotal, cart.totalWeightGrams, db)
    : [];

  const selectedShipping =
    shippingOptions.find((o) => o.methodCode === shippingMethodCode) ?? shippingOptions[0] ?? null;
  const shippingTotal = selectedShipping?.cost ?? 0;

  return {
    cart,
    shippingOptions,
    selectedShipping,
    paymentProviders: listAvailableProviders().map((p) => ({
      id: p.id,
      displayNameFa: p.displayNameFa,
      descriptionFa: p.descriptionFa,
      isSandbox: p.isSandbox,
      confirmsWithoutPayment: p.confirmsWithoutPayment,
    })),
    subtotal: cart.subtotal,
    discountTotal: cart.discountTotal,
    shippingTotal,
    grandTotal: cart.subtotal + shippingTotal,
  };
}

export interface PlaceOrderInput {
  fullName: string;
  phone: string;
  email?: string | undefined;
  province: string;
  city: string;
  postalAddress: string;
  postalCode: string;
  deliveryNotes?: string | undefined;
  shippingMethodCode: string;
  paymentProvider?: string | undefined;
}

export interface PlaceOrderResult {
  orderId: string;
  orderNumber: string;
  trackingToken: string;
  grandTotal: number;
  /** Where to send the browser next: gateway URL, or the confirmation page. */
  redirectUrl: string;
  requiresPayment: boolean;
}

interface PricedCartLine extends PricedLine {
  productId: string;
  sku: string;
  titleFa: string;
  brandName: string | null;
  oemNumber: string | null;
  imageUrl: string | null;
  slug: string;
  weightGrams: number | null;
}

export async function placeOrder(
  identity: CartIdentity,
  input: PlaceOrderInput,
  context: { userId: string | null; siteUrl: string },
): Promise<PlaceOrderResult> {
  const providerId = input.paymentProvider ?? getDefaultProviderId();
  // Resolve (and validate configuration of) the provider before writing anything.
  const provider = getPaymentProvider(providerId);

  const placed = await withTransaction(async (tx) => {
    const cartId = await findCartId(identity, tx);
    if (!cartId) throw errors.cartEmpty();

    // Re-read every line straight from the product table: this is the authority
    // on price and availability, not whatever the cart page rendered earlier.
    const rows = await tx.execute<{
      product_id: string; slug: string; sku: string; title_fa: string; oem_number: string | null;
      brand_name: string | null; image_url: string | null; price: string | number;
      sale_price: string | number | null; quantity: number; is_active: boolean;
      weight_grams: number | null;
    }>(sql`
      select ci.product_id, p.slug, p.sku, p.title_fa, p.oem_number, b.name_fa as brand_name,
        (select pi.url from product_images pi where pi.product_id = p.id
          order by pi.is_primary desc, pi.sort_order asc limit 1) as image_url,
        p.price, p.sale_price, ci.quantity, p.is_active, p.weight_grams
      from cart_items ci
      join products p on p.id = ci.product_id
      left join brands b on b.id = p.brand_id
      where ci.cart_id = ${cartId}
      order by ci.added_at asc
    `);

    if (rows.rows.length === 0) throw errors.cartEmpty();

    const lines: PricedCartLine[] = [];
    for (const r of rows.rows) {
      if (!r.is_active) throw errors.productUnavailable(r.title_fa);
      const listPrice = Number(r.price);
      const salePrice = r.sale_price === null ? null : Number(r.sale_price);
      const unitPrice = effectivePrice({ price: listPrice, salePrice });
      const priced = priceLine({ unitPrice, listPrice, quantity: r.quantity });
      lines.push({
        ...priced,
        productId: r.product_id,
        sku: r.sku,
        titleFa: r.title_fa,
        brandName: r.brand_name,
        oemNumber: r.oem_number,
        imageUrl: r.image_url,
        slug: r.slug,
        weightGrams: r.weight_grams,
      });
    }

    const totalWeightGrams = lines.reduce((n, l) => n + (l.weightGrams ?? 0) * l.quantity, 0);
    const preliminary = computeTotals(lines, 0);

    // Shipping is quoted server-side from the method *code*; the client never
    // supplies a shipping amount.
    const shipping = await quoteMethodOrThrow(
      input.shippingMethodCode,
      input.province,
      preliminary.subtotal,
      totalWeightGrams,
      tx,
    );

    const totals = computeTotals(lines, shipping.cost);
    const ttlMinutes = Number(process.env.ORDER_PAYMENT_TTL_MINUTES ?? 30);
    const trackingToken = randomToken(24);

    const [order] = await tx
      .insert(orders)
      .values({
        orderNumber: generateOrderNumber(),
        userId: context.userId,
        status: 'PENDING_PAYMENT',
        customerFullName: input.fullName,
        customerPhone: input.phone,
        customerEmail: input.email ?? null,
        shippingProvince: input.province,
        shippingCity: input.city,
        shippingAddress: input.postalAddress,
        shippingPostalCode: input.postalCode,
        deliveryNotes: input.deliveryNotes ?? null,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        shippingTotal: totals.shippingTotal,
        grandTotal: totals.grandTotal,
        shippingMethodCode: shipping.methodCode,
        shippingMethodName: shipping.methodName,
        trackingToken,
        paymentProvider: provider.id,
        reservationExpiresAt: provider.confirmsWithoutPayment
          ? null
          : new Date(Date.now() + ttlMinutes * 60_000),
      })
      .returning();

    if (!order) throw errors.conflict('ثبت سفارش انجام نشد.');

    await tx.insert(orderItems).values(
      lines.map((l) => ({
        orderId: order.id,
        productId: l.productId,
        sku: l.sku,
        titleFa: l.titleFa,
        brandName: l.brandName,
        oemNumber: l.oemNumber,
        imageUrl: l.imageUrl,
        productSlug: l.slug,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        lineTotal: l.lineTotal,
        weightGrams: l.weightGrams,
      })),
    );

    // Takes the inventory row locks. Fails the whole transaction if any line is
    // no longer available — including a concurrent buyer taking the last unit.
    await reserveStock(
      tx,
      lines.map((l) => ({ productId: l.productId, quantity: l.quantity, title: l.titleFa })),
      order.id,
      context.userId,
    );

    await tx.insert(payments).values({
      orderId: order.id,
      provider: provider.id,
      status: 'INITIATED',
      amount: totals.grandTotal,
      meta: provider.confirmsWithoutPayment ? { collectOnDelivery: true } : { sandbox: provider.isSandbox },
    });

    await tx.insert(shipments).values({
      orderId: order.id,
      methodCode: shipping.methodCode,
      carrier: shipping.methodName,
      cost: shipping.cost,
      status: 'PENDING',
    });

    await tx.insert(orderEvents).values({
      orderId: order.id,
      toStatus: 'PENDING_PAYMENT',
      eventType: 'ORDER_PLACED',
      message: 'سفارش ثبت شد و موجودی کالاها رزرو گردید.',
      actorType: context.userId ? 'customer' : 'system',
      actorUserId: context.userId,
      isPublic: true,
    });

    await tx.delete(cartItems).where(eq(cartItems.cartId, cartId));

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      trackingToken,
      grandTotal: totals.grandTotal,
    };
  });

  // ── outside the transaction: talk to the gateway ──────────────────────────
  const callbackUrl = `${context.siteUrl}/api/payments/${provider.id}/callback`;

  let init;
  try {
    init = await provider.initiate({
      orderId: placed.orderId,
      orderNumber: placed.orderNumber,
      amount: placed.grandTotal,
      description: `پرداخت سفارش ${placed.orderNumber}`,
      callbackUrl,
      customer: { fullName: input.fullName, phone: input.phone, email: input.email ?? null },
    });
  } catch (e) {
    // The order stays PENDING_PAYMENT and its reservation expires on schedule,
    // so a gateway outage cannot strand stock.
    await getDb()
      .insert(orderEvents)
      .values({
        orderId: placed.orderId,
        eventType: 'PAYMENT_INIT_FAILED',
        message: 'اتصال به درگاه پرداخت برقرار نشد.',
        actorType: 'system',
        isPublic: false,
      });
    console.error('[checkout] payment initiate failed:', e);
    throw errors.paymentFailed('اتصال به درگاه پرداخت ممکن نشد. سفارش شما ثبت شد؛ می‌توانید دوباره پرداخت کنید.');
  }

  await getDb()
    .update(payments)
    .set({ providerRef: init.providerRef, meta: init.meta ?? null, updatedAt: new Date() })
    .where(eq(payments.orderId, placed.orderId));

  if (provider.confirmsWithoutPayment) {
    // Cash on delivery: confirm now, collect later. The payment row stays
    // INITIATED so the outstanding amount remains visible to the admin.
    await markOrderPaid(placed.orderId, {
      actorType: 'system',
      message: 'سفارش با روش «پرداخت در محل» تأیید شد؛ مبلغ هنگام تحویل دریافت می‌شود.',
      settlePayment: false,
    });
    return {
      ...placed,
      redirectUrl: `/orders/confirmation/${placed.trackingToken}`,
      requiresPayment: false,
    };
  }

  return {
    ...placed,
    redirectUrl: init.redirectUrl ?? `/orders/confirmation/${placed.trackingToken}`,
    requiresPayment: true,
  };
}
