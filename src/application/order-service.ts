/**
 * Order lifecycle, payment settlement and tracking.
 *
 * Every status change goes through `applyTransition`, which:
 *   • locks the order row (`FOR UPDATE`) so two admins — or an admin and a
 *     gateway callback — cannot both act on the same order;
 *   • validates the move against the domain state machine;
 *   • performs the matching inventory side effect exactly once;
 *   • appends an audit row to `order_events`.
 *
 * Payment callbacks are idempotent: a gateway retrying a webhook, or a customer
 * refreshing the return URL, converges on the same state instead of fulfilling
 * stock twice.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, withTransaction, type Database } from '@/infrastructure/db/client';
import {
  orderEvents,
  orderItems,
  orders,
  payments,
  shipments,
  users,
} from '@/infrastructure/db/schema';
import { errors } from '@/domain/errors';
import {
  assertTransition,
  holdsReservation,
  ORDER_STATUS_LABEL_FA,
  type OrderStatus,
} from '@/domain/order-status';
import { fulfillReservation, releaseReservation, returnStock } from './inventory-service';
import { getPaymentProvider } from './payment/registry';
import { generateTrackingCode } from '@/lib/crypto';

export type OrderActor = 'customer' | 'admin' | 'system' | 'gateway';

interface TransitionOptions {
  actorType: OrderActor;
  actorUserId?: string | null;
  message?: string;
  isPublic?: boolean;
  eventType?: string;
  /** Guard: refuse unless the order is currently in one of these statuses. */
  expectedFrom?: readonly OrderStatus[];
}

