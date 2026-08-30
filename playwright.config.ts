import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * E2E runs against a production build backed by a dedicated database
 * (`madesaite_e2e`), seeded by tests/e2e/global-setup.ts. It never touches the
 * development data.
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        launchOptions: process.env.PW_CHROME_PATH ? { executablePath: process.env.PW_CHROME_PATH } : {},
      },
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 5'],
        launchOptions: process.env.PW_CHROME_PATH ? { executablePath: process.env.PW_CHROME_PATH } : {},
      },
      testMatch: /(rtl-responsive|storefront)\.spec\.ts/,
    },
  ],
  webServer: {
    command: `npm run start -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: e2eDatabaseUrl(),
      // SITE_URL is read at runtime; NEXT_PUBLIC_* would be baked in at build.
      SITE_URL: baseURL,
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'e2e_only_secret_value_at_least_32_chars!!',
      MOCK_GATEWAY_SECRET: process.env.MOCK_GATEWAY_SECRET ?? 'e2e_only_gateway_secret_1234567890',
      PAYMENT_PROVIDER: 'mock',
      ORDER_PAYMENT_TTL_MINUTES: '30',
      NODE_ENV: 'production',
    },
  },
});

export function e2eDatabaseUrl(): string {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5432/madesaite');
  url.pathname = `/${process.env.E2E_DB_NAME ?? 'madesaite_e2e'}`;
  return url.toString();
}
