# Compliance matrix

Verdicts against `docs/WEBSITE_STANDARD.md`. **No row is PASS because a document
says so** — each cites a test, a measurement or an inspectable artefact.

Assessed at commit `f6b8aad` + the production-readiness phase's changes.

Rows changed in this phase are marked **↑** (improved) or **↓** (found worse
than previously recorded).

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
| R2 ↑ | Reflow at 320px | PASS | 10 pages at 320px, no horizontal scroll; verified to fail on a 2000px unshrinkable element | `tests/e2e/accessibility.spec.ts` | — | — |
| R3 | Touch targets ≥ 44px | PASS | asserted on add-to-cart | `tests/e2e/rtl-responsive.spec.ts` | — | — |
| R4 | Wide content self-scrolls | PASS | `.scroll-x`, asserted | same | — | — |
| R5 ↑ | 200% text zoom | PASS | 10 pages at 640×450 (=1280 at 2×); same falsification | `tests/e2e/accessibility.spec.ts` | — | — |
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
| A1 ↑ | Keyboard operable | PASS | 40-stop tab sweep across 5 routes; every stop paints an indicator | `tests/e2e/accessibility.spec.ts` | — | — |
| A2 ↑ | No keyboard trap | PASS | tab sweep asserts focus moves across >1 element on every route | `tests/e2e/accessibility.spec.ts` | — | — |
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
| A14 ↑ | Automated axe audit | PASS | axe-core WCAG 2.1 A+AA on 11 pages + the 404: **0 violations**; verified to fail on a missing `alt` | `tests/e2e/accessibility.spec.ts` | — | — |
| A15 | Automated ≠ conformant | **PARTIAL** | axe catches ~⅓ of WCAG failures. Meaningfulness of Persian alt text and announcements is unjudged | — | **P1** | folded into A13 |

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
| P1 ↑ | LCP ≤ 2.5s | PARTIAL | **LAB** 556–1068ms under 4× CPU + 150ms/request + cold cache. Inside "good" with headroom; the network is still absent | `docs/PERFORMANCE.md` | P2 | field measurement |
| P2 | INP ≤ 200ms | **UNKNOWN** | needs real interaction traces | — | P2 | RUM |
| P3 | CLS ≤ 0.1 | PASS | **LAB** cold-cache 0.0001–0.0045 across 10 page/viewport pairs | `docs/PERFORMANCE.md` | — | — |
| P4 | TTFB | PASS | 12–46ms **LAB, localhost** — excludes all real network cost and is not a field predictor | same | — | — |
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
| C14 ↑ | Dependency audit | PASS | production tree clean at high+; **CI now gates on it**. postcss 8.4.31 (2 high advisories, pinned by Next) resolved by an override rather than deferred to Next 16 | `.github/workflows/ci.yml`, `package.json` | — | — |
| C16 ↑ | Client IP not attacker-controlled | PASS | **P0 fixed this phase**: the leftmost `X-Forwarded-For` entry is client-written, so rate limits could be bypassed by rotating a header. 10 tests | `tests/unit/client-ip.test.ts` | — | — |
| C17 ↑ | Secrets cannot be committed or imaged | PASS | **exposure fixed this phase**: `.env.production` matched no gitignore rule. `.dockerignore` excludes every `.env` from the build context | `.gitignore`, `.dockerignore` | — | — |
| C18 ↑ | Unsafe production config fails closed | PASS | 17 unit tests, plus **the real image asserted in CI** to exit non-zero naming both faults | `tests/unit/production-config.test.ts`, CI step 18 | — | — |
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
| E12 ↑↓ | **PAID order implies a settled payment** | PASS | **the ledger could contradict the order.** A retry after a failed or cancelled attempt left `order.status = PAID` with `payment.status = FAILED`, because settlement matched only `INITIATED`. Reproduced, then fixed and **enforced**: `PAID_WITHOUT_VERIFICATION` is reported and the transaction rolls back if nothing is settleable. 8 tests, verified to fail on revert | `tests/integration/orders.test.ts` | — | — |
| E11 | **HTTP idempotency key** | **OPEN** | cart lock prevents duplicates; retry after a lost response returns `409 CART_EMPTY`. Re-evaluated for production: still P2, and two claims in the original evaluation were corrected — there is **no** customer-facing lookup by phone, and `CART_EMPTY` is **not** a named invariant, so nothing would alert on it today | ADR-013 + addendum | **P2** | ADR-013 design; escalate on first observed occurrence |

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
| D8 ↑ | Backup/restore rehearsal | PASS | **performed**: dump verified by `pg_restore --list`, restored into a scratch database — products 42, orders 0, fitments 119, 11 Persian trigrams, 10 constraints, 101 indexes | `scripts/backup-db.sh`, `scripts/restore-db.sh` | — | — |
| D9 | Off-host backup copy | **FAIL** | dumps sit on the same host as the database; one disk failure loses both | — | **P1** | owner action, in the launch guide |

