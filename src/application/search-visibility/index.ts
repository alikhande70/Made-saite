/**
 * SearchVisibilityService — the one entry point the rest of the application
 * uses to talk about search visibility.
 *
 * Pages, admin handlers and background jobs call this. None of them know which
 * search engines exist, how the outbox is stored, or how a canonical URL is
 * spelled. That is the boundary: a UI component deciding indexability, or an
 * admin handler calling an engine directly, is exactly what this exists to stop.
 */
import { getDb, type Database } from '@/infrastructure/db/client';
import { siteUrl } from '@/application/settings-service';
import {
  type CanonicalTarget,
  type RobotsDirective,
  canonicalPath,
  canonicalUrl,
  listingRobots,
  type RawParams,
} from '@/domain/search-visibility';
import type { SearchEngineAdapter } from './adapter';
import { IndexNowAdapter } from './indexnow-adapter';
import {
  type SubmissionEventType,
  drainOutbox,
  enqueueSubmissions,
  pruneSettledSubmissions,
  retryFailedSubmissions,
  summariseOutbox,
} from './outbox';

/* ── adapter registry ─────────────────────────────────────────────────────── */

let adapters: SearchEngineAdapter[] | null = null;

/**
 * Built once per process. Adding an engine is one line here; nothing else in
 * the codebase changes.
 */
export function listAdapters(): SearchEngineAdapter[] {
  adapters ??= [new IndexNowAdapter()];
  return adapters;
}

export function getAdapter(id: string): SearchEngineAdapter | null {
  return listAdapters().find((a) => a.id === id) ?? null;
}

/** Test seam: replaces the registry, and restores it on the returned callback. */
export function setAdaptersForTesting(next: SearchEngineAdapter[] | null): () => void {
  const previous = adapters;
  adapters = next;
  return () => {
    adapters = previous;
  };
}

/* ── canonical + indexability (re-exported so callers need one import) ────── */

export { canonicalPath, canonicalUrl, listingRobots };
export type { CanonicalTarget, RobotsDirective, RawParams };

/** Absolute canonical for the configured site. */
export function absoluteCanonical(target: CanonicalTarget): string {
  return canonicalUrl(siteUrl(), target);
}

/* ── change notification ──────────────────────────────────────────────────── */

/**
 * Records that a URL's content changed and search engines should be told.
 *
 * Enqueues for every adapter that supports instant submission and is actually
 * configured — an unconfigured adapter would only accumulate rows that can
 * never succeed. Never throws: a submission is a side effect of the write that
 * caused it, and losing a notification must not lose the write. Callers may
 * pass their own transaction so the enqueue commits atomically with the change.
 */
export async function notifyUrlsChanged(
  targets: readonly CanonicalTarget[],
  eventType: SubmissionEventType,
  db: Database = getDb(),
): Promise<number> {
  try {
    const base = siteUrl();
    const urls = targets.map((t) => canonicalUrl(base, t));
    if (urls.length === 0) return 0;

    let enqueued = 0;
    for (const adapter of listAdapters()) {
      if (!adapter.supportsInstantSubmission) continue;
      if (!adapter.validateConfiguration().configured) continue;
      enqueued += await enqueueSubmissions({ urls, eventType, adapterId: adapter.id }, db);
    }
    return enqueued;
  } catch {
    // Deliberately swallowed. See the doc comment: the caller's write matters
    // more than the notification, and the sitemap remains the durable path to
    // discovery whatever happens here.
    return 0;
  }
}

/** Drains every configured adapter's queue. Called by the background sweeper. */
export async function processSubmissionQueue(
  db: Database = getDb(),
): Promise<{ succeeded: number; failed: number; parked: number }> {
  let succeeded = 0;
  let failed = 0;
  let parked = 0;
  for (const adapter of listAdapters()) {
    if (!adapter.supportsInstantSubmission) continue;
    const result = await drainOutbox(adapter, {}, db);
    succeeded += result.succeeded;
    failed += result.failed;
    parked += result.parked;
  }
  return { succeeded, failed, parked };
}

export { enqueueSubmissions, retryFailedSubmissions, summariseOutbox, pruneSettledSubmissions };
export type { SubmissionEventType, SearchEngineAdapter };
export { getSeoHealth, type SeoHealthReport } from './seo-health';
export {
  countGroup,
  renderSitemapIndex,
  renderUrlSet,
  sitemapEntries,
  sitemapIndex,
} from './sitemap-service';
