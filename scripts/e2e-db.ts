/**
 * Creates, migrates and seeds the dedicated end-to-end database.
 *
 * This runs as part of Playwright's `webServer.command`, **before** the Next
 * server starts, and that placement is the whole point.
 *
 * Playwright starts `webServer` and waits for its `url` to answer before it
 * runs `globalSetup`. Every storefront page is `force-dynamic` and queries the
 * database on every request, so on a machine where the E2E database has never
 * existed the readiness probe gets an HTTP 500 forever, the 120-second
 * webServer timeout fires, and `globalSetup` — the thing that would have
 * created the database — never runs. A deadlock that is invisible on any
 * machine that has run the suite before, and deterministic on a fresh CI
 * runner. Making the server's own command depend on this script removes the
 * ordering question entirely.
 *
 * See docs/TESTING.md.
 */
import { execFileSync } from 'node:child_process';
import { Client, Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

export const E2E_DB_NAME = process.env.E2E_DB_NAME ?? 'madesaite_e2e';

/** The same connection string with the database swapped for the E2E one. */
export function e2eDatabaseUrl(): string {
  return databaseUrlFor(E2E_DB_NAME);
}

export function databaseUrlFor(database: string): string {
  const parsed = new URL(process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5432/madesaite');
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** True when the E2E database exists and carries seeded products. */
export async function e2eDatabaseIsReady(): Promise<boolean> {
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  try {
    await client.connect();
    const { rows } = await client.query<{ n: string }>('select count(*)::text as n from products');
    return Number(rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function prepareE2eDatabase(): Promise<void> {
  const admin = new Client({ connectionString: databaseUrlFor('postgres') });
  await admin.connect();
  try {
    // Drop fails while anything holds a connection — a leftover dev server, or
    // a previous run's pool. Terminate first so a re-run is never blocked.
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
        where datname = $1 and pid <> pg_backend_pid()`,
      [E2E_DB_NAME],
    );
    await admin.query(`drop database if exists ${E2E_DB_NAME}`);
    await admin.query(`create database ${E2E_DB_NAME}`);
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: e2eDatabaseUrl() });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './src/infrastructure/db/migrations' });
  } finally {
    await pool.end();
  }

  execFileSync('npx', ['tsx', 'scripts/seed.ts'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: e2eDatabaseUrl() },
  });
}

// Executed directly by `npm run test:e2e:db`.
if (process.argv[1] && process.argv[1].endsWith('e2e-db.ts')) {
  prepareE2eDatabase()
    .then(() => {
      console.log(`✔ e2e database "${E2E_DB_NAME}" created, migrated and seeded`);
    })
    .catch((error: unknown) => {
      console.error('✖ failed to prepare the e2e database:', error);
      process.exit(1);
    });
}
