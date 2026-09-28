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
version before changing that response. Stopping access permanently retires the key. A stop
request waits for the local worker, rechecks your permission, and saves the stop intent before
contacting Cloud. Do not delete the state file to reconnect: pairing again with a new key does
not take over the existing venue. A test server restored from a Cloud snapshot reconnects to its
venue through the steps in
[Reconnect a restored test server to its Cloud venue](#reconnect-a-restored-test-server-to-its-cloud-venue)
instead.

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

### Recover a test venue from a Cloud snapshot

If a venue server has failed, open **Restore from backup** on a fresh replacement and choose
**Restore from Waitron Cloud**. The replacement shows a code and a Cloud link. Sign in there,
choose a verified snapshot, enter the code, and confirm that the old server and any surviving
peers are stopped. Return to the replacement and choose **Check approval**. Review the snapshot
capture time before you confirm the local restore; later changes are absent from that snapshot.

If the snapshot's database holds bucket settings, choosing **Restore this snapshot** first checks
the old server's bucket. If the old server wrote to it in the last ten minutes, or that could not
be checked, the restore stops and the page asks you to tick **The old server is switched off for
good.** Tick it only when that is true, then choose **Restore this snapshot** again.

This path supports preparation and demo venues. It restores a retained snapshot through the
same local cold restore and module hooks as a backup file. It does not recover changes after the
snapshot, activate a Cloud route, or fence a running server. Reconnecting the replacement to its
Cloud venue is a separate step, described in the next section. Use a backup file for the existing
local recovery path. Do not start trading on a replacement
while another server may hold newer data.

The replacement saves its recovery request and signing key in `cloud-recovery.json` under
`WAITRON_STATE_DIR` before contacting Cloud. The file is mode 0600 and is outside the named
archive capture list. A lost reply or server restart reuses that request. When a request expires,
choose **Start a new request**; a network failure leaves the existing request intact. The
browser receives the code, link, deadline and approved snapshot details, while the archive key
and temporary storage credentials stay on the server. A managed restore excludes the captured
`backup.env`, so the replacement does not inherit the old backup destination credentials.

The Cloud account page authorizes a target to read one snapshot. It does not confirm that local
restore has finished. Waitron stages and validates the encrypted archive, restarts, runs cold
restore, then tries to report completion to Cloud. Reporting is best effort and does not hold up
the restored server if Cloud is unavailable. If a failed cold restore clears its staged request
and leaves the replacement in setup, retry the approved snapshot. Waitron keeps the same
request identity; an expired approval requires a new request.

### Reconnect a restored test server to its Cloud venue

The restored server does not inherit the old server's Cloud connection, because
`cloud-connection.json` stays out of the archive. Instead of pairing it as a new venue, you
reconnect it to the existing Cloud venue as the old server's replacement. This works only on a
server that is not in production and was restored with **Restore from Waitron Cloud**. You need
a local manager with `system.manage`, the screen open at `WAITRON_MANAGEMENT_ORIGIN`, and a
server holding the primary role.

1. Open the Cloud services screen on the restored server and choose **Request reconnection**.
   If the restore has not yet been reported to Cloud, the server reports it first. Before it
   sends the reconnection request, it saves a fresh installation key and a fresh WireGuard key in
   `cloud-replacement.json` under `WAITRON_STATE_DIR`, with mode 0600.
2. The screen shows the previous installation, the organisation and the business, together with
   the original recovery code and an **Open Cloud** link. Use them so the owner of the Cloud
   venue can approve the replacement in Cloud.
3. Return to the restored server and choose **Check reconnection**. Once Cloud reports the
   owner's approval, the server rechecks your permission and its primary role, then imports the
   registration into its Cloud connection. The screen then reads **Connected**.

A lost reply or a restart reuses the saved request and keys, and **Check reconnection** recovers
Cloud's answer. If the server restarts after saving an approved reply but before importing it,
it finishes the import when it starts again. **Stop Cloud access** on a reconnected server also
records the stop in `cloud-replacement.json`, so if `cloud-connection.json` is lost, the import on
the next start or **Check reconnection** restores the connection with the stop still waiting, and
the next check with Cloud, once a minute or **Refresh status**, sends the stop again. On a server that was not restored from a Cloud
snapshot, the screen offers **Connect to Cloud** instead of **Request reconnection**. Keep the
previous server out of service throughout.

Reconnecting registers the replacement with Cloud. Installing the new WireGuard tunnel and a
new TLS certificate remain operator steps, and Cloud access and backups need their own checks
afterwards. Cloud owns route placement and fencing. Continuous complete-server recovery, a
planned handover of the final writes and production recovery are not implemented.

### Reissue staff TLS after a restore

A recovery archive deliberately excludes `cloud-staff.key` and `cloud-staff.crt`.
If your restored configuration still points at those missing files, Waitron refuses
to start; it does not silently serve plain HTTP. Before enabling remote access on a
replacement, generate a new staff key/CSR and have the Cloud operator issue its chain
for the authorized replacement. Set the TLS paths and management origin consistently
before starting it. The certificate commands work without a running server.

The certificate commands do not reconnect the replacement to Cloud; that is the separate
step in [Reconnect a restored test server to its Cloud venue](#reconnect-a-restored-test-server-to-its-cloud-venue).
For local recovery first, use Waitron's existing local-certificate setup and its matching
local management origin, then change to the staff hostname once the replacement is reconnected
and its new tunnel and certificate are installed. Do not copy the old staff key.


## Deliver a managed snapshot locally

The paired test connection exposes `reserveCapture(id)` and `publishCapture(id, metadata)`.
Use one UUID for the capture, keep it across retries and create the encrypted archive with
reserve's `recoveryKey`. `uploadCloudCapture(grant, bytes)` uploads that archive directly
with the returned temporary storage credentials. Pass the digest/size receipt plus
`capturedAt`, `retention`, `sourceNodeId` and `modules` to publication.

Capture calls wait for the current connection operation. Reserve renews the installation lease when needed. Cloud chooses the destination
and archive key version. The client checks the reply's installation, venue and capture IDs,
requires HTTPS storage, and keeps keys and credentials out of saved connection state.
Upload uses a conditional PUT. If a retry finds an existing object, publication checks its
actual bytes; upload credentials do not need read permission. Publication starts pending
verification. A trusted Cloud worker checks the restored archive separately.

Retain the same UUID, archive bytes and metadata until publication succeeds. The scheduled
worker keeps one encrypted archive in a durable local spool and retries publication after a
restart. It schedules daily captures using the venue clock, with the first capture of each
month retained as monthly. The transport methods remain callable separately. Managed capture
refuses production installations; the local proof has not established production storage behavior.

Run Cloud's `scripts/test-local-backups.mjs` with `WAITRON_CHECKOUT` pointing at this
installed checkout. It calls `apps/server/scripts/cloud-capture-client-fixture.ts` only on disposable
roots and exercises actual signatures, temporary storage access and Waitron restore hooks.
The fixture is not an operator command for a real venue.


The byte-array uploader accepts at most 512 MiB and has a 30-second request deadline.
Scheduled captures use `uploadCloudCaptureFile`, which streams the saved archive with a
deadline capped at fourteen minutes and the temporary credentials’ expiry. Each upload call
makes one attempt; the scheduler retries from the durable spool with backoff. It checks its
abort signal so deliberate shutdown does not record a service outage.
