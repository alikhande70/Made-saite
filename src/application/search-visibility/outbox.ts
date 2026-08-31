/**
 * Search submission outbox.
 *
 * Nothing in a request path talks to a search engine. An admin saving a product
 * enqueues a row here; the background sweeper drains it. The properties that
 * buys, and why each matters:
 *
 *   crash-safe     the row is committed with the write that caused it, so a
 *                  restart between "product saved" and "engine told" loses
 *                  nothing;
 *   deduplicated   a partial unique index over (url, adapter) for unsettled
 *                  rows collapses repeated edits onto one pending submission,
 *                  so an afternoon of admin work is one request, not fifty;
 *   retryable      failures carry an attempt count and a next-attempt time,
 *                  with the engine's own status deciding whether retrying is
 *                  even sensible;
 *   observable     every row is visible in the admin with its last error.
 *
 * The one thing it deliberately does not do is guarantee delivery order.
 * Search engines do not care, and imposing an order would mean one stuck URL
 * blocks every other.
 */
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { getDb, type Database } from '@/infrastructure/db/client';
import { searchSubmissionEvents } from '@/infrastructure/db/schema';
import {
  SUBMISSION_MAX_ATTEMPTS,
  dedupeUrls,
  nextRetryAt,
  normalizeSubmissionUrl,
} from '@/domain/search-visibility';
import { logEvent } from '@/lib/observability';
import type { SearchEngineAdapter } from './adapter';

/** Why a URL was enqueued. Audit only — never used to decide behaviour. */
export type SubmissionEventType =
  | 'product.created'
  | 'product.updated'
  | 'product.activated'
  | 'product.deactivated'
  | 'product.slug_changed'
  | 'category.changed'
  | 'brand.changed'
  | 'vehicle_landing.changed'
  | 'manual';

export interface EnqueueInput {
  urls: readonly string[];
  eventType: SubmissionEventType;
  adapterId: string;
}

/**
 * Adds URLs to the outbox, skipping any that already have an unsettled row.
 *
 * Safe to call inside the caller's transaction — pass `db` — so the enqueue
 * commits or rolls back with the change that caused it. Returns how many rows
 * were actually created, which is what the tests assert on to prove dedupe.
 */
export async function enqueueSubmissions(
  input: EnqueueInput,
  db: Database = getDb(),
): Promise<number> {
  const urls = dedupeUrls(input.urls);
  if (urls.length === 0) return 0;

  const rows = urls.map((url) => ({
    url,
    adapter: input.adapterId,
    eventType: input.eventType,
  }));

  /*
   * `onConflictDoNothing` against the partial unique index is what makes this
   * idempotent under concurrency: two admins saving the same product in the
   * same second produce one pending row, decided by the database rather than by
   * a read-then-write race in application code.
   */
  const inserted = await db
    .insert(searchSubmissionEvents)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: searchSubmissionEvents.id });

  return inserted.length;
}

/** Convenience for the common single-URL case. */
export async function enqueueSubmission(
  url: string,
  eventType: SubmissionEventType,
  adapterId: string,
  db: Database = getDb(),
): Promise<number> {
  return enqueueSubmissions({ urls: [url], eventType, adapterId }, db);
}

export interface DrainResult {
  claimed: number;
  succeeded: number;
  failed: number;
  parked: number;
}

/**
 * Claims and submits one batch of due rows.
 *
 * Claiming is a single `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP
 * LOCKED)`, so two application instances draining at once split the work rather
 * than both submitting the same URLs. `SKIP LOCKED` is the whole reason this is
 * safe to run in every replica without coordination.
 */
