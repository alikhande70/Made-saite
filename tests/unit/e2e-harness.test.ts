/**
 * Guards the end-to-end harness against the ordering defect that broke CI.
 *
 * Playwright starts `webServer` and waits for its URL to answer *before* it
 * runs `globalSetup`. Every storefront page queries the database, so if the
 * E2E database is created in `globalSetup`, then on a machine where that
 * database has never existed the readiness probe receives HTTP 500 until the
 * webServer timeout fires — and the globalSetup that would have created it
 * never runs. The suite deadlocks.
 *
 * It is invisible locally, because a developer's machine has a database left
 * over from a previous run. It is deterministic on a fresh CI runner. These
 * assertions are static, so they cost nothing and fail loudly if the bootstrap
 * ever drifts back into globalSetup.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf-8');

describe('e2e database bootstrap ordering', () => {
  it('prepares the database inside webServer.command, before the server starts', () => {
    const config = read('playwright.config.ts');
    const command = /command:\s*`([^`]+)`/.exec(config)?.[1];

    expect(command, 'playwright.config.ts must define webServer.command').toBeTruthy();
    expect(command).toContain('test:e2e:db');
    // `&&` is the ordering guarantee: the server cannot start unless the
    // database preparation exited successfully.
    expect(command!.indexOf('test:e2e:db')).toBeLessThan(command!.indexOf('start'));
    expect(command).toMatch(/test:e2e:db\s*&&/);
  });

  it('does not create or seed the database from globalSetup', () => {
    const setup = read('tests/e2e/global-setup.ts');
    for (const forbidden of ['create database', 'drop database', 'migrate(', 'seed.ts']) {
      expect(setup, `globalSetup must not run "${forbidden}" — it runs too late`).not.toContain(forbidden);
    }
  });

  it('fails fast with an explanation when the database is not ready', () => {
    const setup = read('tests/e2e/global-setup.ts');
    expect(setup).toContain('e2eDatabaseIsReady');
    expect(setup).toMatch(/throw new Error/);
  });

  it('allows the webServer timeout to cover create, migrate, seed and boot', () => {
    const config = read('playwright.config.ts');
    const timeout = /timeout:\s*([\d_]+)/.exec(config.slice(config.indexOf('webServer')))?.[1];
    expect(timeout, 'webServer.timeout must be declared').toBeTruthy();
    expect(Number(timeout!.replaceAll('_', ''))).toBeGreaterThanOrEqual(180_000);
  });

  it('exposes the bootstrap as a script anyone can run directly', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['test:e2e:db']).toBe('tsx scripts/e2e-db.ts');
  });
});
