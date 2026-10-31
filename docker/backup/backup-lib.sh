# Phase 1B: helpers shared by backup.sh and restore-check.sh (sourced, not run).
# A target is either an S3-compatible bucket (s3://bucket/path: Cloudflare R2, AWS S3, Backblaze B2, MinIO) or a local
# directory (/backups or file:///backups, for trying it out; a backup on the same server is not a backup).

PREFIX="${BACKUP_NAME_PREFIX:-dental}"
NAME_RE="^${PREFIX}-[0-9]{8}T[0-9]{6}Z\.dump\.enc$"
# R2 and some other S3-compatible services reject the checksum headers newer AWS CLIs send by default
export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}"
export AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}"

log() { printf '%s %s: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${SCRIPT_NAME:-backup}" "$*" >&2; }

is_s3() { [[ "$BACKUP_TARGET" == s3://* ]]; }
local_dir() { printf '%s' "${BACKUP_TARGET#file://}"; }
s3() { aws ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"} s3 "$@"; }

# target_put <local file>: uploads under its own name
target_put() {
  if is_s3; then s3 cp --only-show-errors "$1" "${BACKUP_TARGET%/}/$(basename "$1")"
  else mkdir -p "$(local_dir)" && cp "$1" "$(local_dir)/"; fi
}
# target_get <name> <local file>
target_get() {
  if is_s3; then s3 cp --only-show-errors "${BACKUP_TARGET%/}/$1" "$2"
  else cp "$(local_dir)/$1" "$2"; fi
}
target_rm() {
  if is_s3; then s3 rm --only-show-errors "${BACKUP_TARGET%/}/$1"
  else rm -f "$(local_dir)/$1"; fi
}
# every file name in the target, one per line. Fails on a listing error: a failed listing must never look like an
# empty bucket (retention decides what to delete from it).
target_names() {
  if is_s3; then
    local out rc=0
    out="$(s3 ls "${BACKUP_TARGET%/}/")" || rc=$?
    # aws exits 1 for an empty prefix (the first run); 2 and 25x are real errors (arguments, credentials, the service)
    [[ $rc -eq 0 || ( $rc -eq 1 && -z "$out" ) ]] || { log "listing $BACKUP_TARGET failed (aws exit $rc)"; return 1; }
    awk '$1 != "PRE" {print $4}' <<<"$out"
  else
    if [[ -d "$(local_dir)" ]]; then ls -1 "$(local_dir)"; fi
  fi
}
# complete_backups <names>: the dumps whose checksum file is also listed (its upload finished), oldest first
complete_backups() {
  { grep -E "$NAME_RE" <<<"$1" || true; } | sort | while read -r n; do
    if grep -qxF "$n.sha256" <<<"$1"; then printf '%s\n' "$n"; fi
  done
}

# ping <url> [start|fail]: dead man's switch (healthchecks.io, Better Stack heartbeats, Uptime Kuma push).
# Never fails the caller.
ping_url() {
  [[ -n "${1:-}" ]] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${1%/}${2:+/$2}" || log "could not reach the healthcheck URL"
}

# the same connection URL pointing at another database: postgres://u:p@h:5432/x?sslmode=require -> .../<db>?sslmode=require
with_database() {
  local url="$1" db="$2" base query=""
  [[ "$url" == *\?* ]] && query="?${url#*\?}"
  base="${url%%\?*}"
  if [[ "$base" =~ ^(postgres(ql)?://[^/]*)(/.*)?$ ]]; then printf '%s/%s%s' "${BASH_REMATCH[1]}" "$db" "$query"
  else return 1; fi
}

# A password inside a connection URL would show in `ps` for anyone on the host: split_password moves it to PGPASSWORD
# (libpq reads it) and leaves the URL without it in PG_URL. Called directly, not in $(...), so the export sticks.
#   postgres://u:p%40ss@h/db -> PG_URL=postgres://u@h/db, PGPASSWORD=p@ss
split_password() {
  PG_URL="$1"
  if [[ "$1" =~ ^(postgres(ql)?://)([^:@/]*):([^@/]*)@(.*)$ ]]; then
    local pw="${BASH_REMATCH[4]}"
    PGPASSWORD="$(printf '%b' "${pw//%/\\x}")"
    export PGPASSWORD
    PG_URL="${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}"
  fi
}

openssl_enc() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass env:BACKUP_PASSPHRASE "$@"; }
