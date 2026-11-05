#!/usr/bin/env bash
# Turns on automatic deploys. Run once on your Mac, from anywhere. It:
#   1. creates an SSH key on this Mac, used only by GitHub Actions
#   2. adds it to the server's authorized_keys, where it can only run the deploy script
#   3. stores the private key in the repo's GitHub secrets and deletes it from this Mac
#   4. connects ~/chrome-home on the server to the GitHub repo
#   5. sets DEPLOY_ENABLED so the workflow's deploy job starts running
#
# To turn it off later, delete the "home-base-github-actions-deploy" line from
# ~/.ssh/authorized_keys on the server and run: gh variable delete DEPLOY_ENABLED -R ruhul0/home-base
set -euo pipefail

REPO=ruhul0/home-base
SERVER_ALIAS=fitx
SERVER_ADDRESS=76.13.240.163
KEY_COMMENT=home-base-github-actions-deploy

key_dir="$(mktemp -d)"
trap 'rm -rf "$key_dir"' EXIT
ssh-keygen -q -t ed25519 -N '' -C "$KEY_COMMENT" -f "$key_dir/key"
public_key="$(cat "$key_dir/key.pub")"

ssh "$SERVER_ALIAS" bash -s -- "$public_key" "$REPO" "$KEY_COMMENT" <<'REMOTE'
set -euo pipefail
public_key="$1"; repo="$2"; comment="$3"
umask 077

if grep -q "$comment" ~/.ssh/authorized_keys; then
  echo "A deploy key is already installed, so nothing was changed." >&2
  exit 1
fi
cp ~/.ssh/authorized_keys ~/.ssh/authorized_keys.bak."$(date +%F-%H%M)"
install -m 700 ~/chrome-home/deploy/server-deploy.sh ~/chrome-home-deploy.sh
printf 'restrict,command="%s/chrome-home-deploy.sh" %s\n' "$HOME" "$public_key" >> ~/.ssh/authorized_keys

cd ~/chrome-home
if [ ! -d .git ]; then
  git init -q -b main
  git remote add origin "https://github.com/$repo.git"
fi
git fetch -q origin main
git reset -q --mixed origin/main
echo "Server is ready."
REMOTE

gh secret set DEPLOY_SSH_KEY -R "$REPO" < "$key_dir/key"
gh secret set DEPLOY_TARGET -R "$REPO" --body "ruhul@$SERVER_ADDRESS"
ssh-keyscan -t ed25519 "$SERVER_ADDRESS" 2>/dev/null | gh secret set DEPLOY_KNOWN_HOSTS -R "$REPO"
gh variable set DEPLOY_ENABLED -R "$REPO" --body true

echo "Automatic deploys are on. Every push to main that passes the tests now deploys."
