# Staff tunnel runtime

To reach the staff entrance through Cloud, the box needs an outbound WireGuard peer. This
container keeps the network permission and private key separate from the app. It forwards TCP
bytes to `host.docker.internal:8443`, so TLS still ends at the box's staff listener.

This is the optional runtime of A951-S. The signed connection submits the public key and writes
the peer configuration when the Cloud receiver is enabled. Settings controls and automatic
image publication remain to be connected. The default installation does not start it. The
staff listener from PR #2525 must already be running and reachable from the Docker bridge;
its loopback-only default is not reachable from this container.

From a checkout on a Linux Docker host, build and check it with:

```sh
docker build -f deploy/tunnel/Dockerfile -t waitron-tunnel:dev .
sh scripts/tunnel-container-smoke.sh
```

The check renders the real Compose configuration, starts its tunnel profile beside an isolated
gateway and staff echo service, then removes its own
containers, volumes, network and tagged image. It checks the fixed staff destination, refusal of
another source and port, disconnection, reconnection and a container restart. It does not reboot
the host, issue a certificate or touch a running Waitron installation.

On a connected test installation, set `WAITRON_STAFF_ORIGIN` to the exact HTTPS staff address
Cloud assigned. The certificate worker opens that listener after installing its first certificate.
On a Linux box, bind it to Docker's bridge address so this container can reach it:

```sh
export WAITRON_STAFF_ORIGIN=https://staff-v-your-assigned-venue.test.waitron.io
export WAITRON_STAFF_HOST=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')
cat > /tmp/waitron-staff-listener.yml <<'YAML'
services:
  app:
    environment:
      WAITRON_STAFF_ORIGIN: ${WAITRON_STAFF_ORIGIN:?Set the assigned staff origin}
      WAITRON_STAFF_HOST: ${WAITRON_STAFF_HOST:?Set Docker's bridge address}
      WAITRON_STAFF_PORT: "8443"
YAML
docker compose -f deploy/compose.yml -f /tmp/waitron-staff-listener.yml --profile staff-tunnel up -d app tunnel
```

Replace the example origin with your assigned address. The default `127.0.0.1` cannot be reached
from the peer. Keep the bridge bind: choosing `0.0.0.0` would also listen on the venue interfaces.
The runtime's configured message reports local configuration, not a successful gateway handshake.

The container stays off until the signed connection supplies its placement: `tunnel.off` in its logs means
there is no valid `peer.json` in the shared `tunnel_control` volume. The app sees this volume at
`/var/lib/waitron/tunnel`. The file takes exactly three fields from Cloud's placement:

```json
{
  "address": "10.77.17.2",
  "gatewayPublicKey": "replace with Cloud's gateway public key",
  "endpoint": "gateway.test.waitron.io:51820"
}
```

Replace the example values with the placement assigned to your box. Write the complete file to a
temporary sibling with mode 0644 and rename it to `peer.json`. These fields are not secrets;
the directory is restricted to the app (uid 10001) and the peer’s root group. Removing it disconnects the tunnel on the next
poll, normally within two seconds. This is not an instant shutdown guarantee.

Both reset forms stop the profile and clear its connection settings and key, because the box
will pair with Cloud again. An ordinary container restart retains them.

The peer creates its key in `tunnel_keys`, which the app does not mount, and publishes only
`public-key` in the control volume. Restarting retains that key. The only tunnel route is to the
gateway's `10.77.<subnet>.1/32`; incoming tunnel traffic must have that source and destination
port 443. The container has its own network namespace, no published port and no IP forwarding.
It uses `NET_ADMIN` there; the app keeps its existing permissions.

The Debian packages' copyright files, shared licence texts and installed versions ship in
`/app/third-party/system/`.