## 12. Reliability

| # | Requirement | Status | Evidence | Path | Sev | Remediation |
| - | ----------- | ------ | -------- | ---- | --- | ----------- |
| L1 | Idempotent side effects | PASS | cart lock + callback replay | tests | — | — |
| L2 | No double-charge/double-order | PASS | tests | `checkout.test.ts` | — | — |
| L3 ↑↓ | Reservations released | PASS | **a defect was found and fixed**: the production image has no `tsx`, so the documented cron `npm run db:sweep` could never have run in a container — stock would have been stranded permanently with no error. Now in-process, 8 unit + 1 integration test verified to fail when neutered | `src/lib/scheduler.ts` | — | — |
| L4 | Recoverable failures | PASS | payment retry path | `orders.test.ts` | — | — |
| L5 | Restart-safe | PASS | no in-memory critical state | review | — | — |
| L6 | Graceful degradation without JS | PARTIAL | search and tracking work; cart does not | `search-box.tsx` | P3 | acceptable for a cart |

## 13. Testing / CI / Deployment / Observability

| # | Requirement | Status | Evidence | Sev | Remediation |
| - | ----------- | ------ | -------- | --- | ----------- |
| Q1–Q6 | Layered tests, regression guards | PASS | 383 vitest + 109 Playwright | — | — |
| Q7 | Tests fail on regression | PASS | verified by reverting payment guard, harness config, cart lock | — | — |
| Q8 | No brittle assertions | PASS | no animation-timing assertions | — | — |
| I1–I5 ↑ | CI gates on every push | PASS | 19 steps green on `efa1648`, run `33389716248` — now including a production container build, a startup-gate assertion against the real image, a readiness check against a real database, and a production dependency audit | — | — |
| Y1–Y4 | Config documented, fails closed, demo marked | PASS | `.env.example`, payment guard | — | — |
| Y5 ↑↓ | Deployment rehearsed | **PARTIAL** | **the previous PARTIAL was not earned.** Driving the documented entrypoint on a genuinely clean Docker host found four defects that made a first deploy impossible; see §14. It now runs clean end to end: db created → healthy → migrate container applies 32 tables → app ready → 9 smoke checks. **Still never deployed to a real host.** | **P1** | first real deploy |
| Y6 ↑ | Rollback path | PASS | **executed**, not just written: redeploy recorded the previous image, `--rollback` returned to it, and all 9 smoke checks passed against the restored release. The CI gate asserts the running container's image actually changes back — deploying the same commit twice would otherwise make the rollback a no-op that passes without swapping anything | `scripts/deploy.sh` | — | — |
| O1 | Error logging without PII | PASS | review | — | — |
| O2 | Admin audit | PASS | `/admin/audit` | — | — |
| O3 ↑ | Health endpoint | PASS | `/api/health` (liveness, no DB) and `/api/ready` (DB + schema, 3s timeout). Readiness verified to return 503 on database loss and 200 on recovery without a restart; neither leaks a driver message or connection string | `src/app/api/health`, `src/app/api/ready` | — | — |
| O4 ↑ | Error tracking | **PARTIAL** | structured JSON logging with key- and value-pattern redaction, 8 named invariants, and a reporter interface — but **no provider is attached**, so errors reach `docker compose logs` and nobody is told. A dead `SENTRY_DSN` passthrough was removed rather than left implying otherwise | `src/lib/observability.ts` | **P1** | attach a service (owner decision) |
| O5 | Uptime/latency monitoring | **FAIL** | nothing external watches the site. Thresholds and endpoints are specified; none configured | `docs/OPERATIONS.md` §8 | **P1** | owner action, in the launch guide |
| O6 ↑ | Business-invariant alerting | **PARTIAL** | 8 invariants named in code with Critical/Warning severities and thresholds documented; two order-service fraud signals now report. **No alerting is wired to them** | `src/lib/observability.ts`, `docs/OPERATIONS.md` §8 | P2 | wire once O4 has a provider |

