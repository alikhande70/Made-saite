/**
 * Payment abstraction.
 *
 * Domain and checkout code depends only on this interface. Adding a real
 * Iranian gateway means writing one adapter and registering it — no change to
 * the order lifecycle, the inventory rules, or any HTTP handler.
 *
 * Two invariants every adapter must uphold:
 *   1. Raw card data never enters this process. Adapters exchange references
 *      (authority / token / transaction id) only.
 *   2. `verify` must be *authenticated* — a callback URL is attacker-reachable,
 *      so an adapter has to prove the result came from the gateway (signature,
 *      or a server-to-server verification call), never trust the query string.
 */
export type PaymentOutcome = 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface PaymentCustomer {
  readonly fullName: string;
  readonly phone: string;
  readonly email?: string | null;
}

export interface PaymentInitRequest {
  readonly orderId: string;
  readonly orderNumber: string;
  /** Toman. Adapters convert to Rial at the boundary if the gateway needs it. */
  readonly amount: number;
  readonly description: string;
  readonly callbackUrl: string;
  readonly customer: PaymentCustomer;
}

export interface PaymentInitResult {
  /** Gateway-side handle stored on the payment row. */
  readonly providerRef: string;
  /** Where to send the browser. `null` for providers that need no redirect. */
  readonly redirectUrl: string | null;
  readonly meta?: Record<string, unknown>;
}

export interface PaymentVerifyRequest {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly expectedAmount: number;
  readonly providerRef: string | null;
  /** Query/body parameters exactly as received on the callback endpoint. */
  readonly params: Readonly<Record<string, string>>;
}

export interface PaymentVerifyResult {
  readonly outcome: PaymentOutcome;
  readonly providerRef: string;
  readonly transactionId?: string | null;
  /** Amount the gateway says was settled, Toman. Checked against the order. */
  readonly amount?: number | null;
  readonly failureReason?: string | null;
  readonly meta?: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly id: string;
  readonly displayNameFa: string;
  readonly descriptionFa: string;
  /** True when this adapter is not connected to real money. Surfaced in the UI. */
  readonly isSandbox: boolean;
  /**
   * True for providers that confirm the order without collecting money now
   * (cash on delivery). Checkout marks such orders PAID and records that the
   * amount is still outstanding.
   */
  readonly confirmsWithoutPayment: boolean;
  readonly isConfigured: boolean;

  initiate(request: PaymentInitRequest): Promise<PaymentInitResult>;
  verify(request: PaymentVerifyRequest): Promise<PaymentVerifyResult>;
}
