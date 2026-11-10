#!/usr/bin/env bash
set -euo pipefail
refuse() { echo "start.refused:$1" >&2; exit 1; }
[ "$(findmnt -nro UUID /)" = "$(cat /etc/waitron-dev-root)" ] || refuse root-uuid
root_source="$(findmnt -nro SOURCE /)"
backing="$(LC_ALL=C cryptsetup status "${root_source%%\[*}" | awk '$1 == "device:" {print $2}')" || refuse encrypted-root
luks_uuid="$(cryptsetup luksUUID "$backing")" || refuse encrypted-root
[ -n "$luks_uuid" ] && [ "$luks_uuid" = "$(cat /etc/waitron-dev-luks)" ] || refuse encrypted-root
cd /opt/waitron
apparmor_parser -r /etc/apparmor.d/waitron-print-agent
export WAITRON_PRINT_AGENT_APPARMOR=waitron-print-agent
docker compose up -d --pull never
status=""
for attempt in $(seq 1 90); do
  status="$(curl -ksS --max-time 5 -o /run/waitron-status.json -w '%{http_code}' https://127.0.0.1/setup-api/status)" || status=""
  if [ "$status" = 200 ]; then break; fi
  if [ "$status" = 404 ] && curl -kfsS --max-time 5 -o /dev/null https://127.0.0.1/health; then exit 0; fi
  sleep 1
done
test "$status" = 200
images="$(docker compose config --format json | jq -c '.services | with_entries(.value = .value.image)')"
for name in app print-agent mailpit; do
  tag="$(jq -r --arg name "$name" '.[$name]' <<< "$images")"
  id="$(docker image inspect "$tag" --format '{{.Id}}')"
  jq -cn --arg name "$name" --arg id "$id" '{key:$name,value:$id}'
done | jq -s 'from_entries' >/run/waitron-images.json
services="$(docker inspect $(docker compose ps -q) | jq -c 'map({key:.Config.Labels["com.docker.compose.service"],value:.State.Status})|from_entries')"
areas="$(findmnt -rn -t btrfs -o FSROOT | sed 's|^/||;s|/.*||' | sort -u | jq -Rsc 'split("\n") | map(select(length > 0))')"
layout="$(sfdisk --json "/dev/$(lsblk -dnro PKNAME "$backing")")"
partitions="$(jq -c '.partitiontable | .sectorsize as $sector | [.partitions[].size * $sector]' <<< "$layout")"
data_partition="$(jq -c '.partitiontable.partitions[2] | {type,name}' <<< "$layout")"
header="$(LC_ALL=C cryptsetup luksDump "$backing")"
absent=false
if [ ! -e /usr/local/sbin/waitron-dev-install ] && [ ! -e /etc/systemd/system/waitron-dev-install.service ]; then absent=true; fi
sync
jq -cn --arg uuid "$(findmnt -nro UUID /)" --arg machineId "$(cat /etc/machine-id)" \
  --arg luksUuid "$luks_uuid" --argjson partitionBytes "$partitions" \
  --argjson dataPartition "$data_partition" \
  --arg luksVersion "$(awk '$1 == "Version:" {print $2}' <<< "$header")" \
  --arg luksSubsystem "$(awk '$1 == "Subsystem:" {print $2}' <<< "$header")" \
  --argjson images "$(cat /run/waitron-images.json)" --argjson services "$services" \
  --argjson areas "$areas" --argjson writerAbsent "$absent" --argjson status "$(cat /run/waitron-status.json)" \
  '{uuid:$uuid,luksUuid:$luksUuid,luksVersion:$luksVersion,luksSubsystem:$luksSubsystem,dataPartition:$dataPartition,partitionBytes:$partitionBytes,machineId:$machineId,images:$images,services:$services,areas:$areas,writerAbsent:$writerAbsent,status:$status}' \
  | sed 's/^/B3_INSTALLED:/'
