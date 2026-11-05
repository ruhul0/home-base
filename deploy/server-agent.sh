#!/usr/bin/env bash
# Reports this server's disk, memory, load, uptime and container counts to Home Base once a minute.
# It sends only those numbers and the names of unhealthy containers. It never needs root.
#
# Install:  bash server-agent.sh install https://chrome.ruhul0.com <token from the Servers panel>
# Remove:   bash server-agent.sh uninstall
set -euo pipefail

CONFIG="$HOME/.home-base-agent"
INSTALLED="$HOME/.home-base-agent.sh"
CRON_MARK="home-base-agent"

json_names() {
  local first=1 name
  printf '['
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    [ "$first" = 1 ] || printf ','
    first=0
    printf '"%s"' "$(printf '%s' "$name" | tr -cd 'A-Za-z0-9_.-')"
  done
  printf ']'
}

report() {
  # shellcheck disable=SC1090
  . "$CONFIG"

  local disk memory load cores uptime running=0 total=0 unhealthy='[]'
  disk="$(df -P / | awk 'NR==2 { gsub("%", "", $5); print $5 }')"
  memory="$(awk '/^MemTotal:/ { t=$2 } /^MemAvailable:/ { a=$2 } END { if (t > 0) printf "%.1f", (t - a) / t * 100; else print 0 }' /proc/meminfo)"
  load="$(cut -d' ' -f1 /proc/loadavg)"
  cores="$(nproc)"
  uptime="$(cut -d. -f1 /proc/uptime)"

  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    running="$(docker ps -q | wc -l | tr -d ' ')"
    total="$(docker ps -aq | wc -l | tr -d ' ')"
    unhealthy="$(docker ps --filter health=unhealthy --format '{{.Names}}' | head -20 | json_names)"
  fi

  curl -fsS -m 15 -o /dev/null -X POST "$HOME_BASE_URL/api/server-report" \
    -H "Authorization: Bearer $HOME_BASE_TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"diskPercent\":$disk,\"memoryPercent\":$memory,\"load\":$load,\"cores\":$cores,\"uptimeSeconds\":$uptime,\"containersRunning\":$running,\"containersTotal\":$total,\"unhealthy\":$unhealthy}"
}

install_agent() {
  local url="${1:-}" token="${2:-}"
  if [ -z "$url" ] || ! printf '%s' "$token" | grep -Eq '^[0-9a-f]{64}$'; then
    echo "Usage: bash server-agent.sh install <url> <64-character token>" >&2
    exit 1
  fi
  umask 077
  printf 'HOME_BASE_URL=%q\nHOME_BASE_TOKEN=%q\n' "${url%/}" "$token" > "$CONFIG"
  cp "${BASH_SOURCE[0]}" "$INSTALLED"
  chmod 700 "$INSTALLED"

  report
  { crontab -l 2>/dev/null | grep -v "$CRON_MARK" || true; echo "* * * * * bash $INSTALLED report >/dev/null 2>&1 # $CRON_MARK"; } | crontab -
  echo "Installed. This server should appear as online in the Servers panel."
}

uninstall_agent() {
  { crontab -l 2>/dev/null | grep -v "$CRON_MARK" || true; } | crontab -
  rm -f "$CONFIG" "$INSTALLED"
  echo "Removed. You can now delete this server from the Servers panel."
}

case "${1:-report}" in
  install) install_agent "${2:-}" "${3:-}" ;;
  uninstall) uninstall_agent ;;
  report) report ;;
  *) echo "Usage: bash server-agent.sh install <url> <token> | uninstall | report" >&2; exit 1 ;;
esac
