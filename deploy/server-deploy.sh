#!/usr/bin/env bash
# Deploys the latest main branch on the server, and rolls back if the app doesn't become healthy.
# The CI deploy key can only run an installed copy of this script: ~/chrome-home-deploy.sh.
# Reinstall that copy by hand after changing this file.
set -euo pipefail

APP_DIR="$HOME/chrome-home"
HEALTH_URL="http://127.0.0.1:13100/api/health"
KEEP_BACKUPS=14

cd "$APP_DIR"
umask 077

exec 9>"$APP_DIR/.deploy.lock"
flock -n 9 || { echo "Another deploy is already running." >&2; exit 1; }

wait_until_healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

previous="$(git rev-parse HEAD)"
git fetch -q origin main
next="$(git rev-parse origin/main)"
echo "Deploying ${next:0:7} (was ${previous:0:7})"

mkdir -p backups
backup="backups/chrome_home-$(date +%F-%H%M%S).sql"
docker compose exec -T db sh -c 'mysqldump --no-tablespaces -uroot -p"$MYSQL_ROOT_PASSWORD" chrome_home' 2>/dev/null > "$backup"
test -s "$backup"
ls -1t backups/chrome_home-*.sql | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f

git reset -q --hard "$next"
docker compose up -d --build app

if wait_until_healthy; then
  docker image prune -f --filter "label=com.docker.compose.project=chrome-home" >/dev/null
  echo "Deployed ${next:0:7} and it's healthy."
  exit 0
fi

echo "The new version isn't healthy, so rolling back to ${previous:0:7}." >&2
docker compose logs app --tail 20 >&2 || true
git reset -q --hard "$previous"
docker compose up -d --build app
wait_until_healthy && echo "Rollback finished and the app is healthy." >&2
exit 1
