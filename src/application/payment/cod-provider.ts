/**
 * Cash on delivery (پرداخت در محل).
 *
 * No money moves online, so there is nothing to redirect to and nothing to
 * verify. Checkout confirms the order immediately; the payment row stays
 * `INITIATED` and is settled by an admin once the courier hands over the cash.
 * The order therefore never claims to be paid when it is not.
 */
import { randomToken } from '@/lib/crypto';
import type {
  PaymentInitRequest,
  PaymentInitResult,
  PaymentProvider,
  PaymentVerifyRequest,
  PaymentVerifyResult,
} from './provider';

export class CashOnDeliveryProvider implements PaymentProvider {
  readonly id = 'cod';
  readonly displayNameFa = 'پرداخت در محل';
  readonly descriptionFa = 'مبلغ سفارش هنگام تحویل کالا، نقدی یا با کارت‌خوان پرداخت می‌شود.';
  readonly isSandbox = false;
  readonly confirmsWithoutPayment = true;
  readonly isConfigured = true;

  async initiate(request: PaymentInitRequest): Promise<PaymentInitResult> {
    return {
      providerRef: `COD-${randomToken(10)}`,
      redirectUrl: null,
      meta: { collectOnDelivery: true, amountDue: request.amount },
    };
  }

  async verify(request: PaymentVerifyRequest): Promise<PaymentVerifyResult> {
    return {
      outcome: 'FAILED',
      providerRef: request.providerRef ?? '',
      failureReason: 'پرداخت در محل نیازی به تأیید آنلاین ندارد.',
    };
  }
}
