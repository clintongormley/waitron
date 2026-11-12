#!/usr/bin/env bash
set -euo pipefail
box="${WAITRON_DIR:-/opt/waitron}"
host="${WAITRON_HOST_DIR:-/opt/waitron-host}"
node="$host/node-v26.7.0/bin/node"
refuse() { echo "Waitron start held: $1" >&2; exit "$2"; }
pending() {
  [ -d "${box}.upgrades" ] && [ -n "$(find "${box}.upgrades" -mindepth 1 -maxdepth 1 -print -quit)" ]
}
[ "${1:-}" = offline ] || [ "${1:-}" = run ] || refuse 'expected offline or run' 78
exec 9>"${box}.upgrade.lock"
flock -n 9 || refuse 'another host operation is running' 75
if pending; then
  [ -x "$node" ] || refuse 'retained runtime unavailable; retain the copy and runtime' 78
  if [ "$1" = offline ]; then
    "$node" "$host/box/upgrades/cli.mjs" offline-recovery "$box"
  else
    "$node" "$host/box/upgrades/cli.mjs" recover "$box"
    pending && refuse "run waitron.sh status, then choose restore or keep" 78
  fi
fi
[ "$1" = run ] || exit 0
cd "$box"
apparmor_parser -r /etc/apparmor.d/waitron-print-agent
export WAITRON_PRINT_AGENT_APPARMOR=waitron-print-agent
compose_command=(docker compose)
if [ -n "$(docker compose --profile staff-tunnel ps -a -q tunnel)" ]; then
  compose_command+=(--profile staff-tunnel)
fi
"${compose_command[@]}" up -d --pull never --remove-orphans
finish() {
  trap - EXIT
  docker compose --profile staff-tunnel stop --timeout 10
}
trap finish EXIT
trap 'exit 0' TERM INT
ids="$(docker compose ps -q)"
flock -u 9
exec 9>&-
[ -n "$ids" ] || exit 1
# Container exits include the app's deliberate restart after setup, even with exit code zero.
"$node" "$host/box/upgrades/restart.mjs" $ids
exit 1
