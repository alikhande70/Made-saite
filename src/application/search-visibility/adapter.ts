/**
 * Search engine adapter boundary.
 *
 * The domain knows that "a URL changed and somebody should be told". It does
 * not know IndexNow, and must not: the whole point of this seam is that adding
 * a second engine later is a new file here and a registry entry, not a change
 * to the outbox, the sitemap or any admin surface.
 *
 * Adapters are intentionally dumb. They do not retry, schedule, deduplicate or
 * decide what is worth submitting — the outbox owns all of that, because those
 * decisions must be identical across engines and must survive a crash.
 */

export interface SubmissionOutcome {
  ok: boolean;
  /** HTTP status when a request was made, null when it never got that far. */
  status: number | null;
  /**
   * Whether the outbox should try again. Distinct from `ok`: a bad key is a
   * failure nobody should retry, a 429 is a failure everybody should.
   */
  retryable: boolean;
  /** Short, safe for logs and the admin UI. Never contains the key. */
  message: string;
}

export interface AdapterConfigStatus {
  configured: boolean;
  /** Persian, shown in the admin when the adapter is not usable. */
  reasonFa: string | null;
}

export interface SearchEngineAdapter {
  /** Stable identifier, stored on every outbox row. */
  readonly id: string;
  readonly displayNameFa: string;
  /**
   * Whether the engine accepts change notifications at all. An adapter that
   * cannot be told about changes still has a place here — it may later grow
   * reporting — but the outbox will never enqueue for it.
   */
  readonly supportsInstantSubmission: boolean;
  /** Maximum URLs the engine accepts in one batch request. */
  readonly maxBatchSize: number;

  /** Cheap, synchronous-ish check. Never throws. */
  validateConfiguration(): AdapterConfigStatus;

  submitUrl(url: string): Promise<SubmissionOutcome>;
  submitBatch(urls: readonly string[]): Promise<SubmissionOutcome>;
}
