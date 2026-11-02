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
private key. Run one server process per node state directory. Writes use a fresh mode-0600 temporary file, sync it,
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
demo mode, provisions its venue with a throwaway preproduction allocation, and does not configure
fiscal/payment providers or create invoices. On a fixture directory's first start, a non-empty
`WAITRON_DASHBOARD_APP_DIR` in the environment the fixture is launched with replaces the built
dashboard; later starts reuse the saved value.

The local Cloud write routes accept only the configured management origin. Open the
screen at `WAITRON_MANAGEMENT_ORIGIN`; remote-access setup must configure its staff hostname consistently. An automatic status read leaves your
session idle time unchanged. Clicking Check connection or Refresh status counts as your activity.

The box signs every `configuration` request with the body `{"servicesVersion":2}`, and Cloud
answers it with a fourth service, `content_translation`, beside the original three. Renewals and
reports still answer three. Services are matched by name, in any order. The box keeps the last
fourth entry it was given when a renewal or report answers three. A Cloud that predates version 2
refuses any `configuration` body other than `{}` as an invalid proof (401) (Cloud's
`packages/registration/src/installations.ts:28` at `eea0aa5`), and the box answers that by dropping its lease
(the `invalid_proof` branch of `exchange` in `apps/server/src/cloud-installation.ts`). Cloud must therefore support version 2 before
any box running this code talks to it, including a box paired before it was upgraded to this version. Stopping access permanently retires the key. A stop
request waits for the local worker, rechecks your permission, and saves the stop intent before
contacting Cloud. Do not delete the state file to reconnect: pairing again with a new key does
not take over the existing venue. A test server restored from a Cloud snapshot reconnects to its
venue through the steps in
[Reconnect a restored test server to its Cloud venue](#reconnect-a-restored-test-server-to-its-cloud-venue)
instead.

## Translate all

Translate all asks Waitron Cloud to suggest the customer-facing names a venue is missing, so
nobody has to type every translation by hand. The box sends Cloud items that have, in some
enabled language, neither a name nor a suggestion waiting for review, each with its staff name,
its category, the names it already has and the languages it lacks. It adds up to 300 items whose names someone has saved, as examples of the
venue's style, and the venue's languages and country. It sends no prices, no people and no sales.

A runner on the primary (`apps/server/src/content-suggestion-runner.ts`) makes every call to
Cloud. When someone presses **Translate all**, the server records a job in
`content_suggestion_jobs` and wakes the runner. The runner submits it, and while Cloud is still working it asks for
progress again five seconds after each answer. Once Cloud has finished, the runner fetches the
results one page at a time, each reply at most 16 MiB (`COLLECT_REPLY_BYTES` in
`apps/server/src/cloud-translation.ts`), asking for each page by its position in the job's list
of items. It stores each page's suggestions in one transaction with the position of the next
page (`collect_cursor`) and the updated list of every item the job has accounted for so far
(`collected_refs`). The last page
finishes the job only if every item the box sent has come back, as a suggestion or as one Cloud
could not do, and the number accounted for equals Cloud's own count of the job's items; otherwise the job ends failed, shown as
`cloud.request_invalid`, and Cloud is never told the walk is complete. A later step of the runner
releases a finished job, so Cloud deletes its copy at once; it releases a job Cloud reports as
failed too. A job holds at most 1,000 items, context
items included, and 1 MiB, so a venue missing more names than that is sent as several jobs in turn: storing one job's last page
records the next, unless that page left an item unaccounted for, accounted for a number of items
other than Cloud's total, or Cloud stopped the job at the venue's monthly spending cap; either way
the run stops there.

A lost reply or a restart resumes from the job's row. The row keeps the job's body until Cloud
accepts it, and the row's own id is the operation ID, so a retried submit signs the same
fingerprint with the same operation ID and Cloud answers with the job it already made. A lost
page, or a restart part-way through the pages, fetches again from the saved position.

A job that ends after at least one of its items has been accounted for, but before its last page,
because Cloud answers that it has expired or that it has no such job, because the box's own
24-hour clock runs out, or because the service is no longer on, keeps the suggestions already
stored. Every item not yet accounted for is counted as one that could not be done, so when the
alerts bell's Translate all notice appears, it says how many could not be done. No release is sent for such a job.

The box also ends a job itself, without asking Cloud. It does so when the job is 24 hours old,
counted from when the box recorded it; when Cloud's last configuration reply no longer lists the
service as ready, or the connection is revoked; when Cloud refuses a call as a request it will
never accept; when Cloud says the job has expired; and when its last page leaves an item
unaccounted for, or accounts for a number of items other than Cloud's total. A job the box ends itself is marked
released without a call to Cloud. Unless Cloud had already expired it, Cloud may still hold it
until its own deletion: 24 hours
after the job finished, or 24 hours after it was submitted if it never finished (the contract's
`expired` state). The backlog entry "a job the box ends itself is marked released without a call
to Cloud" covers what that leaves open.

Translation calls take the connection's lock only to renew the access lease, or to record that
Cloud refused the installation as revoked or its proof as invalid (`leaseState` and
`recordRefusal` in `apps/server/src/cloud-client.ts`). They never hold it for the translation
exchange itself, so a refresh or a report is not refused with `cloud.busy` while a status or
collect call waits on Cloud. It can still be refused while a translation call holds the lock for
one of those two things, because a refresh and a report do not wait for the lock.

The submit signature covers a fingerprint of the job (`jobSha256`, `jobBytes`), not the job
itself. The signing vectors are `apps/server/test/cloud-translation-vector.json` and the
contract's "Shared test vectors" section.

## Plan and prices

The Cloud services screen's **Plan and prices** section shows the venue's level, its billing
state, the last day of its trial or paid period and Cloud's published prices, with an **Open
Cloud account** link. A venue not yet connected has no **Plan and prices** section; the screen
offers a **Create a Cloud account** link instead: version 1 of Cloud's "Venue billing display" read answers a paired installation alone, so it
shows no prices. The box only displays these values; it switches nothing on or off from them.

The dashboard reads `GET /management-api/cloud/billing` (`system.manage`, on the primary only).
The server asks Cloud with the signed `billing-display` read (`fetchBillingDisplay` in
`apps/server/src/cloud-billing.ts`) at most once a minute per pairing for every dashboard together,
counted from when the read went to Cloud (from when it started, if the lease could not be renewed
first); a 429's `Retry-After` can make the wait longer, up to an hour
(`billing()` in `apps/server/src/cloud-client.ts`). The answer is kept in memory only, never on
disk. A reply outside the contract's shape is refused as `cloud.unavailable`, and so is one
whose `asOf` lies more than 60 seconds before the read was sent or after its reply arrived, and one whose
published prices take effect after the reply's own calendar day.
When the read fails, the screen clears the values it showed and says the details are not
available. The signing vector is `apps/server/test/billing-display-vector.json`, a copy of the
contract's.

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

If the restore is refused, your safety confirmations stay ticked for that approval so you can
retry. Leaving the page or changing the approved snapshot clears them.

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
`backup.env`, so the replacement does not inherit the backup settings kept in that file. It does
inherit the database and the vault key, and with them the settings the database holds sealed: the
bucket copy's settings (`backup.stream`) with its bucket's access keys, and the archive settings
saved from the dashboard (`backup.archive`) with the access keys of any bucket they name.

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
records the stop in `cloud-replacement.json`, unless that file cannot be read. With the stop
recorded, if `cloud-connection.json` is lost, the import on the next start or **Check
reconnection** restores the connection with the stop still waiting, and the next check with
Cloud, once a minute or **Refresh status**, sends the stop again. A stop pressed while **Check
reconnection** is running may be refused as busy; if it is, press it again once the check
finishes. On a server that was not restored from a Cloud snapshot, the screen offers **Connect to
Cloud** instead of **Request reconnection**. Keep the previous server out of service throughout.

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
installed checkout. It needs a Cloud that supports `servicesVersion` 2 (see
[Run the integration proof](#run-the-integration-proof)). It calls `apps/server/scripts/cloud-capture-client-fixture.ts` only on disposable
roots and exercises actual signatures, temporary storage access and Waitron restore hooks.
The fixture is not an operator command for a real venue.


The byte-array uploader accepts at most 512 MiB and has a 30-second request deadline.
Scheduled captures use `uploadCloudCaptureFile`, which streams the saved archive with a
deadline capped at fourteen minutes and the temporary credentials’ expiry. Each upload call
makes one attempt; the scheduler retries from the durable spool with backoff. It checks its
abort signal so deliberate shutdown does not record a service outage.

## A951 build intake

### Host/custody amendment: 2 November 2026

Review artifact [host/custody amendment](../superpowers/specs/2026-11-02-a951-host-custody-amendment.md):
`waitron-a951-host-custody-v1` / `proposal-2026-11-02.1`, full-file SHA-256
`50001abafc7c3edea270821e0a8570f8c722969d62132070a46d9cd3729956d2`.
Accepted amendment digest: **NONE**; accepted executable consumer/runtime pair:
**NONE**. Document review supplies neither bilateral acceptance nor host evidence.

The amendment decides the proposed native caller/service and supervisor socket
custody boundary and requires a fully populated exact-pin manifest and negative/
valid-positive host matrix. Names of future executables are proposals, not shipped
entries or measured hashes. The original helper file and its D130 acceptance digest
below are unchanged; isolated-profile acceptance supplies no real host proof.

**G1 mapping:** Lane G's future item after D462 maps appliance/helper closure,
history, reconnect and intact-reboot semantics against this digest under D132's
unchanged bounds. This local host amendment does not accept or implement that mapping.
**G7 host evidence:** Lane E's post-publication A951 execution remains **BLOCKED**,
waiting for Docker/bench with the owner on **3 November 2026**. Runtime admission
stays CLOSED. The date is an assigned dependency, not an executed qualification.
G2 current authority, G3 unchanged test-only staff, G4 upstream, G5 moves, G6 routing/
privacy and remaining device/origin gates retain their scope. Production customer
manifest empty; `.local` independent; no new owner build-permission question.

The dated intake bodies below remain historical receipts with their original
artifact digests; this entry does not rewrite them.

### A1018 dependency update: 24 October 2026

At 04:07 the owner approved the [revised handover design](../superpowers/specs/2026-10-23-a1018-simple-handover-design.md),
both Harbour Kitchen examples and the retained defaults. This settles the A1018
owner design question that the dated intake below still lists as pending.
After takeover M2 alone handles AEAT; returning M1 transfers only fiscal
originals and received outcomes. Exact formats, compatible A947 amendments,
separate A1018 build authority and physical runtime qualification remain open.
A951's other contract and runtime gates retain their scope.

### Current response disposition: 23 October 2026, D130/D132

Use this response and the [focused plan amendment](../superpowers/plans/2026-10-22-a951-connection.md#focused-d130d132-amendment-2026-10-23)
for current path-scoped gates. Only the D130/D132 review sections in the supplied
snapshots were read for this response. Their pins identify review sources;
this response supplies no runtime qualification.

| Pinned review source                                                                                                                                                                                                                                              | Full source-document SHA-256                                       | Exact source words, then intake consequence                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [D130 helper/routing response](https://github.com/waitron-io/waitron-cloud/blob/1ecaf2c5b43c8011e1aa2493a3d27f84b7b5a8e8/docs/waitron-integration-contract.md#a951-helper-and-routing-response-2026-10-23-d130), Cloud `1ecaf2c5b43c8011e1aa2493a3d27f84b7b5a8e8` | `45eac989f3af786b1ca6963f5fb921ad092c8bf71fb9c67b230b49988ed31183` | “Cloud accepts its engineering profile for T3 implementation with isolated fixtures.” Lane E matches that acceptance for the exact helper local profile below, with no live-adapter or host qualification. |
| [D130 manifest disposition](https://github.com/waitron-io/waitron-cloud/blob/1ecaf2c5b43c8011e1aa2493a3d27f84b7b5a8e8/docs/waitron-integration-contract.md#a951-helper-and-routing-response-2026-10-23-d130)                                                      | Same D130 source digest                                            | “Accept the exact 83 ASCII bytes displayed in that proposal, with no final newline” Lane E matches the separate empty-manifest acceptance; no nonempty routes or customer products are accepted.           |
| [D132 appliance response](https://github.com/waitron-io/waitron-cloud/blob/4e07a98a9dad1073289a76b086073afc36728191/docs/waitron-integration-contract.md#a951-appliance-response-2026-10-23-d132), Cloud `4e07a98a9dad1073289a76b086073afc36728191`               | `fd6bad29674a29bf8fec3e812c30acb2918ad8d4a9804411ef6227160aef434e` | “It did not accept the new appliance-to-helper mappings here.” The appliance and its integration mappings require D132’s returned amendments and a revised full-artifact disposition.                      |

**Matching E helper acceptance:** `waitron-a951-helper-v1` /
`proposal-2026-10-23.1`, [exact helper source at Waitron
`fc54735435bc88b5fe7ba376c074fe8010c63401`](https://github.com/clintongormley/waitron/blob/fc54735435bc88b5fe7ba376c074fe8010c63401/docs/superpowers/specs/2026-10-23-a951-local-helper-v1-proposal.md),
SHA-256 `da433f66a7dcb835e99eeb4a7e5c6f01f2bc9c69db369c44a5131247a4ab008f`.
This accepts the original engineering profile solely for isolated T3 implementation
with explicit injected policy. It accepts no appliance mapping, real G1/G2 proof,
live adapter or actual host/custody performance. All numbers remain requirements
from that exact helper profile, not measured Linux behavior.

**Matching E empty-manifest acceptance:** exact original 83 bytes without final
newline, revision `proposal-2026-10-23.1`, SHA-256
`271fefd892b2c0f10ffab42f8e4a832a163b244733285f08d5a0ea1dfab1b012`.
The [routing successor](../superpowers/specs/2026-10-23-a951-routing-v1-revision2.md)
is artifact edition `proposal-2026-10-23.2`. It returns D130’s boot-bound,
suspend-aware contexts/deadlines and literal read-boundary controls while retaining
the original manifest bytes and revision. Its full publication SHA-256 is
`974c4e98eb7d583d82ad1c573f9dcec01c63b2cc4f6630d38aeda22775d198d0`.
**Lane G disposition remains pending; full routing and shared-parser code are not accepted.**

The comparison pins Cloud `c0d0e800529ec6c1557fce9a4d68b9b43b7447dc` and
Waitron foundation `72aed2e21705c9d02b6beda5ef248410ffc9b73a` identify source
baselines, not implementations. D132 additionally compares Cloud
`1dc34b2e460ffcbf110fd11c9768d68a8704c0e9` with the same Waitron foundation.
Accepted appliance digest: **NONE**; accepted full-routing digest: **NONE**;
accepted executable Waitron consumer: **NONE**; accepted executable Cloud
consumer: **NONE**; real accepted consumer pair and qualified runtime pair: **NONE**.
Record resulting real consumers, scope and accepted full-artifact digests in both
repositories before connecting those implementations.

| Affected path         | Current disposition                                                                                                                                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0                    | All five build cuts already approved. No repeat A951 owner build question.                                                                                                                                                                                                                                           |
| G1/T3 isolated helper | Exact original local profile accepted by E/G. Follow the focused T3 additions in the plan; external proofs remain injected and synthetic. Actual host/listener custody is G7 unverified.                                                                                                                             |
| G1/T1/T2/T5 appliance | Amendments required: actual approval/provisioning consumers; separately versioned helper custody/safety mapping for temporary closures versus durable stops, intact reboot and safety limits; complete signed-byte corpus; current helper/routing/A1018 references. No appliance acceptance or affected integration. |
| G2                    | Actual A947 current-authority/freshness/withdrawal mapping remains open. Keep endpoint ID distinct from the actual authority target and reconcile latest A1018/D88.                                                                                                                                                  |
| G3/G4/G5              | Staff-v1 client policy, independent public-upstream issuer/mTLS/mapping/transport, and moves/replacement remain gated for their paths. Staff v1 remains unchanged and test-only.                                                                                                                                     |
| G6/T4                 | Exact empty manifest accepted separately. Routing revision 2 and its full digest require new Lane G acceptance before shared-parser code.                                                                                                                                                                            |
| G6/T13, A980/D101     | Diagnostic/export schema and flow-scoped processing/access/destination/retention remain open, including staff metadata. No export permission follows from local receipts.                                                                                                                                            |
| G7/live runtime       | No runtime/host/device qualification supplied. Real admission disabled, production customer manifest empty, `.local` independent. No provider/host/customer/fiscal action or publication/pause control.                                                                                                              |

Latest A1018 source direction supplied for this response: canonical Cloud
`08a2a0d4290cf7fbd54a87d2493b6d9727f8f7ec`, accepted source
`d9252ac34f2b7e946e1154dd5af1a443c2c39ad4`. After takeover M2 alone handles
all AEAT communication, including returned M1 fiscal records and outcomes, as
required by [D132’s fourth return](https://github.com/waitron-io/waitron-cloud/blob/4e07a98a9dad1073289a76b086073afc36728191/docs/waitron-integration-contract.md#required-revisions-before-appliance-acceptance).
The A1018 owner design question remains pending; an accepted source pin is not
owner approval. No fiscal implementation or authority is supplied here.

### Historical intake retained below, labelled on 23 October 2026

The original intake and proposal notices below retain their publication state.
Their blanket “no accepted helper” wording is explicitly superseded **only for
D130’s exact isolated local-helper scope** and its separate empty-manifest
acceptance. Their appliance, full-routing, live-adapter and runtime gates remain;
neither the original body nor the original helper/appliance/routing proposals
are silently rewritten.

Before you implement the lasting connection, separate the owner's build approval
from the protocol agreement with Cloud. The owner approved the complete
[A951 plan](../superpowers/plans/2026-10-22-a951-connection.md) and all five cuts on
23 October 2026, answering “Go ahead and build.” (watcher relay about 06:45).
Start with Cut A. Keep each affected adapter unstarted until its pre-code agreement
is recorded; the plan permits isolated foundation fixtures without real admission.

### Cloud response published on 23 October 2026

Cloud published its [Cut A contract review](https://github.com/waitron-io/waitron-cloud/blob/ca5d2a996b93d16c55ccb79b8c3d2228792b5090/docs/waitron-integration-contract.md#a951-cut-a-contract-review-2026-10-23)
in PR #313 at `ca5d2a996b93d16c55ccb79b8c3d2228792b5090`.
Its disposition is **amendments required**. Lane G owns the Cloud response; Lane E
owns this intake, the client and the local helper boundary. Lane D retains D88
and gateway deployment. The review inspected Cloud
`b16f3ca630019f693d7db999aadc0167c0ef9027` and Waitron
`9a016bb85ae0dab7d334b6fd52929f49d3cf042f`; those source revisions do not
identify a qualified pair of running consumers.

The full published contract has SHA-256
`57df8883fb8dc50f5e0d93c63779ddb1c4831c16243e0df338a1cd6458522f4a`.
This pins the review document. **Accepted appliance, helper and parser artifact
digests: none.** Keep their adapters unstarted while the named owners resolve the
technical amendments. Existing staff-v1 compatibility is reaffirmed; its client
policy and the independent public-upstream agreement remain open.

| Published source                                                                                                                                                                               | Source wording                                                                                                                               | Consequence for this intake                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [Cut A review](https://github.com/waitron-io/waitron-cloud/blob/ca5d2a996b93d16c55ccb79b8c3d2228792b5090/docs/waitron-integration-contract.md#a951-cut-a-contract-review-2026-10-23)           | “No A951 wire/helper/parser artifact is accepted by this review.”                                                                            | The response resolves ownership and the disposition, without opening G1 or G6.                  |
| [Scoped agreements](https://github.com/waitron-io/waitron-cloud/blob/ca5d2a996b93d16c55ccb79b8c3d2228792b5090/docs/waitron-integration-contract.md#what-each-scoped-agreement-still-needs)     | “Internal foundation fixtures may continue under the approved plan with explicit injected policy, no real admission and no customer routes.” | Isolated foundation work remains within the existing build approval.                            |
| [Staff-v1 compatibility](https://github.com/waitron-io/waitron-cloud/blob/ca5d2a996b93d16c55ccb79b8c3d2228792b5090/docs/waitron-integration-contract.md#existing-staff-v1-compatibility-facts) | “Neither is a transport grant or writer permission.”                                                                                         | Keep the existing control lease and machine proof separate from transport and writer authority. |

| Plan gate                 | Intake status and required next agreement                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0, owner                 | Complete plan and all cuts approved. No repeat build question is needed.                                                                                                                                                                                                                                                                                                                                                      |
| G1, appliance and helper  | Lane E and Lane G are named; exact consumer pins and accepted artifact digests remain open. Return versioned positive/rejection vectors and agree authenticated bytes/actions, identity bindings, the three counters, certificate invalidation mapping, reports/replay and establishment/recovery. Pin helper framing, owned resources, addresses/ports, IPv4/IPv6 and expiry/removal rules before the T1 codec or T3 helper. |
| G2, current authority     | Pending the actual A947 interface and Cloud agreement. Inspect its eventual landed source and withdrawal/freshness result before real admission. Membership, installation status and a primary-role boolean supply no substitute. Isolated authority fixtures remain permitted.                                                                                                                                               |
| G3, staff v1              | Existing opt-in, test-only v1 compatibility reaffirmed. Agree response-byte/request-time bounds, polling/jitter/retry hints, reconciliation deadline, renewal and key cadence before T7/T8. Production issuance stays separately gated.                                                                                                                                                                                       |
| G4, public upstream       | Pending an independent issuer/trust, purpose, authentication, bounds, renewal/revocation and connection-closure contract before T10's adapter.                                                                                                                                                                                                                                                                                |
| G5, moves and replacement | Pending predecessor/phases, conditional commit/status, retirement/drain/expiry and recovery epochs before T11's adapters.                                                                                                                                                                                                                                                                                                     |
| G6, routing and privacy   | Return the versioned empty manifest and canonical digest, shared raw-request normalization vectors, authenticated gateway/venue/endpoint/epoch context and bounded diagnostic schema before cross-repository parsers or diagnostic export. A980/D101 flow acceptance precedes real metadata/traffic processing. Customer product agreements remain separate.                                                                  |
| G7, runtime and devices   | No runtime/device qualification is supplied by this intake. Keep real admission disabled until the applicable helper/host, executable pins, DNS/issuer and device/origin evidence is accepted.                                                                                                                                                                                                                                |

Keep timer policy explicit in synthetic fixtures. The plan's proposed ten-minute
transport grant, one-minute attempts, 30-second drain and CSR backoff are not accepted
runtime defaults. The existing one-hour control lease and 60-second proof window
keep their staff-v1 meanings.

Resolve the remaining artifact requests between Lane E and Lane G in both sides'
ledgers, coordinating D88 and gateway deployment with Lane D. Before coding each
affected adapter, record its versioned artifact, acceptance digest, both consumer
revisions and allowed scope in the canonical Cloud contract and this intake. The
published review is a response to the request, not acceptance of those artifacts.
No repeat owner build question is needed. Keep A947's actual authority interface,
the revised A1018 handover and D88 cold recovery as their separate dependencies.

### Local helper proposal for Lane G review

The [local-helper v1 proposal](../superpowers/specs/2026-10-23-a951-local-helper-v1-proposal.md)
returns the G1/T3 process and network boundary requested by Cloud. Lane E owns this
proposal; Lane G must accept or amend it in the canonical contract. Its proposed
bounds and wire examples are review material, not runtime defaults or observed
host behaviour. No helper implementation or real admission is supplied here.

Keep the helper agreement separate from the G1 appliance authentication and
recovery artifact, G2 current authority, G4 public-upstream trust, G5 moves and
G6 routing/diagnostics. Before affected code, record the accepted version/digest,
both consumer revisions and allowed scope in both repositories. The proposal's
publication hash identifies the review material; it is not an acceptance digest.

### Routing proposal for Lane G review

The [routing v1 proposal](../superpowers/specs/2026-10-23-a951-routing-v1-proposal.md)
returns the G6/T4 empty manifest, raw-request refusal vectors and local verified
forwarding-context boundary. Lane E and Lane G must agree its exact artifact and
consumer revisions before shared parser code. Its examples and limits are proposed
choices, not accepted routing policy or runtime evidence. Both production customer
manifests stay empty.

G4 must separately agree the upstream peer authentication and context mapping.
The G6/T13 diagnostic schema and A980/D101 processing acceptance remain open;
this routing proposal settles neither. No customer product or service is enabled.

### Appliance proposal for Lane G review

The [appliance v1 proposal](../superpowers/specs/2026-10-23-a951-appliance-v1-proposal.md)
returns G1/T1's authenticated messages, trust, counter and recovery boundary.
Its concrete formats and limits are proposed engineering choices. Lane E and
Lane G must record acceptance, the exact artifact digest, both full consumer
revisions and allowed scope before the affected codec or state adapter starts.
The helper and routing proposals remain separate, unaccepted artifacts.

Keep actual A947 authority, staff-v1 policy, public-upstream trust, moves,
diagnostic/privacy and runtime qualification as their scoped gates. Publication
of this proposal supplies no recovery permission, writer activation or real
remote admission. It requires no repeat owner build question.

### Earlier source inventory

The document digests below retain the initial inspection at Cloud
`d0f89fbf105f4b15360bf21821b8b22d6fffe0d8`. They are historical source
receipts, not accepted artifact digests or runtime qualification. Use the dated
response above for the current disposition; retain the A1018 handover revision
when reconciling later Cloud publications.

| Cloud document at the earlier pin                                   | SHA-256                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `docs/waitron-integration-contract.md`                              | `1b0f35cff8cc7a69b79d9d785fa0f6058f387f385fadec63a97c3f6f720ef4b3` |
| `docs/product-and-platform.md`                                      | `f3ccc126d829b380d2bf31a4983406a4a15c05fc156454e8cd359ff9bbbb18ff` |
| `docs/superpowers/specs/2026-10-22-cloud-data-protection-design.md` | `34c27c92f952b2499c140533efd9193063821348977bf8fa83003001acf459d1` |