export async function drainOutbox(
  adapter: SearchEngineAdapter,
  options: { limit?: number; now?: Date } = {},
  db: Database = getDb(),
): Promise<DrainResult> {
  /*
   * Due-ness is decided by the *database* clock, not this process's.
   *
   * `next_attempt_at` is written by the database (`defaultNow()`, and
   * `now() + interval` on retry). Comparing it against a `new Date()` from Node
   * meant any skew between the two clocks — a separate database container is
   * enough — left a freshly enqueued row looking not-yet-due, so the first
   * sweep after an enqueue silently claimed nothing. CI caught this; it passed
   * locally because both clocks belonged to the same machine.
   *
   * `options.now` stays available so a caller can pin the moment explicitly.
   */
  const dueNow = options.now
    ? sql`${searchSubmissionEvents.nextAttemptAt} <= ${options.now}`
    : sql`${searchSubmissionEvents.nextAttemptAt} <= now()`;
  const attemptedAt = options.now ?? sql`now()`;
  const limit = Math.min(options.limit ?? 500, adapter.maxBatchSize);
  const empty: DrainResult = { claimed: 0, succeeded: 0, failed: 0, parked: 0 };

  const config = adapter.validateConfiguration();
  if (!config.configured) {
    // Leave rows PENDING rather than burning attempts against a known-bad
    // configuration: once a key is set, the backlog drains on the next tick.
    return empty;
  }

  const claimed = await db
    .update(searchSubmissionEvents)
    .set({ status: 'PROCESSING', lastAttemptAt: attemptedAt })
    .where(
      inArray(
        searchSubmissionEvents.id,
        db
          .select({ id: searchSubmissionEvents.id })
          .from(searchSubmissionEvents)
          .where(
            and(
              eq(searchSubmissionEvents.status, 'PENDING'),
              eq(searchSubmissionEvents.adapter, adapter.id),
              dueNow,
            ),
          )
          .orderBy(asc(searchSubmissionEvents.nextAttemptAt))
          .limit(limit)
          .for('update', { skipLocked: true }),
      ),
    )
    .returning({ id: searchSubmissionEvents.id, url: searchSubmissionEvents.url });

  if (claimed.length === 0) return empty;

  const outcome = await adapter.submitBatch(claimed.map((r) => r.url));
  const ids = claimed.map((r) => r.id);

  if (outcome.ok) {
    await db
      .update(searchSubmissionEvents)
      .set({
        status: 'SUCCEEDED',
        completedAt: sql`now()`,
        attemptCount: sql`${searchSubmissionEvents.attemptCount} + 1`,
        lastError: null,
      })
      .where(inArray(searchSubmissionEvents.id, ids));
    return { claimed: claimed.length, succeeded: claimed.length, failed: 0, parked: 0 };
  }

  /*
   * A failure moves the whole claimed batch together: the engine answered once
   * for the batch, so there is no per-URL verdict to record. Rows that have
   * exhausted their attempts, or whose failure is not worth retrying, are
   * parked as FAILED for a human; the rest go back to PENDING with backoff.
   */
  const message = outcome.message.slice(0, 300);
  const parkAll = !outcome.retryable;

  const updated = await db
    .update(searchSubmissionEvents)
    .set({
      attemptCount: sql`${searchSubmissionEvents.attemptCount} + 1`,
      lastError: message,
      status: parkAll
        ? sql`'FAILED'::search_submission_status`
        : sql`case when ${searchSubmissionEvents.attemptCount} + 1 >= ${SUBMISSION_MAX_ATTEMPTS}
                 then 'FAILED'::search_submission_status
                 else 'PENDING'::search_submission_status end`,
      nextAttemptAt: parkAll
        ? sql`${searchSubmissionEvents.nextAttemptAt}`
        : sql`now() + make_interval(mins => least(power(2, ${searchSubmissionEvents.attemptCount})::int, 60))`,
      completedAt: parkAll ? sql`now()` : null,
    })
    .where(inArray(searchSubmissionEvents.id, ids))
    .returning({ status: searchSubmissionEvents.status });

  const parked = updated.filter((r) => r.status === 'FAILED').length;
  logEvent('warn', {
    event: 'seo.submission.failed',
    adapter: adapter.id,
    urlCount: claimed.length,
    parked,
    retryable: outcome.retryable,
  });

  return { claimed: claimed.length, succeeded: 0, failed: claimed.length, parked };
}

/** Puts FAILED rows back in the queue. Used by the admin "retry" action. */
export async function retryFailedSubmissions(
  adapterId: string,
  db: Database = getDb(),
): Promise<number> {
  const rows = await db
    .update(searchSubmissionEvents)
    .set({ status: 'PENDING', attemptCount: 0, nextAttemptAt: sql`now()`, completedAt: null })
    .where(
      and(eq(searchSubmissionEvents.status, 'FAILED'), eq(searchSubmissionEvents.adapter, adapterId)),
    )
    .returning({ id: searchSubmissionEvents.id });
  return rows.length;
}

export interface OutboxSummary {
  pending: number;
  processing: number;
  succeeded: number;
  failed: number;
  recentFailures: {
    url: string;
    eventType: string;
    attemptCount: number;
    lastError: string | null;
    lastAttemptAt: Date | null;
  }[];
}

export async function summariseOutbox(db: Database = getDb()): Promise<OutboxSummary> {
  const counts = await db
    .select({ status: searchSubmissionEvents.status, n: sql<number>`count(*)::int` })
    .from(searchSubmissionEvents)
    .groupBy(searchSubmissionEvents.status);

  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.n]));

  const recentFailures = await db
    .select({
      url: searchSubmissionEvents.url,
      eventType: searchSubmissionEvents.eventType,
      attemptCount: searchSubmissionEvents.attemptCount,
      lastError: searchSubmissionEvents.lastError,
      lastAttemptAt: searchSubmissionEvents.lastAttemptAt,
    })
    .from(searchSubmissionEvents)
    .where(eq(searchSubmissionEvents.status, 'FAILED'))
    .orderBy(desc(searchSubmissionEvents.lastAttemptAt))
    .limit(10);

  return {
    pending: byStatus.PENDING ?? 0,
    processing: byStatus.PROCESSING ?? 0,
    succeeded: byStatus.SUCCEEDED ?? 0,
    failed: byStatus.FAILED ?? 0,
    recentFailures,
  };
}

/**
 * Deletes settled rows older than the retention window. The outbox is a work
 * queue, not an archive — `orderEvents` and the admin audit log already hold
 * the durable record of what changed.
 */
export async function pruneSettledSubmissions(
  olderThanDays = 30,
  db: Database = getDb(),
): Promise<number> {
  const rows = await db
    .delete(searchSubmissionEvents)
    .where(
      and(
        inArray(searchSubmissionEvents.status, ['SUCCEEDED', 'FAILED']),
        lte(searchSubmissionEvents.completedAt, new Date(Date.now() - olderThanDays * 86_400_000)),
      ),
    )
    .returning({ id: searchSubmissionEvents.id });
  return rows.length;
}

/** Exposed for tests that need to reason about the backoff schedule. */
export { nextRetryAt, normalizeSubmissionUrl };
