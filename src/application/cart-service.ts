/**
 * Cart service.
 *
 * A cart is identified either by the signed-in user or by an opaque guest
 * cookie (stored only as a SHA-256 hash). Prices are *never* read from the
 * client: `getCartView` recomputes every line from the current product row, and
 * checkout recomputes again inside its transaction.
 */
import { and, eq, sql } from 'drizzle-orm';
import { getDb, withTransaction, type Database } from '@/infrastructure/db/client';
import { cartItems, carts } from '@/infrastructure/db/schema';
import { errors } from '@/domain/errors';
import { effectivePrice, priceLine, computeTotals, type PricedLine } from '@/domain/pricing';
import { MAX_QUANTITY_PER_LINE, stockStatus, type StockStatus } from '@/domain/inventory';
import { sha256 } from '@/lib/crypto';
import { toPersianDigits } from '@/lib/fa';

export interface CartIdentity {
  readonly userId?: string | null;
  readonly anonToken?: string | null;
}

export interface CartLine {
  productId: string;
  slug: string;
  sku: string;
  titleFa: string;
  brandName: string | null;
  imageUrl: string | null;
  listPrice: number;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  lineDiscount: number;
  quantityAvailable: number;
  stockStatus: StockStatus;
  /** True when the requested quantity exceeds what is currently available. */
  hasStockIssue: boolean;
  isActive: boolean;
  weightGrams: number | null;
}

export interface CartView {
  cartId: string | null;
  lines: CartLine[];
  subtotal: number;
  discountTotal: number;
  itemCount: number;
  totalWeightGrams: number;
  /** Persian messages for lines that changed availability since they were added. */
  issues: string[];
}

export const EMPTY_CART: CartView = {
  cartId: null,
  lines: [],
  subtotal: 0,
  discountTotal: 0,
  itemCount: 0,
  totalWeightGrams: 0,
  issues: [],
};

function identityCondition(identity: CartIdentity) {
  if (identity.userId) return eq(carts.userId, identity.userId);
  if (identity.anonToken) return eq(carts.anonTokenHash, sha256(identity.anonToken));
  return null;
}

export async function findCartId(identity: CartIdentity, db: Database = getDb()): Promise<string | null> {
  const condition = identityCondition(identity);
  if (!condition) return null;
  const [row] = await db.select({ id: carts.id }).from(carts).where(condition).limit(1);
  return row?.id ?? null;
}

async function getOrCreateCartId(identity: CartIdentity, db: Database = getDb()): Promise<string> {
  const existing = await findCartId(identity, db);
  if (existing) return existing;

  if (!identity.userId && !identity.anonToken) {
    throw errors.validation('برای افزودن کالا به سبد، شناسه سبد خرید لازم است.');
  }

  // ON CONFLICT covers the race where two parallel requests both create a cart.
  const [row] = await db
    .insert(carts)
    .values({
      userId: identity.userId ?? null,
      anonTokenHash: identity.anonToken ? sha256(identity.anonToken) : null,
    })
    .onConflictDoNothing()
    .returning({ id: carts.id });

  if (row) return row.id;
  const retry = await findCartId(identity, db);
  if (!retry) throw errors.conflict('ایجاد سبد خرید ممکن نشد. لطفاً دوباره تلاش کنید.');
  return retry;
}

/**
 * Reads the cart and re-prices it from live product rows.
 * Returns availability problems as Persian messages rather than throwing, so the
 * cart page can render them next to each line.
 */
export async function getCartView(identity: CartIdentity, db: Database = getDb()): Promise<CartView> {
  const cartId = await findCartId(identity, db);
  if (!cartId) return EMPTY_CART;

  const rows = await db.execute<{
    product_id: string; slug: string; sku: string; title_fa: string; brand_name: string | null;
    image_url: string | null; price: string | number; sale_price: string | number | null;
    quantity: number; quantity_available: number; low_stock_threshold: number;
    is_active: boolean; weight_grams: number | null;
  }>(sql`
    select ci.product_id, p.slug, p.sku, p.title_fa, b.name_fa as brand_name,
      (select pi.url from product_images pi where pi.product_id = p.id
        order by pi.is_primary desc, pi.sort_order asc limit 1) as image_url,
      p.price, p.sale_price, ci.quantity, p.is_active, p.weight_grams,
      greatest(0, coalesce(inv.quantity_on_hand,0) - coalesce(inv.quantity_reserved,0)) as quantity_available,
      coalesce(inv.low_stock_threshold, 3) as low_stock_threshold
    from cart_items ci
    join products p on p.id = ci.product_id
    left join brands b on b.id = p.brand_id
    left join inventory inv on inv.product_id = p.id
    where ci.cart_id = ${cartId}
    order by ci.added_at asc
  `);

  const lines: CartLine[] = [];
  const priced: PricedLine[] = [];
  const issues: string[] = [];

  for (const r of rows.rows) {
    const listPrice = Number(r.price);
    const salePrice = r.sale_price === null ? null : Number(r.sale_price);
    const unitPrice = effectivePrice({ price: listPrice, salePrice });
    const available = Number(r.quantity_available);
    const p = priceLine({ unitPrice, listPrice, quantity: r.quantity });
    priced.push(p);

    const hasStockIssue = !r.is_active || available < r.quantity;
    if (!r.is_active) issues.push(`«${r.title_fa}» دیگر در فروشگاه موجود نیست و باید از سبد حذف شود.`);
    else if (available <= 0) issues.push(`موجودی «${r.title_fa}» به پایان رسیده است.`);
    else if (available < r.quantity)
      issues.push(`تنها ${toPersianDigits(available)} عدد از «${r.title_fa}» موجود است؛ تعداد سبد را کاهش دهید.`);

    lines.push({
      productId: r.product_id,
      slug: r.slug,
      sku: r.sku,
      titleFa: r.title_fa,
      brandName: r.brand_name,
      imageUrl: r.image_url,
      listPrice,
      unitPrice,
      quantity: r.quantity,
      lineTotal: p.lineTotal,
      lineDiscount: p.lineDiscount,
      quantityAvailable: available,
      stockStatus: stockStatus({
        quantityOnHand: available,
        quantityReserved: 0,
        lowStockThreshold: Number(r.low_stock_threshold),
      }),
      hasStockIssue,
      isActive: r.is_active,
      weightGrams: r.weight_grams,
    });
  }

  const totals = computeTotals(priced, 0);
  return {
    cartId,
    lines,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    itemCount: totals.itemCount,
    totalWeightGrams: lines.reduce((n, l) => n + (l.weightGrams ?? 0) * l.quantity, 0),
    issues,
  };
}

