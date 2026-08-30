import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closePool, getDb, withTransaction } from '@/infrastructure/db/client';
import { products, users } from '@/infrastructure/db/schema';
import {
  addToCart, clearCart, getCartItemCount, getCartView, removeFromCart, updateCartQuantity,
} from '@/application/cart-service';
import {
  changePassword, login, mergeGuestCart, register, resolveSession, revokeAllSessions,
  revokeSession, updateProfile,
} from '@/application/auth-service';
import { adjustStock } from '@/application/inventory-service';
import { DomainError } from '@/domain/errors';
import { createProduct, createUser, resetDatabase } from '../helpers/factory';

beforeEach(resetDatabase);
afterAll(closePool);

describe('cart', () => {
  it('re-prices lines from live product rows, ignoring what was added earlier', async () => {
    const p = await createProduct({ price: 1_000_000, stock: 10 });
    const identity = { anonToken: 'cart-1' };
    await addToCart(identity, p.id, 2);

    await getDb().update(products).set({ salePrice: 800_000 }).where(eq(products.id, p.id));

    const view = await getCartView(identity);
    expect(view.lines[0]!.unitPrice).toBe(800_000);
    expect(view.lines[0]!.lineTotal).toBe(1_600_000);
    expect(view.subtotal).toBe(1_600_000);
    expect(view.discountTotal).toBe(400_000);
  });

  it('tops up an existing line instead of duplicating it', async () => {
    const p = await createProduct({ stock: 10 });
    const identity = { anonToken: 'cart-2' };
    await addToCart(identity, p.id, 2);
    const view = await addToCart(identity, p.id, 3);
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]!.quantity).toBe(5);
  });

  it('refuses to add more than is available', async () => {
    const p = await createProduct({ titleFa: 'کالای کم', stock: 2 });
    await expect(addToCart({ anonToken: 'cart-3' }, p.id, 3)).rejects.toThrow(/کالای کم/);
  });

  it('enforces the per-line maximum', async () => {
    const p = await createProduct({ stock: 100 });
    await expect(addToCart({ anonToken: 'cart-4' }, p.id, 21)).rejects.toThrow(/حداکثر/);
    await addToCart({ anonToken: 'cart-4' }, p.id, 20);
    await expect(addToCart({ anonToken: 'cart-4' }, p.id, 1)).rejects.toThrow(/حداکثر/);
  });

  it('refuses an inactive product', async () => {
    const p = await createProduct({ titleFa: 'غیرفعال', stock: 5, isActive: false });
    await expect(addToCart({ anonToken: 'cart-5' }, p.id, 1)).rejects.toThrow(/غیرفعال/);
  });

  it('refuses an out-of-stock product', async () => {
    const p = await createProduct({ titleFa: 'ناموجود', stock: 0 });
    await expect(addToCart({ anonToken: 'cart-6' }, p.id, 1)).rejects.toThrow(/به پایان رسیده/);
  });

  it('removes a line when quantity is set to zero', async () => {
    const p = await createProduct({ stock: 10 });
    const identity = { anonToken: 'cart-7' };
    await addToCart(identity, p.id, 3);
    const view = await updateCartQuantity(identity, p.id, 0);
    expect(view.lines).toHaveLength(0);
  });

  it('surfaces a Persian warning when stock drops below the cart quantity', async () => {
    const p = await createProduct({ titleFa: 'لنت ترمز', stock: 5 });
    const identity = { anonToken: 'cart-8' };
    await addToCart(identity, p.id, 5);
    await withTransaction((tx) => adjustStock(tx, { productId: p.id, delta: -3, reason: 'ضایعات', actorUserId: null }));

    const view = await getCartView(identity);
    expect(view.lines[0]!.hasStockIssue).toBe(true);
    expect(view.issues[0]).toContain('لنت ترمز');
    expect(view.issues[0]).toContain('۲');
  });

  it('flags a product deactivated while it sits in the cart', async () => {
    const p = await createProduct({ titleFa: 'کالای بایگانی‌شده', stock: 5 });
    const identity = { anonToken: 'cart-9' };
    await addToCart(identity, p.id, 1);
    await getDb().update(products).set({ isActive: false }).where(eq(products.id, p.id));

    const view = await getCartView(identity);
    expect(view.lines[0]!.isActive).toBe(false);
    expect(view.issues[0]).toContain('دیگر در فروشگاه موجود نیست');
  });

  it('keeps guest and user carts separate', async () => {
    const p = await createProduct({ stock: 10 });
    const user = await createUser('customer');
    await addToCart({ anonToken: 'cart-10' }, p.id, 2);
    await addToCart({ userId: user.id }, p.id, 5);

    expect(await getCartItemCount({ anonToken: 'cart-10' })).toBe(2);
    expect(await getCartItemCount({ userId: user.id })).toBe(5);
  });

  it('removes and clears', async () => {
    const p = await createProduct({ stock: 10 });
    const q = await createProduct({ stock: 10 });
    const identity = { anonToken: 'cart-11' };
    await addToCart(identity, p.id, 1);
    await addToCart(identity, q.id, 1);
    expect((await removeFromCart(identity, p.id)).lines).toHaveLength(1);
    await clearCart(identity);
    expect((await getCartView(identity)).lines).toHaveLength(0);
  });

  it('returns an empty cart for an identity that has never shopped', async () => {
    const view = await getCartView({ anonToken: 'never-seen' });
    expect(view.lines).toHaveLength(0);
    expect(view.subtotal).toBe(0);
    expect(view.cartId).toBeNull();
  });
});

