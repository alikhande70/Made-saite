#!/usr/bin/env bash
#
# Restore a Made-saite dump, and rehearse restores safely.
#
# Refuses to write to the database named in $DATABASE_URL unless --force-production
# is passed. That guard exists because the realistic way to lose a database is a
# rehearsal that silently targeted production.
#
#   ./scripts/restore-db.sh backups/madesaite-2026….dump --into madesaite_restore_test
#   ./scripts/restore-db.sh backups/madesaite-2026….dump --force-production
#
set -euo pipefail

DUMP="${1:?usage: restore-db.sh <dump-file> [--into <database>] [--force-production]}"
shift || true

DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"
TARGET_DB=""
FORCE_PRODUCTION=0

while [ $# -gt 0 ]; do
  case "$1" in
    --into) TARGET_DB="${2:?--into needs a database name}"; shift 2 ;;
    --force-production) FORCE_PRODUCTION=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -f "$DUMP" ] || { echo "✖ no such dump: $DUMP" >&2; exit 1; }

# Split the URL so the target database can be swapped without string surgery.
ADMIN_URL="${DATABASE_URL%/*}/postgres"
PRODUCTION_DB="$(basename "${DATABASE_URL%%\?*}")"

if [ -z "$TARGET_DB" ]; then
  TARGET_DB="$PRODUCTION_DB"
fi

if [ "$TARGET_DB" = "$PRODUCTION_DB" ] && [ "$FORCE_PRODUCTION" -ne 1 ]; then
  cat >&2 <<MSG
✖ Refusing to restore over "${PRODUCTION_DB}", the database in DATABASE_URL.

  To rehearse safely:   $0 "$DUMP" --into ${PRODUCTION_DB}_restore_test
  To really restore:    $0 "$DUMP" --force-production
MSG
  exit 1
fi

echo "▶ verifying the archive before touching anything"
pg_restore --list "$DUMP" > /dev/null

echo "▶ (re)creating ${TARGET_DB}"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c \
  "select pg_terminate_backend(pid) from pg_stat_activity where datname = '${TARGET_DB}' and pid <> pg_backend_pid()" > /dev/null
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "drop database if exists ${TARGET_DB}" > /dev/null
# UTF-8: pg_trgm extracts no trigrams from Persian under a C locale, so a
# restore into the wrong locale silently disables fuzzy search.
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c \
  "create database ${TARGET_DB} template template0 encoding 'UTF8' lc_collate 'C.UTF-8' lc_ctype 'C.UTF-8'" > /dev/null

RESTORE_URL="${DATABASE_URL%/*}/${TARGET_DB}"

echo "▶ restoring"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_URL" "$DUMP"

echo "▶ verifying the restored database"
psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -tAc "
  select
    (select count(*) from products)  as products,
    (select count(*) from orders)    as orders,
    (select count(*) from product_fitments) as fitments,
    coalesce(array_length(show_trgm('فیلتر روغن'), 1), 0) as persian_trigrams
" | awk -F'|' '{
  printf "  products=%s orders=%s fitments=%s persian_trigrams=%s\n", $1, $2, $3, $4;
  if ($4 + 0 < 1) { print "✖ pg_trgm produced no trigrams for Persian — wrong locale"; exit 1 }
}'

echo "✔ restored into ${TARGET_DB} and verified"
