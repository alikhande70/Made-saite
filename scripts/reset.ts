/** Drops and recreates the public schema, then re-applies migrations. */
import './env';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb, closePool } from '../src/infrastructure/db/client';

async function main() {
  const db = getDb();
  await db.execute(sql`drop schema public cascade`);
  await db.execute(sql`create schema public`);
  await migrate(db, { migrationsFolder: './src/infrastructure/db/migrations' });
  console.log('✔ database reset and migrated');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => closePool());
