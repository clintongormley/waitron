#!/bin/sh
set -eu
umask 077
control=${1:-/control}
keys=${2:-/keys}
mkdir -p "$control" "$keys"
chmod 700 "$keys"
if [ ! -f "$keys/private-key" ]; then
  wg genkey > "$keys/private-key.new"
  mv "$keys/private-key.new" "$keys/private-key"
fi
chmod 600 "$keys/private-key"
rm -f "$control/public-key.new"
wg pubkey < "$keys/private-key" > "$control/public-key.new"
chmod 644 "$control/public-key.new"
mv "$control/public-key.new" "$control/public-key"
proxy=
active=
stop() {
  if [ -n "$proxy" ]; then
    kill -TERM "-$proxy" 2>/dev/null || kill -TERM "$proxy" 2>/dev/null || :
    wait "$proxy" 2>/dev/null || :
    kill -TERM "-$proxy" 2>/dev/null || :
    proxy=
  fi
  if [ -n "$active" ]; then
    ip link del wg-cloud
    iptables -F INPUT
    active=
  fi
}
configure() {
  ip link add wg-cloud type wireguard || return 1
  ip address add "$address/32" dev wg-cloud || return 1
  wg set wg-cloud private-key "$keys/private-key" peer "$gateway_key" \
    endpoint "$endpoint" allowed-ips "$gateway/32" persistent-keepalive 25 || return 1
  iptables -A INPUT -i wg-cloud -s "$gateway/32" -p tcp --dport 443 -j ACCEPT || return 1
  iptables -A INPUT -i wg-cloud -j DROP || return 1
  iptables -P FORWARD DROP || return 1
  ip link set wg-cloud up || return 1
  ip route add "$gateway/32" dev wg-cloud || return 1
  setsid socat "TCP4-LISTEN:443,bind=$address,reuseaddr,fork" TCP4:host.docker.internal:8443 &
  proxy=$!
}
trap 'stop; exit 0' TERM INT
trap stop EXIT
while :; do
  next=
  if [ -f "$control/peer.json" ] && [ "$(wc -c < "$control/peer.json")" -le 2048 ]; then
    next=$(jq -Ssce '
      select(length == 1) | .[0] |
      select(type == "object" and (keys == ["address", "endpoint", "gatewayPublicKey"])) |
      select(.address | type == "string") |
      select(.address | test("^10\\.77\\.(0|[1-9][0-9]{0,2})\\.([1-9][0-9]{0,2})$")) |
      select((.address | split(".")[2] | tonumber) <= 255) |
      select((.address | split(".")[3] | tonumber) >= 2 and (.address | split(".")[3] | tonumber) <= 254) |
      select(.gatewayPublicKey | type == "string") |
      select(.gatewayPublicKey | test("^[A-Za-z0-9+/]{43}=$")) |
      select(.endpoint | type == "string") |
      select(.endpoint | length <= 259) |
      select(.endpoint | test("^[a-z0-9]([a-z0-9.-]*[a-z0-9])?:51820$"))
    ' "$control/peer.json" 2>/dev/null) || next=
  fi
  if [ "$next" != "$active" ]; then
    stop
    if [ -n "$next" ]; then
      address=$(printf '%s' "$next" | jq -r .address)
      gateway=${address%.*}.1
      gateway_key=$(printf '%s' "$next" | jq -r .gatewayPublicKey)
      endpoint=$(printf '%s' "$next" | jq -r .endpoint)
      active=$next
      if configure; then
        printf '%s\n' tunnel.configured
      else
        stop
        printf '%s\n' tunnel.off
      fi
    else
      printf '%s\n' tunnel.off
    fi
  elif [ -z "$next" ] && [ -z "${reported:-}" ]; then
    printf '%s\n' tunnel.off
  fi
  reported=yes
  if [ -n "$proxy" ] && ! kill -0 "$proxy" 2>/dev/null; then exit 1; fi
  sleep 2 & wait $! || :
done
