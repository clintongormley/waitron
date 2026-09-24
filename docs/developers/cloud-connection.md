# Connect a venue to Waitron Cloud

The Cloud services screen in Settings connects this installation to a Cloud
organisation and legal business. You need a local manager with `system.manage` and
a Cloud account with permission to register venues for that business.

Choose **Connect to Cloud**, then **Open Cloud**. Enter the code shown locally and
approve the business in Cloud. Return to Waitron, choose **Check connection**, check
the organisation and business, then choose **Connect this venue**. The server checks
your local permission and its primary role again before signing the final request.

Connected means the installation is registered. Remote access and backups remain
unconfigured until provisioned. Local remote-access operator setup is implemented;
managed backup setup follows separately. The screen shows configuration
and observed health separately; a five-minute-old observation reads Health unknown.
No account or Cloud call is
added to the sale path.

## Refresh or stop Cloud access

After you connect, the primary server checks Cloud once a minute. It obtains a signed
one-hour access lease and renews it with ten minutes left. Every request also uses
the installation private key; copying a lease does not grant access. Background work
never extends your management login. Choose **Refresh status** to check immediately.

A Cloud outage keeps the last known configuration and shows that status is unavailable.
Pending requests are saved before sending, so a restart can recover a renewal or stop
request whose response was lost. The server treats a revoked installation separately
and does not silently generate another identity.

Choose **Stop Cloud access**, read the consequences, then confirm. You need a live
local manager session. You can stop access even after this node loses its primary
role. This stops new Cloud control requests and credential grants, preserves the venue
and stored backups, and leaves local trading and subscriptions alone. It does not
cancel billing. The local remote-access gateway now enforces revocation and expiring signed route
authority. Storage credentials are part of the separate backup adapter.

## Configure the Cloud destination

Set `WAITRON_CLOUD_ORIGIN` to the exact portal origin, for example
`https://cloud.example.com`, without a trailing slash. HTTPS is required. A development
server with `WAITRON_ENV=dev` can use HTTP on `127.0.0.1`, `localhost` or `::1`.
Without this setting, the screen reports that Cloud services are unavailable.

The server derives the local venue from its provisioned location. Production maps
to Cloud's production environment; development and preproduction map to test.
Browser input cannot select the destination, installation key or local venue.

`cloud-connection.json` lives under `WAITRON_STATE_DIR` and contains the installation's
private key. Run one server process per node state directory. Requests within that
process share a write gate. Writes use a fresh mode-0600 temporary file, sync it,
rename it and sync the directory before sending the first request to Cloud. Restart
and lost-reply tests exercise reuse of the saved key and request. These tests do not
simulate a power loss.

Keep this file out of replacement restores. The current secret/configuration capture
uses named file lists and does not include it. A managed replacement must obtain a
fresh Cloud identity while retaining the venue's identity; that lifecycle is separate
from pairing. Corrupt state fails closed instead of silently generating another key.

If a request expires or becomes unavailable, choose **Start again**. Waitron checks
Cloud before replacing the request. If Cloud has already completed it, Waitron recovers
that result. Network failures retain the current operation for a deliberate retry.

## Run the integration proof

