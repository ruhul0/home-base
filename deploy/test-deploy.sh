#!/usr/bin/env bash
# Tests server-deploy.sh, including its rollback, using a temporary repository and stand-ins for
# docker, curl and sleep. It never touches a real server or container.
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/server-deploy.sh"
workspace="$(mktemp -d)"
trap 'rm -rf "$workspace"' EXIT
failures=0

check() {
  if [ "$2" = "$3" ]; then
    echo "PASS $1"
  else
    echo "FAIL $1: expected '$3', got '$2'"
    failures=$((failures + 1))
  fi
}

export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
git init -q --bare -b main "$workspace/origin.git"
git clone -q "$workspace/origin.git" "$workspace/source" 2>/dev/null
git -C "$workspace/source" checkout -q -b main
echo one > "$workspace/source/version"
git -C "$workspace/source" add version
git -C "$workspace/source" commit -q -m one
git -C "$workspace/source" push -q origin main
first="$(git -C "$workspace/source" rev-parse HEAD)"

export HOME="$workspace/home"
mkdir -p "$HOME"
git clone -q -b main "$workspace/origin.git" "$HOME/chrome-home"
echo 'SECRET=keep' > "$HOME/chrome-home/.env"

bin="$workspace/bin"
mkdir -p "$bin"
cat > "$bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$HOME/docker.log"
case "$*" in
  *mysqldump*) [ -f "$HOME/backup-fails" ] && exit 1; echo 'CREATE TABLE test;' ;;
  pull*) [ -f "$HOME/pull-fails" ] && exit 1 ;;
esac
exit 0
EOF
cat > "$bin/curl" <<'EOF'
#!/usr/bin/env bash
if [ -f "$HOME/unhealthy" ] && [ "$(cat "$HOME/chrome-home/version")" = "bad" ]; then exit 22; fi
exit 0
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$bin/sleep"
# macOS has no flock, and these tests run one deploy at a time.
printf '#!/usr/bin/env bash\nexit 0\n' > "$bin/flock"
chmod +x "$bin/docker" "$bin/curl" "$bin/sleep" "$bin/flock"
export PATH="$bin:$PATH"

publish() {
  echo "$1" > "$workspace/source/version"
  git -C "$workspace/source" commit -qam "$1"
  git -C "$workspace/source" push -q origin main
  git -C "$workspace/source" rev-parse HEAD
}

good="$(publish good)"
outcome=0
bash "$script" >/dev/null 2>&1 || outcome=$?
check "a healthy deploy succeeds" "$outcome" 0
check "a healthy deploy moves to the new commit" "$(git -C "$HOME/chrome-home" rev-parse HEAD)" "$good"
check "a deploy backs up the database first" "$(ls "$HOME"/chrome-home/backups/*.sql | wc -l | tr -d ' ')" 1
check "a deploy keeps the server's secrets" "$(cat "$HOME/chrome-home/.env")" "SECRET=keep"
check "a deploy pulls that commit's image" "$(grep -c "docker pull -q ghcr.io/ruhul0/home-base:$good" "$HOME/docker.log")" 1
check "a deploy runs that image" "$(grep -c "docker tag ghcr.io/ruhul0/home-base:$good chrome-home-app:latest" "$HOME/docker.log")" 1
check "a deploy keeps the old image for rollback" "$(grep -c "docker tag chrome-home-app:latest chrome-home-app:rollback" "$HOME/docker.log")" 1

touch "$HOME/unhealthy"
publish bad >/dev/null
outcome=0
bash "$script" >/dev/null 2>&1 || outcome=$?
check "an unhealthy deploy reports failure" "$outcome" 1
check "an unhealthy deploy rolls back the code" "$(git -C "$HOME/chrome-home" rev-parse HEAD)" "$good"
check "a rollback restores the old files" "$(cat "$HOME/chrome-home/version")" "good"
check "a rollback keeps the server's secrets" "$(cat "$HOME/chrome-home/.env")" "SECRET=keep"
check "a rollback restarts the app" "$(tail -1 "$HOME/docker.log")" "docker compose up -d --no-build app"
check "a rollback restores the old image" "$(tail -2 "$HOME/docker.log" | head -1)" "docker tag chrome-home-app:rollback chrome-home-app:latest"
rm "$HOME/unhealthy"

touch "$HOME/pull-fails"
backups_before="$(ls "$HOME"/chrome-home/backups/*.sql | wc -l | tr -d ' ')"
publish missing-image >/dev/null
outcome=0
bash "$script" >/dev/null 2>&1 || outcome=$?
check "a missing image stops the deploy" "$outcome" 1
check "a missing image leaves the code alone" "$(git -C "$HOME/chrome-home" rev-parse HEAD)" "$good"
check "a missing image doesn't touch the database" "$(ls "$HOME"/chrome-home/backups/*.sql | wc -l | tr -d ' ')" "$backups_before"
rm "$HOME/pull-fails"

named="$(publish named)"
publish later >/dev/null
outcome=0
SSH_ORIGINAL_COMMAND="$named" bash "$script" >/dev/null 2>&1 || outcome=$?
check "CI can name the commit to deploy" "$outcome $(git -C "$HOME/chrome-home" rev-parse HEAD)" "0 $named"
outcome=0
SSH_ORIGINAL_COMMAND='main; touch hacked' bash "$script" >/dev/null 2>&1 || outcome=$?
check "anything but a commit is refused" "$outcome $(git -C "$HOME/chrome-home" rev-parse HEAD)" "1 $named"
good="$named"

newest="$(publish fine)"
touch "$HOME/backup-fails"
outcome=0
bash "$script" >/dev/null 2>&1 || outcome=$?
check "a failed backup stops the deploy" "$outcome" 1
check "a failed backup leaves the code alone" "$(git -C "$HOME/chrome-home" rev-parse HEAD)" "$good"
rm "$HOME/backup-fails"

rm -f "$HOME"/chrome-home/backups/*
for number in $(seq 1 20); do touch "$HOME/chrome-home/backups/chrome_home-2020-01-$(printf %02d "$number")-000000.sql"; done
bash "$script" >/dev/null 2>&1
check "only the newest backups are kept" "$(ls "$HOME"/chrome-home/backups/*.sql | wc -l | tr -d ' ')" 14
check "the deploy finished on the newest commit" "$(git -C "$HOME/chrome-home" rev-parse HEAD)" "$newest"
check "nothing is ever built on the server" "$(grep -c -e '--build' -e 'docker build' "$HOME/docker.log" || true)" 0
test "$first" != "$newest"

if [ "$failures" -gt 0 ]; then
  echo "$failures FAILED"
  exit 1
fi
echo "ALL PASSED"