/** Adds to (or tops up) a line, capped by both live stock and the per-line max. */
export async function addToCart(
  identity: CartIdentity,
  productId: string,
  quantity: number,
): Promise<CartView> {
  if (quantity < 1) throw errors.validation('تعداد باید حداقل ۱ باشد.');

  await withTransaction(async (tx) => {
    const cartId = await getOrCreateCartId(identity, tx);

    const [product] = await tx.execute<{
      title_fa: string; is_active: boolean; quantity_available: number;
    }>(sql`
      select p.title_fa, p.is_active,
        greatest(0, coalesce(inv.quantity_on_hand,0) - coalesce(inv.quantity_reserved,0)) as quantity_available
      from products p left join inventory inv on inv.product_id = p.id
      where p.id = ${productId}
      limit 1
    `).then((r) => r.rows);

    if (!product) throw errors.notFound('کالای موردنظر یافت نشد.');
    if (!product.is_active) throw errors.productUnavailable(product.title_fa);

    const available = Number(product.quantity_available);
    if (available <= 0) throw errors.outOfStock(product.title_fa);

    const [existing] = await tx
      .select({ quantity: cartItems.quantity })
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)))
      .limit(1);

    const desired = (existing?.quantity ?? 0) + quantity;
    if (desired > MAX_QUANTITY_PER_LINE) {
      throw errors.validation(
        `حداکثر ${toPersianDigits(MAX_QUANTITY_PER_LINE)} عدد از هر کالا در یک سفارش قابل خرید است.`,
      );
    }
    if (desired > available) throw errors.insufficientStock(product.title_fa, available);

    await tx
      .insert(cartItems)
      .values({ cartId, productId, quantity: desired })
      .onConflictDoUpdate({
        target: [cartItems.cartId, cartItems.productId],
        set: { quantity: desired },
      });

    await tx.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
  });

  return getCartView(identity);
}

/** Sets an exact quantity; `0` removes the line. */
export async function updateCartQuantity(
  identity: CartIdentity,
  productId: string,
  quantity: number,
): Promise<CartView> {
  if (quantity < 0) throw errors.validation('تعداد نمی‌تواند منفی باشد.');
  if (quantity > MAX_QUANTITY_PER_LINE) {
    throw errors.validation(`حداکثر ${toPersianDigits(MAX_QUANTITY_PER_LINE)} عدد از هر کالا قابل سفارش است.`);
  }

  const cartId = await findCartId(identity);
  if (!cartId) return EMPTY_CART;

  if (quantity === 0) {
    await getDb().delete(cartItems).where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));
    return getCartView(identity);
  }

  await withTransaction(async (tx) => {
    const [product] = await tx.execute<{ title_fa: string; is_active: boolean; quantity_available: number }>(sql`
      select p.title_fa, p.is_active,
        greatest(0, coalesce(inv.quantity_on_hand,0) - coalesce(inv.quantity_reserved,0)) as quantity_available
      from products p left join inventory inv on inv.product_id = p.id
      where p.id = ${productId} limit 1
    `).then((r) => r.rows);

    if (!product) throw errors.notFound('کالای موردنظر یافت نشد.');
    if (!product.is_active) throw errors.productUnavailable(product.title_fa);

    const available = Number(product.quantity_available);
    if (quantity > available) {
      if (available <= 0) throw errors.outOfStock(product.title_fa);
      throw errors.insufficientStock(product.title_fa, available);
    }

    const updated = await tx
      .update(cartItems)
      .set({ quantity })
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)))
      .returning({ id: cartItems.id });

    if (updated.length === 0) throw errors.notFound('این کالا در سبد خرید شما نیست.');
    await tx.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
  });

  return getCartView(identity);
}

export async function removeFromCart(identity: CartIdentity, productId: string): Promise<CartView> {
  const cartId = await findCartId(identity);
  if (!cartId) return EMPTY_CART;
  await getDb().delete(cartItems).where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));
  return getCartView(identity);
}

export async function clearCart(identity: CartIdentity, db: Database = getDb()): Promise<void> {
  const cartId = await findCartId(identity, db);
  if (!cartId) return;
  await db.delete(cartItems).where(eq(cartItems.cartId, cartId));
}

export async function clearCartById(cartId: string, db: Database = getDb()): Promise<void> {
  await db.delete(cartItems).where(eq(cartItems.cartId, cartId));
}

/** Badge count for the header. Cheap: one aggregate, no product join. */
export async function getCartItemCount(identity: CartIdentity, db: Database = getDb()): Promise<number> {
  const cartId = await findCartId(identity, db);
  if (!cartId) return 0;
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${cartItems.quantity}), 0)::int` })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId));
  return row?.n ?? 0;
}
