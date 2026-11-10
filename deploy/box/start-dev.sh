#!/usr/bin/env bash
set -euo pipefail
[ "$(findmnt -nro UUID /)" = "$(cat /etc/waitron-dev-root)" ] || { echo start.refused:root-uuid >&2; exit 1; }
cd /opt/waitron
apparmor_parser -r /etc/apparmor.d/waitron-print-agent
export WAITRON_PRINT_AGENT_APPARMOR=waitron-print-agent
docker compose up -d --pull never
ready=false
for attempt in $(seq 1 90); do
  if curl -kfsS -o /dev/null https://127.0.0.1/health; then ready=true; break; fi
  sleep 1
done
test "$ready" = true
if ! curl -kfsS -o /run/waitron-status.json https://127.0.0.1/setup-api/status; then exit 0; fi
images="$(docker compose config --format json | jq -c '.services | with_entries(.value = .value.image)')"
for name in app print-agent mailpit; do
  tag="$(jq -r --arg name "$name" '.[$name]' <<< "$images")"
  id="$(docker image inspect "$tag" --format '{{.Id}}')"
  jq -cn --arg name "$name" --arg id "$id" '{key:$name,value:$id}'
done | jq -s 'from_entries' >/run/waitron-images.json
services="$(docker inspect $(docker compose ps -q) | jq -c 'map({key:.Config.Labels["com.docker.compose.service"],value:.State.Status})|from_entries')"
areas="$(findmnt -rn -t btrfs -o FSROOT | sed 's|^/||;s|/.*||' | sort -u | jq -Rsc 'split("\n") | map(select(length > 0))')"
absent=false
if [ ! -e /usr/local/sbin/waitron-dev-install ] && [ ! -e /etc/systemd/system/waitron-dev-install.service ]; then absent=true; fi
sync
jq -cn --arg uuid "$(findmnt -nro UUID /)" --arg machineId "$(cat /etc/machine-id)" \
  --argjson images "$(cat /run/waitron-images.json)" --argjson services "$services" \
  --argjson areas "$areas" --argjson writerAbsent "$absent" --argjson status "$(cat /run/waitron-status.json)" \
  '{uuid:$uuid,machineId:$machineId,images:$images,services:$services,areas:$areas,writerAbsent:$writerAbsent,status:$status}' \
  | sed 's/^/B3_INSTALLED:/'
