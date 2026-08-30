/**
 * Sandbox gateway used for local development and automated tests.
 *
 * It mimics the redirect-and-callback shape of Iranian gateways (Zarinpal,
 * IDPay) without touching real money, and — importantly — it is *signed*: the
 * callback carries an HMAC over `orderId|ref|outcome|amount`, so the security
 * property real adapters must have (an unforgeable callback) is exercised by the
 * tests rather than assumed.
 */
import { randomToken, hmacSign, hmacVerify } from '@/lib/crypto';
import type {
  PaymentInitRequest,
  PaymentInitResult,
  PaymentProvider,
  PaymentVerifyRequest,
  PaymentVerifyResult,
} from './provider';

function secret(): string {
  const value = process.env.MOCK_GATEWAY_SECRET;
  if (!value || value.length < 16) {
    throw new Error(
      'MOCK_GATEWAY_SECRET is missing or too short. Set it in .env.local (see .env.example).',
    );
  }
  return value;
}

export function mockCallbackPayload(
  orderId: string,
  providerRef: string,
  outcome: string,
  amount: number,
): string {
  return `${orderId}|${providerRef}|${outcome}|${amount}`;
}

/** Used by the sandbox checkout page to produce a valid signed return URL. */
export function signMockCallback(
  orderId: string,
  providerRef: string,
  outcome: string,
  amount: number,
): string {
  return hmacSign(mockCallbackPayload(orderId, providerRef, outcome, amount), secret());
}

export class MockPaymentProvider implements PaymentProvider {
  readonly id = 'mock';
  readonly displayNameFa = 'درگاه آزمایشی (Sandbox)';
  readonly descriptionFa =
    'این درگاه صرفاً برای توسعه و آزمایش است و هیچ تراکنش مالی واقعی انجام نمی‌دهد.';
  readonly isSandbox = true;
  readonly confirmsWithoutPayment = false;

  get isConfigured(): boolean {
    return Boolean(process.env.MOCK_GATEWAY_SECRET && process.env.MOCK_GATEWAY_SECRET.length >= 16);
  }

  async initiate(request: PaymentInitRequest): Promise<PaymentInitResult> {
    const providerRef = `MOCK-${randomToken(12)}`;
    const url = new URL('/payment/sandbox', request.callbackUrl);
    url.searchParams.set('ref', providerRef);
    url.searchParams.set('order', request.orderId);
    url.searchParams.set('amount', String(request.amount));
    url.searchParams.set('callback', request.callbackUrl);
    return {
      providerRef,
      redirectUrl: url.toString(),
      meta: { sandbox: true, orderNumber: request.orderNumber },
    };
  }

  async verify(request: PaymentVerifyRequest): Promise<PaymentVerifyResult> {
    const { params } = request;
    const providerRef = params.ref ?? request.providerRef ?? '';
    const outcome = params.status ?? '';
    const signature = params.sig ?? '';
    const amount = Number(params.amount ?? request.expectedAmount);

    if (!providerRef || !signature) {
      return {
        outcome: 'FAILED',
        providerRef,
        failureReason: 'پاسخ درگاه ناقص بود (امضا یا شناسه تراکنش وجود ندارد).',
      };
    }

    // Reject anything not signed with the gateway secret — this is what stops a
    // crafted callback from marking an unpaid order as paid.
    const payload = mockCallbackPayload(request.orderId, providerRef, outcome, amount);
    if (!hmacVerify(payload, signature, secret())) {
      return {
        outcome: 'FAILED',
        providerRef,
        failureReason: 'امضای بازگشتی درگاه معتبر نیست.',
        meta: { signatureValid: false },
      };
    }

    if (outcome !== 'SUCCEEDED') {
      return {
        outcome: outcome === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
        providerRef,
        failureReason:
          outcome === 'CANCELLED' ? 'پرداخت توسط کاربر لغو شد.' : 'پرداخت در درگاه ناموفق بود.',
        meta: { signatureValid: true },
      };
    }

    return {
      outcome: 'SUCCEEDED',
      providerRef,
      transactionId: `TX-${providerRef.slice(5)}`,
      amount,
      meta: { signatureValid: true, sandbox: true },
    };
  }
}
