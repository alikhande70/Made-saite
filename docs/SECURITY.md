# Security

Scope: this documents the controls implemented, the reasoning behind them, and
what must be true of a deployment. It is not a claim that the application has
been independently audited or penetration-tested — it has not been.

---

## Deployment requirements

| Requirement | Why |
| ----------- | --- |
| **Serve over HTTPS** and set `SITE_URL=https://…` | Session and cart cookies are marked `Secure` only when `SITE_URL` is `https://`. Over plain HTTP the browser would drop a `Secure` cookie entirely, so the flag is derived from the deployment's own scheme rather than `NODE_ENV`. |
| **Set a strong `AUTH_SECRET`** (≥32 random bytes) | Reserved for signing/rotation; must not be the placeholder. |
| **Set a strong `MOCK_GATEWAY_SECRET`** | The sandbox refuses to run without ≥16 characters. Any real gateway replaces it with real credentials. |
| **Run behind a proxy that sets `X-Forwarded-For`** | Rate limits are keyed on client IP. Without it every visitor shares one bucket. |
| **Restrict database credentials** | The app needs DML on its own schema only. |
| **Schedule `npm run db:sweep`** | Expired reservations otherwise hold stock indefinitely. |

---

## Authentication

- **Passwords** — scrypt (`N=2^16, r=8, p=1`, ~64 MiB), 16-byte per-user salt,
  64-byte derived key. The stored format `scrypt$N$r$p$salt$hash` is
  self-describing, so parameters can be raised later without invalidating
  existing hashes. Verification is `timingSafeEqual`.
- **Sessions** — opaque 32-byte random tokens. Only the **SHA-256** of the token
  is stored, so a database leak cannot be replayed as a login. Cookies are
  `httpOnly`, `SameSite=Lax`, `Secure` (per above), 30-day expiry.
- **Enumeration resistance** — an unknown phone number and a wrong password
  return the same Persian message and the same HTTP status. The unknown-account
  path deliberately runs a scrypt verification against a dummy hash so response
  timing does not distinguish the two. Duplicate registration returns one generic
  "phone or email already exists" message rather than saying which.
- **Lockout** — 10 failed attempts locks the account for 15 minutes; the counter
  resets on a successful sign-in.
- **Password change revokes every session**, on every device.
- **Deactivating a customer** revokes their sessions immediately.

## Authorization

- `requireUser()` / `requireAdmin()` gate every protected surface. Customers
  hitting an admin route get **403**, not 404 — the endpoint's existence is not a
  secret, and a misleading 404 makes real bugs harder to diagnose.
- The entire `/admin` subtree is gated in its layout, so a new admin page cannot
  be added without the check.
- `adminRoute()` wraps every admin route handler with origin check + admin check +
  error mapping, so an individual handler cannot forget one.

### IDOR

Ownership is expressed **in the query**, not checked after the fact:

```ts
.where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
```

A customer requesting another customer's order id gets `null` → not-found. The
same pattern guards address deletion. Both are covered by tests that attempt the
access as a second signed-in customer.

Guest order tracking uses a 24-byte random `tracking_token`, not the order id or
order number — knowing an order number is not enough to read an order.

## Input validation

Every value crossing an HTTP boundary is parsed by a Zod schema before a service
sees it (`src/lib/validation.ts`). Unknown keys are dropped, so a hostile
`grandTotal` in a checkout body simply does not exist by the time the handler
runs. Persian/Arabic digits are normalised to Latin before pattern checks, so a
customer typing `۰۹۱۲۳۴۵۶۷۸۹` validates and stores as `09123456789`.

## Injection

- **SQL** — every value is a bound parameter, including inside the composed
  search SQL. Arrays are bound with `sql.param()` (a bare array would be spliced
  as SQL fragments by the template tag). No user input is ever concatenated into
  a query.
- **XSS** — React escapes all interpolated content. The only
  `dangerouslySetInnerHTML` in the codebase is JSON-LD, which goes through
  `serializeJsonLd()`: `JSON.stringify` does **not** escape `<`, so a product
  title containing `</script>` would otherwise break out of the script element —
  and because Next requires `'unsafe-inline'` in the script CSP, that would
  execute. `<`, `>`, `&`, U+2028 and U+2029 are escaped; a unit test asserts an
  injected `</script><img onerror=…>` cannot escape.
