/**
 * Fixed-window rate limiting backed by the database, so limits hold across
 * multiple app instances (an in-memory counter would not).
 *
 * The counter row is written with an upsert that increments atomically, so
 * concurrent requests cannot both read a stale count.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '@/infrastructure/db/client';
import { rateLimits } from '@/infrastructure/db/schema';
import { sha256 } from './crypto';

export interface RateLimitRule {
  /** Requests permitted per window. */
  readonly limit: number;
  /** Window length in seconds. */
  readonly windowSeconds: number;
}

export const RATE_LIMITS = {
  login: { limit: 8, windowSeconds: 300 },
  register: { limit: 5, windowSeconds: 900 },
  checkout: { limit: 10, windowSeconds: 600 },
  cartWrite: { limit: 120, windowSeconds: 60 },
  search: { limit: 120, windowSeconds: 60 },
  paymentCallback: { limit: 60, windowSeconds: 60 },
  trackingLookup: { limit: 30, windowSeconds: 300 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

function windowStart(windowSeconds: number, now: Date): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

/**
 * Consumes one unit from `name`'s bucket for `identity`.
 * `identity` is hashed, so raw IPs never land in the table.
 */
export async function consumeRateLimit(
  name: RateLimitName,
  identity: string,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[name];
  const bucket = `${name}:${sha256(identity).slice(0, 32)}`;
  const start = windowStart(rule.windowSeconds, now);

  const db = getDb();
  const rows = await db
    .insert(rateLimits)
    .values({ bucket, windowStart: start, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.bucket, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  const count = rows[0]?.count ?? 1;
  const resetAt = start.getTime() + rule.windowSeconds * 1000;
  return {
    allowed: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000)),
  };
}

/** Deletes windows older than a day. Call from a scheduled job. */
export async function pruneRateLimits(olderThan: Date = new Date(Date.now() - 86_400_000)): Promise<void> {
  await getDb().delete(rateLimits).where(sql`${rateLimits.windowStart} < ${olderThan}`);
}
