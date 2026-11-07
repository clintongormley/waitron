# Staff tunnel runtime

To reach the staff entrance through Cloud, the box needs an outbound WireGuard peer. This
container keeps the network permission and private key separate from the app. It forwards TCP
bytes to `host.docker.internal:8443`, so TLS still ends at the box's staff listener.

This is the optional runtime cut of A951-S. The signed connection, Settings controls and automatic
image publication are still to be connected. The default installation does not start it. The
staff listener from PR #2525 must already be running and reachable from the Docker bridge;
its loopback-only default is not reachable from this container.

From a checkout on a Linux Docker host, build and check it with:

```sh
docker build -f deploy/tunnel/Dockerfile -t waitron-tunnel:dev .
sh scripts/tunnel-container-smoke.sh
```

The check creates an isolated gateway, peer and staff echo service, then removes its own
containers, volumes, network and tagged image. It checks the fixed staff destination, refusal of
another source and port, disconnection, reconnection and a container restart. It does not reboot
the host, issue a certificate or touch a running Waitron installation.

After configuring the separate staff listener, you can start this runtime with:

```sh
docker compose -f deploy/compose.yml --profile staff-tunnel up -d tunnel
```

Until the connection writer is wired in, the container stays off: `tunnel.off` in its logs means
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

The peer creates its key in `tunnel_keys`, which the app does not mount, and publishes only
`public-key` in the control volume. Restarting retains that key. The only tunnel route is to the
gateway's `10.77.<subnet>.1/32`; incoming tunnel traffic must have that source and destination
port 443. The container has its own network namespace, no published port and no IP forwarding.
It uses `NET_ADMIN` there; the app keeps its existing permissions.

The Debian packages' copyright files, shared licence texts and installed versions ship in
`/app/third-party/system/`.
