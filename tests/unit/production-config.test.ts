/**
 * The production environment contract.
 *
 * Each case is a deployment that would boot and look healthy while being
 * quietly wrong. Refusing to start is the desired behaviour: a misconfigured
 * store that runs takes real orders it cannot honour.
 */
import { describe, expect, it } from 'vitest';
import {
  assertProductionConfig, inspectProductionConfig, isLiveDeployment,
} from '@/lib/production-config';

const LIVE = {
  NODE_ENV: 'production',
  SITE_URL: 'https://madesaite.example',
  DATABASE_URL: 'postgres://app:s3cret@db.internal:5432/madesaite',
  PAYMENT_PROVIDER: 'zarinpal',
  ZARINPAL_MERCHANT_ID: 'a1b2c3d4-real-merchant-id',
  TRUSTED_PROXY_HOPS: '1',
} as NodeJS.ProcessEnv;

const errorsFor = (env: NodeJS.ProcessEnv) =>
  inspectProductionConfig(env).filter((f) => f.severity === 'error').map((f) => f.variable);
const warningsFor = (env: NodeJS.ProcessEnv) =>
  inspectProductionConfig(env).filter((f) => f.severity === 'warning').map((f) => f.variable);

describe('what counts as a live deployment', () => {
  it('is production served from a real host', () => {
    expect(isLiveDeployment(LIVE)).toBe(true);
  });

  it('is not a developer machine', () => {
    expect(isLiveDeployment({ ...LIVE, NODE_ENV: 'development' })).toBe(false);
  });

  it('is not a production build under test on localhost', () => {
    // This is exactly how the E2E suite runs the production build.
    expect(isLiveDeployment({ ...LIVE, SITE_URL: 'http://127.0.0.1:3100' })).toBe(false);
  });

  it('treats a missing SITE_URL in production as live, not as a test', () => {
    const { SITE_URL: _drop, ...withoutSiteUrl } = LIVE;
    expect(isLiveDeployment(withoutSiteUrl)).toBe(true);
  });
});

describe('a correct production configuration', () => {
  it('produces no errors and no warnings', () => {
    expect(inspectProductionConfig(LIVE)).toEqual([]);
    expect(() => assertProductionConfig(LIVE)).not.toThrow();
  });

  it('never runs its checks outside a live deployment', () => {
    // Development must not be blocked by production-only requirements.
    const dev = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;
    expect(inspectProductionConfig(dev)).toEqual([]);
    expect(() => assertProductionConfig(dev)).not.toThrow();
  });
});

describe('dangerous configurations refuse to start', () => {
  it('rejects a test or development database', () => {
    for (const name of ['madesaite_test', 'madesaite_e2e', 'app_dev']) {
      const env = { ...LIVE, DATABASE_URL: `postgres://app:s3cret@db:5432/${name}` };
      expect(errorsFor(env), `${name} must be refused`).toContain('DATABASE_URL');
    }
  });

  it('rejects a plain-HTTP site URL, because Secure cookies derive from it', () => {
    expect(errorsFor({ ...LIVE, SITE_URL: 'http://madesaite.example' })).toContain('SITE_URL');
  });

  it('rejects the sandbox gateway on a live host', () => {
    expect(errorsFor({ ...LIVE, PAYMENT_PROVIDER: 'mock' })).toContain('PAYMENT_PROVIDER');
  });

  it('allows the sandbox only with an explicit staging opt-in, and warns loudly', () => {
    const staging = { ...LIVE, PAYMENT_PROVIDER: 'mock', ALLOW_SANDBOX_PAYMENTS: 'true' };
    expect(errorsFor(staging)).not.toContain('PAYMENT_PROVIDER');
    expect(warningsFor(staging)).toContain('ALLOW_SANDBOX_PAYMENTS');
  });

  it('refuses an unset payment provider rather than defaulting', () => {
    const { PAYMENT_PROVIDER: _drop, ...noProvider } = LIVE;
    expect(errorsFor(noProvider)).toContain('PAYMENT_PROVIDER');
  });

  it('requires the credential belonging to the selected gateway', () => {
    const { ZARINPAL_MERCHANT_ID: _drop, ...noCredential } = LIVE;
    expect(errorsFor(noCredential)).toContain('ZARINPAL_MERCHANT_ID');
    expect(errorsFor({ ...LIVE, PAYMENT_PROVIDER: 'idpay', IDPAY_API_KEY: undefined })).toContain('IDPAY_API_KEY');
  });

  it('rejects placeholder secrets that survived a copy of .env.example', () => {
    expect(errorsFor({ ...LIVE, MOCK_GATEWAY_SECRET: 'e2e_only_gateway_secret_1234567890' }))
      .toContain('MOCK_GATEWAY_SECRET');
    expect(errorsFor({ ...LIVE, ZARINPAL_MERCHANT_ID: 'your-merchant-id-here' }))
      .toContain('ZARINPAL_MERCHANT_ID');
  });

  it('requires a database URL at all', () => {
    const { DATABASE_URL: _drop, ...noDb } = LIVE;
    expect(errorsFor(noDb)).toContain('DATABASE_URL');
  });

  it('reports every problem at once rather than one per restart', () => {
    const broken = {
      NODE_ENV: 'production',
      SITE_URL: 'http://madesaite.example',
      DATABASE_URL: 'postgres://app@db:5432/madesaite_test',
      PAYMENT_PROVIDER: 'mock',
    } as NodeJS.ProcessEnv;
    expect(errorsFor(broken).length).toBeGreaterThanOrEqual(3);
  });

  it('throws a message that names variables and never prints their values', () => {
    const env = { ...LIVE, DATABASE_URL: 'postgres://app:hunter2@db:5432/madesaite_test' };
    try {
      assertProductionConfig(env);
      throw new Error('should have refused to start');
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain('DATABASE_URL');
      // A startup failure is logged and often pasted into a ticket.
      expect(message).not.toContain('hunter2');
    }
  });
});

describe('proxy configuration', () => {
  it('warns when no proxy is declared, because every visitor shares one bucket', () => {
    const { TRUSTED_PROXY_HOPS: _drop, ...noProxy } = LIVE;
    expect(warningsFor(noProxy)).toContain('TRUSTED_PROXY_HOPS');
    // A warning, not an error: it is safe, just badly throttled.
    expect(errorsFor(noProxy)).not.toContain('TRUSTED_PROXY_HOPS');
  });
});