## 14. Production & deployment

| # | Requirement | Status | Evidence | Sev | Remediation |
| - | ----------- | ------ | -------- | --- | ----------- |
| N1 ↑↓ | Reproducible image | PASS | multi-stage, `npm ci` from the lockfile. `NEXT_PUBLIC_BUILD_SHA` was set only in the build stage, so a running container reported **nothing** — the first thing the runbook tells an operator to check. Fixed and asserted in CI against the running container | — | — |
| N2 | Runs unprivileged | PASS | non-root user 1001, `read_only: true`, `no-new-privileges`, tini for signal handling | — | — |
| N3 | No secret in an image layer | PASS | `.dockerignore` excludes every `.env`; configuration arrives at run time | — | — |
| N4 | Database not publicly exposed | PASS | compose publishes no port for `db`; app bound to `127.0.0.1` | — | — |
| N5 ↑↓ | Migrations gate the app | PASS | **the migrate container could not run at all**: Next's standalone tracer inlines drizzle-orm rather than leaving it resolvable, so the runner died on `Cannot find module`. Now shipped and asserted — CI checks the *container* created ≥30 tables | — | — |
| N6 | Deploy is attributable to a SHA | PASS | `deploy.sh` refuses a dirty working tree | — | — |
| N7 | Trusted proxy configured safely | PASS | hops counted from the right; a short chain resolves to `unknown` rather than to a client value | — | — |
| N8 | Deployment architecture decided | PASS | ADR-014, three options evaluated | — | — |
| N9 | Owner-operable documentation | PASS | `docs/LAUNCH_GUIDE_FA.md` (Persian), `docs/OPERATIONS.md`, `docs/SMOKE_TEST_PLAN.md` | — | — |
| N10 | Automated post-deploy smoke tests | PASS | 9 non-destructive checks gate the rollback, including a real 404 and the admin redirect | — | — |
| N17 ↑↓ | First deploy works on a clean host | PASS | **was broken four ways and nothing tested it.** Reproduced on an empty Docker project with only `./scripts/deploy.sh`; each fix verified by re-running. CI now drives the real entrypoint from nothing on every push | — | — |
| N19 ↑↓ | Deploy uses the configured database, not the operator's shell | PASS | **found by the new clean-host gate on its first CI run.** The compose file reads `${DATABASE_URL:?}` by interpolation, and Compose resolves interpolation from the *shell* before `--env-file` — so a `DATABASE_URL` already exported (direnv, `.bashrc`, an earlier `npm run db:migrate`) silently repointed the whole stack, migrations included. `deploy.sh` now sources the deployment file first, fixing every compose call at once. CI reproduces the hostile ambient value by construction | `scripts/deploy.sh` | — | — |
| N21 ↑↓ | Rollback uses the configured database too | PASS | **the first fix missed the path that matters most.** `--rollback` returns before the preflight, so it never loaded the deployment file and brought the app up against the operator's ambient `DATABASE_URL` — during an incident, which is when rollback runs. The next CI run caught it: the rolled-back app never became ready. Configuration is now loaded before any branching | `scripts/deploy.sh` | — | — |
| N20 ↑↓ | Teardown actually tears down | PASS | **second silent no-op of the same shape.** `compose down -v` also interpolates the whole file, so it failed on the required variables, removed nothing, and had its stderr and exit code discarded — leaving a populated `pgdata` volume that a later deploy met with the *previous* password (`28P01`). Both teardowns now pass `--env-file` and no longer hide stderr | `.github/workflows/ci.yml` | — | — |
| N18 ↑↓ | Pre-deploy backup actually taken | PASS | **it never ran.** Every redeploy printed "first deployment, nothing to back up" while the database was up, and wrote no dump. The condition tested command success, not whether a container was running, and failed on APP_IMAGE interpolation. Now taken **and read back** with `pg_restore --list` before migrating | — | — |
| N16 | E2E exercises the production server | **PARTIAL** | the Playwright harness runs `next start`, which now warns it "does not work with output: standalone". It does serve correctly — 104 E2E tests pass through full purchase journeys — but production runs `node server.js` from the standalone bundle, a different wrapper over the same build. CI's container readiness step boots the standalone server directly, so both paths are exercised, just not by the same suite | P3 | point `webServer` at the standalone server once it can be done without destabilising the harness |
| N11 | Domain + HTTPS | **FAIL** | no domain registered, no certificate | **P1** | owner action |
| N12 | Real payment provider | **FAIL** | sandbox only; the app refuses to start this way on a live host | **P1** | owner action, 3–10 working days |
| N13 | Production deployment | **FAIL** | never deployed | **P1** | after N11 + N12 |
| N14 | Live payment verified | **FAIL** | no real transaction has ever been made | **P1** | smoke plan T14 |
| N15 | Backup schedule running | **FAIL** | script exists and is rehearsed; no cron installed anywhere | **P1** | owner/engineer at deploy |

