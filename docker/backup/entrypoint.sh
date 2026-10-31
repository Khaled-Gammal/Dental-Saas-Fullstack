#!/bin/sh
# Phase 1B: the backup container.
#   cron (default)  nightly backup at BACKUP_CRON (default 02:15, in TZ)
#   once            one backup now, then exit
#   restore-check   restore the latest backup into RESTORE_ADMIN_URL's server, check it, drop it
set -eu
case "${1:-cron}" in
  once) exec /usr/local/bin/backup.sh ;;
  restore-check) exec /usr/local/bin/restore-check.sh ;;
  cron)
    # busybox crond does not pass the container's environment to its jobs: hand it over in a root-only file
    # (/run is a tmpfs in docker-compose.backup.yml, so the passphrase is not written to the disk)
    umask 077
    export -p > /run/backup.env
    echo "${BACKUP_CRON:-15 2 * * *} . /run/backup.env; /usr/local/bin/backup.sh > /proc/1/fd/1 2>&1" > /etc/crontabs/root
    echo "backup: scheduled \"${BACKUP_CRON:-15 2 * * *}\" (TZ=${TZ:-UTC}) to ${BACKUP_TARGET:-<BACKUP_TARGET not set>}"
    exec crond -f -d 8 ;; # -d: crond's own messages (a bad schedule) to stderr, i.e. the container log
  *) exec "$@" ;;
esac
