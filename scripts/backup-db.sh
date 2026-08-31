#!/usr/bin/env bash
#
# PostgreSQL backup for Made-saite.
#
# Produces a compressed custom-format dump, verifies it is readable before
# declaring success, and prunes by age. A file appearing on disk is not a
# backup — a backup is a file that has been proven restorable, which is why
# this script verifies and why scripts/restore-db.sh exists to rehearse it.
#
#   ./scripts/backup-db.sh                      # uses $DATABASE_URL
#   BACKUP_DIR=/mnt/backups ./scripts/backup-db.sh
#
set -euo pipefail

DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/madesaite-${STAMP}.dump"

mkdir -p "$BACKUP_DIR"
# Dumps contain every customer record; keep them unreadable to other users.
chmod 700 "$BACKUP_DIR"

echo "▶ dumping to ${TARGET}"
# Custom format (-Fc): compressed, and restorable selectively with pg_restore.
# --no-owner/--no-privileges so a restore does not require the original roles.
pg_dump --format=custom --compress=9 --no-owner --no-privileges \
        --file="$TARGET" "$DATABASE_URL"

chmod 600 "$TARGET"

# Verification. `pg_restore --list` parses the archive's table of contents, so a
# truncated or corrupt dump fails here rather than during an emergency.
echo "▶ verifying archive"
if ! pg_restore --list "$TARGET" > /dev/null 2>&1; then
  echo "✖ archive is not readable — removing it rather than keeping a false backup" >&2
  rm -f "$TARGET"
  exit 1
fi

# A dump that parses but contains no tables is the other silent failure.
TABLE_COUNT="$(pg_restore --list "$TARGET" | grep -c 'TABLE DATA' || true)"
if [ "$TABLE_COUNT" -lt 1 ]; then
  echo "✖ archive contains no table data — refusing to record it as a backup" >&2
  rm -f "$TARGET"
  exit 1
fi

SIZE="$(du -h "$TARGET" | cut -f1)"
echo "✔ backup ${TARGET} (${SIZE}, ${TABLE_COUNT} tables with data)"

echo "▶ pruning backups older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -name 'madesaite-*.dump' -type f -mtime "+${RETENTION_DAYS}" -print -delete

echo "✔ done. Retained:"
ls -1t "$BACKUP_DIR"/madesaite-*.dump 2>/dev/null | head -5 || true

cat <<'NOTE'

Reminder: a backup that has never been restored is a hypothesis.
Rehearse with:  ./scripts/restore-db.sh <dump> --into madesaite_restore_test
NOTE
