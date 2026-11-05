#!/usr/bin/env bash
# Turns on encrypted backups to Cloudflare R2. Run on the server, without sudo.
# The first run creates an encryption key and shows its private half once. It's never saved on the
# server, so if you lose it, your backups can't be read.
set -euo pipefail

cd "$(dirname "$0")/.."

read -rp "Cloudflare Account ID: " account_id
read -rp "R2 bucket name: " bucket
read -rp "R2 Access Key ID: " access_key
read -rsp "R2 Secret Access Key: " secret_key
echo

if [ -z "$account_id" ] || [ -z "$bucket" ] || [ -z "$access_key" ] || [ -z "$secret_key" ]; then
  echo "Nothing was changed: all four values are needed." >&2
  exit 1
fi

docker compose build backup

recipient="$(grep -E '^BACKUP_AGE_RECIPIENT=.' .env | head -1 | cut -d= -f2- || true)"
if [ -n "$recipient" ]; then
  echo "Keeping the existing encryption key."
else
  keys="$(docker compose run --rm --no-deps -T --entrypoint age-keygen backup 2>/dev/null)"
  recipient="$(printf '%s\n' "$keys" | sed -n 's/^# public key: //p')"
  private_key="$(printf '%s\n' "$keys" | grep '^AGE-SECRET-KEY-')"
  if [ -z "$recipient" ] || [ -z "$private_key" ]; then
    echo "Nothing was changed: the encryption key couldn't be created." >&2
    exit 1
  fi
  echo
  echo "================ SAVE THIS PRIVATE KEY NOW ================"
  echo "$private_key"
  echo "==========================================================="
  echo "Store it in your password manager. It's the only way to read your backups,"
  echo "and it won't be shown again or saved on this server."
  echo
  read -rp "Type SAVED once you've stored it: " confirmation
  if [ "$confirmation" != "SAVED" ]; then
    echo "Nothing was changed. Run this again when you're ready." >&2
    exit 1
  fi
  clear || true
fi

umask 077
grep -vE '^(R2_ACCOUNT_ID|R2_BUCKET|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|BACKUP_AGE_RECIPIENT|BACKUP_UID)=' .env > .env.new || true
{
  printf 'R2_ACCOUNT_ID=%s\n' "$account_id"
  printf 'R2_BUCKET=%s\n' "$bucket"
  printf 'R2_ACCESS_KEY_ID=%s\n' "$access_key"
  printf 'R2_SECRET_ACCESS_KEY=%s\n' "$secret_key"
  printf 'BACKUP_AGE_RECIPIENT=%s\n' "$recipient"
  printf 'BACKUP_UID=%s\n' "$(id -u)"
} >> .env.new
mv .env.new .env

docker compose up -d backup
echo "Running a first backup to check everything works..."
if docker compose exec -T backup bash /usr/local/bin/backup.sh once; then
  echo "Backups are on. They run daily, and their status shows in the Servers panel."
else
  echo "The first backup failed. Check the Account ID, bucket and key, then run this again." >&2
  exit 1
fi
