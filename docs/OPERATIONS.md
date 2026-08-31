# Operations

How Made-saite is deployed, watched, backed up and recovered.

Written for whoever is on the hook at 2am, so it states what to run and what
each failure means rather than describing the system in the abstract. The
Persian owner-facing version — what the shop owner personally has to do, and
nothing else — is [LAUNCH_GUIDE_FA.md](LAUNCH_GUIDE_FA.md).

**Honesty about status.** Sections marked **NOT DONE** describe something this
codebase supports but which nobody has actually performed. They are not
claims. See [COMPLIANCE_MATRIX.md](COMPLIANCE_MATRIX.md) for the evidence
behind every status.

---

## 1. Topology

```
        internet
           │  443
     ┌─────▼──────────────┐
     │  reverse proxy     │  TLS terminates here (Caddy / nginx), on the host
     └─────┬──────────────┘
           │  127.0.0.1:3000
  ┌────────▼─────────────────────────────────┐  docker compose project "madesaite"
  │  app        next standalone, non-root    │
  │   │                                      │
  │   │  internal network only               │
  │  db         postgres:16-alpine           │  no published port
  └──────────────────────────────────────────┘
```

Why it is shaped this way: [ADR-014](DECISIONS.md#adr-014--deploy-as-docker-compose-on-a-single-vps).

Three properties are load-bearing:

- **PostgreSQL publishes no port.** It is reachable only from the app container.
  There is no firewall rule to get wrong.
- **The app binds to `127.0.0.1`.** It is never directly reachable from the
  internet; the proxy is the only way in, so TLS cannot be bypassed.
- **TLS lives outside the compose project.** Certificate renewal and the
  application have very different change rates, and HTTPS must keep working
  across an application rollback.

---

## 2. The production environment contract

Every variable, its classification and what happens when it is wrong is in
[`.env.example`](../.env.example). That file is the contract; this is the
summary.

On a server the real values live in `.env.production` beside the compose file.
That file is `git`-ignored, is never copied into an image, and should be
`chmod 600`.

**The startup gate.** `src/lib/production-config.ts` checks the contract once,
at boot, and the process **exits rather than serves** if it fails. The checks
apply only to a *live* deployment — `NODE_ENV=production` **and** a `SITE_URL`
that is not localhost — so a production build served locally for verification
is exempt, which is how the E2E suite exercises the real production build.

It refuses to start on:

| Condition | Why it is fatal |
|---|---|
| `DATABASE_URL` naming a `_test` / `_e2e` / `_dev` / `_scratch` / `_tmp` database | Works, looks fine, and is wiped by the next test run |
| `DATABASE_URL` with a placeholder password | The password was never set |
| `SITE_URL` not `https://` | Session and cart cookies are marked `Secure` from this scheme; plain HTTP silently downgrades every cookie |
| `PAYMENT_PROVIDER` unset | Every default is either "take no money" or "take money through an unconfigured gateway" |
| `PAYMENT_PROVIDER=mock` without `ALLOW_SANDBOX_PAYMENTS=true` | The sandbox records orders as paid with no money taken |
| `zarinpal` without `ZARINPAL_MERCHANT_ID`, `idpay` without `IDPAY_API_KEY` | Checkout would fail at the gateway, after the customer commits |
| `TRUSTED_PROXY_HOPS` not a whole number | Ambiguous trust boundary |

It warns, but starts, on: `ALLOW_SANDBOX_PAYMENTS=true` (correct for staging,
never for a real shop — logged on **every** boot so it cannot be forgotten);
`TRUSTED_PROXY_HOPS` unset; a passwordless `DATABASE_URL`; a `SITE_URL` with a
path.

Messages name the **variable**, never its value, so a boot log is safe to paste
into a support thread.

All findings are reported at once rather than one per restart. Read the whole
list before editing.

---

## 3. The trusted proxy setting

`TRUSTED_PROXY_HOPS` is the one variable where a plausible-looking wrong value
is a security hole, so it gets its own section.

The client address is taken by counting back exactly `TRUSTED_PROXY_HOPS`
entries **from the right-hand end** of `X-Forwarded-For`. Only the last N
entries are appended by infrastructure we control; everything to the left of
them was written by the client.

```
X-Forwarded-For: 1.2.3.4, 203.0.113.9, 198.51.100.7
                 ^^^^^^^  client-written        ^^^^^^^^^^^^ appended by our proxy
```

| Value | Effect |
|---|---|
| unset / `0` | Header ignored. Every visitor shares one rate-limit bucket. Safe, but throttles the site under load. |
| `1` | One reverse proxy (Caddy, nginx, one load balancer). **The usual answer.** |
| `2` | A proxy behind a CDN that also appends. |

Setting it **too high is the dangerous direction**: it starts trusting entries
the client wrote, which reopens the rate-limit bypass on login, checkout and
payment callbacks. A chain shorter than the declared hop count resolves to
`unknown` rather than to an attacker-supplied value.

If unsure, use `1`. Verify with `curl -H 'X-Forwarded-For: 9.9.9.9' https://…`
and confirm the logs do **not** show `9.9.9.9`.

---

## 4. Deploying

```bash
./scripts/deploy.sh
```

The script refuses to run on a dirty working tree: **a deploy must be
attributable to an exact Git SHA**, and that SHA is baked into the image as
`NEXT_PUBLIC_BUILD_SHA` so a running container can name the commit it came
from.

What it does, in order — each step can abort the deploy:

1. Preflight: compose file present, `.env.production` present, Docker up.
2. Resolve the exact SHA; refuse if the tree is dirty.
3. `docker build --build-arg GIT_SHA=<sha>`.
4. Record the currently-running image id to `.deploy/previous-image`.
5. **Pre-deploy `pg_dump`.** Taken before migrations, so there is a restore
   point from *before* any schema change.
6. `docker compose up migrate --exit-code-from migrate`. A failed migration
   stops here, with the old app still serving.
7. Start the app; poll `/api/ready` until it answers 200.
8. Non-destructive smoke tests (§9).
9. On a readiness or smoke failure: **automatic rollback** to the recorded
   previous image.

### Rolling back

```bash
./scripts/deploy.sh --rollback
```

Re-tags and restarts the previous image. It is fast and does not depend on a
build succeeding — that property is why the containerized option was chosen
over building on the host.

**Rollback does not undo a migration.** Migrations here are additive by
convention, so an older image runs against a newer schema. If a migration was
genuinely destructive, roll back the *code* first to stop the bleeding, then
restore the pre-deploy dump (§6) — in that order, because a restore loses every
order placed since the dump.

---

## 5. Health and readiness

Two endpoints answering two different questions. Wiring them the wrong way
round turns a brief database blip into a restart loop.

| | `/api/health` | `/api/ready` |
|---|---|---|
| Question | Is the process alive? | Can this instance serve a request? |
| Touches the database | **No, deliberately** | Yes, with a 3s timeout |
| Consequence of failure | Container restart | Removed from rotation, put back on recovery |
| Use for | Docker/systemd liveness, uptime monitor | Load balancer, deploy gate |

`/api/ready` runs `select 1` **and** `to_regclass('public.products')` — the
second distinguishes "connected to PostgreSQL" from "connected to a schema that
actually has migrations applied".

Neither endpoint returns a driver message, a connection string, a stack trace
or a version. An unauthenticated endpoint that explains why it failed explains
the internal topology to whoever asks.

**Verified:** readiness returns 503 within the timeout when PostgreSQL is
stopped, and 200 again on recovery, without a restart.

---

## 6. Backup and restore

### Taking a backup

```bash
./scripts/backup-db.sh
```

`pg_dump -Fc --compress=9 --no-owner --no-privileges` into `./backups/`, which
is a host bind mount and therefore survives `docker compose down -v`.

Each dump is **verified before it is kept**: the script lists it with
`pg_restore --list` and requires at least one `TABLE DATA` section. If that
fails the file is deleted. An unverified backup is worse than a missing one,
because it is trusted.

Retention is `BACKUP_RETENTION_DAYS` (default 14). Files are `600`, the
directory `700` — a dump contains every customer record.

**Schedule it.** Nothing in this repository schedules backups; that is a host
concern. Daily, off-peak:

```
17 1 * * *  cd /srv/madesaite && ./scripts/backup-db.sh >> /var/log/madesaite-backup.log 2>&1
```

**Off-host copy: NOT DONE.** Backups currently sit on the same machine as the
database, which means one failed disk loses both. Copying `./backups/` to
object storage or another host is an owner action and is listed as such in the
launch guide.

### Restoring

```bash
./scripts/restore-db.sh <dump-file> --into madesaite_restore_check   # rehearsal
./scripts/restore-db.sh <dump-file> --force-production               # real recovery
```

The script **refuses** to target the database named in `DATABASE_URL` unless
`--force-production` is passed, so the rehearsal path cannot become the
production path by accident.

It recreates the target with `template0 encoding 'UTF8' lc_collate 'C.UTF-8'`.
That is not cosmetic: under a `C` locale, `pg_trgm` extracts **zero** trigrams
from Persian text and fuzzy search silently stops working. A restore into the
wrong locale produces a database that looks correct and cannot search.

After restoring it verifies row counts for products, orders and fitments, and
runs `show_trgm('فیلتر روغن')` expecting at least one trigram.

**Rehearsal performed** — restore into a scratch database from a real dump:
products 42, orders 0, fitments 119, 11 Persian trigrams, 10 constraints, 101
indexes, `md_normalize_fa` present. A restore is only a backup once it has been
performed at least once.

---

## 7. Logging and error tracking

`src/lib/observability.ts` emits one structured JSON line per event:

```json
{"level":"error","event":"invariant.callback_amount_mismatch","orderNumber":"MS-2608-…"}
```

**Everything is redacted on the way out**, by key pattern (`password`,
`secret`, `token`, merchant id, DSN, connection string) and by value pattern,
which strips credentials embedded in a URL. The point is that a future caller
who logs a whole request object does not thereby log a session cookie.

`LOG_LEVEL` defaults to `info`. `debug` is noisy and may log request shapes —
keep it to short investigations.

### Attaching an error service — NOT DONE

There is no vendor SDK in this project and no DSN is read anywhere. What exists
is a structural interface, so a service can be attached at the edge without the
domain depending on one:

```ts
import { setErrorReporter } from '@/lib/observability';

setErrorReporter({
  name: 'sentry',
  captureError(error, context) { Sentry.captureException(error, { extra: context }); },
});
```

Call it from `src/instrumentation.ts`, after the config gate. A reporter that
throws is swallowed by design — observability failing must not become the
outage.

Until that is done, errors are in `docker compose logs app` and nowhere else,
which means nobody is told about them. Attaching a service is an owner
decision (it costs money or a self-hosted instance) and is in the launch guide.

---

## 8. Alerting

### The invariants

Eight conditions that should never occur. They are named in code
(`INVARIANT` in `src/lib/observability.ts`) so an alert rule and the log line
use the same string.

| Event | Severity | Means | First action |
|---|---|---|---|
| `invariant.paid_without_verified_transaction` | **Critical** | An order is `paid` with no verified gateway transaction. Either a bug or an attempt to forge payment. | Freeze fulfilment for that order. Reconcile against the gateway dashboard. |
| `invariant.callback_amount_mismatch` | **Critical** | A gateway callback's amount disagrees with the order. Tampering, or a currency-unit bug. | Do not fulfil. Compare against the gateway record. |
| `invariant.stock_below_zero` | **Critical** | Stock went negative — overselling, so orders exist that cannot be filled. | Halt checkout for that SKU; recount. |
| `invariant.duplicate_order_for_checkout` | **Critical** | The cart lock did not hold. A customer may be charged twice. | Refund the duplicate; capture the logs before they rotate. |
| `invariant.migration_failed` | **Critical** | A deployment applied a partial schema change. | The deploy has already stopped. Do not retry blindly — read the error. |
| `invariant.illegal_order_state_transition` | Warning | An order moved between states the model forbids. | Investigate same-day; usually a code path bypassing the service. |
| `invariant.callback_for_unknown_order` | Warning | A callback named an order that does not exist. A few are internet noise; a burst is probing. | Rate-limit the source; check for enumeration. |
| `invariant.database_unavailable` | Warning → Critical if sustained | Readiness lost the database. | If it recovers within a minute, note it. If not, treat as an outage. |

**Critical** means wake someone. **Warning** means same-day. Ordinary
validation failures — a rejected postcode, an empty cart — must never use this
channel, or the alerts stop being read.

### Thresholds worth setting

| Signal | Warning | Critical |
|---|---|---|
| `/api/ready` non-200 | 2 consecutive | 5 minutes continuous |
| 5xx rate on any route | > 1% over 5 min | > 5% over 5 min |
| Checkout route p95 latency | > 2s | > 5s |
| PostgreSQL connections in use | > 70% of `PG_POOL_MAX` | > 90% |
| Disk free on the database volume | < 25% | < 10% |
| Age of the newest verified backup | > 26h | > 50h |
| TLS certificate expiry | < 21 days | < 7 days |

The backup-age alert is the one most often skipped and most often regretted:
a backup job that silently stopped is indistinguishable from one that works
until the day it is needed.

### Uptime monitoring — NOT DONE

Nothing external watches this site. An external check is the only thing that
notices "the whole host is down", because every internal check is down too.

Point any external monitor (UptimeRobot, Better Stack, Healthchecks.io, or a
cron on another machine) at:

- `https://<domain>/api/health` — every 60s, alert after 2 failures. Liveness.
- `https://<domain>/` — every 5 min, assert 200 **and** that the response
  contains Persian body text, so a blank 200 from a misconfigured proxy is
  caught.
- TLS expiry — most monitors do this from the same check.

Do **not** point an external uptime monitor at `/api/ready`: it fails during
every ordinary deployment, and an alert that fires on every deploy is one
nobody reads.

---

## 9. Smoke tests

`scripts/deploy.sh` runs these automatically after every deploy and rolls back
if any fails. They are **non-destructive**: no order is placed, no payment is
attempted, nothing is written.

| Check | Asserts |
|---|---|
| `/api/health` | 200 — process alive |
| `/api/ready` | 200 — database reachable, schema applied |
| `/` | 200 — the app renders |
| `/products` | 200 — the catalogue and its database query work |
| `/robots.txt`, `/sitemap.xml` | 200 — SEO surface intact |
| `/cart` | 200 — session and cookie path work |
| `/products/no-such-product-slug` | **404, not 200** — catches the soft-404 regression, where a missing product renders a cheerful empty page |
| `/admin` | **307** — the authorization gate still redirects |

The last two matter most: both are cases where a broken deployment returns a
cheerful 200.

The full manual plan for a first launch — including the one test that *does*
move money — is [SMOKE_TEST_PLAN.md](SMOKE_TEST_PLAN.md).

---

## 10. Domain, DNS and HTTPS — OWNER ACTION, NOT DONE

No domain is registered and no certificate exists. These cannot be performed
from this repository; they need an account and a payment method.

1. **Register the domain** (an Iranian registrar for a `.ir`, any registrar for
   a `.com`).
2. **DNS:** an `A` record for `@` and `www` to the server's IPv4. If the host
   has IPv6, `AAAA` too. TTL 300 during setup, raise it afterwards.
3. **Certificate.** Caddy is the fewest moving parts — it obtains and renews
   automatically:

   ```
   madesaite.example, www.madesaite.example {
       encode gzip zstd
       reverse_proxy 127.0.0.1:3000
   }
   ```

   Caddy sets `X-Forwarded-For` itself, which is why `TRUSTED_PROXY_HOPS=1`.
4. **Set `SITE_URL=https://madesaite.example`** in `.env.production` and
   restart. Until this is set the app will refuse to start in production, which
   is the intended order: HTTPS first, then the app.
5. **Verify:** `https://` loads, `http://` redirects to it, and the session
   cookie carries `Secure` (browser devtools → Application → Cookies).

Renewal is automatic with Caddy. With nginx + certbot it is a timer — confirm
`systemctl list-timers | grep certbot` shows one.

---

## 11. Payment provider handoff — OWNER ACTION, NOT DONE

The shop currently runs the **sandbox** provider, which marks orders paid with
no money taken. That is why it refuses to start on a live host without
`ALLOW_SANDBOX_PAYMENTS=true`.

Going live needs credentials this project does not and should not hold.

**The owner must:**

1. Open a merchant account with Zarinpal or IDPay (a registered business and a
   bank account are required; expect identity verification).
2. Receive the `ZARINPAL_MERCHANT_ID` or `IDPAY_API_KEY`.
3. Register the callback URL with the provider. The route is **scoped to the
   provider id**, so it is `https://<domain>/api/payments/zarinpal/callback`
   for Zarinpal and `https://<domain>/api/payments/idpay/callback` for IDPay —
   not a single shared `/api/payments/callback`. Getting this wrong is the
   single most common launch failure: the payment succeeds, the money moves,
   and the order never confirms.
4. Confirm with the provider whether the callback IP is restricted, and if so
   give them the server's egress IP.

**Then, on the server:**

```diff
- PAYMENT_PROVIDER=mock
- ALLOW_SANDBOX_PAYMENTS=true
+ PAYMENT_PROVIDER=zarinpal
+ ZARINPAL_MERCHANT_ID=<from the provider>
```

Remove `ALLOW_SANDBOX_PAYMENTS` entirely rather than setting it to `false`.
Restart. The startup gate will refuse to boot if the credential is missing.

**Then verify with one real, low-value purchase**, and refund it. Confirm: the
order reaches `paid`; the amount in the gateway dashboard matches the order to
the Toman; the transaction reference is stored against the order.

**Payment status must never depend on the browser redirect alone.** The
callback is verified server-side against the gateway before an order is marked
paid — a customer who closes the tab mid-payment still gets a correct order.
Do not "fix" a stuck order by marking it paid in the admin without checking the
gateway dashboard first.

---

## 12. Routine operations

| Task | Command | When |
|---|---|---|
| Watch logs | `docker compose -f docker-compose.production.yml logs -f app` | Investigating |
| Check what is deployed | `docker compose … exec app printenv NEXT_PUBLIC_BUILD_SHA` | Before debugging anything |
| Restart the app only | `docker compose … restart app` | Rarely; prefer a rollback |
| Release stranded stock | Automatic, in-process — see §14 | — |
| Back up now | `./scripts/backup-db.sh` | Before anything risky |
| Deploy | `./scripts/deploy.sh` | — |
| Roll back | `./scripts/deploy.sh --rollback` | Immediately, when in doubt |

**Never** run `docker compose down -v`. The `-v` removes the `pgdata` volume,
which is the database. Backups survive it because they are a host bind mount;
nothing else does.

---

## 13. When something is wrong

**Site is down.** `curl -sS -o /dev/null -w '%{http_code}' https://<domain>/`.
If the proxy answers but the app does not, `docker compose … ps` — an app
container in a restart loop is almost always the startup gate refusing a
configuration change. `docker compose … logs app | tail -40` names the exact
variable.

**Site is up but checkout fails.** Check `/api/ready` first. If it is 200, the
database is fine and the problem is the gateway: look for
`invariant.callback_for_unknown_order` or an amount mismatch.

**Orders are paid but not confirmed.** Almost always the callback URL
registered with the provider does not match `SITE_URL` (§11.3). The money is
real; the orders are recoverable from the gateway dashboard.

**A deploy made things worse.** `./scripts/deploy.sh --rollback`. Diagnose
afterwards — a rollback is cheap and an outage is not.

**Suspected credential leak.** Rotate `AUTH_SECRET` (signs out every user,
which is the correct response), rotate the database password, rotate the
gateway credential with the provider. Then find out how it leaked.

---

## 14. The reservation sweeper

An unpaid order holds its stock for `ORDER_PAYMENT_TTL_MINUTES` (default 30).
Something has to release it afterwards, or an abandoned checkout hides sellable
stock permanently and the shop quietly stops being able to sell an item that is
sitting on the shelf.

In development that something is cron:

```
*/5 * * * *  cd /srv/madesaite && npm run db:sweep
```

**That script cannot run in the production container.** The image contains the
compiled server and nothing else — no `tsx`, no `src` tree — so `npm run
db:sweep` fails there. Relying on it would have left every containerized
deployment stranding stock, with no error anywhere.

So the sweep runs **inside the server process** on a timer
(`src/lib/scheduler.ts`), starting 60 seconds after boot and every
`SWEEP_INTERVAL_MINUTES` (default 5) thereafter. It cancels expired unpaid
orders and returns their stock, prunes expired sessions, and prunes stale
rate-limit windows.

It is safe to run more than one copy: each order is locked and re-checked in
its own transaction, and both prunes delete only already-expired rows.

It logs `sweep.scheduled` once at boot, and `sweep.completed` **only when it
actually cancelled something** — an idle shop should not write a log line every
five minutes. A sweep that throws is reported and retried on the next tick,
because the failure that matters is a sweep failing on *every* tick.

To drive it from an external scheduler instead, set
`DISABLE_BACKGROUND_JOBS=true` and run the sweep from cron on a host that has
the repository checked out.

**Trade-off, stated plainly.** An external scheduler is more visible and easier
to monitor than a timer inside the application. It is also one more thing to
set up correctly and one more thing to forget, and this deployment targets an
owner who is not an engineer. A job that runs by default beats a better job
that is never configured. If the sweep matters enough to monitor, alert on the
absence of `sweep.completed` over a day on a shop that takes orders.

