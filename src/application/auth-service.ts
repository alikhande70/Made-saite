/**
 * Authentication. Sessions are opaque random tokens; only their SHA-256 is
 * stored, so a database leak cannot be replayed as a login. Passwords use
 * scrypt (see lib/crypto).
 *
 * Login responses are deliberately uniform — an unknown phone number and a wrong
 * password produce the same Persian message and comparable timing, so the
 * endpoint cannot be used to enumerate customers.
 */
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database } from '@/infrastructure/db/client';
import { getDb, withTransaction } from '@/infrastructure/db/client';
import { carts, sessions, users } from '@/infrastructure/db/schema';
import { errors } from '@/domain/errors';
import { hashPassword, randomToken, sha256, verifyPassword } from '@/lib/crypto';

export const SESSION_COOKIE = 'ms_session';
export const SESSION_TTL_DAYS = 30;

export type UserRole = 'customer' | 'admin';

export interface AuthUser {
  readonly id: string;
  readonly fullName: string;
  readonly phone: string;
  readonly email: string | null;
  readonly role: UserRole;
}

/** Wrong-password attempts tolerated before the account is briefly locked. */
const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;

export interface RegisterInput {
  fullName: string;
  phone: string;
  email?: string | undefined;
  password: string;
}

export async function register(input: RegisterInput): Promise<AuthUser> {
  const passwordHash = await hashPassword(input.password);

  try {
    const [row] = await getDb()
      .insert(users)
      .values({
        fullName: input.fullName,
        phone: input.phone,
        email: input.email ?? null,
        passwordHash,
        role: 'customer',
      })
      .returning({
        id: users.id,
        fullName: users.fullName,
        phone: users.phone,
        email: users.email,
        role: users.role,
      });
    if (!row) throw errors.conflict('ثبت حساب کاربری انجام نشد.');
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) {
      // Same message for phone and email so neither can be probed.
      throw errors.conflict('حسابی با این شماره موبایل یا ایمیل از قبل وجود دارد.');
    }
    throw e;
  }
}

/**
 * Drizzle wraps driver errors in a `DrizzleQueryError`, so the PostgreSQL
 * SQLSTATE lives on `cause` (possibly nested). Walk the chain rather than
 * checking only the outermost error — missing it would surface raw SQL as a 500.
 */
function isUniqueViolation(e: unknown): boolean {
  let current: unknown = e;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === 'object' && current !== null) {
      if ((current as { code?: string }).code === '23505') return true;
      current = (current as { cause?: unknown }).cause;
    } else {
      return false;
    }
  }
  return false;
}

export interface LoginResult {
  readonly user: AuthUser;
  /** Raw token — set as a cookie and never persisted anywhere else. */
  readonly token: string;
  readonly expiresAt: Date;
}

export async function login(
  phone: string,
  password: string,
  context: { userAgent?: string | null; ipHash?: string | null } = {},
): Promise<LoginResult> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);

  const generic = errors.unauthenticated('شماره موبایل یا رمز عبور نادرست است.');

  if (!user) {
    // Burn comparable time so a missing account is not detectable by timing.
    await verifyPassword(password, 'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
    throw generic;
  }
  if (!user.isActive) throw errors.forbidden('این حساب کاربری غیرفعال شده است.');
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw errors.rateLimited(
      'به دلیل تلاش‌های ناموفق، ورود به این حساب موقتاً مسدود شده است. لطفاً بعداً تلاش کنید.',
    );
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await db
      .update(users)
      .set({
        failedLoginCount: failed,
        lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    throw generic;
  }

  if (user.failedLoginCount !== 0 || user.lockedUntil) {
    await db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, user.id));
  }

  const { token, expiresAt } = await createSession(db, user.id, context);
  return {
    user: { id: user.id, fullName: user.fullName, phone: user.phone, email: user.email, role: user.role },
    token,
    expiresAt,
  };
}

export async function createSession(
  db: Database,
  userId: string,
  context: { userAgent?: string | null; ipHash?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt,
    userAgent: context.userAgent?.slice(0, 300) ?? null,
    ipHash: context.ipHash ?? null,
  });
  return { token, expiresAt };
}

/** Resolves a raw session token to its user, or null when invalid/expired. */
export async function resolveSession(token: string | undefined | null): Promise<AuthUser | null> {
  if (!token) return null;
  const [row] = await getDb()
    .select({
      id: users.id,
      fullName: users.fullName,
      phone: users.phone,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, sha256(token)),
        gt(sessions.expiresAt, new Date()),
        isNull(sessions.revokedAt),
      ),
    )
    .limit(1);

  if (!row || !row.isActive) return null;
  return { id: row.id, fullName: row.fullName, phone: row.phone, email: row.email, role: row.role };
}

export async function revokeSession(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await getDb()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, sha256(token)));
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await getDb()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw errors.notFound('حساب کاربری یافت نشد.');
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw errors.unauthenticated('رمز عبور فعلی نادرست است.');
  }
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(users.id, userId));
  // Every other device is signed out after a password change.
  await revokeAllSessions(userId);
}

export async function updateProfile(
  userId: string,
  input: { fullName: string; email?: string | undefined },
): Promise<AuthUser> {
  try {
    const [row] = await getDb()
      .update(users)
      .set({ fullName: input.fullName, email: input.email ?? null, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        fullName: users.fullName,
        phone: users.phone,
        email: users.email,
        role: users.role,
      });
    if (!row) throw errors.notFound('حساب کاربری یافت نشد.');
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw errors.conflict('این ایمیل قبلاً برای حساب دیگری ثبت شده است.');
    throw e;
  }
}

/**
 * Moves a guest cart onto the account at sign-in. Quantities are summed and the
 * guest cart is dropped, so nothing a customer picked before logging in is lost.
 */
export async function mergeGuestCart(userId: string, anonToken: string | null): Promise<void> {
  if (!anonToken) return;
  const anonTokenHash = sha256(anonToken);

  await withTransaction(async (tx) => {
    const [guestCart] = await tx
      .select({ id: carts.id })
      .from(carts)
      .where(eq(carts.anonTokenHash, anonTokenHash))
      .limit(1);
    if (!guestCart) return;

    const [userCart] = await tx.select({ id: carts.id }).from(carts).where(eq(carts.userId, userId)).limit(1);

    if (!userCart) {
      await tx
        .update(carts)
        .set({ userId, anonTokenHash: null, updatedAt: new Date() })
        .where(eq(carts.id, guestCart.id));
      return;
    }

    await tx.execute(sql`
      insert into cart_items (cart_id, product_id, quantity)
      select ${userCart.id}::uuid, product_id, quantity
      from cart_items where cart_id = ${guestCart.id}::uuid
      on conflict (cart_id, product_id)
      do update set quantity = least(20, cart_items.quantity + excluded.quantity)
    `);
    await tx.delete(carts).where(eq(carts.id, guestCart.id));
  });
}

export async function deleteExpiredSessions(): Promise<void> {
  await getDb().delete(sessions).where(sql`${sessions.expiresAt} < now()`);
}