describe('guest cart merge on sign-in', () => {
  it('sums quantities into the account cart and drops the guest cart', async () => {
    const p = await createProduct({ stock: 20 });
    const q = await createProduct({ stock: 20 });
    const user = await createUser('customer');

    await addToCart({ userId: user.id }, p.id, 2);
    await addToCart({ anonToken: 'merge-1' }, p.id, 3);
    await addToCart({ anonToken: 'merge-1' }, q.id, 1);

    await mergeGuestCart(user.id, 'merge-1');

    const view = await getCartView({ userId: user.id });
    expect(view.lines).toHaveLength(2);
    expect(view.lines.find((l) => l.productId === p.id)!.quantity).toBe(5);
    expect(await getCartItemCount({ anonToken: 'merge-1' })).toBe(0);
  });

  it('adopts the guest cart wholesale when the account has none', async () => {
    const p = await createProduct({ stock: 10 });
    const user = await createUser('customer');
    await addToCart({ anonToken: 'merge-2' }, p.id, 4);

    await mergeGuestCart(user.id, 'merge-2');
    expect(await getCartItemCount({ userId: user.id })).toBe(4);
  });

  it('caps a merged line at the per-line maximum', async () => {
    const p = await createProduct({ stock: 100 });
    const user = await createUser('customer');
    await addToCart({ userId: user.id }, p.id, 15);
    await addToCart({ anonToken: 'merge-3' }, p.id, 15);

    await mergeGuestCart(user.id, 'merge-3');
    expect((await getCartView({ userId: user.id })).lines[0]!.quantity).toBe(20);
  });
});

