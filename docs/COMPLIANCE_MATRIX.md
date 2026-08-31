# Compliance matrix

Verdicts against `docs/WEBSITE_STANDARD.md`. **No row is PASS because a document
says so** — each cites a test, a measurement or an inspectable artefact.

Assessed at commit `aeeeede` + this phase's changes.

| Status | Meaning |
| ------ | ------- |
| **PASS** | Evidence exists and is reproducible |
| **PARTIAL** | Met in part; the gap is named |
| **FAIL** | Not met |
| **UNKNOWN** | Not assessed |
| **N/A** | Does not apply |

Severity: **P0** blocker · **P1** major · **P2** important · **P3** minor.

---

## 1. HTML semantics

| # | Requirement | Status | Evidence | Path | Sev | Remediation |
| - | ----------- | ------ | -------- | ---- | --- | ----------- |
| H1 | doctype, `lang`, `dir` | PASS | E2E asserts `lang="fa" dir="rtl"` on 11 pages | `tests/e2e/rtl-responsive.spec.ts` | — | — |
| H2 | UTF-8 first | PASS | framework head | `src/app/layout.tsx` | — | — |
| H3 | Viewport, zoom not disabled | PASS | no `user-scalable=no` | `src/app/layout.tsx` | — | — |
| H4 | One `<h1>` | PASS | E2E over 6 routes | `tests/e2e/rtl-responsive.spec.ts` | — | — |
| H5 | Landmarks | PASS | `header`/`nav`/`main`/`footer` present | `src/app/layout.tsx` | — | — |
| H6 | Heading order | PARTIAL | spot-checked, not asserted | — | P3 | add an axe-based check |
| H7 | Unique ids | PASS | `useId()` in repeated components | `search-box.tsx`, `vehicle-selector.tsx` | — | — |
| H8 | Table semantics | PASS | `caption`/`thead`/`scope` throughout | `.spec-table` users | — | — |
| H9 | Input types | PASS | `type="search"`, `inputMode`, `autoComplete` | forms | — | — |
| H10 | Non-blocking scripts | PASS | Next default | — | — | — |

## 2. UI

| # | Requirement | Status | Evidence | Path | Sev | Remediation |
| - | ----------- | ------ | -------- | ---- | --- | ----------- |
| U1 | Tokenised colour | PASS | `@theme` block | `src/app/globals.css` | — | — |
| U2 | Text contrast ≥ 4.5:1 | PASS | computed ratios, 4.77–17.17 | `docs/DESIGN.md` | — | — |
| U3 | UI contrast ≥ 3:1 | PARTIAL | text/chips computed; borders not | `docs/DESIGN.md` | P3 | compute for `--color-line` |
| U4 | Visible focus | PASS | `:focus-visible` accent ring | `globals.css` | — | — |
| U5 | Disabled distinct | PASS | `disabled:` variants; `steel-300` | `ui/index.tsx` | — | — |
| U6 | No decorative gradient/ambient motion | PASS | grep; no animation without user action | `globals.css` | — | — |
| U7 | Glass confined | PASS | `.glass-*`/`.scrim` only | `globals.css` | — | — |
| U8 | Consistent scale | PASS | shared tokens | `globals.css` | — | — |

## 3. UX

| # | Requirement | Status | Evidence | Path | Sev | Remediation |
| - | ----------- | ------ | -------- | ---- | --- | ----------- |
| X1 | Success/failure reported | PASS | toast + inline; E2E | `tests/e2e/interaction.spec.ts` | — | — |
| X2 | Pending state on async actions | PASS | Button `loading`; E2E | `ui/index.tsx` | — | — |
| X3 | Destructive actions guarded | PASS | vehicle delete refuses, names cost | `vehicle-admin-service.ts` | — | — |
| X4 | Errors say what to do next | PASS | search no-results, fitment hints | `search-box.tsx`, `compatibility.tsx` | — | — |
| X5 | Empty states useful | PASS | `EmptyState` used throughout | `ui/index.tsx` | — | — |
| X6 | Filter state in URL | PASS | listing is URL-driven | `product-filters.tsx` | — | — |
| X7 | No dead ends | PASS | real 404s with routes back | `tests/e2e/seo.spec.ts` | — | — |
| X8 | Nothing hover-only | PASS | `.lift` disabled under `hover: none` | `globals.css` | — | — |

## 4. Responsive web