/** Locks one order row for update and returns its current status. */
async function lockOrder(tx: Database, orderId: string) {
  const [row] = await tx
    .select({
      id: orders.id,
      status: orders.status,
      grandTotal: orders.grandTotal,
      orderNumber: orders.orderNumber,
      userId: orders.userId,
      trackingToken: orders.trackingToken,
      paymentProvider: orders.paymentProvider,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .for('update')
    .limit(1);
  if (!row) throw errors.notFound('سفارش یافت نشد.');
  return row;
}

/**
 * The single writer for `orders.status`. Inventory effects are keyed off the
 * transition, so they cannot drift from the state machine.
 */
async function applyTransition(
  tx: Database,
  orderId: string,
  to: OrderStatus,
  options: TransitionOptions,
): Promise<{ from: OrderStatus; to: OrderStatus }> {
  const order = await lockOrder(tx, orderId);
  const from = order.status;

  if (options.expectedFrom && !options.expectedFrom.includes(from)) {
    throw errors.conflict(
      `این عملیات روی سفارشی در وضعیت «${ORDER_STATUS_LABEL_FA[from]}» قابل انجام نیست.`,
    );
  }

  assertTransition(from, to);

  const now = new Date();
  const patch: Partial<typeof orders.$inferInsert> = { status: to, updatedAt: now };

  if (to === 'PAID') {
    patch.paidAt = now;
    patch.reservationExpiresAt = null;
    // Reservation becomes a real deduction exactly once, here.
    await fulfillReservation(tx, orderId, 'خروج از انبار پس از تأیید پرداخت', options.actorUserId ?? null);
  }

  if (to === 'CANCELLED') {
    patch.cancelledAt = now;
    patch.reservationExpiresAt = null;
    if (holdsReservation(from)) {
      // Never paid: give the held units straight back.
      await releaseReservation(tx, orderId, 'آزادسازی رزرو پس از لغو سفارش', options.actorUserId ?? null);
    } else {
      // Already deducted from stock: put the units back on the shelf.
      await returnStock(tx, orderId, 'بازگشت کالا به انبار پس از لغو سفارش', options.actorUserId ?? null);
    }
  }

  if (to === 'REFUNDED') {
    await returnStock(tx, orderId, 'بازگشت کالا به انبار پس از بازپرداخت', options.actorUserId ?? null);
    await tx
      .update(payments)
      .set({ status: 'REFUNDED', updatedAt: now })
      .where(and(eq(payments.orderId, orderId), eq(payments.status, 'SUCCEEDED')));
  }

  await tx.update(orders).set(patch).where(eq(orders.id, orderId));

  await tx.insert(orderEvents).values({
    orderId,
    fromStatus: from,
    toStatus: to,
    eventType: options.eventType ?? 'STATUS_CHANGED',
    message: options.message ?? `وضعیت سفارش به «${ORDER_STATUS_LABEL_FA[to]}» تغییر کرد.`,
    actorType: options.actorType,
    actorUserId: options.actorUserId ?? null,
    isPublic: options.isPublic ?? true,
  });

  // Keep the shipment row in step with the order.
  if (to === 'SHIPPED') {
    await tx
      .update(shipments)
      .set({ status: 'IN_TRANSIT', shippedAt: now, updatedAt: now })
      .where(eq(shipments.orderId, orderId));
  }
  if (to === 'DELIVERED') {
    await tx
      .update(shipments)
      .set({ status: 'DELIVERED', deliveredAt: now, updatedAt: now })
      .where(eq(shipments.orderId, orderId));
  }
  if (to === 'PACKED') {
    await tx.update(shipments).set({ status: 'READY', updatedAt: now }).where(eq(shipments.orderId, orderId));
  }

  return { from, to };
}

/** Admin/system status change. */
export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  options: TransitionOptions,
): Promise<{ from: OrderStatus; to: OrderStatus }> {
  return withTransaction((tx) => applyTransition(tx, orderId, to, options));
}

export async function markOrderPaid(
  orderId: string,
  options: {
    actorType: OrderActor;
    actorUserId?: string | null;
    message?: string;
    /** Whether to flip the payment row to SUCCEEDED (false for cash on delivery). */
    settlePayment: boolean;
    transactionId?: string | null;
    providerRef?: string | null;
  },
): Promise<void> {
  await withTransaction(async (tx) => {
    await applyTransition(tx, orderId, 'PAID', {
      actorType: options.actorType,
      actorUserId: options.actorUserId ?? null,
      eventType: 'PAYMENT_CONFIRMED',
      message: options.message ?? 'پرداخت سفارش با موفقیت تأیید شد.',
      expectedFrom: ['PENDING_PAYMENT'],
    });

    if (options.settlePayment) {
      await tx
        .update(payments)
        .set({
          status: 'SUCCEEDED',
          transactionId: options.transactionId ?? null,
          providerRef: options.providerRef ?? undefined,
          updatedAt: new Date(),
        })
        .where(and(eq(payments.orderId, orderId), eq(payments.status, 'INITIATED')));
    }
  });
}

export async function cancelOrder(
  orderId: string,
  options: { actorType: OrderActor; actorUserId?: string | null; reason?: string },
): Promise<void> {
  await transitionOrder(orderId, 'CANCELLED', {
    actorType: options.actorType,
    actorUserId: options.actorUserId ?? null,
    eventType: 'ORDER_CANCELLED',
    message: options.reason ?? 'سفارش لغو شد.',
  });
}

/* ── payment callback ─────────────────────────────────────────────────── */

export interface CallbackResult {
  orderId: string | null;
  orderNumber: string | null;
  trackingToken: string | null;
  outcome: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'ALREADY_SETTLED';
  message: string;
}

/**
 * Handles a gateway return/webhook. Safe to call repeatedly with the same
 * parameters: the order row is locked first and an already-settled order short-
 * circuits before any inventory effect runs.
 */
export async function handlePaymentCallback(
  providerId: string,
  params: Record<string, string>,
): Promise<CallbackResult> {
  const provider = getPaymentProvider(providerId);
  const orderId = params.order ?? params.orderId ?? '';

  if (!orderId) {
    return {
      orderId: null, orderNumber: null, trackingToken: null,
      outcome: 'FAILED', message: 'شناسه سفارش در پاسخ درگاه وجود ندارد.',
    };
  }

  const db = getDb();
  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      grandTotal: orders.grandTotal,
      trackingToken: orders.trackingToken,
      paymentProvider: orders.paymentProvider,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) {
    return {
      orderId: null, orderNumber: null, trackingToken: null,
      outcome: 'FAILED', message: 'سفارش مرتبط با این پرداخت یافت نشد.',
    };
  }

  // A callback for a different provider than the one the order was created with
  // is always a forgery attempt or a misconfiguration.
  if (order.paymentProvider !== providerId) {
    await db.insert(orderEvents).values({
      orderId: order.id,
      eventType: 'PAYMENT_CALLBACK_REJECTED',
      message: `پاسخ درگاه «${providerId}» با روش پرداخت ثبت‌شده سفارش مطابقت ندارد.`,
      actorType: 'system',
      isPublic: false,
    });
    return {
      orderId: order.id, orderNumber: order.orderNumber, trackingToken: order.trackingToken,
      outcome: 'FAILED', message: 'پاسخ دریافتی با روش پرداخت این سفارش مطابقت ندارد.',
    };
  }

  if (order.status !== 'PENDING_PAYMENT') {
    // Retry / refresh of an already-processed callback.
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      trackingToken: order.trackingToken,
      outcome: order.status === 'CANCELLED' ? 'FAILED' : 'ALREADY_SETTLED',
      message:
        order.status === 'CANCELLED'
          ? 'این سفارش پیش‌تر لغو شده است.'
          : 'این پرداخت پیش‌تر ثبت شده است.',
    };
  }

  const [paymentRow] = await db
    .select({ providerRef: payments.providerRef })
    .from(payments)
    .where(eq(payments.orderId, order.id))
    .orderBy(desc(payments.createdAt))
    .limit(1);

  const verification = await provider.verify({
    orderId: order.id,
    orderNumber: order.orderNumber,
    expectedAmount: order.grandTotal,
    providerRef: paymentRow?.providerRef ?? null,
    params,
  });

  if (verification.outcome !== 'SUCCEEDED') {
    await withTransaction(async (tx) => {
      await tx
        .update(payments)
        .set({
          status: verification.outcome === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
          failureReason: verification.failureReason ?? null,
          meta: verification.meta ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(payments.orderId, order.id), eq(payments.status, 'INITIATED')));

      await tx.insert(orderEvents).values({
        orderId: order.id,
        eventType: 'PAYMENT_FAILED',
        message: verification.failureReason ?? 'پرداخت ناموفق بود.',
        actorType: 'gateway',
        isPublic: true,
      });
    });
    // Stock stays reserved until the TTL expires, so the customer can retry.
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      trackingToken: order.trackingToken,
      outcome: verification.outcome,
      message: verification.failureReason ?? 'پرداخت ناموفق بود.',
    };
  }

  // Amount tampering check: a "successful" payment for the wrong amount is
  // treated as a failure, never as a paid order.
  if (
    verification.amount !== null &&
    verification.amount !== undefined &&
    verification.amount !== order.grandTotal
  ) {
    await db.insert(orderEvents).values({
      orderId: order.id,
      eventType: 'PAYMENT_AMOUNT_MISMATCH',
      message: `مبلغ تأییدشده (${verification.amount}) با مبلغ سفارش (${order.grandTotal}) مطابقت ندارد.`,
      actorType: 'system',
      isPublic: false,
    });
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      trackingToken: order.trackingToken,
      outcome: 'FAILED',
      message: 'مبلغ پرداخت‌شده با مبلغ سفارش مطابقت ندارد. لطفاً با پشتیبانی تماس بگیرید.',
    };
  }

  try {
    await markOrderPaid(order.id, {
      actorType: 'gateway',
      settlePayment: true,
      transactionId: verification.transactionId ?? null,
      providerRef: verification.providerRef,
      message: 'پرداخت با موفقیت انجام و تأیید شد.',
    });
  } catch (e) {
    // Lost the race against a concurrent callback: the other one already paid it.
    const [current] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id)).limit(1);
    if (current && current.status !== 'PENDING_PAYMENT') {
      return {
        orderId: order.id, orderNumber: order.orderNumber, trackingToken: order.trackingToken,
        outcome: 'ALREADY_SETTLED', message: 'این پرداخت پیش‌تر ثبت شده است.',
      };
    }
    throw e;
  }

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    trackingToken: order.trackingToken,
    outcome: 'SUCCEEDED',
    message: 'پرداخت با موفقیت انجام شد.',
  };
}

