# Website standard — production quality gate

This is a gate, not an article. Every row is PASS/FAIL against **evidence in
this repository**, and the current verdict for each lives in
`docs/COMPLIANCE_MATRIX.md`. A row cannot be marked PASS because a document
claims it; it is PASS when a test, a measurement or an inspectable artefact
says so.

**Scope: web.** Desktop, laptop, tablet and mobile *browsers*. No native app.

Grounded in: WCAG 2.2 (W3C), Core Web Vitals thresholds (web.dev), the
Front-End Checklist (thedaviddias), OWASP guidance, Google Search Central, and
the Next.js and PostgreSQL documentation.

---

## How to use

| Verdict | Meaning |
| ------- | ------- |
| **PASS** | Evidence exists and is reproducible |
| **FAIL** | Criterion not met |
| **PARTIAL** | Met in part; the gap is named |
| **N/A** | Does not apply, with a reason |

Severity: **P0** release blocker · **P1** major · **P2** important · **P3** minor.

**Release rule: no P0 or P1 open.**

---

## 1. HTML semantics

| # | Criterion | How to verify |
| - | --------- | ------------- |
| H1 | `<!doctype html>`, `lang` and `dir` on `<html>` | inspect; RTL suite asserts `lang="fa" dir="rtl"` |
| H2 | UTF-8 charset declared first | inspect head |
| H3 | Responsive viewport meta, pinch-zoom **not** disabled | inspect; no `user-scalable=no` |
| H4 | Exactly one `<h1>` per page | E2E assertion |
| H5 | Landmarks: `header`, `nav`, `main`, `footer` | inspect |
| H6 | Headings descend without skipping | inspect |
| H7 | Every `id` unique per document | `useId()` for repeated components |
| H8 | Tables use `<caption>`, `<thead>`, `scope` | inspect |
| H9 | Correct `input type` and `autocomplete` | inspect |
| H10 | Scripts non-blocking | framework default |

## 2. UI

| # | Criterion | How to verify |
| - | --------- | ------------- |
| U1 | Colour defined as tokens, not literals | `@theme` in `globals.css` |
| U2 | Text contrast ≥ 4.5:1; large text ≥ 3:1 | computed ratios in docs/DESIGN.md |
| U3 | Non-text/UI contrast ≥ 3:1 | same |
| U4 | Visible focus on every interactive element | `:focus-visible` token |
| U5 | Disabled state visually distinct and non-interactive | `disabled:` variants |
| U6 | No decorative gradient, no ambient animation | grep |
| U7 | Frosted surfaces confined to declared utilities | `.glass-*` only |
| U8 | Consistent spacing and radius scale | tokens |

## 3. UX

| # | Criterion | How to verify |
| - | --------- | ------------- |
| X1 | Every action reports success or failure | interaction E2E |
| X2 | Every async action shows a pending state | Button `loading` |
| X3 | Destructive actions are confirmed or reversible | delete refusals name the cost |
| X4 | Errors say what to do next, not just what failed | inspect copy |
| X5 | Empty states explain and offer a next step | `EmptyState` |
| X6 | Filter/search state is in the URL — shareable, back-navigable | inspect |
| X7 | No dead end: 404 and error pages offer a route back | inspect |
| X8 | Nothing important depends on hover alone | touch review |

## 4. Responsive web

| # | Criterion | How to verify |
| - | --------- | ------------- |
| R1 | No horizontal overflow at 360/390/430/768/1024/1440 | E2E sweep |
| R2 | Reflow at 320px without 2-D scrolling (WCAG 1.4.10) | R1 covers ≥360; 320 untested |
| R3 | Touch targets ≥ 44px on primary actions (WCAG 2.5.8) | E2E assertion |
| R4 | Wide content scrolls inside its own container | `.scroll-x` |
| R5 | Readable at 200% text zoom (WCAG 1.4.4) | manual |
| R6 | Layout uses logical properties, not left/right | grep |

## 5. RTL