| # | Requirement | Status | Evidence | Path | Sev | Remediation |
| - | ----------- | ------ | -------- | ---- | --- | ----------- |
| R1 | No overflow 360–1440 | PASS | 8 pages × 6 widths | `tests/e2e/rtl-responsive.spec.ts` | — | — |
| R2 | Reflow at 320px | UNKNOWN | tested from 360 up | — | P2 | extend the sweep to 320 |
| R3 | Touch targets ≥ 44px | PASS | asserted on add-to-cart | `tests/e2e/rtl-responsive.spec.ts` | — | — |
| R4 | Wide content self-scrolls | PASS | `.scroll-x`, asserted | same | — | — |
| R5 | 200% text zoom | UNKNOWN | not tested | — | P2 | add a zoom pass |
| R6 | Logical properties | PASS | `ms-`/`me-`/`start`/`end` | components | — | — |

## 5. RTL

| # | Requirement | Status | Evidence | Path | Sev | Remediation |
| - | ----------- | ------ | -------- | ---- | --- | ----------- |
| T1 | Document RTL | PASS | E2E | `rtl-responsive.spec.ts` | — | — |
| T2 | Logical properties | PASS | grep | components | — | — |
| T3 | Mirrored glyphs | PASS | `.flip-rtl`, computed transform asserted | E2E | — | — |
| T4 | Drawer from start edge | PASS | E2E bounding-box assertion | E2E | — | — |
| T5 | Identifiers keep LTR + Latin digits | PASS | `.latin-id` direction asserted | E2E | — | — |
| T6 | Persian numerals for quantities/prices | PASS | E2E | E2E | — | — |
| T7 | Persian line height | PASS | 1.75 body / 1.45 headings | `globals.css` | — | — |

## 6. Accessibility (WCAG 2.2 AA)

| # | Requirement | Status | Evidence | Path | Sev | Remediation |
| - | ----------- | ------ | -------- | ---- | --- | ----------- |
| A1 | Keyboard operable | PARTIAL | search arrow/enter asserted; not swept | `tests/e2e/interaction.spec.ts` | P2 | full keyboard pass |
| A2 | No keyboard trap | UNKNOWN | not tested | — | P2 | test drawer/dialog |
| A3 | Visible, unobscured focus | PASS | token; sticky header does not overlay focus | `globals.css` | — | — |
| A4 | Colour not the only carrier | PASS | verdict chips pair glyph + word | `compatibility.tsx` | — | — |
| A5 | Contrast | PASS | computed | `docs/DESIGN.md` | — | — |
| A6 | Accessible names | PASS | E2E labelled-fields test | E2E | — | — |
| A7 | Errors identified in text | PASS | `role="alert"` + field text | forms | — | — |
| A8 | Status announced, focus kept | PASS | `role="status"`, live region | `ui/toast.tsx` | — | — |
| A9 | Reduced motion, meaning retained | PASS | 3 unit + 2 E2E under `reducedMotion` | `motion-system.test.ts`, `interaction.spec.ts` | — | — |
| A10 | Image alt | PASS | E2E | E2E | — | — |
| A11 | Target size | PASS | 44px asserted on primary | E2E | — | — |
| A12 | Skip link | PASS | E2E | E2E | — | — |
| A13 | Screen-reader pass | **UNKNOWN** | never run | — | **P1** | NVDA/VoiceOver pass on the buy journey |
| A14 | Automated axe audit | **UNKNOWN** | no axe integration | — | P2 | add `@axe-core/playwright` |

## 7. SEO

| # | Requirement | Status | Evidence | Path | Sev | Remediation |
| - | ----------- | ------ | -------- | ---- | --- | ----------- |
| S1 | Unique title/description | PASS | per-page metadata | pages | — | — |
| S2 | Canonical | PASS | E2E | `seo.spec.ts` | — | — |
| S3 | Facets `noindex, follow` | PASS | E2E over 4 combos | `seo.spec.ts` | — | — |
| S4 | Threshold-gated landing pages | PASS | E2E both sides | `seo.spec.ts` | — | — |
| S5 | Sitemap from live state | PASS | E2E | `seo.spec.ts` | — | — |
| S6 | robots.txt | PASS | E2E | `seo.spec.ts` | — | — |
| S7 | Structured data matches DB | PASS | E2E | `seo.spec.ts` | — | — |
| S8 | No fabricated ratings/reviews | PASS | no `aggregateRating` emitted | `products/[slug]/page.tsx` | — | — |
| S9 | Real 404s | PASS | E2E over 5 routes | `seo.spec.ts` | — | — |
| S10 | Open Graph | PASS | inspect | pages | — | — |

## 8. Performance