/* ── reservation sweeper ──────────────────────────────────────────────── */

/**
 * Cancels unpaid orders whose reservation window has passed and returns the
 * held stock. Idempotent and safe to run concurrently: each order is locked and
 * re-checked inside its own transaction.
 */
export async function expireStaleOrders(now: Date = new Date()): Promise<number> {
  const db = getDb();
  const stale = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.status, 'PENDING_PAYMENT'),
        sql`${orders.reservationExpiresAt} is not null and ${orders.reservationExpiresAt} < ${now}`,
      ),
    )
    .limit(200);

  let cancelled = 0;
  for (const row of stale) {
    try {
      await withTransaction(async (tx) => {
        const locked = await lockOrder(tx, row.id);
        if (locked.status !== 'PENDING_PAYMENT') return; // someone got there first
        await applyTransition(tx, row.id, 'CANCELLED', {
          actorType: 'system',
          eventType: 'ORDER_EXPIRED',
          message: 'مهلت پرداخت سفارش به پایان رسید و موجودی رزروشده آزاد شد.',
        });
      });
      cancelled += 1;
    } catch (e) {
      console.error('[sweeper] failed to expire order', row.id, e);
    }
  }
  return cancelled;
}

/* ── reads ────────────────────────────────────────────────────────────── */

export interface OrderDetail {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  customerFullName: string;
  customerPhone: string;
  customerEmail: string | null;
  shippingProvince: string;
  shippingCity: string;
  shippingAddress: string;
  shippingPostalCode: string;
  deliveryNotes: string | null;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  grandTotal: number;
  shippingMethodName: string;
  shippingMethodCode: string;
  paymentProvider: string;
  trackingToken: string;
  placedAt: Date;
  paidAt: Date | null;
  reservationExpiresAt: Date | null;
  userId: string | null;
  items: {
    id: string;
    productId: string | null;
    productSlug: string | null;
    sku: string;
    titleFa: string;
    brandName: string | null;
    oemNumber: string | null;
    imageUrl: string | null;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }[];
  events: {
    eventType: string;
    message: string | null;
    toStatus: OrderStatus | null;
    createdAt: Date;
    isPublic: boolean;
    actorType: OrderActor;
  }[];
  shipment: {
    carrier: string | null;
    trackingCode: string | null;
    status: string;
    shippedAt: Date | null;
    deliveredAt: Date | null;
  } | null;
  payment: {
    provider: string;
    status: string;
    amount: number;
    transactionId: string | null;
    failureReason: string | null;
  } | null;
}

