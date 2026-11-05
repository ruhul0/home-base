#!/usr/bin/env bash
# Saves the private GitHub App's details to .env and restarts the app. Run on the server, without sudo.
# The client secret isn't shown as you type it. An encryption key for stored tokens is generated
# once and kept. Changing it later would disconnect every user, who'd then need to reconnect.
set -euo pipefail

cd "$(dirname "$0")/.."

read -rp "GitHub App public link name (the slug, from github.com/apps/<slug>): " app_slug
read -rp "GitHub App Client ID: " client_id
read -rsp "GitHub App Client secret: " client_secret
echo

if [ -z "$app_slug" ] || [ -z "$client_id" ] || [ -z "$client_secret" ]; then
  echo "Nothing was changed: all three values are needed." >&2
  exit 1
fi

encryption_key="$(grep -E '^TOKEN_ENCRYPTION_KEY=.' .env | head -1 | cut -d= -f2- || true)"
if [ -z "$encryption_key" ]; then
  encryption_key="$(openssl rand -base64 32)"
  echo "Generated a new encryption key for stored GitHub tokens."
fi

umask 077
cp .env ".env.bak.$(date +%F-%H%M%S)"
grep -vE '^(GITHUB_APP_(SLUG|CLIENT_ID|CLIENT_SECRET)|TOKEN_ENCRYPTION_KEY)=' .env > .env.new || true
{
  printf 'GITHUB_APP_SLUG=%s\n' "$app_slug"
  printf 'GITHUB_APP_CLIENT_ID=%s\n' "$client_id"
  printf 'GITHUB_APP_CLIENT_SECRET=%s\n' "$client_secret"
  printf 'TOKEN_ENCRYPTION_KEY=%s\n' "$encryption_key"
} >> .env.new
mv .env.new .env

docker compose up -d app
echo "Saved. Reload your Home Base page and use Connect private GitHub on the GitHub panel."