| # | Requirement | Status | Evidence | Path | Sev | Remediation |
| - | ----------- | ------ | -------- | ---- | --- | ----------- |
| P1 | LCP ≤ 2.5s | PARTIAL | 204–328ms **lab, localhost** | `docs/PERFORMANCE.md` | P2 | field measurement |
| P2 | INP ≤ 200ms | **UNKNOWN** | needs real interaction traces | — | P2 | RUM |
| P3 | CLS ≤ 0.1 | PASS | cold-cache 0.0006–0.0045 after the font fix | `docs/PERFORMANCE.md` | — | — |
| P4 | TTFB | PASS | 37–41ms lab | same | — | — |
| P5 | JS budget | PASS | 103KB shared; routes ≤ 3.6KB | build output | — | — |
| P6 | No N+1 | PASS | one query per result page | `fitment-service.ts` | — | — |
| P7 | Transform/opacity only | PASS | keyframes parsed by test | `motion-system.test.ts` | — | — |
| P8 | Images sized | PASS | `aspect-square` boxes | `product-card.tsx` | — | — |
| P9 | No third-party script | PASS | none loaded | — | — | — |
| P10 | Field data | **UNKNOWN** | no RUM/CrUX | — | P2 | instrument after deploy |

## 9. Security

| # | Requirement | Status | Evidence | Path | Sev | Remediation |
| - | ----------- | ------ | -------- | ---- | --- | ----------- |
| C1 | HTTPS-keyed Secure cookies | PASS | derived from `SITE_URL` | `lib/session.ts` | — | — |
| C2 | Security headers | PASS | E2E asserts 5 headers | `seo.spec.ts` | — | — |
| C3 | Session tokens hashed | PASS | SHA-256 stored | `auth-service.ts` | — | — |
| C4 | Memory-hard KDF | PASS | scrypt N=2^16 | `lib/crypto.ts` | — | — |
| C5 | CSRF two layers | PASS | API tests | `tests/api/routes.test.ts` | — | — |
| C6 | Server-side authz | PASS | API tests 401/403/200 | same | — | — |
| C7 | IDOR | PASS | cross-customer tests | API + integration | — | — |
| C8 | Input validation | PASS | Zod at every boundary | `lib/validation.ts` | — | — |
| C9 | Bound SQL | PASS | review; `sql.param` for arrays | `catalog-service.ts` | — | — |
| C10 | JSON-LD escaped | PASS | unit test | `lib/json-ld.ts` | — | — |
| C11 | Rate limits | PASS | API tests | `tests/api` | — | — |
| C12 | No PII in logs | PASS | audit redaction list | `audit-service.ts` | — | — |
| C13 | **Sandbox payment fails closed in production** | PASS | **fixed this phase**; 7 tests, verified to fail on revert | `tests/unit/payment-safety.test.ts` | — | — |
| C14 | Dependency audit | PARTIAL | 2 advisories, build-tooling only | `npm audit` | P2 | resolve on the Next 16 upgrade |
| C15 | Penetration test | **UNKNOWN** | never done | — | **P1** | external review before launch |

## 10. E-commerce correctness

| # | Requirement | Status | Evidence | Path | Sev | Remediation |
| - | ----------- | ------ | -------- | ---- | --- | ----------- |
| E1 | Server-side pricing | PASS | integration tests | `checkout.test.ts` | — | — |
| E2 | Client totals ignored | PASS | tampered-total test | same | — | — |
| E3 | Shipping re-quoted | PASS | tests | same | — | — |
| E4 | No overselling | PASS | 2- and 10-buyer races | `inventory.test.ts` | — | — |
| E5 | No duplicate order | PASS | 2/8 concurrent + sequential | `checkout.test.ts` | — | — |
| E6 | Callback verified/replay-safe | PASS | forged, mis-signed, replayed, concurrent | `orders.test.ts` | — | — |
| E7 | State machine server-validated | PASS | tests | `domain.test.ts` | — | — |
| E8 | Immutable line snapshots | PASS | test | `checkout.test.ts` | — | — |
| E9 | Stock ≥ reserved | PASS | CHECK + tests | schema | — | — |
| E10 | No compatibility without evidence | PASS | 23 unit + 20 integration + E2E | `fitment.test.ts` | — | — |
| E11 | **HTTP idempotency key** | **OPEN** | cart lock prevents duplicates; retry after lost response returns `409 CART_EMPTY` | ADR-013 | **P2** | see §13 |

## 11. Database

