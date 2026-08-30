/**
 * Creates (or recreates) the dedicated test database and applies migrations
 * once for the whole run.
 */
import { config } from 'dotenv';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

config({ path: '.env.local' });
config({ path: '.env' });

const TEST_DB = process.env.TEST_DB_NAME ?? 'madesaite_test';

function adminUrl(): string {
  const base = process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5432/madesaite';
  const url = new URL(base);
  url.pathname = '/postgres';
  return url.toString();
}

export function testDatabaseUrl(): string {
  const base = process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5432/madesaite';
  const url = new URL(base);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
}

export async function setup(): Promise<void> {
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  await admin.query(
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
    [TEST_DB],
  );
  await admin.query(`drop database if exists ${TEST_DB}`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  const pool = new Pool({ connectionString: testDatabaseUrl() });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: './src/infrastructure/db/migrations' });
  await pool.end();
}