---

## Open items by severity

### P0
None open. Three were found and closed across the last two phases:

- **C13** — the sandbox gateway was reachable from a live deployment, so
  `PAYMENT_PROVIDER=mock` (or unset, defaulting to mock) would have recorded
  orders as paid with no money taken.
- **C16** — `getClientIp()` returned the client-written end of
  `X-Forwarded-For`, so login, checkout and payment-callback rate limits could
  be bypassed by rotating a header.
- **C17** — `.env.production` matched no gitignore rule, so a production
  secrets file created on a server would have been offered up by `git status`
  as a new file to commit.

### P1 — blocks a real launch

The previous revision of this file claimed every remaining P1 was external to
the code. **That was wrong, and an independent review was right to reject it.**
Two internal P1s were open at that point, and looking for them found more:

- a first deploy could not work at all — four separate defects (§14, N17);
- a PAID order could carry a FAILED payment row (§10, E12).

Both are now fixed, reproduced first and verified to fail on revert. They were
invisible from reading the code and from the CI that existed, which is the
lesson: *nothing that had never been executed should have been recorded as
PASS.* Y5 and Y6 in particular were marked PARTIAL on the strength of scripts
that had been written but never run against a clean host.

With those closed, the list below is external — but that claim is now made
having been caught making it too early once.

| # | Item | Why it blocks | Whose |
| - | ---- | ------------- | ----- |
| N11 | No domain or certificate | there is nothing to deploy to | owner |
| N12 | No real payment provider | the shop cannot take money; 3–10 working days | owner |
| N13 | Never deployed to a real host | failure modes at cutover are unknown | owner + engineer |
| N14 | No live payment ever verified | everything else can pass on a shop that cannot take one payment | owner |
| N15 | Backup schedule not installed | the script is rehearsed but nothing runs it | engineer at deploy |
| D9 | Backups sit on the database's own host | one disk failure loses both | owner |
| O4 | No error-tracking provider attached | production errors reach a log nobody reads | owner decision |
| O5 | Nothing external watches the site | outages are found by customers | owner |
| A13 / A15 | No screen-reader pass | AA is claimed from automated tooling, which catches ~⅓ of failures | needs a human with AT |
| C15 | No penetration test | automated review is not an independent audit | external |
| Y5 | Deployment rehearsed, not performed | see N13 | — |

