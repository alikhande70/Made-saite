/* Applies pending Drizzle migrations. Usage: npm run db:migrate */
import './env';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb, closePool } from '../src/infrastructure/db/client';

async function main() {
  const db = getDb();
  await migrate(db, { migrationsFolder: './src/infrastructure/db/migrations' });
  console.log('✔ migrations applied');
}

main()
  .catch((err) => {
    console.error('✖ migration failed:', err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
