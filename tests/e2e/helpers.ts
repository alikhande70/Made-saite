import { createHmac } from 'node:crypto';
import type { Page, APIRequestContext } from '@playwright/test';
import { Pool } from 'pg';
import { e2eDatabaseUrl } from '../../playwright.config';

/**
 * Recreates the sandbox gateway's callback signature.
 *
 * Deliberately reimplemented from the documented payload shape rather than
 * imported from the app: an end-to-end test should sign the way an external
 * gateway would, so a change to the app's signing scheme fails this test
 * instead of silently agreeing with itself.
 */
export function signSandboxCallback(
  orderId: string,
  providerRef: string,
  outcome: string,
  amount: number,
): string {
  const secret = process.env.MOCK_GATEWAY_SECRET ?? 'e2e_only_gateway_secret_1234567890';
  return createHmac('sha256', secret).update(`${orderId}|${providerRef}|${outcome}|${amount}`).digest('hex');
}

/** Direct database access for arranging and asserting E2E state. */
export function e2ePool(): Pool {
  return new Pool({ connectionString: e2eDatabaseUrl() });
}

export async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const pool = e2ePool();
  try {
    const result = await pool.query<T>(sql, params);
    return result.rows;
  } finally {
    await pool.end();
  }
}

export const DEMO_ADMIN = { phone: '09120000000', password: 'Admin@12345' };
export const DEMO_CUSTOMER = { phone: '09121111111', password: 'Customer@12345' };

export async function signIn(page: Page, credentials: { phone: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('شمارهٔ موبایل').fill(credentials.phone);
  await page.getByLabel('رمز عبور').fill(credentials.password);
  await page.getByRole('button', { name: /ورود به حساب/ }).click();
  await page.waitForURL(/\/(account|admin)/);
}

export const CHECKOUT_ADDRESS = {
  fullName: 'علی رضایی',
  phone: '09123456789',
  province: 'تهران',
  city: 'تهران',
  postalAddress: 'خیابان نمونه، کوچهٔ آزمایش، پلاک ۱۰',
  postalCode: '1234567890',
};

/** Fills the checkout form and submits it. */
export async function completeCheckout(page: Page): Promise<void> {
  await page.getByLabel('نام و نام خانوادگی').fill(CHECKOUT_ADDRESS.fullName);
  await page.getByLabel('شمارهٔ موبایل').fill(CHECKOUT_ADDRESS.phone);
  await page.getByLabel('استان').selectOption(CHECKOUT_ADDRESS.province);
  await page.getByRole('textbox', { name: 'شهر' }).fill(CHECKOUT_ADDRESS.city);
  await page.getByLabel('کد پستی').fill(CHECKOUT_ADDRESS.postalCode);
  await page.getByLabel('نشانی پستی').fill(CHECKOUT_ADDRESS.postalAddress);
  await page.getByRole('button', { name: /ثبت سفارش|پرداخت و ثبت/ }).click();
}

/** Places an order straight through the API — used to arrange fixtures fast. */
export async function placeOrderViaApi(
  request: APIRequestContext,
  productId: string,
  quantity = 1,
): Promise<{ orderId: string; trackingToken: string; grandTotal: number }> {
  const added = await request.post('/api/cart/items', { data: { productId, quantity } });
  if (!added.ok()) throw new Error(`add-to-cart failed (${added.status()}): ${await added.text()}`);

  const response = await request.post('/api/checkout', {
    data: { ...CHECKOUT_ADDRESS, shippingMethodCode: 'post-pishtaz' },
  });
  if (!response.ok()) throw new Error(`checkout failed (${response.status()}): ${await response.text()}`);

  const body = (await response.json()) as { data: { orderId: string; trackingToken: string; grandTotal: number } };
  return body.data;
}

/**
 * A distinct client IP per spec file.
 *
 * The app rate-limits checkout and login per client IP. Every request in a
 * Playwright run originates from the same host, so without this the suite
 * throttles itself and tests fail for reasons unrelated to what they assert.
 * Presenting an `x-forwarded-for` is exactly how a real deployment behind a
 * proxy distinguishes customers — the limits stay active and are still covered
 * directly by tests/api/routes.test.ts.
 */
export function clientIpHeaders(specName: string): Record<string, string> {
  let hash = 0;
  for (const ch of specName) hash = (hash * 31 + ch.charCodeAt(0)) % 250;
  return { 'x-forwarded-for': `198.51.100.${hash + 1}` };
}
