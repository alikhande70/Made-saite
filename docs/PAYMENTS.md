# Payments

## Status

| Provider | State | Notes |
| -------- | ----- | ----- |
| `mock` — درگاه آزمایشی | **Active** | Sandbox. Signed callbacks. **Moves no money.** |
| `cod` — پرداخت در محل | **Active** | Cash on delivery. No online settlement. |
| `zarinpal` — زرین‌پال | **Stub** | Typed adapter that throws unless configured. Never run against a real gateway. |
| `idpay` — آیدی‌پی | **Stub** | As above. |

**No real payment processing is enabled in this build.** The stubs exist so the
wiring is visible and so selecting an unconfigured gateway fails loudly instead of
silently behaving like the sandbox. `listAvailableProviders()` hides any provider
that reports `isConfigured === false`, so an unconfigured gateway can never be
offered at checkout.

---

## The interface

`src/application/payment/provider.ts`:

```ts
interface PaymentProvider {
  id: string;
  displayNameFa: string;
  descriptionFa: string;
  isSandbox: boolean;              // surfaced to the customer in the UI
  confirmsWithoutPayment: boolean; // true for cash on delivery
  isConfigured: boolean;           // false hides it from checkout

  initiate(request: PaymentInitRequest): Promise<PaymentInitResult>;
  verify(request: PaymentVerifyRequest): Promise<PaymentVerifyResult>;
}
```

Domain and checkout code depend only on this interface. Adding a gateway means
writing one adapter and registering it — no change to the order lifecycle, the
inventory rules or any HTTP handler.

### Two invariants every adapter must uphold

1. **Card data never enters this process.** Adapters exchange references
   (authority / token / transaction id) only. Nothing resembling a PAN, CVV2 or
   second password is accepted, logged or stored anywhere in this codebase.
2. **`verify` must be authenticated.** The callback URL is reachable by anyone,
   so the adapter has to *prove* the result came from the gateway — by signature,
   or by a server-to-server verification call. Trusting the query string is the
   classic way to hand out free orders.

The sandbox provider demonstrates the property rather than assuming it: it signs
its callback with an HMAC over `orderId|providerRef|outcome|amount` and rejects
anything that does not verify. Tests cover an unsigned callback, a
wrongly-signed callback, and a correctly-signed callback for the wrong amount.

---

## Defence in depth around the callback

`handlePaymentCallback` re-checks everything the adapter cannot:

- the order exists and is still `PENDING_PAYMENT` (a settled order short-circuits,
  making retries idempotent);
- the callback's provider matches the one the order was created with;
- the verified amount equals the order's `grand_total` — a "successful" payment
  for the wrong amount is recorded as a mismatch and the order stays unpaid;
- the order row is locked for update, so two concurrent callbacks settle once.

A rejected callback writes an internal (`isPublic: false`) `order_events` row, so
forgery attempts are visible in the audit log without being shown to customers.

---

## Adding a real gateway

Using Zarinpal as the example:

1. **Obtain credentials** and test against the gateway's own sandbox first.
2. **Implement the adapter** in `src/application/payment/iranian-gateways.ts`,
   replacing the stub:
   - `initiate` → `POST /pg/v4/payment/request.json` with
     `{ merchant_id, amount, callback_url, description }`. **Amount is in Rial** —
     use `toRial(request.amount)`; the conversion belongs at this boundary and
     nowhere else. Store the returned `authority` as `providerRef` and redirect
     to `https://www.zarinpal.com/pg/StartPay/{authority}`.
   - `verify` → `POST /pg/v4/payment/verify.json` with
     `{ merchant_id, amount, authority }`. **Verify server-to-server; never trust
     the `Status` query parameter.** Return `SUCCEEDED` only on the documented
     success codes (100, and 101 for an already-verified transaction), and return
     the settled amount converted back to Toman so the amount check applies.
3. **Configure** `ZARINPAL_MERCHANT_ID` and set `PAYMENT_PROVIDER=zarinpal`.
   `isConfigured` then reports true and the provider appears at checkout.
4. **Verify end to end** in the gateway's sandbox before enabling it live:
   success, user cancellation, gateway timeout, duplicate callback, and a
   tampered amount.

Until step 4 is done against the real gateway, the store must not describe
payment as working.

---

## Cash on delivery

COD is honest about what it is. `confirmsWithoutPayment` is true, so checkout
confirms the order (moving it to `PAID`, which deducts stock for real) but the
`payments` row stays `INITIATED` — the amount is still outstanding. An admin
records receipt with **ثبت دریافت وجه** on the order page, which flips the payment
to `SUCCEEDED`. The order therefore never claims to be paid when it is not.
