/**
 * Background-job scheduling policy.
 *
 * The failure this guards is silent and slow: the production image has no
 * `tsx` and no `src` tree, so the cron-driven `npm run db:sweep` cannot run
 * inside a container at all. If the in-process sweep is disabled or
 * mis-scheduled, unpaid orders hold their stock forever and the shop stops
 * being able to sell items that are on the shelf — with no error anywhere.
 */
import { describe, expect, it } from 'vitest';
import { backgroundJobsEnabled, sweepIntervalMs } from '@/lib/scheduler';

const env = (over: Record<string, string | undefined>): NodeJS.ProcessEnv =>
  ({ NODE_ENV: 'production', ...over }) as NodeJS.ProcessEnv;

describe('background job scheduling', () => {
  it('runs in production, which is the deployment that cannot use cron', () => {
    expect(backgroundJobsEnabled(env({}))).toBe(true);
  });

  it('stays off in development, where a restart loop would hold a connection open', () => {
    expect(backgroundJobsEnabled(env({ NODE_ENV: 'development' }))).toBe(false);
  });

  it('can be turned off for an operator who prefers an external scheduler', () => {
    expect(backgroundJobsEnabled(env({ DISABLE_BACKGROUND_JOBS: 'true' }))).toBe(false);
  });

  it('is not disabled by a value that merely looks falsy', () => {
    // Only the exact string opts out; "false", "0" and "" must not silently
    // disable the sweep.
    for (const value of ['false', '0', '', 'no']) {
      expect(backgroundJobsEnabled(env({ DISABLE_BACKGROUND_JOBS: value }))).toBe(true);
    }
  });

  it('defaults to five minutes', () => {
    expect(sweepIntervalMs(env({}))).toBe(5 * 60_000);
  });

  it('honours an explicit interval', () => {
    expect(sweepIntervalMs(env({ SWEEP_INTERVAL_MINUTES: '15' }))).toBe(15 * 60_000);
  });

  it('never sweeps more often than once a minute', () => {
    // Three deletes per tick against the busiest tables in the schema, so a
    // sub-minute interval is a typo rather than a tuning decision. A positive
    // but tiny value is clamped, not rejected — the operator did mean "often".
    expect(sweepIntervalMs(env({ SWEEP_INTERVAL_MINUTES: '0.01' }))).toBe(60_000);
    expect(sweepIntervalMs(env({ SWEEP_INTERVAL_MINUTES: '0.5' }))).toBe(60_000);
  });

  it('falls back to the default on a value that is not an interval at all', () => {
    // Zero, a negative, and a non-number express no interval. Clamping them to
    // one minute would obey a typo; the default is the safer reading, and the
    // sweep keeps running either way — which is the property that matters.
    for (const value of ['0', '-5', 'soon', '']) {
      expect(sweepIntervalMs(env({ SWEEP_INTERVAL_MINUTES: value }))).toBe(5 * 60_000);
    }
  });
});
