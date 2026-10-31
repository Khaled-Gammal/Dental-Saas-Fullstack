#!/usr/bin/env bash
# Phase 1B: one database backup — pg_dump (custom format, compressed), encrypted with AES-256, uploaded with a SHA-256
# checksum, then backups older than BACKUP_RETENTION_DAYS are deleted (the newest BACKUP_KEEP_MIN are always kept).
# Run nightly by the backup container's cron (entrypoint.sh), or by hand:
#   docker compose -f docker-compose.yml -f docker-compose.backup.yml run --rm backup once
# docs/ops/backups.md has the set-up, the restore and the monthly drill.
set -Eeuo pipefail
SCRIPT_NAME=backup
# shellcheck source=backup-lib.sh
source "$(dirname "$(readlink -f "$0")")/backup-lib.sh"

: "${BACKUP_DATABASE_URL:?set BACKUP_DATABASE_URL (a role that can read every table, e.g. app_backup)}"
: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE}"
: "${BACKUP_TARGET:?set BACKUP_TARGET (s3://bucket/path or a local directory)}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
KEEP_MIN="${BACKUP_KEEP_MIN:-7}"
[[ ${#BACKUP_PASSPHRASE} -ge 20 ]] || { log "BACKUP_PASSPHRASE must be at least 20 characters"; exit 2; }
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ && "$KEEP_MIN" =~ ^[0-9]+$ && "$KEEP_MIN" -ge 1 ]] || { log "BACKUP_RETENTION_DAYS and BACKUP_KEEP_MIN must be whole numbers (KEEP_MIN >= 1)"; exit 2; }

# with errtrace the ERR trap also runs inside the pipeline's subshells: report once, from the script itself
failed() { [[ $BASHPID -eq $$ ]] || exit 1; log "FAILED (line $1)"; ping_url "${BACKUP_HEALTHCHECK_URL:-}" fail; exit 1; }
trap 'failed $LINENO' ERR

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
split_password "$BACKUP_DATABASE_URL"
db_url="$PG_URL"

ping_url "${BACKUP_HEALTHCHECK_URL:-}" start

name="${PREFIX}-$(date -u +%Y%m%dT%H%M%SZ).dump.enc"
started=$SECONDS
log "dumping to $name"
# streamed: the unencrypted dump never touches the disk
pg_dump --format=custom --compress=6 --no-password --dbname="$db_url" | openssl_enc -salt -out "$work/$name"

# proves the file decrypts with this passphrase and is a readable archive before anything old is deleted
tables=$(openssl_enc -d -in "$work/$name" | pg_restore --list | grep -c ' TABLE DATA ' || true)
[[ "$tables" -gt 0 ]] || { log "the new backup has no table data"; failed $LINENO; }
(cd "$work" && sha256sum "$name" > "$name.sha256")

target_put "$work/$name"
target_put "$work/$name.sha256" # last: a dump with its checksum file is a complete upload
size=$(du -h "$work/$name" | cut -f1)
log "uploaded $name ($size, $tables tables, $((SECONDS - started)) s)"

# retention: older than the cutoff, but never one of the newest KEEP_MIN (a broken cron must not empty the bucket).
# Everything is decided from ONE listing, which must show the backup just uploaded (else the listing is wrong: delete
# nothing).
if [[ "$RETENTION_DAYS" -gt 0 ]]; then
  cutoff="${PREFIX}-$(date -u -d "@$(( $(date +%s) - RETENTION_DAYS * 86400 ))" +%Y%m%dT%H%M%SZ).dump.enc"
  names="$(target_names)"
  mapfile -t complete < <(complete_backups "$names")
  if [[ ${#complete[@]} -eq 0 || "${complete[-1]}" != "$name" ]]; then
    log "the listing does not show $name as the newest complete backup: nothing deleted this time"
  else
    removable=$(( ${#complete[@]} - KEEP_MIN ))
    for old in "${complete[@]}"; do
      [[ $removable -gt 0 && "$old" < "$cutoff" ]] || break
      target_rm "$old.sha256"
      target_rm "$old"
      removable=$((removable - 1))
      log "deleted $old (older than $RETENTION_DAYS days)"
    done
    # a dump whose checksum never arrived (an upload cut off) is not a backup: removed once past the cutoff too
    while read -r partial; do
      [[ -n "$partial" && "$partial" < "$cutoff" ]] || continue
      if ! grep -qxF "$partial.sha256" <<<"$names"; then target_rm "$partial"; log "deleted the incomplete upload $partial"; fi
    done < <(grep -E "$NAME_RE" <<<"$names" || true)
  fi
fi

ping_url "${BACKUP_HEALTHCHECK_URL:-}"
log "done"