- **Admin image URLs** must be a site-relative path or an `https://` URL, so
  `javascript:` and `data:` values cannot reach an `src` attribute.
- **Open redirect** — the `?next=` parameter on sign-in accepts only same-origin
  relative paths (rejecting `//evil.example`).

## CSRF

Two independent layers:
1. Session cookies are `SameSite=Lax`, which blocks cross-site form POSTs.
2. `assertSameOrigin()` rejects any unsafe method whose `Origin` does not match
   the request host — so protection does not rest on browser behaviour alone.

Covered by tests for both a customer cart write and an authenticated admin write.

## Rate limiting

Database-backed fixed windows (so limits hold across instances), keyed on user id
when signed in and client IP otherwise. Identities are hashed before storage, so
raw IPs are never persisted.

| Bucket | Limit |
| ------ | ----- |
| login | 8 / 5 min — **per IP _and_ per targeted phone**, so neither one host nor one victim account can be hammered |
| register | 5 / 15 min |
| checkout | 10 / 10 min |
| payment callback | 60 / min |
| tracking lookup | 30 / 5 min |
| cart writes | 120 / min |
| search suggestions | 120 / min |

## Commerce-specific abuse

| Attack | Control |
| ------ | ------- |
| Price manipulation | Every figure recomputed server-side at order time; client-sent totals dropped by the schema. Tested. |
| Free/cheap shipping | The client sends a method **code**; cost is re-quoted from admin configuration, and province eligibility re-checked. Tested. |
| Overselling | Row locks in a consistent order + transactions + database CHECK constraints. Tested with 2 and 10 concurrent buyers. |
| Payment callback forgery | Signature verification, provider match, amount match, status re-check under lock. Tested. |
| Replayed callback | Idempotent — a settled order short-circuits before any inventory effect. Tested, including two concurrent duplicates. |
| Cart quantity abuse | Per-line cap of 20, enforced in schema, service and on merge. |
| Inventory manipulation | Only `inventory-service` writes stock; admin-only; every movement needs a reason and is appended to `inventory_events`. A reduction below reserved quantity is refused. |
| Order status tampering | The domain state machine is the only path; illegal transitions are rejected server-side regardless of what the UI offers. |

## Data handling

- **No card data** is accepted, logged or stored — see docs/PAYMENTS.md.
- **PII in logs** — the application logs no customer names, phone numbers or
  addresses. Unhandled errors are logged server-side and returned to the client
  as a generic Persian message; stack traces and driver details never cross the
  wire.
- **IP addresses** are stored only as SHA-256 hashes (session records, rate-limit
  buckets).
- **Order snapshots are immutable.** Line items copy the product's title, SKU,
  brand and price at purchase time, so later catalogue edits cannot rewrite
  history.
- **Internal order events** (`isPublic: false`) are filtered out of every
  customer-facing view; a test asserts an internal note never reaches the public
  tracking page.

## HTTP headers

Set globally in `next.config.ts`:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:;
  connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self';
  object-src 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin
X-Powered-By: (removed)
```

`'unsafe-inline'` in `script-src` is required by Next's inline bootstrap and is
the main CSP weakness. It can be replaced with a nonce-based policy via
middleware; that is a known follow-up, and it is why the JSON-LD escaping above
matters rather than being belt-and-braces.

Verified by an E2E test that asserts the headers on a real response.

---

## Known weaknesses and follow-ups

1. **`'unsafe-inline'` script CSP** — see above.
2. **No 2FA / OTP.** Iranian stores commonly authenticate by SMS OTP; this build
   uses phone + password only. `auth-service` is the single place that would
   change.
3. **No brute-force protection on the tracking token** beyond the rate limit. The
   token is 24 random bytes, so guessing is impractical, but there is no
   per-token lockout.
4. **No image upload path**, therefore no upload validation. If one is added it
   needs content-type and magic-byte checks, a size cap, re-encoding, and storage
   outside the web root.
5. **No audit log for admin catalogue edits.** Inventory and order changes are
   audited; product/category/brand edits are not yet.
6. **Two build-time-only advisories remain** in the dependency tree
   (`postcss@8.4.31` nested under Next, `esbuild` under `drizzle-kit`). Neither is
   reachable by a site visitor: both are development/build tooling, and the
   advisories require attacker-controlled input to those tools. The direct
   `postcss` dependency is patched. Resolving them fully means upgrading to
   Next 16, which is a deliberate follow-up rather than a mid-build change.
