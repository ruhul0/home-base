#!/usr/bin/env bash
# Tests a full backup cycle with Docker: dump, encrypt, upload to a fake R2, decrypt, restore to a
# second database and compare. It uses only throwaway containers and test values.
set -euo pipefail

cd "$(dirname "$0")/.."
STACK="server/test/backup-stack.yml"
ENV_FIXTURE="server/test/backup-test.env"
failures=0

check() {
  if [ "$2" = "$3" ]; then
    echo "PASS $1"
  else
    echo "FAIL $1: expected '$3', got '$2'"
    failures=$((failures + 1))
  fi
}

cleanup() {
  docker compose -f "$STACK" down -v >/dev/null 2>&1 || true
  rm -f "$ENV_FIXTURE"
}
trap cleanup EXIT

echo 'TEST_SETTING=settings-sentinel' > "$ENV_FIXTURE"
chmod 644 "$ENV_FIXTURE"

# Saves uploads to disk, and refuses any request that isn't signed for S3.
export FAKE_R2_SCRIPT='
const http = require("http"), fs = require("fs"), path = require("path");
http.createServer((req, res) => {
  if (!(req.headers.authorization || "").startsWith("AWS4-HMAC-SHA256 Credential=test-key-id/")) { res.statusCode = 403; return res.end(); }
  const file = path.join("/data", req.url);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  req.pipe(fs.createWriteStream(file)).on("finish", () => res.end());
}).listen(9000);
'

export BACKUP_AGE_RECIPIENT=""
docker compose -f "$STACK" build --quiet backup
keys="$(docker compose -f "$STACK" run --rm --no-deps -T --entrypoint age-keygen backup 2>/dev/null)"
BACKUP_AGE_RECIPIENT="$(printf '%s\n' "$keys" | sed -n 's/^# public key: //p')"
export BACKUP_AGE_RECIPIENT
private_key="$(printf '%s\n' "$keys" | grep '^AGE-SECRET-KEY-')"
check "a key pair is created" "$([ -n "$private_key" ] && [ -n "$BACKUP_AGE_RECIPIENT" ] && echo yes)" yes

docker compose -f "$STACK" up -d --wait db restored-db fake-r2 >/dev/null 2>&1
sleep 2

sql() { docker compose -f "$STACK" exec -T "$1" mysql -N -uroot -pthrowaway-root test -e "$2" 2>/dev/null; }
sql db "CREATE TABLE sample (id INT PRIMARY KEY, note VARCHAR(100)); INSERT INTO sample VALUES (1, 'database-sentinel');"

in_backup() { docker compose -f "$STACK" run --rm --no-deps -T --entrypoint bash backup -c "$1"; }

outcome=0
docker compose -f "$STACK" run --rm -T backup once >/dev/null 2>&1 || outcome=$?
check "a backup runs" "$outcome" 0
check "the status records success" "$(sql db 'SELECT last_error, last_success_at IS NOT NULL, last_bytes > 0 FROM backup_status' | tr '\t' ',')" ",1,1"

database_object="$(in_backup 'ls /r2/test-bucket/database | head -1')"
settings_object="$(in_backup 'ls /r2/test-bucket/settings | head -1')"
check "the database is uploaded" "$([ -n "$database_object" ] && echo yes)" yes
check "the settings are uploaded" "$([ -n "$settings_object" ] && echo yes)" yes
check "uploads are not readable without the key" \
  "$(in_backup "cat /r2/test-bucket/database/$database_object /r2/test-bucket/settings/$settings_object | grep -ac -e database-sentinel -e settings-sentinel -e 'CREATE TABLE' || true")" 0
check "uploads are age files" "$(in_backup "head -c 21 /r2/test-bucket/database/$database_object")" "age-encryption.org/v1"

decrypt() { in_backup "printf '%s\n' '$private_key' > /tmp/key && age -d -i /tmp/key /r2/test-bucket/$1"; }
check "the settings decrypt with the key" "$(decrypt "settings/$settings_object")" "TEST_SETTING=settings-sentinel"

decrypt "database/$database_object" | gunzip | docker compose -f "$STACK" exec -T restored-db mysql -uroot -pthrowaway-root test 2>/dev/null
check "a restored database matches" "$(sql restored-db 'SELECT note FROM sample WHERE id = 1')" "database-sentinel"

wrong_key="$(docker compose -f "$STACK" run --rm --no-deps -T --entrypoint age-keygen backup 2>/dev/null | grep '^AGE-SECRET-KEY-')"
outcome=0
in_backup "printf '%s\n' '$wrong_key' > /tmp/key && age -d -i /tmp/key /r2/test-bucket/settings/$settings_object" >/dev/null 2>&1 || outcome=$?
check "a different key can't decrypt" "$([ "$outcome" -ne 0 ] && echo refused)" refused

outcome=0
R2_ENDPOINT="http://fake-r2:9999" docker compose -f "$STACK" run --rm -T backup once >/dev/null 2>&1 || outcome=$?
check "a failed upload reports failure" "$([ "$outcome" -ne 0 ] && echo failed)" failed
check "the status records the failed upload" "$(sql db 'SELECT last_error FROM backup_status')" "The upload to R2 failed."
check "a failure keeps the last success time" "$(sql db 'SELECT last_success_at IS NOT NULL FROM backup_status')" 1

if [ "$failures" -gt 0 ]; then
  echo "$failures FAILED"
  exit 1
fi
echo "ALL PASSED"
