#!/usr/bin/env bash
# Saves the GitHub OAuth app's details to .env and restarts the app. Run without sudo.
# The secret isn't shown as you type it.
set -euo pipefail

cd "$(dirname "$0")/.."

read -rp "GitHub Client ID: " client_id
read -rsp "GitHub Client secret: " client_secret
echo

if [ -z "$client_id" ] || [ -z "$client_secret" ]; then
  echo "Nothing was changed: both values are needed." >&2
  exit 1
fi

umask 077
grep -vE '^GITHUB_CLIENT_(ID|SECRET)=' .env > .env.new || true
printf 'GITHUB_CLIENT_ID=%s\nGITHUB_CLIENT_SECRET=%s\n' "$client_id" "$client_secret" >> .env.new
mv .env.new .env

docker compose up -d app
echo "Saved. GitHub sign-in is ready at https://chrome.ruhul0.com"