async function hydrateOrder(row: typeof orders.$inferSelect, db: Database): Promise<OrderDetail> {
  const [items, events, shipmentRows, paymentRows] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, row.id)),
    db.select().from(orderEvents).where(eq(orderEvents.orderId, row.id)).orderBy(orderEvents.createdAt),
    db.select().from(shipments).where(eq(shipments.orderId, row.id)).limit(1),
    db.select().from(payments).where(eq(payments.orderId, row.id)).orderBy(desc(payments.createdAt)).limit(1),
  ]);

  const shipment = shipmentRows[0];
  const payment = paymentRows[0];

  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    customerFullName: row.customerFullName,
    customerPhone: row.customerPhone,
    customerEmail: row.customerEmail,
    shippingProvince: row.shippingProvince,
    shippingCity: row.shippingCity,
    shippingAddress: row.shippingAddress,
    shippingPostalCode: row.shippingPostalCode,
    deliveryNotes: row.deliveryNotes,
    subtotal: row.subtotal,
    discountTotal: row.discountTotal,
    shippingTotal: row.shippingTotal,
    grandTotal: row.grandTotal,
    shippingMethodName: row.shippingMethodName,
    shippingMethodCode: row.shippingMethodCode,
    paymentProvider: row.paymentProvider,
    trackingToken: row.trackingToken,
    placedAt: row.placedAt,
    paidAt: row.paidAt,
    reservationExpiresAt: row.reservationExpiresAt,
    userId: row.userId,
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productSlug: i.productSlug,
      sku: i.sku,
      titleFa: i.titleFa,
      brandName: i.brandName,
      oemNumber: i.oemNumber,
      imageUrl: i.imageUrl,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
    })),
    events: events.map((e) => ({
      eventType: e.eventType,
      message: e.message,
      toStatus: e.toStatus,
      createdAt: e.createdAt,
      isPublic: e.isPublic,
      actorType: e.actorType,
    })),
    shipment: shipment
      ? {
          carrier: shipment.carrier,
          trackingCode: shipment.trackingCode,
          status: shipment.status,
          shippedAt: shipment.shippedAt,
          deliveredAt: shipment.deliveredAt,
        }
      : null,
    payment: payment
      ? {
          provider: payment.provider,
          status: payment.status,
          amount: payment.amount,
          transactionId: payment.transactionId,
          failureReason: payment.failureReason,
        }
      : null,
  };
}

