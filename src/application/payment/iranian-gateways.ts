/**
 * Adapters for real Iranian gateways.
 *
 * NOT ACTIVE. Each adapter is present so the wiring is obvious and so selecting
 * an unconfigured gateway fails loudly instead of silently behaving like a
 * sandbox. Turning one on requires production merchant credentials plus a
 * verification run against the gateway's own sandbox — see docs/PAYMENTS.md.
 */
import type {
  PaymentInitRequest,
  PaymentInitResult,
  PaymentProvider,
  PaymentVerifyRequest,
  PaymentVerifyResult,
} from './provider';
import { toRial } from '@/domain/money';

class UnconfiguredGateway implements PaymentProvider {
  constructor(
    readonly id: string,
    readonly displayNameFa: string,
    readonly descriptionFa: string,
    private readonly envVar: string,
  ) {}

  readonly isSandbox = false;
  readonly confirmsWithoutPayment = false;

  get isConfigured(): boolean {
    return Boolean(process.env[this.envVar]);
  }

  private fail(): never {
    throw new Error(
      `Payment provider "${this.id}" is not configured: ${this.envVar} is unset. ` +
        'This gateway has no live implementation in this build — see docs/PAYMENTS.md.',
    );
  }

  async initiate(_request: PaymentInitRequest): Promise<PaymentInitResult> {
    this.fail();
  }

  async verify(_request: PaymentVerifyRequest): Promise<PaymentVerifyResult> {
    this.fail();
  }
}

/**
 * Zarinpal settles in **Rial**; the conversion point is `toRial` and lives here,
 * at the adapter boundary, never in domain code.
 */
export class ZarinpalProvider extends UnconfiguredGateway {
  constructor() {
    super(
      'zarinpal',
      'زرین‌پال',
      'پرداخت امن از طریق درگاه زرین‌پال.',
      'ZARINPAL_MERCHANT_ID',
    );
  }

  /** Reference implementation of the amount conversion the adapter will need. */
  static amountForGateway(toman: number): number {
    return toRial(toman);
  }
}

export class IdPayProvider extends UnconfiguredGateway {
  constructor() {
    super('idpay', 'آیدی‌پی', 'پرداخت امن از طریق درگاه آیدی‌پی.', 'IDPAY_API_KEY');
  }

  static amountForGateway(toman: number): number {
    return toRial(toman);
  }
}
