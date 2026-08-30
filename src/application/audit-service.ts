/**
 * Append-only audit trail for privileged actions (ADR-007).
 *
 * Recording an action must never fail the action itself: an audit write that
 * throws would roll back a legitimate admin operation. Failures are logged and
 * swallowed, which is the correct trade-off while the log is an accountability
 * aid rather than a compliance control. If it ever becomes the latter, this
 * should move inside the caller's transaction instead.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, type Database } from '@/infrastructure/db/client';
import { adminAuditLog, users } from '@/infrastructure/db/schema';

export type AuditAction =
  | 'product.create' | 'product.update' | 'product.publish' | 'product.unpublish'
  | 'inventory.adjust'
  | 'order.transition' | 'order.tracking' | 'order.settle_cash'
  | 'category.upsert' | 'category.delete'
  | 'brand.upsert' | 'brand.delete'
  | 'shipping.upsert' | 'shipping.delete'
  | 'customer.activate' | 'customer.deactivate'
  | 'settings.update'
  | 'import.validate' | 'import.commit';

export interface AuditEntry {
  actorUserId: string | null;
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  /** Persian, shown verbatim in the admin UI. */
  summary: string;
  metadata?: Record<string, unknown> | null;
  ipHash?: string | null;
}

/** Keys never written to the audit log even if a caller passes them. */
const REDACTED_KEYS = new Set([
  'password', 'passwordHash', 'token', 'tokenHash', 'secret', 'authority',
  'providerRef', 'transactionId', 'cardNumber', 'cvv',
]);

function redact(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!metadata) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (REDACTED_KEYS.has(key)) continue;
    // Keep the log small and free of nested surprises.
    out[key] = typeof value === 'object' && value !== null ? JSON.stringify(value).slice(0, 300) : value;
  }
  return out;
}

export async function recordAudit(entry: AuditEntry, db: Database = getDb()): Promise<void> {
  try {
    await db.insert(adminAuditLog).values({
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ? String(entry.entityId).slice(0, 80) : null,
      summary: entry.summary.slice(0, 400),
      metadata: redact(entry.metadata),
      ipHash: entry.ipHash ?? null,
    });
  } catch (e) {
    console.error('[audit] failed to record', entry.action, e);
  }
}

export interface AuditFilter {
  action?: string | undefined;
  actorUserId?: string | undefined;
  page?: number;
  perPage?: number;
}

export async function listAudit(filter: AuditFilter = {}, db: Database = getDb()) {
  const page = filter.page ?? 1;
  const perPage = filter.perPage ?? 50;

  const conditions = [];
  if (filter.action) conditions.push(eq(adminAuditLog.action, filter.action));
  if (filter.actorUserId) conditions.push(eq(adminAuditLog.actorUserId, filter.actorUserId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: adminAuditLog.id,
      action: adminAuditLog.action,
      entityType: adminAuditLog.entityType,
      entityId: adminAuditLog.entityId,
      summary: adminAuditLog.summary,
      metadata: adminAuditLog.metadata,
      createdAt: adminAuditLog.createdAt,
      actorName: users.fullName,
      actorPhone: users.phone,
    })
    .from(adminAuditLog)
    .leftJoin(users, eq(users.id, adminAuditLog.actorUserId))
    .where(where)
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(perPage)
    .offset((page - 1) * perPage);

  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adminAuditLog)
    .where(where);

  const total = count?.n ?? 0;
  return { items: rows, total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) };
}

/** Distinct actions present in the log, for the admin filter dropdown. */
export async function listAuditActions(db: Database = getDb()): Promise<string[]> {
  const rows = await db
    .selectDistinct({ action: adminAuditLog.action })
    .from(adminAuditLog)
    .orderBy(adminAuditLog.action);
  return rows.map((r) => r.action);
}

export const AUDIT_ACTION_LABEL_FA: Record<string, string> = {
  'product.create': 'ایجاد کالا',
  'product.update': 'ویرایش کالا',
  'product.publish': 'انتشار کالا',
  'product.unpublish': 'خروج کالا از انتشار',
  'inventory.adjust': 'تغییر موجودی',
  'order.transition': 'تغییر وضعیت سفارش',
  'order.tracking': 'ثبت کد رهگیری',
  'order.settle_cash': 'ثبت دریافت وجه',
  'category.upsert': 'ثبت/ویرایش دسته',
  'category.delete': 'حذف دسته',
  'brand.upsert': 'ثبت/ویرایش برند',
  'brand.delete': 'حذف برند',
  'shipping.upsert': 'ثبت/ویرایش روش ارسال',
  'shipping.delete': 'حذف روش ارسال',
  'customer.activate': 'فعال‌سازی مشتری',
  'customer.deactivate': 'مسدودسازی مشتری',
  'settings.update': 'تغییر تنظیمات فروشگاه',
  'import.validate': 'بررسی فایل ورودی',
  'import.commit': 'اعمال فایل ورودی',
};
