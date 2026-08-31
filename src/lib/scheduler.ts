/**
 * In-process background jobs.
 *
 * Unpaid orders hold their stock reservation until something releases it. In
 * development that something is `npm run db:sweep`, run from cron. The
 * production image has neither `tsx` nor the `src` tree, so that script cannot
 * run there at all — which means a containerized deployment would hold stranded
 * stock forever, and the shop would quietly stop being able to sell items that
 * are physically on the shelf. Sessions and rate-limit windows would grow
 * without bound for the same reason.
 *
 * So the sweep runs inside the server process on an interval. That is a
 * deliberate trade: an external scheduler is more visible and more easily
 * monitored, but it is also one more thing for an operator to set up correctly
 * and one more thing to forget. This project targets an owner who is not an
 * engineer, and a job that runs by default beats a better job that is never
 * configured.
 *
 * It is safe to run more than one copy: `expireStaleOrders` locks and
 * re-checks each order inside its own transaction, and both prunes are plain
 * deletes of already-expired rows. A second application instance would double
 * the work and change nothing else.
 *
 * Set `DISABLE_BACKGROUND_JOBS=true` to turn this off and drive the sweep from
 * cron instead.
 */
import { INVARIANT, logEvent, reportError } from './observability';

const DEFAULT_INTERVAL_MINUTES = 5;

/**
 * Delayed so a deploy is not competing with a sweep while it is still proving
 * readiness, and so a restart loop cannot turn into a query storm.
 */
const FIRST_RUN_DELAY_MS = 60_000;

let started = false;

export function sweepIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SWEEP_INTERVAL_MINUTES);
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_MINUTES;
  // A sweep every few seconds is a mistake, not a configuration: it would run
  // three deletes per tick against the busiest tables in the schema.
  return Math.max(minutes, 1) * 60_000;
}

export function backgroundJobsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.DISABLE_BACKGROUND_JOBS === 'true') return false;
  // Development restarts constantly and has no stock to strand; running the
  // sweep there just holds a database connection open across every reload.
  return env.NODE_ENV === 'production';
}

/** Runs one sweep. Exported for tests and for a manual trigger. */
export async function runSweep(): Promise<{ cancelled: number }> {
  const [{ expireStaleOrders }, { deleteExpiredSessions }, { pruneRateLimits }] = await Promise.all([
    import('@/application/order-service'),
    import('@/application/auth-service'),
    import('./rate-limit'),
  ]);

  const cancelled = await expireStaleOrders();
  await deleteExpiredSessions();
  await pruneRateLimits();

  // Only worth a line when it actually did something; an idle shop should not
  // write a log entry every five minutes.
  if (cancelled > 0) {
    logEvent('info', { event: 'sweep.completed', cancelledOrders: cancelled });
  }
  return { cancelled };
}

/**
 * Starts the interval. Idempotent — a second call is ignored, because Next may
 * initialise instrumentation more than once per process.
 */
export function startBackgroundJobs(): void {
  if (started || !backgroundJobsEnabled()) return;
  started = true;

  const tick = () => {
    void runSweep().catch((error) => {
      // A failed sweep is not fatal: stock is released on the next tick. It is
      // reported because a sweep that fails *every* tick is how stranded stock
      // accumulates silently.
      reportError(error, { event: INVARIANT.DATABASE_UNAVAILABLE, job: 'sweep' });
    });
  };

  // `unref` so a pending timer never keeps the process alive through a SIGTERM;
  // the container must shut down promptly or it is killed after the timeout.
  setTimeout(() => {
    tick();
    setInterval(tick, sweepIntervalMs()).unref();
  }, FIRST_RUN_DELAY_MS).unref();

  logEvent('info', {
    event: 'sweep.scheduled',
    intervalMinutes: sweepIntervalMs() / 60_000,
  });
}
