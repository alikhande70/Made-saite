/**
 * The sandbox gateway must never be reachable from a real deployment.
 *
 * `MockPaymentProvider` confirms an order as paid without any money moving.
 * If it stays selectable in production, a customer can complete a checkout and
 * the shop records a paid order it was never paid for. Two ways in:
 *
 *   1. `PAYMENT_PROVIDER=mock` set explicitly on a live host;
 *   2. `PAYMENT_PROVIDER` unset — the default fell back to 'mock'.
 *
 * Both must fail **closed**: refuse to take the order, rather than take it and
 * pretend it was paid.
 *
 * Localhost is deliberately exempt. A production *build* served on 127.0.0.1 is
 * a verification run (that is exactly how the E2E suite runs), not a store.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ORIGINAL = { ...process.env };

/**
 * `process.env.NODE_ENV` is typed readonly, so tests write through a widened
 * view. The view must alias the live object — restoring by *replacing*
 * `process.env` would leave this reference pointing at a discarded copy — so
 * restore mutates the same object instead.
 */
const env = process.env as Record<string, string | undefined>;

function restore(): void {
  for (const key of Object.keys(env)) {
    if (!(key in ORIGINAL)) delete env[key];
  }
  Object.assign(env, ORIGINAL);
}

beforeEach(restore);
afterEach(restore);

/** Re-imports the registry so module-level env reads are re-evaluated. */
async function freshRegistry() {
  const mod = await import('@/application/payment/registry');
  return mod;
}

describe('sandbox payments are refused on a live deployment', () => {
  it('refuses the mock provider when production is served from a real host', async () => {
    env.NODE_ENV = 'production';
    env.SITE_URL = 'https://madesaite.example';
    env.MOCK_GATEWAY_SECRET = 'a_secret_long_enough_to_pass';
    delete env.ALLOW_SANDBOX_PAYMENTS;

    const { getPaymentProvider, listAvailableProviders } = await freshRegistry();

    expect(() => getPaymentProvider('mock')).toThrow();
    expect(listAvailableProviders().map((p) => p.id)).not.toContain('mock');
  });

  it('refuses to fall back to mock when PAYMENT_PROVIDER is unset in production', async () => {
    env.NODE_ENV = 'production';
    env.SITE_URL = 'https://madesaite.example';
    env.MOCK_GATEWAY_SECRET = 'a_secret_long_enough_to_pass';
    delete env.PAYMENT_PROVIDER;
    delete env.ALLOW_SANDBOX_PAYMENTS;

    const { getDefaultProviderId } = await freshRegistry();
    // Silently defaulting to a sandbox on a live host is the failure mode.
    expect(() => getDefaultProviderId()).toThrow();
  });

  it('never lists a sandbox provider as available on a live deployment', async () => {
    env.NODE_ENV = 'production';
    env.SITE_URL = 'https://madesaite.example';
    env.MOCK_GATEWAY_SECRET = 'a_secret_long_enough_to_pass';
    delete env.ALLOW_SANDBOX_PAYMENTS;

    const { listAvailableProviders } = await freshRegistry();
    expect(listAvailableProviders().filter((p) => p.isSandbox)).toHaveLength(0);
  });
});

describe('sandbox payments stay usable where they are legitimate', () => {
  it('allows the mock provider in development', async () => {
    env.NODE_ENV = 'development';
    env.SITE_URL = 'http://localhost:3000';
    env.MOCK_GATEWAY_SECRET = 'a_secret_long_enough_to_pass';

    const { getPaymentProvider } = await freshRegistry();
    expect(getPaymentProvider('mock').id).toBe('mock');
  });

  it('allows a production build served on localhost — that is a verification run', async () => {
    env.NODE_ENV = 'production';
    env.SITE_URL = 'http://127.0.0.1:3100';
    env.MOCK_GATEWAY_SECRET = 'a_secret_long_enough_to_pass';

    const { getPaymentProvider } = await freshRegistry();
    expect(getPaymentProvider('mock').id).toBe('mock');
  });

  it('allows a deliberate, explicit staging opt-in', async () => {
    env.NODE_ENV = 'production';
    env.SITE_URL = 'https://staging.madesaite.example';
    env.MOCK_GATEWAY_SECRET = 'a_secret_long_enough_to_pass';
    env.ALLOW_SANDBOX_PAYMENTS = 'true';

    const { getPaymentProvider } = await freshRegistry();
    expect(getPaymentProvider('mock').id).toBe('mock');
  });

  it('keeps cash on delivery available in production — it is not a sandbox', async () => {
    env.NODE_ENV = 'production';
    env.SITE_URL = 'https://madesaite.example';
    delete env.ALLOW_SANDBOX_PAYMENTS;

    const { getPaymentProvider } = await freshRegistry();
    expect(getPaymentProvider('cod').isSandbox).toBe(false);
  });
});
