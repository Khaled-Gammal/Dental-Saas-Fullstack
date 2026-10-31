# Phase 1B: nightly encrypted database backups (docs/ops/backups.md).
# pg_dump must be the same major version as the server or newer: keep this in step with the postgres image (16).
FROM postgres:16-alpine
RUN apk add --no-cache bash aws-cli curl openssl tini tzdata
COPY backup-lib.sh backup.sh restore-check.sh entrypoint.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore-check.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["cron"]
