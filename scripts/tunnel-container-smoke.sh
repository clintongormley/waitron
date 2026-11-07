#!/bin/sh
set -eu
name=waitron-tunnel-smoke-$(date +%s)-$$
image=$name:local
scratch=$(mktemp -d)
profile() {
  COMPOSE_PROFILES=staff-tunnel docker compose -f deploy/compose.yml -f "$scratch/override.yml" -p "$name" "$@"
}
cleanup() {
  if [ -f "$scratch/override.yml" ]; then profile down --volumes --remove-orphans >/dev/null 2>&1 || :; fi
  for part in peer gateway staff; do docker rm -f "$name-$part" >/dev/null 2>&1 || :; done
  for part in control keys; do docker volume rm "$name-$part" >/dev/null 2>&1 || :; done
  docker network rm "$name" >/dev/null 2>&1 || :
  docker image rm "$image" >/dev/null 2>&1 || :
  rm -rf "$scratch"
}
trap cleanup EXIT
trap 'exit 1' INT TERM
wait_for() {
  for attempt in $(seq 1 40); do
    if "$@"; then return 0; fi
    sleep 1
  done
  docker logs "$name-peer" >&2
  return 1
}
docker build -f deploy/tunnel/Dockerfile -t "$image" .
COMPOSE_PROFILES= docker compose -f deploy/compose.yml config --format json > "$scratch/default.json"
docker compose -f deploy/compose.yml --profile staff-tunnel config --format json > "$scratch/profile.json"
docker run --rm -i --entrypoint jq "$image" -e '.services.tunnel == null' < "$scratch/default.json" >/dev/null
docker run --rm -i --entrypoint jq "$image" -e '
  .services as $s | $s.tunnel as $t |
  $t.profiles == ["staff-tunnel"] and
  $t.cap_add == ["NET_ADMIN"] and $t.cap_drop == ["ALL"] and
  $t.read_only == true and $t.security_opt == ["no-new-privileges:true"] and
  $t.sysctls["net.ipv4.ip_forward"] == "0" and
  ($t.ports // [] | length) == 0 and $t.network_mode == null and
  ($t.networks | keys) == ["tunnel"] and
  $t.extra_hosts == ["host.docker.internal=host-gateway"] and
  ([$t.volumes[].target] | sort) == ["/control", "/keys"] and
  all($s.app.volumes[]; .source | endswith("tunnel_keys") | not) and
  ($s.app.cap_add // [] | length) == 0
' < "$scratch/profile.json" >/dev/null
printf '%s\n' 'PASS actual Compose profile keeps the default off and isolates privileges, keys and networking'
docker network create "$name" >/dev/null
docker run -d --name "$name-staff" --network "$name" --entrypoint socat "$image" \
  TCP4-LISTEN:8443,reuseaddr,fork 'EXEC:/bin/cat' >/dev/null
staff_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$name-staff")
docker run -d --name "$name-gateway" --network "$name" --cap-add NET_ADMIN --entrypoint sh "$image" -c '
  umask 077
  wg genkey > /keys/gateway.key
  wg pubkey < /keys/gateway.key > /keys/gateway.pub
  exec sleep infinity
' >/dev/null
gateway_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$name-gateway")
wait_for docker exec "$name-gateway" test -s /keys/gateway.pub
gateway_key=$(docker exec "$name-gateway" cat /keys/gateway.pub)
cat > "$scratch/override.yml" <<YAML
services:
  tunnel:
    image: "$image"
    container_name: "$name-peer"
    extra_hosts: !override
      - "host.docker.internal:$staff_ip"
volumes:
  tunnel_control:
    name: "$name-control"
  tunnel_keys:
    name: "$name-keys"
networks:
  tunnel:
    name: "$name"
    external: true
YAML
profile config --format json > "$scratch/resolved.json"
docker run --rm -i --entrypoint jq "$image" -e --arg upstream "host.docker.internal=$staff_ip" \
  '.services.tunnel.extra_hosts == [$upstream]' < "$scratch/resolved.json" >/dev/null
profile up -d --no-deps tunnel
wait_for docker exec "$name-peer" test -s /control/public-key
peer_key=$(docker exec "$name-peer" cat /control/public-key)
docker exec --user 10001:10001 "$name-peer" sh -c '
  set -e
  test -r /control/public-key
  test ! -r /keys/private-key
  umask 022
  printf probe > /control/app-write-probe
'
[ "$(docker exec "$name-peer" cat /control/app-write-probe)" = probe ]
docker exec --user 10001:10001 "$name-peer" rm /control/app-write-probe
if docker exec "$name-peer" ip link show wg-cloud 2>/dev/null; then exit 1; fi
[ "$(docker exec "$name-peer" stat -c %a /keys/private-key)" = 600 ]
docker exec "$name-peer" sh -c 'test "$(ls /control)" = public-key'
docker exec "$name-gateway" sh -c '
  ip link add wg-cloud type wireguard
  ip address add 10.77.17.1/32 dev wg-cloud
  wg set wg-cloud private-key /keys/gateway.key listen-port 51820 peer "$1" allowed-ips 10.77.17.2/32
  ip link set wg-cloud up
  ip route add 10.77.17.2/32 dev wg-cloud
' sh "$peer_key"
printf '{"address":"10.77.17.2","gatewayPublicKey":"%s","endpoint":"%s:51820"}\n' "$gateway_key" "$gateway_ip" > "$scratch/peer.json"
sed "s/$gateway_ip:51820/unresolvable.invalid:51820/" "$scratch/peer.json" > "$scratch/unavailable.json"
docker cp "$scratch/unavailable.json" "$name-peer:/control/peer.json" >/dev/null
failed_endpoint() { docker logs "$name-peer" > "$scratch/failure.log" 2>&1 || return 1; grep -q unresolvable.invalid "$scratch/failure.log"; }
wait_for failed_endpoint
[ "$(docker inspect -f '{{.RestartCount}}' "$name-peer")" = 0 ]
docker exec "$name-peer" test ! -e /keys/wg.conf
docker cp "$scratch/peer.json" "$name-peer:/control/peer.json" >/dev/null
request() { docker exec "$name-gateway" sh -c 'printf staff-only | timeout 3 socat - TCP4:10.77.17.2:443,connect-timeout=2'; }
connected() { [ "$(request)" = staff-only ]; }
wait_for connected
printf '%s\n' 'PASS gateway TCP stream reaches only staff upstream'
docker exec "$name-gateway" ip address add 10.77.17.3/32 dev wg-cloud
if docker exec "$name-gateway" sh -c 'printf denied | timeout 3 socat - TCP4:10.77.17.2:443,bind=10.77.17.3,connect-timeout=1'; then exit 1; fi
docker exec -d "$name-peer" socat TCP4-LISTEN:8443,bind=10.77.17.2,reuseaddr,fork 'SYSTEM:printf forbidden-port'
local_port() { [ "$(docker exec "$name-peer" sh -c 'printf probe | timeout 3 socat - TCP4:10.77.17.2:8443,connect-timeout=1')" = forbidden-port ]; }
wait_for local_port
if docker exec "$name-gateway" sh -c 'printf denied | timeout 3 socat - TCP4:10.77.17.2:8443,connect-timeout=1'; then exit 1; fi
printf '%s\n' 'PASS another source address and another tunnel port are refused'
docker exec -d "$name-gateway" sh -c '
  socat -d -d TCP4:10.77.17.2:443,connect-timeout=2 OPEN:/dev/null,ignoreeof > /tmp/held.log 2>&1
  touch /tmp/held.closed
'
held_ready() { docker exec "$name-gateway" grep -q 'starting data transfer' /tmp/held.log; }
wait_for held_ready
docker exec "$name-peer" rm /control/peer.json
off() { ! docker exec "$name-peer" ip link show wg-cloud >/dev/null 2>&1; }
wait_for off
[ "$(docker exec "$name-peer" iptables -S INPUT)" = '-P INPUT ACCEPT' ]
wait_for docker exec "$name-gateway" test -f /tmp/held.closed
if request; then exit 1; fi
printf '%s\n' 'PASS removing configuration closes an existing stream and disconnects the peer'
docker cp "$scratch/peer.json" "$name-peer:/control/peer.json" >/dev/null
wait_for connected
docker restart "$name-peer" >/dev/null
wait_for connected
[ "$(docker exec "$name-peer" cat /control/public-key)" = "$peer_key" ]
docker exec "$name-peer" sh -c 'test -s /app/third-party/system/PACKAGES.txt && test -s /app/third-party/system/common-licenses/GPL-2'
docker logs "$name-peer" > "$scratch/peer.log" 2>&1
key_search_status=0
docker exec -i "$name-peer" grep -Fq -f /keys/private-key < "$scratch/peer.log" || key_search_status=$?
[ "$key_search_status" = 1 ]
printf '%s\n' 'PASS reconnect and restart retain the box key; image ships system licence notices'
profile down --remove-orphans
if docker inspect "$name-peer" >/dev/null 2>&1; then exit 1; fi
printf '%s\n' 'PASS the reset down command also stops the optional Compose profile'
