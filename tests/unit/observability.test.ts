/**
 * Logging is where secrets leak.
 *
 * A log line is written in a hurry, ends up in a ticket, a screenshot or a
 * shipped log stream, and is read by more people than the database ever is.
 * Redaction is therefore enforced at the boundary rather than trusted to call
 * sites.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INVARIANT, logEvent, redact, reportError, reportInvariantViolation,
  setErrorReporter, type ErrorReporter, type LogContext,
} from '@/lib/observability';

let lines: string[] = [];

beforeEach(() => {
  lines = [];
  for (const method of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(String(args[0]));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  setErrorReporter(null);
});

const parsed = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);

describe('redaction', () => {
  it('strips values whose key names a credential, at any nesting depth', () => {
    const out = redact({
      orderId: 'ord_1',
      password: 'hunter2',
      apiKey: 'live_abc',
      nested: { merchantId: 'M-123', transactionId: 'T-9', safe: 'keep' },
    }) as Record<string, unknown>;

    expect(out.orderId).toBe('ord_1');
    expect(out.password).toBe('[redacted]');
    expect(out.apiKey).toBe('[redacted]');
    const nested = out.nested as Record<string, unknown>;
    expect(nested.merchantId).toBe('[redacted]');
    expect(nested.transactionId).toBe('[redacted]');
    expect(nested.safe).toBe('keep');
  });

  it('matches key names case-insensitively and in any casing convention', () => {
    const out = redact({
      PASSWORD: 'a', api_key: 'b', ZarinpalMerchantId: 'c', session_id: 'd',
    }) as Record<string, string>;
    for (const value of Object.values(out)) expect(value).toBe('[redacted]');
  });

  it('strips credentials embedded inside a string, not just in keys', () => {
    // The realistic leak: a driver error message quoting the connection URL.
    const out = redact('connect failed: postgres://app:hunter2@db.internal:5432/madesaite');
    expect(out).not.toContain('hunter2');
    expect(out).toContain('[redacted-url]');
  });

  it('bounds depth and length so a log line cannot become a payload dump', () => {
    let deep: Record<string, unknown> = { value: 'bottom' };
    for (let i = 0; i < 10; i++) deep = { nested: deep };
    expect(JSON.stringify(redact(deep))).toContain('[truncated]');
    expect(String(redact('x'.repeat(5_000)))).toHaveLength(2_001);
  });
});

describe('structured output', () => {
  it('emits one parseable JSON object per line with a stable event name', () => {
    logEvent('info', { event: 'checkout.started', orderId: 'ord_1' });
    const [line] = parsed();
    expect(line!.event).toBe('checkout.started');
    expect(line!.level).toBe('info');
    expect(typeof line!.ts).toBe('string');
  });

  it('honours LOG_LEVEL so debug noise stays out of production', () => {
    const previous = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'warn';
    logEvent('info', { event: 'ignored' });
    logEvent('error', { event: 'kept' });
    expect(parsed().map((l) => l.event)).toEqual(['kept']);
    process.env.LOG_LEVEL = previous;
  });

  it('records an error with its stack but redacts the message', () => {
    reportError(new Error('failed for postgres://app:hunter2@db:5432/x'), { event: 'db.query_failed' });
    const [line] = parsed();
    expect(line!.event).toBe('db.query_failed');
    expect(String(line!.errorMessage)).not.toContain('hunter2');
    expect(line!.stack).toBeTruthy();
  });
});

describe('the reporter boundary', () => {
  it('forwards errors when a reporter is attached, and works when none is', () => {
    const captured: LogContext[] = [];
    const reporter: ErrorReporter = {
      name: 'test',
      captureError: (_e, context) => { captured.push(context); },
    };

    reportError(new Error('boom'), { event: 'a' });   // none attached
    setErrorReporter(reporter);
    reportError(new Error('boom'), { event: 'b' });

    expect(captured.map((c) => c.event)).toEqual(['b']);
    // Both were still logged; the reporter is additive, never the only sink.
    expect(parsed()).toHaveLength(2);
  });

  it('survives a reporter that throws, rather than failing the request', () => {
    setErrorReporter({
      name: 'broken',
      captureError: () => { throw new Error('reporter is down'); },
    });

    expect(() => reportError(new Error('original'), { event: 'payment.failed' })).not.toThrow();
    const events = parsed().map((l) => l.event);
    expect(events).toContain('payment.failed');
    expect(events).toContain('observability.reporter_failed');
  });
});

describe('operational invariants', () => {
  it('emits a stable, greppable name that alerting can key on', () => {
    reportInvariantViolation(INVARIANT.CALLBACK_AMOUNT_MISMATCH, {
      orderId: 'ord_1', expectedAmount: 100, reportedAmount: 1,
    });
    const [line] = parsed();
    expect(line!.event).toBe('invariant.callback_amount_mismatch');
    expect(line!.invariant).toBe(true);
    expect(line!.level).toBe('error');
  });

  it('keeps every invariant name distinct, since alerts are keyed on them', () => {
    const names = Object.values(INVARIANT);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name.startsWith('invariant.')).toBe(true);
  });
});
