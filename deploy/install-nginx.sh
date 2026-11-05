#!/usr/bin/env bash
# Adds chrome.ruhul0.com to nginx and gets its HTTPS certificate. Run once with sudo.
# Other sites' config files are not edited. If the nginx test fails, the new site is removed again.
set -euo pipefail

DOMAIN=chrome.ruhul0.com
SOURCE="$(cd "$(dirname "$0")" && pwd)/$DOMAIN.nginx"
AVAILABLE="/etc/nginx/sites-available/$DOMAIN"
ENABLED="/etc/nginx/sites-enabled/$DOMAIN"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo." >&2
  exit 1
fi

if [ -e "$AVAILABLE" ] || [ -e "$ENABLED" ]; then
  echo "$DOMAIN is already in nginx, so nothing was changed." >&2
  exit 1
fi

cp "$SOURCE" "$AVAILABLE"
ln -s "$AVAILABLE" "$ENABLED"

if ! nginx -t; then
  rm -f "$ENABLED" "$AVAILABLE"
  echo "The nginx test failed, so the new site was removed and nginx was not reloaded." >&2
  exit 1
fi

systemctl reload nginx
certbot --nginx --redirect -d "$DOMAIN"
echo "Done: https://$DOMAIN"