**Internal P1s found and closed by the review that rejected the earlier claim:**

| # | Was | Now |
| - | --- | --- |
| N17 | First deploy impossible: migrate container could not load drizzle-orm; `--no-deps` never started the database; `APP_IMAGE` interpolation broke starting `db` alone | fixed, rehearsed clean end to end, gated in CI |
| N18 | Pre-deploy backup silently never taken | taken and read back before migrating |
| N19 | An exported `DATABASE_URL` silently redirected the whole deploy | the deployment file is authoritative |
| N20 | `compose down -v` removed nothing and said nothing | scoped, interpolable, stderr visible |
| N21 | `--rollback` skipped the config load entirely | configuration loaded before any branch |
| N1 | Running container reported no build SHA, though the runbook says to read it | carried into the runtime stage, asserted in CI |
| E12 | `order.status = PAID` reachable with `payment.status = FAILED` | retry settles the row; invariant enforced and reported |

### P2
**E11** (idempotency key — re-evaluated, still P2) · **P1/P2/P10** (field
metrics: LAB measured, FIELD absent, INP unmeasurable synthetically) ·
**Y6** (rollback path exists, never exercised on a real host) · **O6**
(invariants named, alerting not wired)

### P3
H6 (heading-order assertion) · U3 (border contrast) · L6 (cart without JS) ·
N16 (E2E runs `next start`, production runs the standalone server)

---

## Production readiness

**Not production ready.**

*Revised after an independent review rejected the previous conclusion.* The
prior version of this section said the operational readiness existed as
artefacts and only lacked a real host. That was too generous: the artefacts
existed, but four of them did not work, and the one thing that would have
revealed it — running the documented entrypoint on a clean host — had not been
done. It has now.

At the last assessment six P1 items were open and the honest summary was "the
code is in good shape; the operational readiness around it has not been
established." The operational readiness now exists as *artefacts*: a container
image that CI builds and boots, a startup gate that refuses a dangerous
configuration, liveness and readiness endpoints, a rehearsed backup and
restore, a rollback path, a deploy script that will not deploy an
unattributable commit, named invariants, alert thresholds, and documentation in
both English and Persian.

What is left is that **none of it has touched a real host.** There is no
domain, no certificate, no payment merchant account, no deployed instance, and
no real transaction. That is not an engineering gap; it is a set of purchases
and human decisions, and it is listed above as such.

Three defects were found and fixed *because* this phase looked at deployment
rather than at code:

1. The reservation sweeper could never have run in a container (**L3**) —
   stranded stock, silently, forever.
2. A production secrets file was not gitignored (**C17**).
3. Two high-severity advisories sat in the shipped dependency tree (**C14**),
   with npm's own remedy being a major framework upgrade.

None of the three is visible from reading application code, which is the
argument for having done this phase at all.

Five further defects were found by the same exercise, on top of the two the
review named: the pre-deploy backup never ran, the image could not report its
own commit, a CI assertion passed vacuously on an errored command, an exported
`DATABASE_URL` silently redirected the entire deploy, and the teardown removed
nothing while reporting success.

Four of those five are one mistake repeated: **a shell construct whose failure
was indistinguishable from success.** `compose ps` exiting 0 with no output,
`compose down` dying on interpolation behind `2>/dev/null || true`, an
assertion reading an errored command's empty output. Each looked correct and
each did nothing. That pattern, not any individual bug, is what the clean-host
gate exists to catch — and it caught two of them after being written to catch
the first.

**The honest statement is: the system is now demonstrably deployable — a clean
first deploy, a redeploy with a verified backup, and a rollback have all been
executed and are gated in CI — and it has still never been deployed to a real
host, taken a real payment, or been read by a screen reader.**
