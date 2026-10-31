#!/usr/bin/env bash
# Phase 1B: proves the latest backup can be restored. Downloads it, checks its SHA-256, decrypts it, restores it into
# a new database on a SCRATCH server (RESTORE_ADMIN_URL — never the live one), runs sanity queries, drops the database.
# Fails when the newest backup is older than RESTORE_MAX_AGE_HOURS (the nightly job has stopped).
#   docker compose -f docker-compose.yml -f docker-compose.backup.yml --profile restore-check run --rm restore-check
set -Eeuo pipefail
SCRIPT_NAME=restore-check
# shellcheck source=backup-lib.sh
source "$(dirname "$(readlink -f "$0")")/backup-lib.sh"

: "${RESTORE_ADMIN_URL:?set RESTORE_ADMIN_URL (a superuser on a scratch PostgreSQL server)}"
: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE}"
: "${BACKUP_TARGET:?set BACKUP_TARGET}"
MAX_AGE_HOURS="${RESTORE_MAX_AGE_HOURS:-36}"
MIN_TENANTS="${RESTORE_MIN_TENANTS:-1}"
# the roles the dump refers to (owners, grants, policies); created on the scratch server when missing, without login
ROLES="${RESTORE_ROLES:-app_definer app_user app_worker app_platform}"

db="restore_check_$(date -u +%Y%m%d%H%M%S)"
work="$(mktemp -d)"
created=0
split_password "$RESTORE_ADMIN_URL"
admin_url="$PG_URL"
cleanup() {
  if [[ $created -eq 1 ]]; then
    psql -X -q --no-password -d "$admin_url" -c "drop database if exists $db with (force)" >/dev/null 2>&1 || log "could not drop $db: drop it by hand"
  fi
  rm -rf "$work"
}
trap cleanup EXIT
# with errtrace the ERR trap also runs inside the pipeline's subshells: report once, from the script itself
failed() { [[ $BASHPID -eq $$ ]] || exit 1; log "FAILED (line $1)"; ping_url "${RESTORE_HEALTHCHECK_URL:-}" fail; exit 1; }
trap 'failed $LINENO' ERR

names="$(target_names)"
latest=$(complete_backups "$names" | tail -n 1)
[[ -n "$latest" ]] || { log "no complete backup found in $BACKUP_TARGET"; failed $LINENO; }
stamp="${latest#"${PREFIX}"-}"; stamp="${stamp%.dump.enc}"
taken=$(date -u -d "${stamp:0:4}-${stamp:4:2}-${stamp:6:2} ${stamp:9:2}:${stamp:11:2}:${stamp:13:2}" +%s)
age_h=$(( ($(date +%s) - taken) / 3600 ))
log "latest backup: $latest (${age_h} h old)"
[[ $age_h -le $MAX_AGE_HOURS ]] || { log "the newest backup is older than $MAX_AGE_HOURS h: is the nightly backup running?"; failed $LINENO; }

target_get "$latest" "$work/$latest"
target_get "$latest.sha256" "$work/$latest.sha256"
(cd "$work" && sha256sum -c "$latest.sha256" >/dev/null) # busybox and GNU alike

dburl=$(with_database "$admin_url" "$db")
for r in $ROLES; do
  psql -X -q --no-password -v ON_ERROR_STOP=1 -d "$admin_url" \
    -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = '$r') then create role $r nologin; end if; end \$\$" >/dev/null
done
psql -X -q --no-password -v ON_ERROR_STOP=1 -d "$admin_url" -c "create database $db" >/dev/null
created=1
started=$SECONDS
openssl_enc -d -in "$work/$latest" | pg_restore --exit-on-error --no-password --dbname="$dburl"
log "restored into $db in $((SECONDS - started)) s"

q() { psql -X -A -t --no-password -v ON_ERROR_STOP=1 -d "$dburl" -c "$1"; }
tenants=$(q "select count(*) from tenants")
patients=$(q "select count(*) from patients")
appointments=$(q "select count(*) from appointments")
migration=$(q "select max(version) from schema_migrations")
log "tenants=$tenants patients=$patients appointments=$appointments last_migration=$migration"
[[ "$tenants" -ge "$MIN_TENANTS" ]] || { log "expected at least $MIN_TENANTS clinic(s)"; failed $LINENO; }
[[ -n "$migration" ]] || { log "no schema_migrations rows"; failed $LINENO; }

ping_url "${RESTORE_HEALTHCHECK_URL:-}"
log "OK: $latest restores"