| # | Requirement | Status | Evidence | Path | Sev | Remediation |
| - | ----------- | ------ | -------- | ---- | --- | ----------- |
| D1 | Versioned migrations | PASS | 4 migrations | `migrations/` | — | — |
| D2 | Clean install verified | PASS | CI on a fresh container | CI | — | — |
| D3 | Constraints at the DB | PASS | CHECK/unique review | schema | — | — |
| D4 | Indexes on hot paths | PASS | EXPLAIN captured | `docs/PERFORMANCE.md` | — | — |
| D5 | Integer money | PASS | schema | schema | — | — |
| D6 | UTF-8 locale | PASS | CI guard fails the build otherwise | `.github/workflows/ci.yml` | — | — |
| D7 | Transactions | PASS | review + rollback tests | `import.test.ts` | — | — |
| D8 | Backup/restore rehearsal | **UNKNOWN** | never done | — | P2 | rehearse before launch |

## 12. Reliability

| # | Requirement | Status | Evidence | Path | Sev | Remediation |
| - | ----------- | ------ | -------- | ---- | --- | ----------- |
| L1 | Idempotent side effects | PASS | cart lock + callback replay | tests | — | — |
| L2 | No double-charge/double-order | PASS | tests | `checkout.test.ts` | — | — |
| L3 | Reservations released | PARTIAL | sweep exists; not scheduled here | `scripts/sweep.ts` | P2 | schedule in deployment |
| L4 | Recoverable failures | PASS | payment retry path | `orders.test.ts` | — | — |
| L5 | Restart-safe | PASS | no in-memory critical state | review | — | — |
| L6 | Graceful degradation without JS | PARTIAL | search and tracking work; cart does not | `search-box.tsx` | P3 | acceptable for a cart |

## 13. Testing / CI / Deployment / Observability

| # | Requirement | Status | Evidence | Sev | Remediation |
| - | ----------- | ------ | -------- | --- | ----------- |
| Q1–Q6 | Layered tests, regression guards | PASS | 336 vitest + 89 Playwright | — | — |
| Q7 | Tests fail on regression | PASS | verified by reverting payment guard, harness config, cart lock | — | — |
| Q8 | No brittle assertions | PASS | no animation-timing assertions | — | — |
| I1–I5 | CI gates on every push | PASS | run recorded in the report | — | — |
| Y1–Y4 | Config documented, fails closed, demo marked | PASS | `.env.example`, payment guard | — | — |
| Y5 | Deployment rehearsed | **UNKNOWN** | never deployed | **P1** | rehearse |
| Y6 | Rollback path | **UNKNOWN** | undefined | **P1** | define |
| O1 | Error logging without PII | PASS | review | — | — |
| O2 | Admin audit | PASS | `/admin/audit` | — | — |
| O3 | Health endpoint | **FAIL** | none | P2 | add `/api/health` |
| O4 | Error tracking | **FAIL** | none | **P1** | Sentry-class tool |
| O5 | Uptime/latency monitoring | **FAIL** | none | **P1** | before launch |
| O6 | Business-invariant alerting | **FAIL** | none | P2 | alert on oversell/payment mismatch |

---

## Open items by severity

### P0
None open. One was found and closed this phase (**C13**: the sandbox gateway was
reachable from a live deployment — `PAYMENT_PROVIDER=mock`, or unset and
defaulted to mock, would have recorded orders as paid with no money taken).

### P1
| # | Item | Why it blocks a real launch |
| - | ---- | --------------------------- |
| A13 | No screen-reader pass | AA conformance is claimed, never verified with AT |
| C15 | No penetration test | self-review is not an audit |
| Y5 | Deployment never rehearsed | unknown failure modes at cutover |
| Y6 | No rollback path | a bad release would have no exit |
| O4 | No error tracking | production failures would be invisible |
| O5 | No uptime/latency monitoring | outages found by customers |

### P2
R2 (320px reflow) · R5 (200% zoom) · A1/A2 (keyboard sweep) · A14 (axe) ·
P1/P2/P10 (field metrics) · C14 (build-tooling advisories) · **E11 (idempotency
key)** · D8 (backup rehearsal) · L3 (sweep scheduling) · O3 (health endpoint) ·
O6 (invariant alerting)

### P3
H6 (heading-order assertion) · U3 (border contrast) · L6 (cart without JS)

---

## Production readiness

**Not production ready.** Six P1 items are open and every one is external to the
code: accessibility verification, security audit, deployment rehearsal, rollback,
and two observability gaps. The application's own invariants — pricing,
inventory, payment verification, compatibility evidence, duplicate submission —
are tested and green, and CI is green on a clean database.

The honest statement is: **the code is in good shape; the operational readiness
around it has not been established.**
