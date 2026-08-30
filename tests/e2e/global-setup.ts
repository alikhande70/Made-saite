/**
 * Creates and seeds the dedicated E2E database before the suite runs.
 * The seed is the same demo dataset the storefront ships with, so E2E exercises
 * realistic Persian data rather than synthetic stubs.
 */
import { execFileSync } from 'node:child_process';
import { Client, Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const DB_NAME = process.env.E2E_DB_NAME ?? 'madesaite_e2e';

function url(database: string): string {
  const parsed = new URL(process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5432/madesaite');
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export default async function globalSetup(): Promise<void> {
  const admin = new Client({ connectionString: url('postgres') });
  await admin.connect();
  await admin.query(
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
    [DB_NAME],
  );
  await admin.query(`drop database if exists ${DB_NAME}`);
  await admin.query(`create database ${DB_NAME}`);
  await admin.end();

  const pool = new Pool({ connectionString: url(DB_NAME) });
  await migrate(drizzle(pool), { migrationsFolder: './src/infrastructure/db/migrations' });
  await pool.end();

  execFileSync('npx', ['tsx', 'scripts/seed.ts'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url(DB_NAME) },
  });
}