/**
 * Public tracking lookup. The token is 24 random bytes, so knowing an order
 * number is not enough to read someone else's order.
 */
export async function getOrderByTrackingToken(
  token: string,
  db: Database = getDb(),
): Promise<OrderDetail | null> {
  const [row] = await db.select().from(orders).where(eq(orders.trackingToken, token)).limit(1);
  if (!row) return null;
  const detail = await hydrateOrder(row, db);
  // Internal notes stay internal even on the public page.
  return { ...detail, events: detail.events.filter((e) => e.isPublic) };
}

/** Customer view. Ownership is enforced in SQL, not after the fact (anti-IDOR). */
export async function getOrderForUser(
  orderId: string,
  userId: string,
  db: Database = getDb(),
): Promise<OrderDetail | null> {
  const [row] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1);
  if (!row) return null;
  const detail = await hydrateOrder(row, db);
  return { ...detail, events: detail.events.filter((e) => e.isPublic) };
}

export async function listOrdersForUser(userId: string, db: Database = getDb()) {
  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      grandTotal: orders.grandTotal,
      placedAt: orders.placedAt,
      trackingToken: orders.trackingToken,
      itemCount: sql<number>`(select coalesce(sum(oi.quantity),0)::int from order_items oi where oi.order_id = ${orders.id})`,
      firstItemTitle: sql<string | null>`(select oi.title_fa from order_items oi where oi.order_id = ${orders.id} limit 1)`,
      firstItemImage: sql<string | null>`(select oi.image_url from order_items oi where oi.order_id = ${orders.id} limit 1)`,
    })
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.placedAt));
  return rows;
}

/* ── admin reads ──────────────────────────────────────────────────────── */

export async function getOrderAdmin(orderId: string, db: Database = getDb()): Promise<OrderDetail | null> {
  const [row] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!row) return null;
  return hydrateOrder(row, db);
}

export interface AdminOrderFilter {
  status?: OrderStatus | undefined;
  q?: string | undefined;
  page?: number;
  perPage?: number;
}

export async function listOrdersAdmin(filter: AdminOrderFilter = {}, db: Database = getDb()) {
  const page = filter.page ?? 1;
  const perPage = filter.perPage ?? 20;
  const conditions = [sql`true`];
  if (filter.status) conditions.push(sql`o.status = ${filter.status}`);
  if (filter.q?.trim()) {
    const q = filter.q.trim();
    conditions.push(sql`(
      o.order_number ilike '%' || ${q} || '%'
      or o.customer_phone like '%' || ${q} || '%'
      or md_normalize_fa(o.customer_full_name) like '%' || md_normalize_fa(${q}) || '%'
    )`);
  }
  const where = sql.join(conditions, sql` and `);

  const rows = await db.execute<{
    id: string; order_number: string; status: OrderStatus; grand_total: string | number;
    placed_at: Date; customer_full_name: string; customer_phone: string;
    shipping_province: string; item_count: number;
  }>(sql`
    select o.id, o.order_number, o.status, o.grand_total, o.placed_at,
      o.customer_full_name, o.customer_phone, o.shipping_province,
      (select coalesce(sum(oi.quantity),0)::int from order_items oi where oi.order_id = o.id) as item_count
    from orders o
    where ${where}
    order by o.placed_at desc
    limit ${perPage} offset ${(page - 1) * perPage}
  `);

  const countRows = await db.execute<{ total: number }>(sql`
    select count(*)::int as total from orders o where ${where}
  `);

  return {
    items: rows.rows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      status: r.status,
      grandTotal: Number(r.grand_total),
      placedAt: r.placed_at,
      customerFullName: r.customer_full_name,
      customerPhone: r.customer_phone,
      shippingProvince: r.shipping_province,
      itemCount: r.item_count,
    })),
    total: countRows.rows[0]?.total ?? 0,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil((countRows.rows[0]?.total ?? 0) / perPage)),
  };
}

