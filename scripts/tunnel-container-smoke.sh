#!/bin/sh
set -eu
name=waitron-tunnel-smoke-$(date +%s)-$$
image=$name:local
scratch=$(mktemp -d)
cleanup() {
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
docker network create "$name" >/dev/null
docker run -d --name "$name-staff" --network "$name" --entrypoint socat "$image" \
  TCP4-LISTEN:8443,reuseaddr,fork 'SYSTEM:printf staff-only' >/dev/null
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
docker run -d --name "$name-peer" --network "$name" --cap-drop ALL --cap-add NET_ADMIN \
  --security-opt no-new-privileges:true --read-only --sysctl net.ipv4.ip_forward=0 \
  --add-host "host.docker.internal:$staff_ip" \
  -v "$name-control:/control" -v "$name-keys:/keys" "$image" >/dev/null
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
! docker exec "$name-peer" ip link show wg-cloud 2>/dev/null
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
docker cp "$scratch/peer.json" "$name-peer:/control/peer.json" >/dev/null
request() { docker exec "$name-gateway" sh -c 'printf request | timeout 3 socat - TCP4:10.77.17.2:443,connect-timeout=2'; }
connected() { [ "$(request)" = staff-only ]; }
wait_for connected
printf '%s\n' 'PASS gateway TCP stream reaches only staff upstream'
# WireGuard authenticates only the gateway /32; an address it did not receive is refused.
docker exec "$name-gateway" ip address add 10.77.17.3/32 dev wg-cloud
if docker exec "$name-gateway" sh -c 'printf denied | timeout 3 socat - TCP4:10.77.17.2:443,bind=10.77.17.3,connect-timeout=1'; then exit 1; fi
docker exec -d "$name-peer" socat TCP4-LISTEN:8443,bind=10.77.17.2,reuseaddr,fork 'SYSTEM:printf forbidden-port'
local_port() { [ "$(docker exec "$name-peer" sh -c 'printf probe | timeout 3 socat - TCP4:10.77.17.2:8443,connect-timeout=1')" = forbidden-port ]; }
wait_for local_port
if docker exec "$name-gateway" sh -c 'printf denied | timeout 3 socat - TCP4:10.77.17.2:8443,connect-timeout=1'; then exit 1; fi
printf '%s\n' 'PASS another source address and another tunnel port are refused'
docker exec "$name-peer" rm /control/peer.json
off() { ! docker exec "$name-peer" ip link show wg-cloud >/dev/null 2>&1; }
wait_for off
if request; then exit 1; fi
printf '%s\n' 'PASS removing configuration disconnects the peer'
docker cp "$scratch/peer.json" "$name-peer:/control/peer.json" >/dev/null
wait_for connected
docker restart "$name-peer" >/dev/null
wait_for connected
[ "$(docker exec "$name-peer" cat /control/public-key)" = "$peer_key" ]
docker exec "$name-peer" sh -c 'test -s /app/third-party/system/PACKAGES.txt && test -s /app/third-party/system/common-licenses/GPL-2'
printf '%s\n' 'PASS reconnect and restart retain the box key; image ships system licence notices'