describe('authentication', () => {
  it('registers and signs in a customer', async () => {
    const user = await register({ fullName: 'زهرا کریمی', phone: '09121112233', password: 'Password@123' });
    expect(user.role).toBe('customer');

    const session = await login('09121112233', 'Password@123');
    expect(session.user.id).toBe(user.id);
    expect(session.token).toHaveLength(43);

    const resolved = await resolveSession(session.token);
    expect(resolved!.id).toBe(user.id);
  });

  it('never stores the password or the raw session token', async () => {
    await register({ fullName: 'کاربر آزمایشی', phone: '09121112244', password: 'Password@123' });
    const [row] = await getDb().select().from(users).where(eq(users.phone, '09121112244'));
    expect(row!.passwordHash).not.toContain('Password@123');
    expect(row!.passwordHash.startsWith('scrypt$')).toBe(true);

    const session = await login('09121112244', 'Password@123');
    const { sessions } = await import('@/infrastructure/db/schema');
    const stored = await getDb().select().from(sessions);
    expect(stored[0]!.tokenHash).not.toBe(session.token);
    expect(stored[0]!.tokenHash).toHaveLength(64);
  });

  it('gives the same message for an unknown phone and a wrong password', async () => {
    await register({ fullName: 'کاربر', phone: '09121112255', password: 'Password@123' });

    const unknown = await login('09129999999', 'whatever').catch((e: DomainError) => e);
    const wrong = await login('09121112255', 'WrongPassword1').catch((e: DomainError) => e);

    expect((unknown as DomainError).message).toBe((wrong as DomainError).message);
    expect((unknown as DomainError).status).toBe(401);
  });

  it('locks an account after repeated failures', async () => {
    await register({ fullName: 'کاربر', phone: '09121112266', password: 'Password@123' });
    for (let i = 0; i < 10; i += 1) {
      await login('09121112266', 'WrongPassword1').catch(() => undefined);
    }
    // Even the correct password is refused while the lock holds.
    await expect(login('09121112266', 'Password@123')).rejects.toThrow(/مسدود/);
  });

  it('resets the failure counter after a successful sign-in', async () => {
    await register({ fullName: 'کاربر', phone: '09121112277', password: 'Password@123' });
    await login('09121112277', 'bad').catch(() => undefined);
    await login('09121112277', 'Password@123');
    const [row] = await getDb().select().from(users).where(eq(users.phone, '09121112277'));
    expect(row!.failedLoginCount).toBe(0);
  });

  it('rejects a duplicate phone number with one generic message', async () => {
    await register({ fullName: 'کاربر یک', phone: '09121112288', password: 'Password@123' });
    await expect(
      register({ fullName: 'کاربر دو', phone: '09121112288', password: 'Password@123' }),
    ).rejects.toThrow(/از قبل وجود دارد/);
  });

  it('invalidates a revoked session immediately', async () => {
    await register({ fullName: 'کاربر', phone: '09121112299', password: 'Password@123' });
    const session = await login('09121112299', 'Password@123');
    await revokeSession(session.token);
    expect(await resolveSession(session.token)).toBeNull();
  });

  it('signs every device out when the password changes', async () => {
    const user = await register({ fullName: 'کاربر', phone: '09121113300', password: 'Password@123' });
    const a = await login('09121113300', 'Password@123');
    const b = await login('09121113300', 'Password@123');

    await changePassword(user.id, 'Password@123', 'NewPassword@456');

    expect(await resolveSession(a.token)).toBeNull();
    expect(await resolveSession(b.token)).toBeNull();
    await expect(login('09121113300', 'Password@123')).rejects.toThrow();
    expect((await login('09121113300', 'NewPassword@456')).user.id).toBe(user.id);
  });

  it('refuses a password change without the current password', async () => {
    const user = await register({ fullName: 'کاربر', phone: '09121113311', password: 'Password@123' });
    await expect(changePassword(user.id, 'WrongOne1', 'NewPassword@456')).rejects.toThrow(/نادرست/);
  });

  it('rejects a session for a deactivated account', async () => {
    const user = await register({ fullName: 'کاربر', phone: '09121113322', password: 'Password@123' });
    const session = await login('09121113322', 'Password@123');
    await getDb().update(users).set({ isActive: false }).where(eq(users.id, user.id));
    expect(await resolveSession(session.token)).toBeNull();
  });

  it('rejects a garbage or empty token without throwing', async () => {
    expect(await resolveSession('not-a-token')).toBeNull();
    expect(await resolveSession(undefined)).toBeNull();
    expect(await resolveSession('')).toBeNull();
  });

  it('updates the profile and rejects a duplicate email', async () => {
    const a = await register({ fullName: 'کاربر الف', phone: '09121113333', email: 'a@example.invalid', password: 'Password@123' });
    await register({ fullName: 'کاربر ب', phone: '09121113344', email: 'b@example.invalid', password: 'Password@123' });

    const updated = await updateProfile(a.id, { fullName: 'کاربر الف ویرایش‌شده', email: 'a2@example.invalid' });
    expect(updated.fullName).toBe('کاربر الف ویرایش‌شده');

    await expect(updateProfile(a.id, { fullName: 'x y z', email: 'b@example.invalid' })).rejects.toThrow(/ایمیل/);
  });

  it('revokes all sessions on demand', async () => {
    const user = await register({ fullName: 'کاربر', phone: '09121113355', password: 'Password@123' });
    const s = await login('09121113355', 'Password@123');
    await revokeAllSessions(user.id);
    expect(await resolveSession(s.token)).toBeNull();
  });
});
