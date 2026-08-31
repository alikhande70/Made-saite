/**
 * Provider registry. `PAYMENT_PROVIDER` selects the default; the checkout form
 * may only offer providers that report `isConfigured`.
 *
 * The registry is also where the sandbox is fenced off from real deployments —
 * see `sandboxPaymentsAllowed`.
 */
import type { PaymentProvider } from './provider';
import { MockPaymentProvider } from './mock-provider';
import { CashOnDeliveryProvider } from './cod-provider';
import { IdPayProvider, ZarinpalProvider } from './iranian-gateways';
import { errors } from '@/domain/errors';

/**
 * Whether a sandbox gateway may be used at all.
 *
 * A sandbox provider marks an order paid without any money moving. On a live
 * host that is not a test aid, it is a way to take orders for free — so the
 * default is **refuse**, and every exception has to be deliberate:
 *
 *  - not `NODE_ENV=production` → a developer machine;
 *  - production served from localhost → a verification run, which is exactly
 *    how the E2E suite exercises the real production build;
 *  - `ALLOW_SANDBOX_PAYMENTS=true` → an explicit, auditable staging decision.
 *
 * Anything else fails closed. The invariant this protects: a customer must
 * never be able to complete a checkout that records payment nobody made.
 */
export function sandboxPaymentsAllowed(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  if (process.env.ALLOW_SANDBOX_PAYMENTS === 'true') return true;

  const siteUrl = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';
  try {
    const host = new URL(siteUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    // An unparseable or missing SITE_URL in production is not a reason to
    // assume a test environment.
    return false;
  }
}

const registry = new Map<string, PaymentProvider>();

function register(provider: PaymentProvider): void {
  registry.set(provider.id, provider);
}

register(new MockPaymentProvider());
register(new CashOnDeliveryProvider());
register(new ZarinpalProvider());
register(new IdPayProvider());

export function getPaymentProvider(id: string): PaymentProvider {
  const provider = registry.get(id);
  if (!provider) throw errors.validation('روش پرداخت انتخاب‌شده معتبر نیست.');
  if (provider.isSandbox && !sandboxPaymentsAllowed()) {
    // Loud on the server, generic to the customer: they cannot act on it, and
    // the message must not advertise the misconfiguration.
    console.error(
      `[payments] refused sandbox provider "${provider.id}" on a production deployment. ` +
      'Configure a real gateway, or set ALLOW_SANDBOX_PAYMENTS=true if this host is staging.',
    );
    throw errors.validation('در حال حاضر امکان پرداخت آنلاین وجود ندارد. لطفاً با پشتیبانی تماس بگیرید.');
  }
  if (!provider.isConfigured) {
    throw errors.validation(`درگاه «${provider.displayNameFa}» در حال حاضر در دسترس نیست.`);
  }
  return provider;
}

/**
 * The provider used when the customer does not pick one.
 *
 * Deliberately has no fallback in production. Defaulting an unset
 * `PAYMENT_PROVIDER` to the sandbox is the quiet version of the same failure:
 * a deployment that looks configured and charges nobody.
 */
export function getDefaultProviderId(): string {
  const configured = process.env.PAYMENT_PROVIDER;
  if (configured) return configured;

  if (!sandboxPaymentsAllowed()) {
    console.error('[payments] PAYMENT_PROVIDER is unset on a production deployment; refusing to default to the sandbox.');
    throw errors.validation('پیکربندی پرداخت کامل نیست. لطفاً با پشتیبانی تماس بگیرید.');
  }
  return 'mock';
}

/** Providers the checkout page may show. Unconfigured gateways are hidden. */
export function listAvailableProviders(): PaymentProvider[] {
  const allowSandbox = sandboxPaymentsAllowed();
  return [...registry.values()].filter((p) => p.isConfigured && (allowSandbox || !p.isSandbox));
}

export function listAllProviders(): PaymentProvider[] {
  return [...registry.values()];
}
