#!/usr/bin/env bash
# Runs the image GitHub Actions built and tested, and rolls back if the app doesn't become healthy.
# Nothing is built here. The CI deploy key can only run an installed copy of this script,
# ~/chrome-home-deploy.sh, so reinstall that copy by hand after changing this file.
#
# CI sends the image as a gzipped `docker save` on standard input, and names its commit, which
# arrives in SSH_ORIGINAL_COMMAND. To run it by hand: bash server-deploy.sh <commit> < image.tar.gz
set -euo pipefail

APP_DIR="$HOME/chrome-home"
HEALTH_URL="http://127.0.0.1:13100/api/health"
# Compose names this project's app image this, so restarts from the setup scripts keep using it.
APP_IMAGE="chrome-home-app"
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
next="${SSH_ORIGINAL_COMMAND:-${1:-}}"
if ! printf '%s' "$next" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "That isn't a commit to deploy." >&2
  exit 1
fi
if [ -t 0 ]; then
  echo "This needs the image on standard input." >&2
  exit 1
fi
echo "Deploying ${next:0:7} (was ${previous:0:7})"

# This comes first, so a bad image leaves the site exactly as it was. Loading it only adds a tag
# named after the commit, so the running image isn't affected yet.
if ! gunzip -c | docker load -q >/dev/null || ! docker image inspect "$APP_IMAGE:$next" >/dev/null 2>&1; then
  echo "The image for ${next:0:7} couldn't be loaded, so nothing changed." >&2
  exit 1
fi

mkdir -p backups
backup="backups/chrome_home-$(date +%F-%H%M%S).sql"
docker compose exec -T db sh -c 'mysqldump --no-tablespaces -uroot -p"$MYSQL_ROOT_PASSWORD" chrome_home' 2>/dev/null > "$backup"
test -s "$backup"
ls -1t backups/chrome_home-*.sql | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f

docker tag "$APP_IMAGE:latest" "$APP_IMAGE:rollback"
git reset -q --hard "$next"
docker tag "$APP_IMAGE:$next" "$APP_IMAGE:latest"
docker compose up -d --no-build app

if wait_until_healthy; then
  docker rmi "$APP_IMAGE:$next" >/dev/null
  docker image prune -f --filter "label=com.docker.compose.project=chrome-home" >/dev/null
  echo "Deployed ${next:0:7} and it's healthy."
  exit 0
fi

echo "The new version isn't healthy, so rolling back to ${previous:0:7}." >&2
docker compose logs app --tail 20 >&2 || true
git reset -q --hard "$previous"
docker tag "$APP_IMAGE:rollback" "$APP_IMAGE:latest"
docker compose up -d --no-build app
wait_until_healthy && echo "Rollback finished and the app is healthy." >&2
exit 1
