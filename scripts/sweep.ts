/**
 * Reservation sweeper.
 *
 * Cancels unpaid orders whose payment window has elapsed, returning their held
 * stock, and prunes expired sessions and stale rate-limit windows. Idempotent
 * and safe to run concurrently — each order is locked and re-checked inside its
 * own transaction.
 *
 * Run every few minutes in production, e.g.:
 *   *\/5 * * * *  cd /srv/madesaite && npm run db:sweep
 */
import './env';
import { closePool } from '../src/infrastructure/db/client';
import { expireStaleOrders } from '../src/application/order-service';
import { deleteExpiredSessions } from '../src/application/auth-service';
import { pruneRateLimits } from '../src/lib/rate-limit';

async function main() {
  const cancelled = await expireStaleOrders();
  await deleteExpiredSessions();
  await pruneRateLimits();
  console.log(`✔ sweep complete — ${cancelled} expired order(s) cancelled and released`);
}

main()
  .catch((e) => {
    console.error('✖ sweep failed:', e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
