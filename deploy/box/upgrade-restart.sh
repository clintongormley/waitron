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
[ -x "$node" ] || refuse 'retained runtime unavailable; retain the copy and runtime' 78
cd "$box"
if command -v aa-enabled >/dev/null 2>&1 && aa-enabled && apparmor_parser -r /etc/apparmor.d/waitron-print-agent; then
  export WAITRON_PRINT_AGENT_APPARMOR=waitron-print-agent
else
  export WAITRON_PRINT_AGENT_APPARMOR=docker-default
fi
docker compose up -d --pull never
"$node" --input-type=module -e 'const {restoreRestartPolicies}=await import(process.argv[1]);await restoreRestartPolicies(process.argv[2]);' "$host/box/upgrades/host.mjs" "$box"
docker compose up -d --pull never
