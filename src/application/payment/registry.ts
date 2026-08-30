/**
 * Provider registry. `PAYMENT_PROVIDER` selects the default; the checkout form
 * may only offer providers that report `isConfigured`.
 */
import type { PaymentProvider } from './provider';
import { MockPaymentProvider } from './mock-provider';
import { CashOnDeliveryProvider } from './cod-provider';
import { IdPayProvider, ZarinpalProvider } from './iranian-gateways';
import { errors } from '@/domain/errors';

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
  if (!provider.isConfigured) {
    throw errors.validation(`درگاه «${provider.displayNameFa}» در حال حاضر در دسترس نیست.`);
  }
  return provider;
}

export function getDefaultProviderId(): string {
  return process.env.PAYMENT_PROVIDER ?? 'mock';
}

/** Providers the checkout page may show. Unconfigured gateways are hidden. */
export function listAvailableProviders(): PaymentProvider[] {
  return [...registry.values()].filter((p) => p.isConfigured);
}

export function listAllProviders(): PaymentProvider[] {
  return [...registry.values()];
}