| # | Criterion | How to verify |
| - | --------- | ------------- |
| T1 | Document is RTL, not an override | `dir="rtl"` on `<html>` |
| T2 | Logical CSS properties throughout | grep |
| T3 | Directional glyphs mirrored | `.flip-rtl` + E2E |
| T4 | Drawers open from the reading-start edge | E2E |
| T5 | **Technical identifiers keep LTR order and Latin digits** | `.latin-id` + E2E |
| T6 | Persian numerals for quantities, prices, dates | E2E |
| T7 | Line height suited to Persian (≥1.7 body) | tokens |

## 6. Accessibility — WCAG 2.2 AA

| # | Criterion | SC | How to verify |
| - | --------- | -- | ------------- |
| A1 | Keyboard reaches and operates everything | 2.1.1 | manual + search E2E |
| A2 | No keyboard trap | 2.1.2 | manual |
| A3 | Visible focus, unobscured | 2.4.7 / 2.4.11 | inspect |
| A4 | Colour is never the only carrier | 1.4.1 | verdict chips pair glyph + word |
| A5 | Contrast minimums | 1.4.3 | docs/DESIGN.md |
| A6 | Form controls have accessible names | 4.1.2 | E2E |
| A7 | Errors identified in text, tied to the field | 3.3.1 | inspect |
| A8 | Status messages announced without moving focus | 4.1.3 | `role="status"` |
| A9 | `prefers-reduced-motion` respected, **meaning retained** | 2.3.3 | motion tests + E2E |
| A10 | Images have alt; decorative images have empty alt | 1.1.1 | E2E |
| A11 | Target size ≥ 24px minimum | 2.5.8 | E2E (44px on primary) |
| A12 | Skip link to main content | 2.4.1 | E2E |
| A13 | Screen-reader pass | — | **not done** |

## 7. SEO

| # | Criterion | How to verify |
| - | --------- | ------------- |
| S1 | Unique title and meta description per page | inspect |
| S2 | Canonical on every indexable page | E2E |
| S3 | Faceted combinations `noindex, follow` | E2E |
| S4 | Curated landing pages indexable only above an inventory threshold | E2E |
| S5 | Sitemap from live state; excludes private routes | E2E |
| S6 | robots.txt disallows transactional and admin paths | E2E |
| S7 | Structured data matches the database row | E2E |
| S8 | **No fabricated ratings, reviews, availability or prices** | no `aggregateRating` emitted |
| S9 | Missing resources return a real 404, not a soft 404 | E2E status assertions |
| S10 | Open Graph on shareable pages | inspect |

## 8. Performance

| # | Criterion | Threshold | How to verify |
| - | --------- | --------- | ------------- |
| P1 | LCP | ≤ 2.5s at p75 | measured (lab only) |
| P2 | INP | ≤ 200ms at p75 | **not measured** — needs field data |
| P3 | CLS | ≤ 0.1 | measured 0.0000 |
| P4 | TTFB | ≤ 800ms | measured |
| P5 | Route JS budget | ≤ 150KB first load | build output |
| P6 | No N+1 on any listing | query review |
| P7 | Animation touches only transform/opacity | motion tests |
| P8 | Images sized to prevent shift | `aspect-square` |
| P9 | No render-blocking third-party script | none loaded |
| P10 | Field data (CrUX/RUM) | — | **not collected** |

## 9. Security

| # | Criterion | How to verify |
| - | --------- | ------------- |
| C1 | HTTPS; `Secure` cookies keyed to deployment scheme | inspect |
| C2 | CSP, `nosniff`, frame-ancestors, referrer policy | E2E header assertions |
| C3 | Session tokens stored hashed | inspect |
| C4 | Password hashing with a memory-hard KDF | scrypt |
| C5 | CSRF: SameSite **and** explicit origin check | API tests |
| C6 | Authorization on the server, never the UI | API tests |
| C7 | IDOR: ownership in the WHERE clause | API + integration tests |
| C8 | Every external input schema-validated | Zod at every boundary |
| C9 | SQL bound, never concatenated | review |
| C10 | XSS: JSON-LD escaped | unit test |
| C11 | Rate limits on auth, checkout, callbacks | API tests |
| C12 | No PII or secrets in logs | audit redaction list |
| C13 | **Sandbox payment cannot run on a live deployment** | unit tests |
| C14 | Dependency audit clean of runtime-reachable advisories | `npm audit` |
| C15 | Independent penetration test | **not done** |

