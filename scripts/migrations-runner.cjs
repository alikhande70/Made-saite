/**
 * Standalone migration runner for the production image.
 *
 * Exists because the app image has no TypeScript toolchain: `scripts/migrate.ts`
 * needs tsx, which is a dev dependency and deliberately absent from the runtime.
 * This is plain CommonJS against the same migration SQL and the same Drizzle
 * journal, so production applies exactly what development and CI applied.
 *
 * It exits non-zero on any failure, which is what makes the compose `migrate`
 * service gate the application start.
 */
const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[migrate] DATABASE_URL is not set.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './migrations' });
    console.log('[migrate] migrations applied');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  // Deliberately fatal: a partially-migrated database serving traffic is worse
  // than a deployment that stops here.
  console.error('[migrate] FAILED — deployment must not continue:', error);
  process.exit(1);
});
