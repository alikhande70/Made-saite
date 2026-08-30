/**
 * Request-scoped auth + cart identity helpers for Server Components, Server
 * Actions and Route Handlers.
 */
import 'server-only';
import { cookies, headers } from 'next/headers';
import { resolveSession, SESSION_COOKIE, SESSION_TTL_DAYS, type AuthUser } from '@/application/auth-service';
import { errors } from '@/domain/errors';
import { randomToken, sha256 } from './crypto';

export const ANON_CART_COOKIE = 'ms_cart';
/** The vehicle the shopper is browsing as. Not sensitive; readable by the UI. */
export const SELECTED_VEHICLE_COOKIE = 'ms_vehicle';
const ANON_CART_TTL_DAYS = 60;
const VEHICLE_TTL_DAYS = 180;

/**
 * `Secure` is keyed to the deployment's own scheme rather than NODE_ENV.
 *
 * A `Secure` cookie is silently dropped by the browser over plain HTTP, so
 * tying it to NODE_ENV breaks every production-mode run that is not already
 * behind TLS (local verification, container health checks, E2E). Deriving it
 * from the configured site URL keeps real deployments — which must be HTTPS —
 * fully protected while remaining usable over HTTP. See docs/SECURITY.md.
 */
function usesHttps(): boolean {
  const url = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';
  return url.startsWith('https://');
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  get secure() {
    return usesHttps();
  },
  path: '/',
};

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** Current signed-in user, or null for guests. Safe to call anywhere. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  return resolveSession(await getSessionToken());
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw errors.unauthenticated();
  return user;
}

/** Authorization gate for every admin surface. Customers get 403, not 404. */
export async function requireAdmin(): Promise<AuthUser> {
  const user = await requireUser();
  if (user.role !== 'admin') throw errors.forbidden('این بخش تنها برای مدیران فروشگاه در دسترس است.');
  return user;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, { ...sessionCookieOptions, expires: expiresAt });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
}

export async function getAnonCartToken(): Promise<string | undefined> {
  return (await cookies()).get(ANON_CART_COOKIE)?.value;
}

/**
 * Returns the guest-cart token, minting one if absent.
 * Only call from a context allowed to set cookies (Action / Route Handler).
 */
export async function ensureAnonCartToken(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(ANON_CART_COOKIE)?.value;
  if (existing) return existing;
  const token = randomToken(24);
  jar.set(ANON_CART_COOKIE, token, {
    ...sessionCookieOptions,
    expires: new Date(Date.now() + ANON_CART_TTL_DAYS * 86_400_000),
  });
  return token;
}

/**
 * The vehicle configuration the shopper is browsing as.
 *
 * Signed-in customers get their default garage vehicle; guests get a cookie, so
 * vehicle-first shopping works before registration. The cookie stores only a
 * configuration id — a public taxonomy key, not personal data — so it is
 * deliberately not httpOnly: client components read it to keep the UI in step.
 */
export async function getSelectedVehicleId(): Promise<string | null> {
  const cookieValue = (await cookies()).get(SELECTED_VEHICLE_COOKIE)?.value ?? null;
  if (cookieValue) return cookieValue;

  const user = await getCurrentUser();
  if (!user) return null;
  const { getDefaultVehicle } = await import('@/application/garage-service');
  const vehicle = await getDefaultVehicle(user.id).catch(() => null);
  return vehicle?.configurationId ?? null;
}

export async function setSelectedVehicleCookie(configurationId: string | null): Promise<void> {
  const jar = await cookies();
  if (!configurationId) {
    jar.set(SELECTED_VEHICLE_COOKIE, '', { ...sessionCookieOptions, httpOnly: false, maxAge: 0 });
    return;
  }
  jar.set(SELECTED_VEHICLE_COOKIE, configurationId, {
    ...sessionCookieOptions,
    httpOnly: false,
    expires: new Date(Date.now() + VEHICLE_TTL_DAYS * 86_400_000),
  });
}

export async function clearAnonCartCookie(): Promise<void> {
  (await cookies()).set(ANON_CART_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
}

/** Identity used for rate limiting: the user id when known, else the client IP. */
export async function rateLimitIdentity(user?: AuthUser | null): Promise<string> {
  if (user) return `user:${user.id}`;
  return `ip:${await getClientIp()}`;
}

export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return h.get('x-real-ip') ?? 'unknown';
}

export async function getClientIpHash(): Promise<string> {
  return sha256(await getClientIp());
}

export { SESSION_TTL_DAYS };
