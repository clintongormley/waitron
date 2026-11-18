# Staff tunnel runtime

Pair your test box with Cloud. When Cloud supplies the staff address, the box installs its
public certificate and serves HTTPS through a Unix socket shared with the tunnel companion.
Use **Remote access** under **System → Cloud services** to turn the connection off or back on.

The normal box Compose file starts the companion. It makes a WireGuard key and waits for the
signed Cloud connection to write `peer.json` in the `tunnel_control` volume. The companion then
opens the tunnel and forwards the gateway's connection to the staff socket. Turning remote
access off removes `peer.json`. On its next poll the companion closes existing connections
and removes its WireGuard interface. Turning access back on uses the same key and pairing.

The companion stays running while access is off. It keeps its private key in `tunnel_keys` and
its network-admin permission in its own network namespace, including on production boxes.
The app sees the public key and connection settings through `tunnel_control`. Restarting
retains the box key. A box reset clears both tunnel volumes.

From a checkout with Docker and jq, run the connection smoke test:

```sh
sh scripts/tunnel-container-smoke.sh
```

The test starts a gateway, the Compose companion and a stand-in for the app socket. It checks
that the staff stream recovers within 90 seconds after an idle gateway loses its WireGuard session,
then checks that turning access off closes a held stream and that reconnect and restart retain
the box key.

While the tunnel is on, the peer sends one byte to the gateway's private UDP port 9 on activation
and about every 20 seconds. This gives WireGuard traffic to retry when an idle gateway loses its
session. The gateway needs no listener on that port. If the send fails, the peer logs
`tunnel.probe_failed` once for that configuration and keeps the staff forwarder running. A probe
in progress can delay the next configuration poll by up to one second.

The Debian packages' copyright files, licence texts and versions ship in
`/app/third-party/system/`.
