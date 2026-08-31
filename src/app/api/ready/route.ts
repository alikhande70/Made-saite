/**
 * Readiness: "can this process actually serve a customer?"
 *
 * The distinction from liveness is operational, not pedantic. A load balancer
 * uses readiness to decide whether to send traffic, and a deployment uses it to
 * decide whether the new release is good. Both need to know the application can
 * reach its database — an instance that is running but cannot query is worse
 * than one that is down, because it answers with errors.
 *
 * The check is deliberately cheap: `select 1` plus a schema probe, no counting
 * and no application queries. A readiness endpoint that does real work becomes
 * a load generator once a monitor polls it every ten seconds.
 *
 * It reveals nothing: no connection string, no driver message, no stack. A
 * failing probe says "database", and the detail goes to the server log.
 */
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/infrastructure/db/client';

export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 3_000;

async function checkDatabase(): Promise<{ ok: boolean; detail?: string }> {
  try {
    await Promise.race([
      // `to_regclass` confirms migrations have run, not merely that a
      // connection opened — a fresh empty database would otherwise read ready.
      getDb().execute(sql`select 1 as ok, to_regclass('public.products') as schema_present`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
    return { ok: true };
  } catch (error) {
    console.error('[ready] database check failed:', error);
    return { ok: false, detail: error instanceof Error && error.message === 'timeout' ? 'timeout' : 'unavailable' };
  }
}

export async function GET() {
  const database = await checkDatabase();
  const ready = database.ok;

  return NextResponse.json(
    {
      status: ready ? 'ready' : 'not_ready',
      checks: { database: database.ok ? 'ok' : (database.detail ?? 'failed') },
    },
    {
      // 503 so a load balancer and a deployment gate both act on it without
      // needing to parse the body.
      status: ready ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
