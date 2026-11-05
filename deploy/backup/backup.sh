#!/usr/bin/env bash
# Encrypts the database and the server's .env, then uploads them to Cloudflare R2.
# Everything is encrypted to a public key before leaving this container. The private key isn't
# on the server, so neither the server nor R2 can read a backup.
#
#   backup.sh         run now, then once every BACKUP_INTERVAL_HOURS
#   backup.sh once    run once and exit with its result
set -uo pipefail

ENV_FILE="${BACKUP_ENV_FILE:-/run/home-base.env}"
INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"

log() { echo "$(date -u +%FT%TZ) $*"; }

configured() {
  [ -n "${R2_ACCOUNT_ID:-}" ] && [ -n "${R2_BUCKET:-}" ] && [ -n "${R2_ACCESS_KEY_ID:-}" ] &&
    [ -n "${R2_SECRET_ACCESS_KEY:-}" ] && [ -n "${BACKUP_AGE_RECIPIENT:-}" ]
}

run_sql() {
  MYSQL_PWD="$DB_PASSWORD" mysql -h "$DB_HOST" -u "$DB_USER" "$DB_NAME" -e "$1"
}

# Status goes in the database so the admin panel can show it. A silent failure is the real risk.
record_status() {
  local error="$1"
  run_sql "CREATE TABLE IF NOT EXISTS backup_status (
             id INT PRIMARY KEY, last_success_at DATETIME NULL, last_attempt_at DATETIME NOT NULL, last_error VARCHAR(200) NOT NULL DEFAULT '', last_bytes BIGINT NOT NULL DEFAULT 0
           ); $2" || log "Couldn't record the backup status."
  [ -z "$error" ] || log "Backup failed: $error"
}

record_success() {
  record_status "" "INSERT INTO backup_status (id, last_success_at, last_attempt_at, last_error, last_bytes)
    VALUES (1, UTC_TIMESTAMP(), UTC_TIMESTAMP(), '', $1)
    ON DUPLICATE KEY UPDATE last_success_at = VALUES(last_success_at), last_attempt_at = VALUES(last_attempt_at), last_error = '', last_bytes = VALUES(last_bytes);"
}

record_failure() {
  record_status "$1" "INSERT INTO backup_status (id, last_attempt_at, last_error)
    VALUES (1, UTC_TIMESTAMP(), '$1')
    ON DUPLICATE KEY UPDATE last_attempt_at = VALUES(last_attempt_at), last_error = VALUES(last_error);"
}

upload() {
  local file="$1" key="$2"
  local endpoint="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"
  # Credentials go through standard input, so they don't appear in the process list.
  printf 'user = "%s:%s"\n' "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY" |
    curl --config - --fail --silent --show-error --max-time 600 --retry 3 --retry-delay 10 \
      --aws-sigv4 "aws:amz:auto:s3" --upload-file "$file" "$endpoint/$R2_BUCKET/$key" -o /dev/null
}

backup_once() {
  local work stamp database_file env_file bytes
  work="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$work'" RETURN
  stamp="$(date -u +%Y-%m-%d-%H%M%S)"
  database_file="$work/chrome_home-$stamp.sql.gz.age"
  env_file="$work/env-$stamp.age"

  if ! MYSQL_PWD="$DB_PASSWORD" mysqldump --no-tablespaces --single-transaction --set-gtid-purged=OFF -h "$DB_HOST" -u "$DB_USER" "$DB_NAME" |
    gzip -9 | age -r "$BACKUP_AGE_RECIPIENT" -o "$database_file"; then
    record_failure "The database dump or encryption failed."
    return 1
  fi

  if ! age -r "$BACKUP_AGE_RECIPIENT" -o "$env_file" "$ENV_FILE"; then
    record_failure "The settings file could not be encrypted."
    return 1
  fi

  if ! upload "$database_file" "database/$(basename "$database_file")" || ! upload "$env_file" "settings/$(basename "$env_file")"; then
    record_failure "The upload to R2 failed."
    return 1
  fi

  bytes="$(wc -c < "$database_file" | tr -d ' ')"
  record_success "$bytes"
  log "Backup $stamp uploaded ($bytes bytes)."
}

if ! configured; then
  log "R2 backups aren't configured, so nothing will run. Use deploy/set-r2-backup.sh."
  [ "${1:-}" = "once" ] && exit 1
  exec sleep infinity
fi

if [ "${1:-}" = "once" ]; then
  backup_once
  exit $?
fi

while true; do
  backup_once || true
  sleep "$((INTERVAL_HOURS * 3600))"
done
