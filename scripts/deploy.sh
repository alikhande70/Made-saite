#!/usr/bin/env bash
#
# Made-saite production deployment.
#
# Every deployment is attributable to an exact Git SHA, and the previous image
# is retained so a rollback is a tag swap rather than a rebuild. The sequence
# refuses to continue at each gate, which is the point: a deployment that stops
# halfway with the old release still serving is a good outcome.
#
#   ./scripts/deploy.sh                  # deploy origin/<branch> HEAD
#   ./scripts/deploy.sh <git-sha>        # deploy an exact commit
#   ./scripts/deploy.sh --rollback       # return to the previous image
#
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
IMAGE_NAME="${IMAGE_NAME:-madesaite}"
PREVIOUS_TAG_FILE=".deploy/previous-image"
CURRENT_TAG_FILE=".deploy/current-image"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${APP_PORT:-3000}}"
READY_TIMEOUT="${READY_TIMEOUT:-120}"

step()  { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
fail()  { printf '\033[31m✖ %s\033[0m\n' "$1" >&2; exit 1; }
ok()    { printf '\033[32m✔ %s\033[0m\n' "$1"; }

mkdir -p .deploy

compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

# ── readiness gate ───────────────────────────────────────────────────────────
# Polls /api/ready, which checks the database and the schema — not /api/health,
# which only proves the process is running.
wait_until_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT))
  while [ $SECONDS -lt $deadline ]; do
    if curl -fsS --max-time 5 "${HEALTH_URL}/api/ready" > /dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  return 1
}

# ── smoke tests ──────────────────────────────────────────────────────────────
# Deliberately read-only and non-destructive: no order is placed against a live
# store by a deployment script.
smoke_test() {
  local failures=0
  check() {
    local path="$1" expected="$2" label="$3"
    local status
    status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${HEALTH_URL}${path}" || echo 000)"
    if [ "$status" = "$expected" ]; then
      printf '  ✔ %-34s %s\n' "$label" "$status"
    else
      printf '  ✖ %-34s expected %s, got %s\n' "$label" "$expected" "$status"
      failures=$((failures + 1))
    fi
  }

  check "/api/health"        200 "liveness"
  check "/api/ready"         200 "readiness (database + schema)"
  check "/"                  200 "home page"
  check "/products"          200 "catalogue"
  check "/robots.txt"        200 "robots.txt"
  check "/sitemap.xml"       200 "sitemap"
  check "/cart"              200 "cart"
  check "/products/no-such-product-slug" 404 "missing product returns a real 404"
  check "/admin"             307 "admin redirects anonymous visitors"

  [ "$failures" -eq 0 ] || return 1
}

# ── rollback ─────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--rollback" ]; then
  [ -f "$PREVIOUS_TAG_FILE" ] || fail "no previous image recorded; nothing to roll back to"
  PREVIOUS="$(cat "$PREVIOUS_TAG_FILE")"

  step "Rolling back to ${PREVIOUS}"
  # Note: only the application rolls back. The database does not — see
  # docs/OPERATIONS.md on forward-compatible migrations, which is what makes
  # rolling the app back safe without touching the schema.
  APP_IMAGE="$PREVIOUS" compose up -d --no-deps app

  step "Waiting for readiness"
  wait_until_ready || fail "rollback target did not become ready; investigate immediately"

  step "Smoke testing"
  smoke_test || fail "rollback target failed smoke tests"

  echo "$PREVIOUS" > "$CURRENT_TAG_FILE"
  ok "Rolled back to ${PREVIOUS}"
  exit 0
fi

# ── preflight ────────────────────────────────────────────────────────────────
step "Preflight"
[ -f "$ENV_FILE" ] || fail "${ENV_FILE} not found — copy .env.example and fill it in"
[ -f "$COMPOSE_FILE" ] || fail "${COMPOSE_FILE} not found"
command -v docker >/dev/null || fail "docker is not installed"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 is required"
ok "environment file and tooling present"

# ── resolve the exact commit ─────────────────────────────────────────────────
step "Resolving release"
TARGET="${1:-}"
git fetch --quiet origin || fail "could not fetch from origin"

