/**
 * Structured logging and the error-reporting boundary.
 *
 * Two problems this solves. First, production failures currently go to
 * `console.error` as free text, which cannot be searched, filtered or alerted
 * on. Second, there is no error tracker — and wiring one in directly would put
 * a vendor's name through the whole codebase.
 *
 * So the application logs through `logEvent`/`reportError` and knows nothing
 * about where the output goes. A reporter is attached at startup if one is
 * configured, and if none is, the boundary degrades to structured stdout —
 * which a VPS operator can still tail, ship to journald, or point at anything
 * that reads JSON lines.
 *
 * Redaction is enforced here rather than trusted to call sites, because the
 * one place a secret leaks is the log line somebody wrote in a hurry.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;
  return LEVEL_ORDER[configured] ?? LEVEL_ORDER.info;
}

/**
 * Keys whose values are never logged, whatever a caller passes.
 *
 * Matched case-insensitively on substrings, so `zarinpalMerchantId`,
 * `MERCHANT_ID` and `merchant_id` are all caught by one entry.
 */
const REDACTED_KEY_PATTERNS = [
  'password', 'passwd', 'secret', 'token', 'authorization', 'cookie',
  'apikey', 'api_key', 'merchant', 'authority', 'transactionid', 'transaction_id',
  'cardnumber', 'card_number', 'cvv', 'iban', 'nationalid', 'national_id',
  'dsn', 'connectionstring', 'database_url', 'sessionid', 'session_id',
];

const REDACTED = '[redacted]';

/** Value patterns that are secrets wherever they appear, including inside strings. */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  // A connection URL with credentials.
  /\b[a-z]+:\/\/[^\s:@/]+:[^\s@/]+@/gi,
];

function redactString(value: string): string {
  let out = value;
  for (const pattern of SECRET_VALUE_PATTERNS) out = out.replace(pattern, '[redacted-url]');
  return out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      out[key] = REDACTED_KEY_PATTERNS.some((p) => lower.includes(p)) ? REDACTED : redact(inner, depth + 1);
    }
    return out;
  }
  return String(value);
}

export interface LogContext {
  /** Stable, greppable identifier for the kind of event, e.g. `payment.verify_failed`. */
  event: string;
  [key: string]: unknown;
}

/**
 * A reporter forwards errors to whatever the deployment has configured.
 * Deliberately structural, so no vendor SDK is a dependency of this module.
 */
export interface ErrorReporter {
  name: string;
  captureError(error: unknown, context: LogContext): void;
}

let reporter: ErrorReporter | null = null;

export function setErrorReporter(next: ErrorReporter | null): void {
  reporter = next;
}

export function currentErrorReporter(): ErrorReporter | null {
  return reporter;
}

function emit(level: LogLevel, context: LogContext, extra?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < threshold()) return;

  const line = {
    ts: new Date().toISOString(),
    level,
    ...(redact({ ...context, ...extra }) as Record<string, unknown>),
  };

  // One JSON object per line: parseable by journald, Loki, Vector or `jq`,
  // without committing to any of them.
  const serialised = JSON.stringify(line);
  if (level === 'error') console.error(serialised);
  else if (level === 'warn') console.warn(serialised);
  else console.log(serialised);
}

export function logEvent(level: LogLevel, context: LogContext): void {
  emit(level, context);
}

/**
 * Records a failure. Always logs; additionally forwards to the configured
 * reporter when one is attached.
 *
 * The stack is logged but never returned to a caller — `jsonError` already maps
 * exceptions to generic Persian messages, and this must not become the leak
 * that undoes it.
 */
export function reportError(error: unknown, context: LogContext): void {
  const shaped = error instanceof Error
    ? { errorName: error.name, errorMessage: redactString(error.message), stack: error.stack }
    : { errorMessage: redactString(String(error)) };

  emit('error', context, shaped);

  try {
    reporter?.captureError(error, context);
  } catch (reporterFailure) {
    // A broken reporter must never take down the request it was reporting on.
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      event: 'observability.reporter_failed',
      reporter: reporter?.name ?? 'unknown',
      errorMessage: String(reporterFailure),
    }));
  }
}

/**
 * Operational invariants: conditions that should be impossible, and that an
 * operator wants an alert for rather than a line in a log nobody reads.
 *
 * Listed explicitly so `docs/OPERATIONS.md` and any alerting rule reference the
 * same names as the code emits.
 */
export const INVARIANT = {
  PAID_WITHOUT_VERIFICATION: 'invariant.paid_without_verified_transaction',
  STOCK_NEGATIVE: 'invariant.stock_below_zero',
  DUPLICATE_ORDER_FOR_CHECKOUT: 'invariant.duplicate_order_for_checkout',
  CALLBACK_UNKNOWN_ORDER: 'invariant.callback_for_unknown_order',
  CALLBACK_AMOUNT_MISMATCH: 'invariant.callback_amount_mismatch',
  ILLEGAL_STATE_TRANSITION: 'invariant.illegal_order_state_transition',
  MIGRATION_FAILED: 'invariant.migration_failed',
  DATABASE_UNAVAILABLE: 'invariant.database_unavailable',
} as const;

export type InvariantName = (typeof INVARIANT)[keyof typeof INVARIANT];

/**
 * Reports a violated invariant at `error` level with a stable event name.
 *
 * These are the events worth waking somebody for; ordinary validation failures
 * are not, and must not use this channel or the alerts stop being read.
 */
export function reportInvariantViolation(
  invariant: InvariantName,
  detail: Record<string, unknown>,
): void {
  emit('error', { event: invariant, invariant: true, ...detail });
  try {
    reporter?.captureError(new Error(`Invariant violated: ${invariant}`), {
      event: invariant, invariant: true, ...detail,
    });
  } catch {
    /* reporting must not cascade */
  }
}