The Cloud repository owns the local runner. Build this checkout's dashboard with
`pnpm --filter @waitron/dashboard build`, then set `WAITRON_CHECKOUT` to its absolute
path when following [Cloud's local-pairing guide](https://github.com/waitron-io/waitron-cloud/blob/main/docs/local-pairing.md).

The runner starts two actual Waitron servers through
`apps/server/scripts/cloud-integration-fixture.ts`, each with disposable SQLite files,
plus the Cloud API and browser. It verifies the two approval screens, a server restart,
a lost committed pairing reply and rejection of crossed installation proofs. It also
loses renewal and revocation responses after Cloud commits, restarts Waitron, and
checks that its real worker recovers both. Independent service configurations and
synthetic adapter observations stay with their intended venues; revoking one
installation leaves the other connected. These observations test the status protocol,
not an actual tunnel or restorable backup. The fixture uses
demo mode and does not configure fiscal/payment providers or create invoices.

The local Cloud write routes accept only the configured management origin. Open the
screen at `WAITRON_MANAGEMENT_ORIGIN`; remote-access setup must configure its staff hostname consistently. An automatic status read leaves your
session idle time unchanged. Clicking Check connection or Refresh status counts as your activity.

Version 1 returns exactly three services. Adding services requires a negotiated protocol
version before changing that response. Stopping access permanently retires the key;
the replacement flow is not implemented yet. Do not delete the state file to reconnect:
a new key does not take over the existing venue. A stop request waits for the local
worker, rechecks your permission, and saves the stop intent before contacting Cloud.

## Local remote-access integration

Cloud's [local remote-access runner](https://github.com/waitron-io/waitron-cloud/blob/main/docs/local-remote-access.md)
now provisions two actual Waitron servers behind one WireGuard/HAProxy gateway.
Staff HTTPS ends at the venue. Public HTTPS ends at the gateway, where a browser
challenge and an exact path allowlist protect the onward encrypted connection.
The only public endpoint in this milestone is `GET /public/availability`, which
returns `{ "available": true }` or a 503 with `false` according to the serving gate.
Menus, bookings and the customer-facing remote setup screen remain separate work.

Your staff certificate private key stays in `WAITRON_STATE_DIR/cloud-staff.key`.
Generate a certificate signing request, the public request a certificate authority
needs, in the Waitron checkout:

```sh
pnpm --filter @waitron/server exec tsx scripts/cloud-certificate.ts csr \
  /path/to/node-state staff-v-venue-id.example.com /tmp/staff.csr
```

Pass the CSR to the Cloud operator certificate command. After it returns a chain,
install that chain against the existing local key:

```sh
pnpm --filter @waitron/server exec tsx scripts/cloud-certificate.ts install \
  /path/to/node-state staff-v-venue-id.example.com /tmp/staff-chain.pem
```

Set `WAITRON_TLS_KEY_FILE` and `WAITRON_TLS_CERT_FILE` to the resulting
`cloud-staff.key` and `cloud-staff.crt`, and set `WAITRON_MANAGEMENT_ORIGIN` to the
HTTPS staff origin and `WAITRON_MANAGEMENT_RP_ID` to its hostname. The initial
HTTP-to-HTTPS change needs a restart. Subsequent certificate updates are checked
every ten seconds and applied to new TLS connections without restarting Waitron.
An invalid replacement leaves the loaded context intact and logs
`cloud.certificate_reload_failed`, repeating every five minutes while it persists.
Check that the certificate covers `WAITRON_MANAGEMENT_ORIGIN`, as well as its key
and dates. Fix the configuration or certificate before the valid certificate expires; the watcher does not obtain certificates itself.

Use the same hostname on your LAN by configuring your local DNS resolver to return
the server's LAN address. Keep that address reserved in DHCP. Devices using a
separate secure-DNS resolver may bypass the override; test each device with the
internet disconnected and a fresh browser session. The Cloud runner proves this
with an isolated DNS resolver and a new TLS client, without changing your router
or installing a global certificate authority.

The gateway removes revoked installations on its next signed configuration update.
Its cached authority lasts at most ten minutes during a Cloud management outage;
a restart cannot extend it. Expiry closes remote connections while local HTTPS
continues. The local peer container grants no access to the rest of your LAN and
has no SSH support feature.

### Reissue staff TLS after a restore

A recovery archive deliberately excludes `cloud-staff.key` and `cloud-staff.crt`.
If your restored configuration still points at those missing files, Waitron refuses
to start; it does not silently serve plain HTTP. Before enabling remote access on a
replacement, generate a new staff key/CSR and have the Cloud operator issue its chain
for the authorized replacement. Set the TLS paths and management origin consistently
before starting it. The certificate commands work without a running server.

Cloud replacement enrollment is a separate recovery step and is not implemented by
the certificate command. Keep the gateway route disabled until it is complete. For
local recovery first, use Waitron's existing local-certificate setup and its matching
local management origin, then change to the staff hostname after Cloud enrollment.
Do not copy the old staff key or delete the Cloud connection state to bypass enrollment.
