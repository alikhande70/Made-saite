import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import * as schema from './schema';

declare global {
   
  var __madesaitePool: Pool | undefined;
}

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and point it at your PostgreSQL instance.',
    );
  }
  return url;
}

/** Single pool per process; reused across HMR reloads in development. */
export function getPool(): Pool {
  if (!globalThis.__madesaitePool) {
    globalThis.__madesaitePool = new Pool({
      connectionString: connectionString(),
      max: Number(process.env.PG_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalThis.__madesaitePool;
}

export type Database = NodePgDatabase<typeof schema>;

let _db: Database | undefined;

export function getDb(): Database {
  if (!_db) _db = drizzle(getPool(), { schema });
  return _db;
}

/** Convenience proxy so callers can `import { db }` without eager connection. */
export const db = new Proxy({} as Database, {
  get(_t, prop) {
    const target = getDb() as unknown as Record<string | symbol, unknown>;
    const value = target[prop];
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

/**
 * Runs `fn` inside a SERIALIZABLE-safe READ COMMITTED transaction.
 * Row locks (`SELECT … FOR UPDATE`) are the concurrency primitive we rely on,
 * so READ COMMITTED plus explicit locking is both correct and retry-free.
 */
export async function withTransaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => fn(tx as unknown as Database));
}

export async function withRawClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (globalThis.__madesaitePool) {
    await globalThis.__madesaitePool.end();
    globalThis.__madesaitePool = undefined;
    _db = undefined;
  }
}

export { schema };