## 10. E-commerce correctness

| # | Criterion | How to verify |
| - | --------- | ------------- |
| E1 | Every monetary figure recomputed server-side | integration tests |
| E2 | Client-sent totals ignored | schema drops them |
| E3 | Shipping re-quoted from a method code | tests |
| E4 | Overselling impossible under concurrency | 2- and 10-buyer tests |
| E5 | Duplicate submit cannot create a second order | cart-lock tests |
| E6 | Payment callbacks verified, amount-checked, replay-safe | tests |
| E7 | Order state machine server-validated | tests |
| E8 | Order line items immutable after purchase | test |
| E9 | Stock never drops below reserved | CHECK + tests |
| E10 | Compatibility never claimed without evidence | fitment tests |

## 11. Database

| # | Criterion | How to verify |
| - | --------- | ------------- |
| D1 | Migrations versioned and forward-only | `migrations/` |
| D2 | Clean-database install verified | CI |
| D3 | Constraints enforce invariants at the database | CHECK/unique review |
| D4 | Indexes cover the hot paths | EXPLAIN |
| D5 | Money as integers | schema |
| D6 | UTF-8 locale (pg_trgm needs it for Persian) | CI guard |
| D7 | Transactions around multi-row invariants | review |

## 12. Reliability

| # | Criterion | How to verify |
| - | --------- | ------------- |
| L1 | Critical side effects idempotent | cart lock, callback replay tests |
| L2 | Duplicate/retried requests cannot double-charge or double-order | tests |
| L3 | Expired reservations released | sweep script |
| L4 | Failure states recoverable by the user | inspect |
| L5 | Restart-safe: no in-memory critical state | review |
| L6 | Backup and restore rehearsed | **not done** |

## 13. Testing

| # | Criterion | How to verify |
| - | --------- | ------------- |
| Q1 | Pure domain rules unit-tested | `tests/unit` |
| Q2 | Services tested against a real database | `tests/integration` |
| Q3 | Real route handlers tested at the HTTP boundary | `tests/api` |
| Q4 | Critical journeys covered E2E, desktop and mobile | `tests/e2e` |
| Q5 | Concurrency and abuse cases covered | inventory/payment/cart tests |
| Q6 | Regression guards for every fixed defect | per-fix tests |
| Q7 | Tests fail when the code regresses | verified by reverting |
| Q8 | No brittle timing/pixel assertions | review |

## 14. CI/CD

| # | Criterion | How to verify |
| - | --------- | ------------- |
| I1 | Typecheck, lint, migrate, seed, test, build, E2E on every push | workflow |
| I2 | CI runs against a clean database | verified |
| I3 | Environment invariants asserted, not assumed | locale guard |
| I4 | Failure artefacts retained | upload-artifact |
| I5 | Pipeline green on the released commit | run ID recorded |

## 15. Deployment

| # | Criterion | How to verify |
| - | --------- | ------------- |
| Y1 | Documented required environment variables | `.env.example` |
| Y2 | Refuses to start with missing critical config | payment guard |
| Y3 | Secrets never committed | inspect |
| Y4 | Demo data clearly marked and switchable | store setting |
| Y5 | Real deployment rehearsed | **not done** |
| Y6 | Rollback path | **not defined** |

## 16. Observability

| # | Criterion | How to verify |
| - | --------- | ------------- |
| O1 | Server errors logged with context, no PII | review |
| O2 | Admin actions audited | audit log |
| O3 | Health endpoint | **not implemented** |
| O4 | Error tracking / alerting | **not implemented** |
| O5 | Uptime and latency monitoring | **not implemented** |
| O6 | Business-invariant alerting (oversell, payment mismatch) | **not implemented** |