export async function setShipmentTracking(
  orderId: string,
  input: { carrier?: string | null; trackingCode?: string | null; generate?: boolean },
  actorUserId: string | null,
): Promise<string | null> {
  const trackingCode = input.generate ? generateTrackingCode() : (input.trackingCode ?? null);
  await withTransaction(async (tx) => {
    await tx
      .update(shipments)
      .set({
        carrier: input.carrier ?? undefined,
        trackingCode,
        updatedAt: new Date(),
      })
      .where(eq(shipments.orderId, orderId));
    await tx.insert(orderEvents).values({
      orderId,
      eventType: 'TRACKING_UPDATED',
      message: trackingCode
        ? `کد رهگیری مرسوله ثبت شد: ${trackingCode}`
        : 'کد رهگیری مرسوله حذف شد.',
      actorType: 'admin',
      actorUserId,
      isPublic: true,
    });
  });
  return trackingCode;
}

/** Marks a cash-on-delivery payment settled once the courier hands over cash. */
export async function settleCashPayment(orderId: string, actorUserId: string | null): Promise<void> {
  await withTransaction(async (tx) => {
    const updated = await tx
      .update(payments)
      .set({ status: 'SUCCEEDED', updatedAt: new Date() })
      .where(and(eq(payments.orderId, orderId), eq(payments.status, 'INITIATED')))
      .returning({ id: payments.id });
    if (updated.length === 0) throw errors.conflict('پرداخت در انتظار تسویه‌ای برای این سفارش وجود ندارد.');
    await tx.insert(orderEvents).values({
      orderId,
      eventType: 'CASH_PAYMENT_SETTLED',
      message: 'وجه سفارش (پرداخت در محل) دریافت و ثبت شد.',
      actorType: 'admin',
      actorUserId,
      isPublic: false,
    });
  });
}

/* ── dashboard aggregates ─────────────────────────────────────────────── */

export async function getDashboardSummary(db: Database = getDb()) {
  const [statusCounts, revenue, recent, customerCount] = await Promise.all([
    db
      .select({ status: orders.status, count: sql<number>`count(*)::int` })
      .from(orders)
      .groupBy(orders.status),
    db.execute<{ paid_total: string | null; paid_count: number; today_total: string | null }>(sql`
      select
        sum(grand_total) filter (where status not in ('CANCELLED','PENDING_PAYMENT')) as paid_total,
        count(*) filter (where status not in ('CANCELLED','PENDING_PAYMENT'))::int as paid_count,
        sum(grand_total) filter (
          where status not in ('CANCELLED','PENDING_PAYMENT') and placed_at >= now() - interval '30 days'
        ) as today_total
      from orders
    `),
    listOrdersAdmin({ perPage: 8 }, db),
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.role, 'customer')),
  ]);

  const byStatus = Object.fromEntries(statusCounts.map((r) => [r.status, r.count])) as Partial<
    Record<OrderStatus, number>
  >;
  const rev = revenue.rows[0];

  return {
    byStatus,
    totalOrders: statusCounts.reduce((n, r) => n + r.count, 0),
    pendingCount: (byStatus.PENDING_PAYMENT ?? 0),
    actionableCount: (byStatus.PAID ?? 0) + (byStatus.PROCESSING ?? 0) + (byStatus.PACKED ?? 0),
    revenueTotal: Number(rev?.paid_total ?? 0),
    revenueLast30Days: Number(rev?.today_total ?? 0),
    paidOrderCount: rev?.paid_count ?? 0,
    customerCount: customerCount[0]?.n ?? 0,
    recentOrders: recent.items,
  };
}

export { inArray };
