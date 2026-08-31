# Production smoke test plan

What to check by hand on a real production deployment, in order, and what each
failure means.

The automated smoke tests in `scripts/deploy.sh` run on **every** deploy and
gate the rollback. This document is different: it is the **first-launch**
pass, run once against the real domain with the real payment gateway, plus the
short version to repeat after any risky change.

**Status: NOT PERFORMED.** No production deployment exists. Nothing in this
document may be reported as passed until someone has actually run it against a
live host. Record dates and outcomes in the table at the end.

---

## Before starting

| | |
|---|---|
| Environment | Production, real domain, real payment provider |
| Duration | ~40 minutes for the full pass |
| Needs | A phone that can receive the order, a real payment card |
| Irreversible steps | **T14 moves real money.** Everything else is read-only. |
| Have ready | Access to the gateway's merchant dashboard, and to `docker compose logs` |

Take a backup first: `./scripts/backup-db.sh`.

---

## A. Infrastructure

### T1 — HTTPS is real and forced
```
curl -sSI http://<domain>/ | head -1        # expect 301/308 to https
curl -sSI https://<domain>/ | head -1       # expect 200
```
Then open the site in a browser and confirm the padlock, the certificate's
subject matches the domain, and expiry is more than 21 days out.

**Fails if:** `http://` serves content instead of redirecting. Session cookies
are marked `Secure`, so they will be dropped on the plain-HTTP path and login
will silently not persist.

### T2 — The app is not directly reachable
From another machine: `curl --max-time 5 http://<server-ip>:3000/` must **fail
to connect**. The app binds to `127.0.0.1`; if it answers, the bind is wrong
and TLS can be bypassed entirely.

### T3 — PostgreSQL is not reachable
From another machine: `psql "postgres://…@<server-ip>:5432/madesaite"` must
fail to connect. The compose file publishes no port; if this connects,
something added one.

### T4 — Liveness and readiness
```
curl -sS https://<domain>/api/health   # {"status":"ok","uptimeSeconds":…}
curl -sS https://<domain>/api/ready    # {"status":"ready","checks":{"database":"ok"}}
```
**Also confirm neither leaks:** no driver message, no connection string, no
version number, no stack trace.

### T5 — The deployed commit is the intended one
```
docker compose -f docker-compose.production.yml exec app printenv NEXT_PUBLIC_BUILD_SHA
```
Must equal the SHA that was deployed. If it says `unknown`, the image was built
outside `deploy.sh` and is not attributable — rebuild before going further.

### T6 — Security headers
```
curl -sSI https://<domain>/ | grep -iE 'content-security-policy|x-frame-options|x-content-type|referrer-policy|permissions-policy'
```
All five present. CSP must **not** contain `unsafe-eval` — its presence means
the app is running in development mode.

### T7 — The forwarding header is not trusted blindly
```
curl -sS -H 'X-Forwarded-For: 9.9.9.9' https://<domain>/ > /dev/null
docker compose … logs app --tail 20 | grep 9.9.9.9
```
Must find **nothing**. A match means `TRUSTED_PROXY_HOPS` is too high and the
rate limits can be bypassed by rotating a header.

---

## B. The storefront

### T8 — The shop renders in Persian, RTL
Home page loads; text is Persian; layout is right-to-left; the Vazirmatn font
is applied (not a fallback); no layout shift as the page settles.

### T9 — Search finds Persian text
Search «فیلتر روغن». Expect results.

**Fails if:** zero results for a term that exists. That is the `pg_trgm` locale
fault — the database was created under a `C` locale, trigrams are empty, and
fuzzy search is silently dead. Confirm with:
```
docker compose … exec db psql -U <user> -d madesaite -c "select show_trgm('فیلتر روغن');"
```
Recreate the database with `--locale=C.UTF-8` and restore. This one cannot be
patched in place.

### T10 — Vehicle fitment gives a verdict
Pick a vehicle in «گاراژ من», open a product, confirm a compatibility verdict
appears — «سازگار», «ناسازگار» or «نامشخص». All three are correct answers;
a *missing* verdict is not.