if [ -n "$TARGET" ]; then
  git rev-parse --verify --quiet "${TARGET}^{commit}" >/dev/null || fail "unknown commit: ${TARGET}"
  GIT_SHA="$(git rev-parse "${TARGET}^{commit}")"
else
  GIT_SHA="$(git rev-parse "origin/$(git rev-parse --abbrev-ref HEAD)")"
fi

# A deployment must be reproducible from the repository, so uncommitted work is
# refused rather than silently baked into an image nobody can rebuild.
if [ -n "$(git status --porcelain)" ]; then
  fail "working tree is dirty; commit or stash before deploying"
fi

git checkout --quiet "$GIT_SHA"
IMAGE="${IMAGE_NAME}:${GIT_SHA}"
ok "deploying ${GIT_SHA}"

# ── build ────────────────────────────────────────────────────────────────────
step "Building ${IMAGE}"
docker build --build-arg "GIT_SHA=${GIT_SHA}" -t "$IMAGE" . || fail "image build failed"
ok "image built"

# ── remember what is currently running, for rollback ─────────────────────────
if [ -f "$CURRENT_TAG_FILE" ]; then
  cp "$CURRENT_TAG_FILE" "$PREVIOUS_TAG_FILE"
  ok "previous release recorded: $(cat "$PREVIOUS_TAG_FILE")"
fi

# ── database ─────────────────────────────────────────────────────────────────
step "Backing up the database before migrating"
# Taken before migrations because that is the point at which a schema change
# becomes hard to undo.
if compose ps db --status running >/dev/null 2>&1; then
  compose exec -T db sh -c 'pg_dump --format=custom --compress=9 --no-owner \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -f "/backups/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ).dump"' \
    || fail "pre-deploy backup failed; refusing to migrate without one"
  ok "pre-deploy backup taken"
else
  echo "  (database not yet running — first deployment, nothing to back up)"
fi

step "Applying migrations"
# The migrate service is one-shot and exits non-zero on failure, which stops the
# deployment here rather than starting an app against a mismatched schema.
APP_IMAGE="$IMAGE" compose up --no-deps --exit-code-from migrate migrate \
  || fail "migration failed — the previous release is still serving; restore from the pre-deploy backup if the schema was partially applied"
ok "migrations applied"

# ── start the candidate ──────────────────────────────────────────────────────
step "Starting the application"
APP_IMAGE="$IMAGE" compose up -d --no-deps app || fail "could not start the application"

step "Waiting for readiness (up to ${READY_TIMEOUT}s)"
if ! wait_until_ready; then
  printf '\033[31m✖ candidate never became ready\033[0m\n' >&2
  compose logs --tail 50 app >&2
  if [ -f "$PREVIOUS_TAG_FILE" ]; then
    step "Automatically rolling back"
    APP_IMAGE="$(cat "$PREVIOUS_TAG_FILE")" compose up -d --no-deps app
    wait_until_ready && ok "rolled back to $(cat "$PREVIOUS_TAG_FILE")"
  fi
  fail "deployment aborted"
fi
ok "application is ready"

# ── verify ───────────────────────────────────────────────────────────────────
step "Smoke testing"
if ! smoke_test; then
  if [ -f "$PREVIOUS_TAG_FILE" ]; then
    step "Smoke tests failed — rolling back"
    APP_IMAGE="$(cat "$PREVIOUS_TAG_FILE")" compose up -d --no-deps app
    wait_until_ready && ok "rolled back to $(cat "$PREVIOUS_TAG_FILE")"
  fi
  fail "deployment aborted: smoke tests failed"
fi
ok "smoke tests passed"

echo "$IMAGE" > "$CURRENT_TAG_FILE"

step "Deployed"
cat <<SUMMARY
  commit   ${GIT_SHA}
  image    ${IMAGE}
  rollback ./scripts/deploy.sh --rollback  →  $( [ -f "$PREVIOUS_TAG_FILE" ] && cat "$PREVIOUS_TAG_FILE" || echo 'none recorded' )

Old images are retained. Prune deliberately with:
  docker image prune -a --filter "until=720h"
SUMMARY