### T11 — A missing product is a real 404
`https://<domain>/products/no-such-product-slug` must return **404**, not a 200
with an empty page. Check the status code, not just the appearance:
```
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/products/no-such-product-slug
```

### T12 — The admin area is closed
Signed out, `https://<domain>/admin` must redirect (307), not render. Then sign
in as a **customer** and try again: expect 403, not the dashboard.

### T13 — SEO surface
`robots.txt` and `sitemap.xml` return 200; the sitemap's URLs use the real
domain and `https`, not `localhost`. A `localhost` URL here means `SITE_URL` is
wrong, which also means every payment callback URL is wrong.

---

## C. Money — the destructive test

### T14 — One real purchase, then refund it

**This moves real money. Do it deliberately, once, with the smallest possible
order.** Do not skip it: everything up to here can pass on a shop that cannot
take a single payment.

1. Add one low-value item to the cart as a **guest**.
2. Check out with a real phone number.
3. Pay with a real card through the real gateway.
4. **Record the tracking token from the confirmation page before closing it.**

Then confirm all five:

| | Check |
|---|---|
| a | The order reaches `paid` in the admin order list |
| b | The amount in the **gateway dashboard** matches the order total, to the Toman |
| c | The transaction reference is stored against the order |
| d | Stock for that product decreased by exactly one |
| e | The tracking page for that token loads and shows the order |

5. **Refund it** through the gateway dashboard and cancel the order in admin.

**If (a) fails but the money moved:** the callback URL registered with the
provider does not match. It is provider-scoped —
`https://<domain>/api/payments/zarinpal/callback`, not
`/api/payments/callback`. Fix it with the provider; the order is recoverable
from the gateway dashboard.

### T15 — Payment does not depend on the browser coming back
Repeat a checkout and **close the tab during the gateway redirect**, before
being returned to the site. Wait a minute, then check the admin order list.

The order must still reach the correct state, because the callback is verified
server-side. If the order is stuck because the customer's browser never
returned, that is a defect: a customer on a flaky mobile connection would pay
and get nothing.

### T16 — The sandbox is genuinely off
```
docker compose … exec app printenv PAYMENT_PROVIDER ALLOW_SANDBOX_PAYMENTS
```
Expect a real provider and an **empty** `ALLOW_SANDBOX_PAYMENTS`. Then check
the boot log for the sandbox warning — its presence on a real shop means orders
can be marked paid with no money taken.

---

## D. Recovery

### T17 — A backup exists and restores
```
./scripts/backup-db.sh
./scripts/restore-db.sh backups/<newest>.dump --into madesaite_restore_check
```
Confirm the reported product, order and fitment counts match production, and
that the trigram check passes. Then drop the scratch database.

**A backup that has never been restored is not a backup.**

### T18 — Rollback works
On a staging host, not production: deploy, then `./scripts/deploy.sh
--rollback`, and confirm the site serves the previous build (check
`NEXT_PUBLIC_BUILD_SHA`). Rehearse this **before** needing it.

### T19 — Readiness reacts to a database loss
On staging: stop the `db` container. `/api/ready` must return 503 within a few
seconds and `/api/health` must stay 200 — that difference is what stops a
database blip from restarting every container. Start `db` again; readiness must
recover **without** an app restart.

---

## E. After launch, day one

- [ ] External uptime monitor is configured and has fired a test alert
- [ ] The backup cron has produced a dump, unattended, at least once
- [ ] `docker compose … logs app | grep invariant.` is empty
- [ ] A second real order, placed by someone who is not the person who built it

---

## Record

| Test | Date | By | Result | Notes |
|---|---|---|---|---|
| T1–T7 infrastructure | | | | |
| T8–T13 storefront | | | | |
| T14–T16 payments | | | | |
| T17–T19 recovery | | | | |
| Day-one checks | | | | |

Leave a row blank rather than guessing. An unrecorded test is an untested one.
