# A947 slice 3b — the spare hosts the store, and joining brings the data — Implementation Plan (revision 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Revision 1, 2026-11-04.** Written against `main` at `6a52e7189c`. Line numbers are that commit's.
Not yet reviewed: the fresh-context plan review comes next.

**Spec:** [`docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md`](../specs/2026-10-21-a947-two-box-failover-design.md)
§11 slice 3b; §3 (the shape); §4 items 1, 4, 5 and 6 and the `node.db` paragraph; §5's first
paragraph; §6.6 way 1 (only the selling box answers the venue's name); the dated A1018 block at the
top. Also read, for what it expects of 3b: the
[A1018 build plan](2026-11-02-a1018-handover-build.md) "Before you build" facts 1–5 (`:80-125`),
the slice table (`:776-796`) and "Slice 3 as built" (`:1731-1760`, Rulings R12 and R13).

## The header facts, for scheduling

- **Six pull requests**, in order: 3b-1 → 3b-2 → 3b-3 → 3b-4 → 3b-5, then **3b-F**. Each leaves
  `main` green and working on its own (the cut is explained below). 3b-1 does not depend on the
  others and may be built beside 3b-2.
- **Fiscal: one of the six.** 3b-F (the spare's dormant tax-filing setup at joining) is fiscal and
  waits for the owner to land it. The design calls 3b "Not fiscal"; it did not know that today's code
  refuses to add a spare to a venue that files with Veri*Factu at all (probe P6, below), so making a
  spare finish joining on a real venue needs one fiscal change. That is the owner's question Q1.
- **Migration: yes, one, in `node.db` only** — in 3b-4: a new table `node_pair_link` in the node
  migration set (`packages/node-db/drizzle`, which holds `0000` and `0001` today). No `venue.db`
  migration is planned in any of the six; 3b-F's trace (Task F.0) may find it needs one, and its
  pull request's first line then says so. No venue reset is needed: the new table is additive and every other
  change is code.
- **Review path: full** for 3b-2, 3b-3, 3b-4, 3b-5 and 3b-F. They touch trust and authentication
  (keys, certificates, an access key, who a box believes), cross-package contracts (`@waitron/node-db`,
  `@waitron/membership`'s chart minting, the stream's target in `stream-host.ts`, the till's server
  router), and in 3b-F a fiscal module. 3b-1 (a binary and its licence notices in the image) touches
  no risk trigger and takes the light path. The Codex run-it seat runs on every branch, as always.

## Words used here

- **Main box / spare box** (staff words): the box that sells, and the box that keeps a copy. The
  code says primary and mirror.
- **`venue.db`**: the venue's database, which the main box streams. **`node.db`**: each box's own
  small database, never streamed (slice 3a).
- **The store**: a small S3-compatible file server — the program **versitygw** — that runs on the
  spare and receives the main box's stream. S3 is the file-storage protocol Amazon defined; slice 2
  built the stream on it.
- **The stream**: **Litestream**, the program that copies every change to `venue.db` into a store,
  about a second behind. Version 0.5.17 is pinned.
- **The first full copy**: the whole database, which Litestream sends first to a new store, before
  the stream of changes.
- **The chart** (membership chart): the signed document listing every box of the venue, its
  address (`contactUrl`) and its standing. **Endorsement**: one box's signature over another box's
  public key, which lets a third party trust that key.
- **Authority**: the venue's certificate authority, the key that signs the boxes' HTTPS
  certificates, which every till trusts since pairing. **Leaf**: one box's own HTTPS certificate.
- **mDNS**: how a `.local` name (such as `waitron.local`) is found on the venue's network without a
  name server: a device asks the whole network, and the box with that name answers.
- **Finished joining**: a spare whose `nodes` row the main box's `venue.db` holds (A1018's
  definition; the start check counts only such boxes).
- **The adoption latch**: `pending-adoption.json`, the file a joining spare writes and keeps until
  it has finished joining (`apps/server/src/finish-adoption.ts:17-18`).

---

## What slice 3b delivers, in one paragraph

After 3b, the owner can add a spare to a venue with the internet unplugged, and it ends up holding a
full copy of the venue. The spare runs the store; the main box streams to it over the venue's
network, encrypted under the venue's authority, with an access key made for this pair. Each box has
its own name (`box-7f3a.waitron.local`), written in the chart and in its certificate, and only the
box that sells answers `waitron.local`. The boxes find each other by those names, trust each other's
certificates and signed answers, and the main box writes the spare's `nodes` row, so the spare
finishes joining. What 3b does **not** do: the spare does not keep following the stream into its
own copy (3c), nobody can switch to it yet (4b–4e), and a venue that copies to its own storage
bucket cannot add a spare until copy-up exists (5e).

---

## What exists today, traced on `6a52e7189c`

Every line below was opened or run on this commit. "Probe Pn" points at the "Probes" section at the
end, which gives the command and what it printed.

1. **A spare cannot join a venue that files with Veri*Factu.** `adoptFromPrimary` calls
   `assertAdoptionModules` (`apps/server/src/adopt.ts:143`), which refuses any module that has
   operations and opens its series at activation (`finish-adoption.ts:20-26`) — the fiscal module
   does. The test "refuses allocation-dependent adoption before its first local write or handover"
   expects `module.operation_invalid` `{ module: "fiscal-verifactu" }`, and "still adopts when the
   allocation-dependent module is disabled" (`apps/server/src/adoption-allocation-refusal.test.ts:141,158`;
   probe P6: 5 passed). The check runs **after** the main box has already reserved for the spare and
   added it to its chart (`adopt.ts:106-111` fetches the bundle first; `mirror-bundle-api.ts:127-143`).
2. **A joined spare never finishes joining** (A1018 fact 1): the latch is written at
   `adopt.ts:195-202`; finishing refuses `mirror.venue_not_copied` while the spare's own `venue.db`
   has no venue row (`apps/server/src/reserved-identity.ts:68-69`), and nothing copies one. Finishing
   today also inserts the spare's `nodes` row into the **spare's** file (`reserved-identity.ts:77-85`),
   not the main box's (A1018 fact 3).
3. **Joining needs a Cloud relay.** The main box's bundle route refuses `mirror.no_relay` when no
   tunnel is configured (`apps/server/src/mirror-bundle-api.ts:117`; the relay comes only from the
   tunnel settings, `boot.ts:3321-3324`; probe P1). So a venue with no Cloud connection cannot add a
   spare, against design goal 6 ("Adding the spare box needs no internet either"). The mirror link's
   `relayUrl` has one reader: the boot reconcile's peer address (`boot.ts:1921`).
4. **Both boxes advertise the same address.** The spare sends `deps.advertisedOrigin` as its
   `contactUrl` (`adopt.ts:109`); the first box seeds its chart row with the same value
   (`boot.ts:1641`, `first-setup-publication.ts:68`); `advertisedOrigin` defaults to the management
   origin (`config.ts:539-541`), which the image sets to `https://waitron.local`
   (`deploy/Dockerfile:277`). The start check never asks a peer at its own address
   (`boot-peer-check.ts:143-149`, `own_address`).
5. **Every box answers `waitron.local`, whatever it is doing.** Five starts call
   `startMdnsResponder({ hostname: BOX_HOSTNAME, … })` — setup (`boot.ts:1656`), the adoption latch
   (`:1718`), the restricted start (`:1778`), the waiting start (`:1866`) and the full start
   (`:3625`) — and the responder answers that one name to anyone (`mdns.ts:59-73`).
6. **A mirror cannot be reached from the venue's network.** `assertMirrorBindSafe` refuses a mirror
   that listens on anything but loopback unless `WAITRON_MIRROR_ALLOW_EXPOSED` is set
   (`apps/server/src/mirror-bind-guard.ts:14-23`, called at `boot.ts:2005`); the image listens on
   `0.0.0.0` (`deploy/Dockerfile:275`) and nothing under `deploy/` sets the opt-in (probe P3). So a
   spare that finished joining would fail to start with `server.mirror_bind_exposed`. The guard
   exists because a mirror serves an ambient full-administrator dashboard with no sign-in
   (`mirror-session.ts:85-92`, mounted at `boot.ts:2020-2025`).
7. **Boxes cannot find each other by a `.local` name.** The runtime image is `node:26-slim`
   (`deploy/Dockerfile:164`); in it, `/etc/nsswitch.conf` reads `hosts: files dns` and there is no
   `libnss_mdns`, so Node's name lookup — which `fetch` and `node:https` use — fails for a `.local`
   name even while an mDNS responder on the same network answers it, and a direct mDNS query from
   Node gets the answer (probe P5). Inferred, not run against a box: a spare joining by the name
   `https://waitron.local` fails at the lookup today, and only an address typed as an IP works.
8. **A main box holds no key for its spare** (Ruling R13). `peerKeyOf` knows this box's own key, a
   pinned main-box key and keys the held chart's endorsements vouch for
   (`apps/server/src/handover-signing.ts:32-41`); a minted chart carries only its signer's own
   endorsement (`apps/server/src/membership-mint.ts:67-73`). A chart carrying the main box's
   endorsement of the spare makes the spare's key known; a wrongly signed one does not (probe P4).
9. **A main box does not pin anything when it asks a peer** (Ruling R12): `authorityOf` returns a
   certificate only for the spare's own origin box (`start-peer-check.ts:191-196`), and otherwise the
   ask connects with `rejectUnauthorized: false` (`boot-peer-check.ts:346-353`). The boot reconcile
   uses the plain global `fetch`, with no time limit and no pin (`membership-reconcile.ts:60-78`).
10. **The venue authority can sign a box's own name.** A leaf for `box-7f3a.waitron.local` that the
    box's authority signs verifies under that authority; a leaf from another authority, a leaf
    without the name, and a name outside `waitron.local` are refused (probe P2; the authority's
    permitted names, `self-signed-cert.ts:34-40`). Since 3a a spare holds the venue authority as
    `tls/venue-ca.crt` and `tls/venue-ca.key` (`box-secrets.ts:93-101`), "unused by the listener
    until slice 3b" (3a plan, OQ3); nothing else reads them except the backup's optional state
    (`backup-optional-state.ts:14-15`).
11. **Litestream trusts only the system's certificate list.** At v0.5.17 its S3 client builds its own
    HTTP transport and sets TLS options only to skip checking (`s3/replica_client.go:384-410`);
    `root-cas` exists only for NATS (`cmd/litestream/main.go:1175`) (probe P11). On Linux,
    `SSL_CERT_FILE` naming the authority made it stream (probe P7); on macOS the same setting did
    not (probe P8). With no trust, Litestream wrote nothing for 90 seconds **and logged no error**
    (probe P7).
12. **A byte pipe solves both.** Litestream speaking plain HTTP to a loopback port on the main box,
    piped by Node over TLS pinned to the venue authority to a Node TLS listener on the spare, piped to
    versitygw on the spare's loopback, streamed and restored on macOS; with another authority pinned,
    nothing was written and Node logged `CERT_SIGNATURE_FAILURE` (probe P9). The request signature
    (S3 signs the `Host` header) passed through unchanged, as the repository's own rehearsal proxy
    already relies on (`aws-rehearsal-interrupt.e2e.test.ts:94-95`).
13. **versitygw is ready to ship.** The repository pins 1.8.0 with checksums for four platforms
    (`scripts/setup-s3-test-server.mjs:20-39`) and a second copy of the version
    (`apps/server/src/testing/s3-test-server.ts:20`). Its release tarball carries `LICENSE` (Apache
    2.0, the same text as `deploy/third-party/licenses/Apache-2.0.txt` but for one leading blank
    line) and `NOTICE` ("versitygw - Versity S3 Gateway / Copyright 2023 Versity Software"); it takes
    its access key from `ROOT_ACCESS_KEY_ID` and `ROOT_SECRET_ACCESS_KEY` in the environment, not
    only from the command line (probe P10). The image already ships Litestream the same way: a
    pinned stage with checksums (`deploy/Dockerfile:145-159`), a pin test
    (`scripts/litestream-pin.test.ts`), generated Go module notices
    (`scripts/litestream-notices.mjs`, `deploy/third-party/litestream/NOTICES.txt`), and an
    image-smoke step that runs the binary (`.github/workflows/image-smoke.yml:270-285`). Go is not
    installed on this Mac (probe P12).
14. **The bucket settings live in `venue.db`**, sealed, as purpose `backup.stream`
    (`stream-host.ts:30`), saved by `PUT /api/backup/stream` (`stream-api.ts:227-250`). Litestream
    0.5 streams a database to one place only (design §3, reason 1), so a venue cannot stream to a
    bucket and to the spare at once.
15. **Rotating the key ring leaves the spare behind** (A1273): `rotateCredentials` re-seals the main
    box's vault rows and its own signing key under the ring's current version
    (`packages/credentials/src/store.ts:260-285`), and nothing sends the new ring to a spare.
16. **A lost `node.db` reads as a sole primary** (A1274): `packages/node-db/src/mode.ts:15-16`. Before
    3b a spare holds no venue data, so its start fails before it could sell. After 3b its
    `venue.db` holds the main box's sales and its own `nodes` row, so the same start would come up as
    a selling, filing primary beside the main box — and the drain files across every invoicing
    installation in the database with no node filter (design §2). **3b is the slice that makes this
    reachable**, so 3b takes A1274 (Task 5.5).
17. **The till keeps the page's own address first.** The router always lists the page's origin
    first (`apps/till/src/api/server-router.ts:253`) and keeps the earlier entry on a tie of terms
    (`:140-144`, the `reduce`). Its lock screen draws one status line per entry
    (`apps/till/src/screens/till-lock-screen.ts:398-399`). Read, not run. So once a one-box venue's
    chart names the box by its own name, its tills would list the same box twice — Task 2.4 merges
    entries that report the same `nodeId` (`/api/node` answers it, `node-api.ts:49-55`).

---

## The cut, and why

| PR | What it does | Leaves `main` working because | Fiscal | Migration | Review |
| --- | --- | --- | --- | --- | --- |
| **3b-1** | versitygw in the box image, its licence notices, its pin | the binary sits unused | no | no | light |
| **3b-2** | Each box's own name: in its chart row, its certificate and its mDNS answers; only the selling box answers `waitron.local`; a spare's certificate comes from the venue authority; tills show one line per box | a one-box venue keeps selling at `waitron.local`; a spare has no data yet, so nothing else changes | no | no | full |
| **3b-3** | Boxes reach and trust each other: mDNS lookup for box-to-box calls, the venue authority pinned on every one (R12), the boot reconcile through the same transport, charts that vouch for every listed box's key (R13), a mirror that listens on the network with its ambient dashboard on its own screen only | no box has a counted peer before 3b-5, so the start check still proceeds | no | no | full |
| **3b-4** | The store on the spare and the pair's access key: `node_pair_link`, a joining route that needs no relay and refuses first (a bucket stream, a fiscal venue until 3b-F, a name already taken), the spare running versitygw behind a TLS listener, the bucket screen refusing while a spare is joined, rotation refusing while a spare is joined (A1273) | the store runs and receives nothing; nothing streams to it yet | no | **yes** (`node.db`) | full |
| **3b-5** | Joining brings the data: the main box streams to the spare, writes its `nodes` row when the store answers, the spare restores the first full copy and finishes joining; a box with a lost `node.db` refuses to start (A1274); the two-box test; the guide | a venue that does not file with Veri*Factu can add a spare end to end; a Veri*Factu venue is still refused at the start of joining | no | no | full |
| **3b-F** | A Veri*Factu venue can add a spare: the spare's dormant tax-filing setup is written at joining, so it can later be switched on | the refusal 3b-4 moved to the main box is lifted only here | **yes — the owner lands it** | no | full |

Why this order: names before trust (3b-3 pins the venue authority, which 3b-2 puts on both boxes);
trust before data (3b-5's main box must verify the spare and vice versa); the store before the
stream; the fiscal change last, so the five non-fiscal PRs never wait for the owner's landing. A
non-fiscal venue (the fiscal module disabled, as the existing adoption tests already run it,
`adoption-allocation-refusal.test.ts:158`) proves 3b-5 end to end without 3b-F.

## Which A1018 slices each 3b PR unblocks

A1018 Slices 0–4 have landed; Slice 4 is PR #2442, parked for the owner. "Reachable on real boxes"
means: two physical boxes, not the one-process simulation A1018's tests use.

| A1018 piece | What stops it on real boxes today | Unblocked by |
| --- | --- | --- |
| Slice 3 (landed): the start check counts a joined spare | no box has finished joining (fact 3); the main box cannot verify the spare's signed answer (R13) and does not pin its certificate (R12) | 3b-3 (R12, R13), 3b-5 (the `nodes` row) |
| Slice 5: controlled handover, server | M1 cannot reach a mirror bound to loopback (fact 4); Task 5.3 refuses `handover.destination_unaddressable` while M2's chart address equals M1's; M1 cannot find M2 by name; M2 never finished joining | 3b-2 (addresses), 3b-3 (listening, lookup, trust), 3b-5 (finished joining, non-Veri*Factu venue), 3b-F (a Veri*Factu venue's spare can be activated) |
| Slice 6: controlled handover screens | the dashboard opens "M2's own handover page", which needs an address of M2's own | 3b-2 (the address and its certificate). Whether each till platform finds a two-part `.local` name stays A947 4d's measurement |
| Slice 7: emergency handover, server | as Slice 5, plus a copy on M2 | 3b-3, 3b-5, 3b-F; the continuous copy is 3c |
| Slice 8: emergency declaration page | reached at M2's own address | 3b-2; passkeys at that address are 4d (A1018 decision 9) |
| Slices 10–11: the return batch | M1 ↔ M2 calls over the venue's network | 3b-3 |
| Slice 13: becoming the spare | the returning box must join as a spare | 3b-5, 3b-F |
| Slice 14: a last copy from a selected backup | — | nothing in 3b |

## The backlog items this plan was asked to place

| Item | Taken? | Where, or why not |
| --- | --- | --- |
| R13, "A947 3b must make the held chart vouch for a joined box's key…" (`docs/backlog.md:5736`) | **yes** | Task 3.4 (endorsements in every chart) and Task 4.2 (the first chart naming the spare carries its endorsement). Own addresses: Task 2.1 |
| "The boot peer reconcile cannot reach a real box's certificate" (`docs/backlog.md:5746`) | **yes** | Task 3.3 |
| A1273, key ring rotation | **yes, as a rule** | Decision D7, Task 4.5 |
| A1274, a lost `node.db` reads as a sole primary | **yes** | Task 5.5 — 3b makes it reachable (fact 16) |
| A1275, a Cloud peer's chart is refused | no | Cloud work; no Cloud peer signs charts |
| A1276, after two promotions in a three-box venue | no | needs three boxes; go-live is two |
| A1277, a malformed chart signed by a trusted key is copied on | no | 3b does not change how a chart's `nodes` entries are read or copied |
| A1278, the joining route spends a reservation on a chart it then refuses | **yes** | Task 4.2 moves every refusal before the reservation anyway; this one joins them |
| A1279, a local secondary promotes only over its own chart | no | no production caller |
| A1280, a retried join leaves the abandoned id's `node.db` rows | **yes** | Task 4.3: 3b adds a fourth per-attempt row, so adopt now clears every other id's rows |
| A1281, the venue command reads a missing `node.db` as version 0 | no | a command-line path 3b does not touch |
| A1282, the Servers screen's fingerprint is stale after a repair | no | 3b does not change the fingerprint line or the repair. Review Focus 5 names the related risk |
| A1283, no guide page covers the Servers screen or adding a spare | **yes** | Task 5.7: 3b changes the joining steps |
| A1284, an environment-set vault key | no | no production box sets it (`deploy/` names none, per the entry) |
| A1285, the staged reset and `secrets.env` | no | a setup reset question 3b does not change |
| A1295, the venue authority pair in backups | **yes, by removal** | Task 2.2: a joined spare's authority becomes its `tls/ca.crt` and `tls/ca.key`, which backup verification already checks as a pair; `venue-ca.*` go |
| A1296, code-quality follow-ups from 3a | no | none is on 3b's path except the hand-written HTTPS client; 3b extends that one client (`boxExchange`) rather than adding a second |

---

## Decisions made in this plan

- **D1 — Each box's own name is `box-<first four characters of its node id>.waitron.local`**, for
  example `box-7f3a.waitron.local`. The design's example was `equipo-7f3a` and left "the exact
  form" to the builder (§4 item 5); CLAUDE.md §3 makes general code English only. FYI for the
  owner, not a question. The box's own **contact URL** is its advertised origin with the host
  `waitron.local` replaced by that name; an origin with any other host (a development or Cloud
  profile, which already names each server by its own origin) is left as configured. A joining
  spare whose name equals a listed box's is refused `mirror.standby_name_taken` before anything is
  reserved; pressing Connect again draws a new node id (`adopt.ts:105`).
- **D2 — The main box's own chart row carries its own name too.** The first setup seeds it, a
  rebuild rewrites it, and the joining route rewrites the signer's row when it still holds the old
  value. No code converts existing charts (CLAUDE.md §3, pre-live): the joining route's rewrite is
  the one place a chart changes.
- **D3 — `waitron.local` is answered by a box that sells, and by a box in setup mode.** The first
  setup of a venue is reached at `http://waitron.local/setup/trust` (`deploy/waitron.sh:465`), so
  setup mode keeps answering. The cost, stated: while a second box is being set up, a till that
  reloads may reach its setup page; that lasts until it joins. Every other start — the adoption
  latch, a mirror, restricted, waiting, fenced — answers only its own name.
- **D4 — Box-to-box calls use one transport**: `boxExchange` (`mirror-bundle-fetch.ts:117`), with an
  mDNS lookup for `.local` names and the venue authority pinned. Every box holds the venue
  authority as `tls/ca.crt` after Task 2.2, so the pin is unconditional and the unchecked path
  goes (R12). Cost: a box whose operator supplied certificate files of their own (`config.tls`) cannot
  verify a peer; no box is set up that way.
- **D5 — The stream to the spare travels through two byte pipes** (fact 12): Litestream and
  versitygw speak plain HTTP on loopback only; Node carries the bytes over TLS between the boxes,
  pinned to the venue authority, with the spare's name as the certificate name. Chosen over
  `SSL_CERT_FILE` because it works the same on the box and on a developer's Mac (probes P7–P9),
  because a failure is logged by our code instead of retried silently (probe P7), because the main
  box finds the spare by mDNS for every connection (so a changed address is followed), and because
  `@waitron/stream` needs no change: the target is an ordinary bucket setting with an `http://127.0.0.1`
  endpoint, which `readBucketConfig` already accepts (`packages/stream/src/bucket-config.ts:25-35`).
- **D6 — The main box writes the spare's `nodes` row when the spare's store first answers it**, not
  when it hands out the bundle. A join abandoned between the two leaves a chart entry, as today, and
  no counted peer, so the main box does not start waiting at every start for a box that never
  arrived (A1018 Slice 3 counts only boxes with a row). The row is written before the stream starts,
  so the first full copy carries it.
- **D7 — A1273: a key ring change means re-joining the spare.** `waitron-credentials rotate`
  refuses `credentials.rotation_spare_joined` while this box holds a pair link (Task 4.5), and the
  runbook says so. A ring changed by hand in `secrets.env` cannot be stopped by the command; the
  pair link records the ring version handed to the spare, so that 3c's spare alerts, built on the
  same alert machinery, can warn when they differ. Reasons: a rotation is an operator's terminal
  act with no product screen (the box's operator has none); pushing a ring needs its own secret
  channel and a restart of the spare; and go-live does not rotate.
- **D8 — A mirror listens on the venue's network; its ambient dashboard is for its own screen only.**
  `assertMirrorBindSafe` and `WAITRON_MIRROR_ALLOW_EXPOSED` are retired; `mirrorSession` attaches the
  viewer only to a request from the box itself (`requestFromBox`, `request-from-box.ts:40`), and any
  other request reaches the routes with no session. Today the viewer is reachable only from the box
  itself anyway (loopback), so nobody loses access.
- **D9 — The spare's certificate authority becomes the venue's.** At joining, adopt writes the
  bundle's authority as the spare's `tls/ca.crt` and `tls/ca.key` (replacing the one it made for
  itself in setup mode), and the next start issues a leaf from it. `tls/venue-ca.*` are no longer
  written. This makes D4's pin one file on both boxes and retires A1295.
- **D10 — 3b restores the first full copy once; 3c follows.** In the adoption-latch start the spare
  restores the newest point of the stream from its own store into a scratch file, checks it, and
  the next start puts it in place of its `venue.db`. Until 3c, the spare's `venue.db` stays as it
  was at that moment, while its store keeps receiving every change.
- **D11 — The store's port is 7443** (`WAITRON_SPARE_STORE_PORT`, a new setting with that default),
  on the spare's listening address. Nothing in the tree uses 7443 (`git grep -n 7443 -- deploy
  apps/server/src/config.ts` printed nothing).
- **D12 — The joining route checks a Veri*Factu venue on the main box, before reserving.** Until
  3b-F lands, the main box refuses with today's code, `module.operation_invalid` (the setup route
  already answers it with 409, `adoption-allocation-refusal.test.ts:173-197`), so a refused join
  leaves no chart entry and no reservation. The setup app gains words for it.

## Global Constraints

- **Pre-live: no backwards-compatibility or data-migration code** (CLAUDE.md §3). No reader of
  `tls/venue-ca.*`, of `mirror.no_relay` or of an old chart's `waitron.local` row is kept.
- **Every `node.db` table is `local`, keeps a `node_id` column, and every read and write names it**;
  no foreign key into or out of `node.db` (CLAUDE.md §3).
- **Across the two files: take `node.db`'s write lock outside `venue.db`'s; save `venue.db` first and
  `node.db` after**, so a re-run repairs `node.db` (CLAUDE.md §3). Task 5.2's join step states it at
  its site.
- **Secrets stay sealed.** The pair's secret key is sealed under the key ring in `node.db`, bound to
  the box's and the peer's node ids; it reaches versitygw through its environment, never its
  command line (fact 13), and never a log line.
- **Nothing external may block a sale** (CLAUDE.md §5): the stream to the spare never waits on the
  spare to sell; the main box's `backup.stream_behind` rule applies to it unchanged.
- **New error codes are registered** in `apps/server/src/errors.ts` (or the throwing package's
  `errors.ts`) and imported by the throwing file (`scripts/errors-reachable.test.ts`):
  `mirror.standby_name_taken`, `mirror.bucket_stream_active`, `backup.spare_stream_active`,
  `credentials.rotation_spare_joined`, `node.state_missing`, and the log-only `mirror.peer_unresolved`
  (Task 3.1). Retired: `mirror.no_relay`,
  `server.mirror_bind_exposed`. Every refusal a person sees has English and Spanish words that say
  what happened and what each choice does, and sends nobody to anyone else (CLAUDE.md §3).
- **A new box-to-box route or duty**: a duty a full start runs is registered in
  `apps/server/src/background-duties.ts` with its stop, signalled at a stepdown or carrying a reason
  (guard: `handover-stepdown.test.ts`, "every closer is either atStepdown or carries a reason").
- **Tests that start versitygw or Litestream** skip locally without the binaries and fail in CI
  (the existing rule, `stream-loop.e2e.test.ts:1-6`), and run in the stream job.
- **Changed test checks**: every `expect(` line or test title a PR changes has a row in that PR's
  "Changed checks" list, written before the code (as 3a's table). The rows known now are listed in
  each PR's section; a changed line with no row is a STOP.
- Plain English in comments, commit messages and PRs; every commit `git commit -s`; run Vitest under
  `env -u AI_AGENT -u CLAUDECODE` when you need a passing test's output, and read the `Tests` count.

## Review Focus

1. **A join that stops half-way.** The spare loses power after the main box handed out the bundle
   but before its store answered: the main box must hold no `nodes` row for it, start without
   waiting, and a second join (new node id) must work. Test: Task 5.2, "a pending spare whose store
   never answers is not a counted peer".
2. **A spare whose `node.db` is lost after it finished joining** must not start as a selling,
   filing box (fact 16). Test: Task 5.5, with the control that a first box with no mode row still
   starts.
3. **A store that rejects the main box** (wrong key, wrong certificate) must show up in the main
   box's stream status within one minute, not retry silently (probe P7). Test: Task 5.1, "a pipe
   refused by the spare's certificate puts the stream's bucket problem in its status".
4. **The spare's disk**: the store keeps Litestream's week of history (`packages/stream/src/litestream.ts:79-80`,
   `retention: 168h`) on the spare's disk beside its own copy. A full disk on the spare must stop
   the store, not the main box's sales. Test: Task 5.1, "the main box keeps selling while the
   spare's store refuses every write" (a store that answers 507 to every upload).
5. **A box whose certificate authority changes** (a connection repair, `box-tls-repair.ts`) while a
   spare is joined breaks the pair's trust. 3b does not build a repair for this; Task 3.2 makes the
   refusal visible: "a peer whose certificate another authority signed is silent, with the reason
   `certificate`".

---

## File structure

- **`deploy/`**: `Dockerfile` (a `versitygw` stage, a copy into the runtime), `third-party/versitygw/`
  (`NOTICE`, `NOTICES.txt`), `third-party/README.md` (a section).
- **`scripts/`**: `versitygw-pin.test.ts` (new); `go-binary-notices.mjs` (Litestream's generator,
  taking the program's name; `litestream-notices.mjs` becomes a one-line call of it, or is renamed
  with its test); `deploy-image-env.test.ts` (a versitygw block); `ci-workflow.test.mjs`
  (`STREAM_TEST_FILES`); `write-path-tables.json` (`node_pair_link`); `backup-room-note.test.ts`'s
  hand lists (Task 5.4).
- **`.github/workflows/`**: `image-smoke.yml` (versitygw's version), `ci.yml` (the new e2e file in
  the stream job, and in the server shards' exclude list, `ci.yml:1177`).
- **`packages/node-db/`**: `src/schema/node-pair-link.ts`, `drizzle/0002_*.sql` (generated),
  `src/classification.ts`, `src/pair-link.ts` (readers), `src/index.ts`.
- **`packages/credentials/`**: `src/node-pair-link.ts` (the writers, which seal; the signing key's
  writer sits in this package for the same reason, `write-path-tables.json`), `src/cli.ts` (rotate).
- **`packages/membership/`**: none, unless Task 3.4's helper is shared.
- **`apps/server/src/`**: new `box-name.ts`, `box-lookup.ts`, `spare-store.ts`, `spare-pipe.ts`,
  `spare-join.ts`, `spare-copy.ts`, `spare-copy-placement.ts`; changed `adopt.ts`, `mirror-bundle.ts`,
  `mirror-bundle-api.ts`, `mirror-bundle-fetch.ts`, `finish-adoption.ts`, `reserved-identity.ts`,
  `membership-mint.ts`, `membership-reconcile.ts`, `membership-seed.ts` callers, `rebuild-first-start.ts`,
  `start-peer-check.ts`, `boot-peer-check.ts`, `mdns.ts`, `mirror-session.ts`, `box-secrets.ts`,
  `backup-optional-state.ts`, `stream-host.ts`, `stream-api.ts`, `boot.ts`, `config.ts`, `errors.ts`;
  `mirror-bind-guard.ts` and its test deleted; the guide pages in `guide/en/` and `guide/es/`.
- **`apps/till/src/api/server-router.ts`**; **`apps/setup/src/`** (adopt refusal words, the joined
  screen's sentence); **`apps/dashboard/src/`** (the bucket screen's refusal words).
- **`docs/`**: `docs/operations/` (adding a spare), `docs/developers/conventions-data.md` (the store
  and the pair link), `docs/backlog/replication-cloud.md`.

---

## PR 3b-1 — versitygw ships in the box image

Light review path. No server code.

### Task 1.1: The pinned versitygw in the image, with one pin

**Files:** Modify `deploy/Dockerfile` (a `versitygw` stage after the `litestream` stage, shaped like
it: `version=1.8.0`, the `linux-x64` and `linux-arm64` sums from `scripts/setup-s3-test-server.mjs:24-31`
under Docker's `amd64`/`arm64` names, `sha256sum -c`, `tar` of `<name>/versitygw` only, then
`test "$(versitygw --version | sed -n …)" = "${version}"`; in the runtime stage
`COPY --from=versitygw /usr/local/bin/versitygw /usr/local/bin/versitygw`),
`.github/workflows/image-smoke.yml` (run `docker exec "$app" versitygw --version` and compare with
the pin, beside the Litestream step at `:270-285`), `apps/server/src/testing/s3-test-server.ts:20`
(import the version from Task 4.4's `spare-store.ts` later; for now leave it and let the pin test
hold the copies equal). Create `scripts/versitygw-pin.test.ts`, as `scripts/litestream-pin.test.ts`.

- [ ] **Step 1: Write the failing test** `scripts/versitygw-pin.test.ts`: "names one version in the
  setup script, the test server and the box image" (`VERSITYGW_VERSION` from the setup script equals
  the one in `s3-test-server.ts` and the Dockerfile's `versitygw` stage); "checks the same Linux
  checksums in the box image and the setup script" (each Docker arch's sum equals the script's for
  its platform); "image-smoke runs the binary and compares it with the pin" (reads the workflow as
  text). Its header says it reads text and is weaker than its name, as the Litestream one does.
- [ ] **Step 2: Run** `pnpm exec vitest run scripts/versitygw-pin.test.ts` from the root — FAIL: no
  `versitygw` stage.
- [ ] **Step 3: Implement.** The `apt-get` rule does not apply (no apt in this stage); the download
  uses `curl -fsSL` as the Litestream stage does.
- [ ] **Step 4: Run** it — PASS; then `pnpm exec vitest run scripts/litestream-pin.test.ts
  scripts/ci-workflow.test.mjs scripts/deploy-image-env.test.ts`, and build the image once
  (`docker build -f deploy/Dockerfile .`, recording its id) to see the stage's own version check pass;
  record the image's size before and after (the binary is about 54 MB uncompressed on arm64, probe
  P10's tarball).
- [ ] **Step 5: Commit** `git commit -s -m "image: ship the pinned versitygw, the store a spare box will run"`.

### Task 1.2: Its licence notices, and final checks

**Files:** Create `deploy/third-party/versitygw/NOTICE` (the tarball's `NOTICE`, unchanged) and
`deploy/third-party/versitygw/NOTICES.txt` (the Go modules built into the binary, generated as
Litestream's are). Generalise `scripts/litestream-notices.mjs` into `scripts/go-binary-notices.mjs`
taking the program's name and version for its header line (`<Name> version: <v>`), keeping
Litestream's output byte for byte (its test proves it); modify `deploy/third-party/README.md` (a
`## versitygw` section: the version, the release URL, the checksum check, Apache 2.0 with
`licenses/Apache-2.0.txt`, `versitygw/NOTICE`, `versitygw/NOTICES.txt` and the command that
regenerates it), `scripts/deploy-image-env.test.ts` (a block like the Litestream one at `:1048-1098`),
and image-smoke (`grep -qx "versitygw version: $pinned" /app/third-party/versitygw/NOTICES.txt`).
Go is not installed on this Mac (probe P12): run `go version -m` in a `golang` container on the
pinned Linux binaries, and say so in the README's regeneration steps.

**Changed checks:** `scripts/deploy-image-env.test.ts` "names no version in the notice but
libvips's, Litestream's and Iosevka's" (`:1062-1067`) — the set gains versitygw's version; the title
names it. Group V (the expected value changes).

- [ ] **Step 1: Write the failing tests** in `deploy-image-env.test.ts`: "names the pinned versitygw,
  and only that version, in its section of the notice"; "ships versitygw's NOTICE and the notices
  of what the binary bundles, generated for the pinned version"; "image-smoke checks the shipped
  notice". In the generator's test: "writes the program's own name in the header" and "writes
  Litestream's notice unchanged".
- [ ] **Step 2: Run** `pnpm exec vitest run scripts/deploy-image-env.test.ts scripts/litestream-notices.test.mjs`
  — FAIL.
- [ ] **Step 3: Implement**; regenerate both notice files and check `git diff --stat
  deploy/third-party/litestream/` prints nothing.
- [ ] **Step 4: Run** them — PASS; then `pnpm format:check`.
- [ ] **Step 5: Commit** `git commit -s -m "image: versitygw's licence and the notices of what it bundles"`.
  Then `/finish-branch` on the light path.

---

## PR 3b-2 — each box's own name

Full review path. Unblocks A1018 Task 5.3's address check.

### Task 2.1: The box's own name, in its chart row

**Files:** Create `apps/server/src/box-name.ts`. Modify `membership-seed.ts`'s two callers
(`boot.ts:1641`, `first-setup-publication.ts:68`), `rebuild-first-start.ts` (its `contactUrl`),
`boot.ts:1976` (`runFirstStart`'s `contactUrl`), `adopt.ts:109` (the standby's `contactUrl`),
`mirror-bundle-api.ts` (`appendStandbyToChart`, `:193-216`, also rewrites the signer's own row when
its `contactUrl` differs from the signer's own contact URL). `start-peer-check.ts:182` already reads
this box's own address from its chart row, so it needs no change. Tests `apps/server/src/box-name.test.ts` (new),
`membership-seed.test.ts`, `rebuild-first-start.test.ts`, `adopt.test.ts`, `mirror-bundle-api.test.ts`.

**Interfaces — Produces:** `boxHostnameFor(nodeId: string): string` → `box-${nodeId.slice(0, 4)}.waitron.local`;
`ownContactUrl(advertisedOrigin: string, nodeId: string): string` (D1: host `waitron.local` replaced,
scheme and port kept; any other host returned unchanged); `sameBoxName(a: string, b: string): boolean`
(the four characters compared, for D1's collision refusal, used in Task 4.2).

- [ ] **Step 1: Write the failing tests.** `box-name.test.ts`: "names a box by the first four
  characters of its node id under waitron.local"; "keeps the advertised origin's scheme and port";
  "leaves an origin at another host as configured" (`https://localhost:8443` stays). The seed: "the
  first box's chart row names its own address". Adopt: "sends the spare's own address as its
  contactUrl". The joining route: "the chart that adds a spare names both boxes by their own
  addresses" (a held chart whose signer row says `https://waitron.local` is rewritten; control: one
  that already names the signer's own address keeps it). The rebuild: "a rebuilt box's chart row
  names its own address".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/box-name.test.ts src/membership-seed.test.ts src/rebuild-first-start.test.ts src/adopt.test.ts src/mirror-bundle-api.test.ts`
  — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then `src/start-peer-check.test.ts src/boot-peer-check.test.ts
  src/till-reroute-e2e.test.ts src/boot.start-check.test.ts`. A case that asserts a chart row equal
  to the advertised origin gets a Changed checks row (it is an expected value that changes).
- [ ] **Step 5: Commit** `git commit -s -m "server: each box names itself in the chart, not by the venue's name"`.

### Task 2.2: The certificate names the box's own name, and a spare's comes from the venue authority

**Files:** Modify `box-secrets.ts` (`writeVenueAuthority` becomes `installVenueAuthority`: writes the
bundle's authority as `tls/ca.crt` and `tls/ca.key`, 0600, through the same working-name-then-rename
pattern `reissueBoxLeaf` uses, `:249-290`, and removes the leaf so the next start issues one; new
`ensureLeafNames(deps: { stateDir; hostnames: string[]; listIpv4; now }): Promise<boolean>` — reads
the leaf, and when it lacks a hostname or a current permitted address, reissues it with
`reissueBoxLeaf`; returns whether it did), `adopt.ts:169-172` (the call), `backup-optional-state.ts:14-15`
(drop `tls/venue-ca.*`), `boot.ts` (call `ensureLeafNames` with `[ownHostname, BOX_HOSTNAME,
"localhost"]` at every trading start before the listener, in the latch start too). Tests
`box-secrets.test.ts`, `adopt.test.ts`, `backup-optional-state.test.ts`, new
`apps/server/src/box-leaf-names.test.ts`.

**Changed checks:** the 3a cases that read `tls/venue-ca.crt` / `venue-ca.key` after adopt
(`git grep -n "venue-ca" -- 'apps/server/src/*.test.ts'`) now read `tls/ca.crt` / `ca.key` — Group V,
the file named changes.

- [ ] **Step 1: Write the failing tests.** `box-leaf-names.test.ts`, with real TLS as probe P2 did:
  "a reissued leaf for box-7f3a.waitron.local verifies under the box's authority" (a `node:tls`
  connect with `servername` set and `ca` the authority); "a leaf already naming every name and
  address is left alone" (the file's bytes unchanged); control: "a leaf another authority signed is
  refused" (`CERT_SIGNATURE_FAILURE`). `adopt.test.ts`: "a joined spare's authority is the bundle's,
  and its next leaf verifies under the main box's authority". `backup-optional-state.test.ts`: the
  optional entries no longer list `venue-ca.*`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/box-leaf-names.test.ts src/box-secrets.test.ts src/adopt.test.ts src/backup-optional-state.test.ts`
  — FAIL.
- [ ] **Step 3: Implement.** A start whose leaf reissue fails logs it and keeps the old leaf: a
  wrong name is no reason to stop selling (the same rule as `tls.tighten_failed`, `boot.ts:1681-1684`).
- [ ] **Step 4: Run** them — PASS; then `src/backup-verification.test.ts src/rebuild-first-start.test.ts
  src/box-tls-repair.test.ts` (if present) and `src/boot.mirror.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a box's certificate names its own name, and a spare's comes from the venue's authority"`.

### Task 2.3: mDNS answers the box's own name, and the venue's name only while it sells

**Files:** Modify `mdns.ts` (`MdnsDeps.hostname` becomes `names: () => readonly string[]`, read per
query; `buildMdnsAnswers(name, addresses)` unchanged), and the five starts in `boot.ts` (setup:
`[BOX_HOSTNAME]` — D3, no node id exists yet; the latch, restricted, waiting: `[ownHostname]`; the
full start: `[ownHostname, ...(acceptingSales ? [BOX_HOSTNAME] : [])]`, reading the value boot already
hands `/api/node`, `node-api.ts:54`). Test `mdns.test.ts`.

**Changed checks:** `mdns.test.ts:68` ("answers an A query for its hostname…") and `:84`, `:100`
take `names` instead of `hostname`; their expected answers stay. Group R (same value, new input).

- [ ] **Step 1: Write the failing tests.** "answers each of its names"; "stops answering a name
  dropped from the list on the next query"; "a box that is not selling answers its own name and not
  the venue's" (a fake socket asked for `waitron.local` sends nothing; asked for `box-7f3a.waitron.local`
  answers); in `boot.mirror.test.ts` or a boot suite with an injected socket: "a mirror start answers
  only its own name".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/mdns.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `src/mdns.test.ts` (the existing development and loopback
  cases) and `src/boot.mirror.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: only the box that sells answers waitron.local"`.

### Task 2.4: A till shows one line per box

**Files:** Modify `apps/till/src/api/server-router.ts` (keep each probe's `nodeId`; in `statuses()`
and in `#runRound`'s choice, an entry reporting the same `nodeId` as an earlier entry is the same
server, and only the earlier one — the page's origin, listed first, `:253` — is shown and chosen).
Check `packages/print-agent/src/router.ts` and do the same there if it chooses by the same rule.
Test `apps/till/src/api/server-router.test.ts`.

- [ ] **Step 1: Write the failing tests.** "the page's origin and the box's own name answering the
  same node id are one server" (two fetch stubs answering `nodeId: "n1"`, `acceptingSales: true`, same
  term: `statuses()` has one entry, labelled with the page's host); "two boxes are two servers"
  (different node ids); a pin of fact 17: "stays on the page's origin when its own name answers
  primary at the same term".
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/api/server-router.test.ts`
  — the first FAILS; the pin passes on today's code (say so in the commit).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `pnpm --filter @waitron/till typecheck` and, if changed,
  `pnpm --filter @waitron/print-agent exec vitest run src/router.test.ts`. Open the till's lock screen
  once (the dev stack, `wa-wt demo <worktree>`) and look: one status line.
- [ ] **Step 5: Commit** `git commit -s -m "till: a box reached at two addresses is one server"`.

### Task 2.5: Final checks for 3b-2

- [ ] `pnpm --filter @waitron/server typecheck`, `pnpm --filter @waitron/till typecheck`,
  `pnpm format:check`; from the root `scripts/deploy-image-env.test.ts` (BOX_HOSTNAME pins unchanged),
  `scripts/errors-reachable.test.ts`. Update `docs/developers/conventions-ui.md` or
  `conventions-data.md` with one rule line if a reviewer asks; otherwise none. PR first line: "Each
  box names itself (`box-<id>.waitron.local`) in the chart, its certificate and its mDNS answers;
  only the selling box answers waitron.local." Then `/finish-branch` on the full path.

---

## PR 3b-3 — the boxes reach and trust each other

Full review path. Unblocks R12, R13, A1018 fact 4 and the reconcile entry.

### Task 3.1: Box-to-box calls find a `.local` name by mDNS

**Files:** Create `apps/server/src/box-lookup.ts`. Modify `mirror-bundle-fetch.ts` (`boxExchange`
passes `lookup` to `request`/`httpRequest`; default `boxLookup`). Test `apps/server/src/box-lookup.test.ts`.

**Interfaces — Produces:** `lookupBoxName(hostname: string, opts?: { timeoutMs?: number; makeSocket?: () => MdnsQuerySocket }): Promise<string>`
— for a name ending `.local`, one multicast query for its A record, the first IPv4 answered within
`timeoutMs` (default 2000), else refuses `mirror.peer_unresolved` (log-only code, never shown);
any other name goes to `dns.lookup`. `boxLookup: LookupFunction` — the `node:net` lookup shape
around it. A literal IP is returned as is.

- [ ] **Step 1: Write the failing tests** with a fake socket: "answers a .local name from the first
  A record answered"; "ignores an answer for another name"; "refuses after its time limit"; "hands a
  name that is not .local to the system lookup"; and through `boxExchange` against a local HTTPS
  server: "connects to the address the lookup gave and checks the certificate against the name"
  (lookup stubbed to `127.0.0.1`, URL `https://box-7f3a.waitron.local:<port>`, leaf for that name:
  answers 200; control: a leaf without the name is refused).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/box-lookup.test.ts` — FAIL.
- [ ] **Step 3: Implement**, with the `multicast-dns` package the responder already uses.
- [ ] **Step 4: Run** it — PASS; then `src/mirror-bundle-fetch.test.ts` unchanged.
- [ ] **Step 5: Commit** `git commit -s -m "server: a box finds another box's .local name by asking the network"`.

### Task 3.2: Every peer call trusts the venue authority and nothing else

**Files:** Modify `start-peer-check.ts:191-196` (`authorityOf` returns this box's `tls/ca.crt` for
every peer), `boot-peer-check.ts:346-353` (the `rejectUnauthorized: false` branch and its comment
go; a TLS refusal records the silent reason `certificate`). Test `boot-peer-check.test.ts`,
`start-peer-check.test.ts`.

**Changed checks:** the cases that ask a peer serving a certificate no authority signed and expect
an answer (find them with `git grep -n "rejectUnauthorized\|authorityOf" -- 'apps/server/src/*.test.ts'`)
now expect silence with `certificate` — Group V.

- [ ] **Step 1: Write the failing tests.** "a main box verifies its spare's certificate under the
  venue authority" (two local HTTPS servers under one authority; the ask answers); "a peer whose
  certificate another authority signed is silent, with the reason certificate" (Review Focus 5).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/boot-peer-check.test.ts src/start-peer-check.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then `src/boot.start-check.test.ts src/waiting-start.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a box trusts another box's certificate only under the venue's authority"`.

### Task 3.3: The boot reconcile uses the same transport

**Files:** Modify `membership-reconcile.ts:60-78` (`fetchPeerMembershipDocument` sends through
`boxExchange` with the venue authority, `boxLookup` and a 5-second limit; its "unreachable →
`null`" answers stay), `boot.ts:1914-1935` (the peer address: the origin box's `contactUrl` from the
held chart when it lists one, else the mirror link's address). Test `membership-reconcile.test.ts`,
`boot.reconcile.test.ts`.

- [ ] **Step 1: Write the failing tests.** "fetches a peer's chart from a box under the venue
  authority" (fails today: the global `fetch` refuses the leaf); "answers null for a peer that does
  not answer within 5 seconds" (a server that accepts and never replies); "answers null for a peer
  under another authority".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/membership-reconcile.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `src/boot.reconcile.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: the start's chart check reaches a real box, and gives up after five seconds"`.

### Task 3.4: Every chart vouches for every listed box's key (R13)

**Files:** Modify `membership-mint.ts:67-73` (the endorsements carried are the signer's own and, for
every node the new chart lists in good standing, the endorsement its `venue.db` `nodes` row holds,
when a key this box trusts made it; at most `MAX_NODES`, which equals `MAX_ENDORSEMENTS`,
`packages/membership/src/verify.ts:25-27`); `mintNextMembershipDocument` gains `extraEndorsements?:
readonly Endorsement[]` for Task 4.2's first chart, before the row exists. Test `membership-mint.test.ts`,
`handover-signing.test.ts` (or `start-peer-check.test.ts`).

**Changed checks:** `membership-mint.test.ts:78` ("carries no endorsement when the signer's row holds
none") — unchanged if its chart lists no other endorsed box; check before editing.
`boot.start-check.test.ts:145`'s fixture "Stands in for A947 3b's join step" now writes the spare's
`nodes` row and lets the mint carry the endorsement, and the comment goes — a setup change, no row.

- [ ] **Step 1: Write the failing tests.** "a chart carries the endorsement of each listed box whose
  row holds one" ; "does not carry an evicted box's endorsement"; and the R13 test: "a main box
  holding its spare's row verifies the spare's signed status" (`peerKeyOf` on the main box returns
  the spare's key; control: with the endorsement signed by the wrong key it returns `undefined`, as
  probe P4).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/membership-mint.test.ts src/start-peer-check.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then `src/boot.start-check.test.ts src/mirror-bundle-api.test.ts
  src/membership-removal-api.test.ts src/promote.test.ts src/retire.test.ts` (if present); and from the
  root `pnpm --filter @waitron/membership exec vitest run`.
- [ ] **Step 5: Commit** `git commit -s -m "membership: each chart vouches for the key of every box it lists"`.

### Task 3.5: A mirror listens on the venue's network; its ambient dashboard stays on its own screen

**Files:** Delete `mirror-bind-guard.ts` and its test; modify `boot.ts:2002-2005` (the call),
`mirror-session.ts` (`mirrorSession` takes `isFromBox: (c) => boolean`, default `requestFromBox`, and
attaches nothing — no cookie, no keep-alive write — to any other request), `errors.ts` (retire
`server.mirror_bind_exposed`), `docs/developers/` lines naming the opt-in (`git grep -n
MIRROR_ALLOW_EXPOSED`). Tests `mirror-session.test.ts`, `boot.mirror.test.ts`.

**Changed checks:** `boot.mirror.test.ts:475-505` ("refuses a mirror boot binding a non-loopback
host without the … opt-in" and its opted-in twin) — Group V: replaced by "a mirror boot listens on
a non-loopback host". `mirror-bind-guard.test.ts` (6 cases) — deleted with the guard; its behaviour
is retired by D8, and the new `mirror-session.test.ts` cases carry the protection it gave.

- [ ] **Step 1: Write the failing tests.** "gives the ambient viewer to a request from the box
  itself"; "gives a request from another address no session and writes nothing" (the
  `managementSessions` row's `last_seen_at` unchanged); "a dashboard read from another address is
  refused as signed out" (401 through a real route); boot: "a mirror boot listens on a non-loopback
  host".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/mirror-session.test.ts src/boot.mirror.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Trace every consumer of the viewer before changing it (CLAUDE.md, global):
  `git grep -n "MIRROR_VIEWER\|mirrorSession\|ensureMirrorViewer" -- apps packages`.
- [ ] **Step 4: Run** them — PASS; then `src/boot.mirror.test.ts src/mirror-session.test.ts
  src/request-from-box.test.ts src/till-reroute-e2e.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a spare can be reached from the venue's network; its open dashboard is for its own screen"`.

### Task 3.6: Final checks for 3b-3

- [ ] Typecheck `@waitron/server` and `@waitron/membership`; `pnpm format:check`; root guards
  `scripts/errors-reachable.test.ts`, `scripts/write-path-tables.test.ts`. Update the two backlog
  entries' text only through the controller (this plan does not edit `docs/backlog.md`). PR first
  line names R12, R13 and the retired opt-in. `/finish-branch`, full path.

---

## PR 3b-4 — the store on the spare, and the pair's access key

Full review path. **Adds one `node.db` migration.**

### Task 4.1: `node_pair_link`, node.db's third migration

**Files:** Create `packages/node-db/src/schema/node-pair-link.ts`, `src/pair-link.ts` (readers);
`packages/credentials/src/node-pair-link.ts` (writers, which seal). Modify `packages/node-db/src/schema/index.ts`,
`classification.ts` (`local`, reason as the other five), `index.ts`; `scripts/write-path-tables.json`
(`node_pair_link` → `packages/credentials/src/node-pair-link.ts`); `scripts/schema-constraints.test.ts`
(the new check names). From `packages/node-db`, `pnpm exec drizzle-kit generate` once.

**The table** (columns through `packages/db/src/schema/columns.ts` builders only):
`node_id` (primary key: this box), `role` (`label`, `"streams" | "serves"`; check
`node_pair_link_role_ck`), `state` (`label`: `"pending" | "streaming"` for `streams`,
`"awaiting_copy" | "copied"` for `serves`; check `node_pair_link_state_ck`), `peer_node_id`,
`peer_public_key` (the spare's, on the main box; the main box's, on the spare), `store_url` (the
spare's store, `https://box-7f3a.waitron.local:7443`), `venue_id`, `access_key_id`, `secret_ciphertext`,
`secret_iv`, `secret_auth_tag` (`binary`, with the 12- and 16-byte checks as `node_signing_key`),
`key_version` (`count`, ≥ 1), `ring_version` (`count`: the ring's current version when the pair
was made, D7), `created_at`, `updated_at`. `peer_node_id` names a venue row: its column comment says
nothing establishes it exists in this file (CLAUDE.md §3).

**Interfaces — Produces:** `readPairLink(node: NodeDatabase, nodeId: string): Promise<PairLink | null>`
(no secret); `readPairSecret(node, ring, nodeId): Promise<string>` (credentials);
`writePairLinkTx(tx: NodeTransaction, ring: KeyRing, nodeId: string, link: NewPairLink): Promise<void>`;
`setPairLinkStateTx(tx, nodeId, state)`; `deletePairLinkTx(tx, nodeId)`.

- [ ] **Step 1: Write the failing tests.** `packages/node-db/src/schema.test.ts`: "creates
  node_pair_link in node.db and not in venue.db"; "refuses a state that does not belong to its role"
  (CHECK naming `node_pair_link_state_ck`). `packages/credentials/src/node-pair-link.test.ts`: "seals
  the pair's secret so it opens only under this ring and these two node ids" (another ring:
  `credentials.decrypt_failed`; another peer id: refused).
- [ ] **Step 2: Run** `pnpm --filter @waitron/node-db exec vitest run src/schema.test.ts` and
  `pnpm --filter @waitron/credentials exec vitest run src/node-pair-link.test.ts` — FAIL.
- [ ] **Step 3: Implement**; generate the migration once; do not hand-edit it or `_journal.json`.
- [ ] **Step 4: Run** them — PASS; then from the root `scripts/classification-complete.test.ts
  scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts
  scripts/schema-constraints.test.ts scripts/journal-monotonic.test.ts scripts/write-path-tables.test.ts
  scripts/column-vocabulary.test.ts scripts/id-columns-are-references.test.ts
  scripts/module-graph-honesty.test.ts`; and `pnpm --filter @waitron/node-db mutation` (a score of 90
  or more). An `_id` column that is not a reference: `peer_node_id` goes in the export's `omit` or
  the guard's allowance as `origin_node_id` does — follow what `node_mirror_link` does.
- [ ] **Step 5: Commit** `git commit -s -m "node-db: the pair link, where each box keeps the store's address and the pair's access key"`.

### Task 4.2: The joining route: no relay, its refusals first, and the pair's key

**Files:** Modify `mirror-bundle.ts` (`MirrorBundle` gains `primaryUrl` — the main box's own contact
URL — and `store: { url: string; accessKeyId: string; secretAccessKey: string; venueId: string }`;
`relayUrl` becomes optional and is carried only when a tunnel is configured; the doc comment's list of
secrets gains the pair's key), `mirror-bundle-fetch.ts` (`isMirrorBundle`), `mirror-bundle-api.ts`:
1. after the credential, **before the reservation**: refuse `mirror.bucket_stream_active` (409) when
   `readStreamSettings` finds bucket settings; refuse `module.operation_invalid` when an enabled
   module fails `assertAdoptionModules` (D12; until 3b-F); refuse `mirror.standby_name_taken` (409)
   when `sameBoxName` matches a listed box (D1); refuse repeated ids in the held chart's `revoked`
   list with `membership.revoked_duplicate` (A1278: the readability check gains it);
2. mint the access key (`access_key_id` = `waitron` + 16 random hex characters, as
   `s3-test-server.ts:177`; secret = 32 random bytes, hex);
3. the chart append passes the spare's endorsement in `extraEndorsements` (Task 3.4);
4. after the append, write this box's pair link `{ role: "streams", state: "pending", … }` in one
   node transaction (venue first, node after: the chart is already saved; a crash between leaves a
   chart entry and no link, which a second join replaces).
`mirror.no_relay` is retired from `errors.ts`, `STATUS` and its test. Tests `mirror-bundle-api.test.ts`,
`mirror-bundle.test.ts`, `mirror-bundle-fetch.test.ts`.

**Changed checks:** `mirror-bundle-api.test.ts:721` ("refuses mirror.no_relay (400) when no relay is
configured") — Group V: becomes "hands out a bundle with no relay configured, naming the main box's own
address". `adoption-allocation-refusal.test.ts:141` — the same code, now from the main box's route
before any reservation: the test that checks the spare wrote nothing stays, and a new route test
checks the main box reserved nothing and listed nobody.

- [ ] **Step 1: Write the failing tests.** "refuses a join while the venue streams to a bucket,
  reserving nothing and listing nobody"; "refuses a fiscal venue's join before reserving"; "refuses a
  spare whose name a listed box already has"; "refuses a chart with a repeated revoked id before
  reserving" (A1278's snapshot of reservations before and after: equal); "hands out a bundle with no
  relay, carrying the main box's address and the pair's key"; "writes a pending pair link naming the
  spare's store"; "the first chart naming the spare vouches for its key".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/mirror-bundle-api.test.ts src/mirror-bundle.test.ts src/mirror-bundle-fetch.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then `src/adoption-allocation-refusal.test.ts src/allocated-standby-host.test.ts
  src/boot.setup-routes.test.ts src/setup-api.test.ts`; root `scripts/errors-reachable.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "joining: no Cloud relay needed, every refusal before anything is reserved, and an access key for the pair"`.

### Task 4.3: Adopt keeps the pair's key, and the setup app's words

**Files:** Modify `adopt.ts` (in its one node transaction: `writePairLinkTx({ role: "serves", state:
"awaiting_copy", peerNodeId: designated.nodeId, peerPublicKey: bundle.primaryPublicKey, … })`; before
it, delete every `node.db` row keyed by another node id in `node_mode`, `node_mirror_link`,
`node_signing_key`, `node_recovery_key`, `node_primary_key` and `node_pair_link` — A1280; the mirror
link's address is `bundle.primaryUrl`), `packages/node-db/src/mirror-link.ts` (the TypeScript field
`relayUrl` becomes `originUrl`, documented as "the address this box asks its origin box at"; the
column `relay_url` keeps its name, so no migration), `apps/setup/src/setup-app.ts:254-264` (words for
`mirror.bucket_stream_active`, `mirror.standby_name_taken` and `module.operation_invalid` on the
adopt path), `apps/setup/src/i18n/strings/shell.ts` (English and Spanish), and the joined screen's
sentence ("The spare now takes its first copy of the venue's data from the main box. This can take a
few minutes; it restarts by itself when it has it." and its Spanish). Tests `adopt.test.ts`,
`apps/setup/src/setup-app.test.ts`, the joined screen's test.

The words, for the implementer to translate faithfully and the reviewer to check against CLAUDE.md
§3's refusal rule:
- `mirror.bucket_stream_active`: "This venue copies its data to its own storage bucket. A spare box
  cannot be added while it does: the spare would take over that copy, and this version of Waitron
  cannot yet pass it on to the bucket, so the venue would lose its offsite copy. Nothing was
  changed. You can stop the bucket copy in Settings → Backups on the main box and then add the spare
  (the venue then has no offsite copy), or keep the bucket copy and add the spare later."
- `mirror.standby_name_taken`: "This box picked a name another box of the venue already uses.
  Nothing was changed. Press Connect again: it picks a new one."
- `module.operation_invalid` (adopt path): "This venue files its invoices with Veri*Factu, and this
  version of Waitron cannot add a spare box to such a venue yet. Nothing was changed on either box."

**Changed checks:** the 3a cases naming `relayUrl` on the mirror link (`git grep -n "relayUrl" --
'apps/server/src/*.test.ts' 'packages/node-db/src/*.test.ts'`) — Group R (field renamed, same value).

- [ ] **Step 1: Write the failing tests.** "keeps the pair's key sealed in node.db, opening under the
  venue's ring"; "a second join under a new id removes the first attempt's node.db rows" (A1280,
  with a control that the new id's rows are all there); the setup app: "shows the bucket refusal's
  words with both choices", "shows the name refusal and leaves Connect working".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/adopt.test.ts` and
  `pnpm --filter @waitron/setup exec vitest run src/setup-app.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Open the setup app's refusal and the joined screen in both themes and at
  phone width, and look.
- [ ] **Step 4: Run** them — PASS; then `src/boot.reconcile.test.ts src/mirror-link` suites in
  `@waitron/node-db`.
- [ ] **Step 5: Commit** `git commit -s -m "joining: the spare keeps the pair's access key, and the setup app explains the new refusals"`.

### Task 4.4: The spare runs the store

**Files:** Create `apps/server/src/spare-store.ts` and `spare-pipe.ts`. Modify `config.ts`
(`WAITRON_SPARE_STORE_PORT`, default 7443, `WAITRON_VERSITYGW_BIN`, default `versitygw`),
`boot.ts` (start the store in the latch start and in a mirror's full start when `readPairLink` gives
`role: "serves"`; in the full start register it in `background-duties.ts` with a reason),
`apps/server/src/testing/s3-test-server.ts:20` (import `VERSITYGW_VERSION` from `spare-store.ts`;
the pin test of Task 1.1 then reads it there). Tests `spare-store.test.ts`, `spare-pipe.test.ts`.

**Interfaces — Produces:** `VERSITYGW_VERSION = "1.8.0"`; `SPARE_STORE_BUCKET = "waitron"`;
`SPARE_STORE_REGION = "us-east-1"` (as `s3-test-server.ts:176`);
`startSpareStore(deps: { bin; stateDir; accessKeyId; secretAccessKey; loopbackPort: number; spawn?; log }): Promise<SpareStore>`
— versitygw on `127.0.0.1:<loopbackPort>`, `posix --sidecar <state>/spare-store/meta <state>/spare-store/data`,
the bucket a folder created first, the keys in `ROOT_ACCESS_KEY_ID`/`ROOT_SECRET_ACCESS_KEY`;
restarted after it exits, with the backoff the stream supervisor uses; `SpareStore = { loopbackUrl: string; stop(): Promise<void> }`.
`startStoreListener(deps: { port; host; certFile; keyFile; upstreamPort; log }): Promise<{ close() }>`
— a `node:tls` server on the box's listening address and the store port, with the box's leaf,
piping each connection to the loopback store (probe P9's shape); a connection whose handshake fails
is logged with its reason.

- [ ] **Step 1: Write the failing tests.** `spare-store.test.ts` with a fake spawn: "passes the keys
  in the environment and never on the command line"; "listens on loopback only"; "starts again
  after versitygw exits". `spare-pipe.test.ts` with real TLS and a plain HTTP stand-in for
  versitygw: "carries a request from a client trusting the venue authority, Host header unchanged";
  "a client under another authority is refused and the refusal is logged".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/spare-store.test.ts src/spare-pipe.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then `src/boot.mirror.test.ts`, `src/boot.failed-start.test.ts`,
  `src/handover-stepdown.test.ts` (the duty table), and with the binaries installed
  (`node scripts/setup-s3-test-server.mjs`) one case in `spare-store.test.ts` marked as needing
  versitygw: "the real versitygw answers through the pipe with the pair's key, and refuses another
  key with 403" (skips locally without the binary; the stream job runs it — add the file to that
  job's list, `ci.yml:1312-1323` and `scripts/ci-workflow.test.mjs:62-74`, and to the server
  shards' excludes, `ci.yml:1177`).
- [ ] **Step 5: Commit** `git commit -s -m "server: a spare runs the store the main box will stream to"`.

### Task 4.5: A joined spare stops a bucket copy and a key rotation

**Files:** Modify `stream-api.ts:227-250` (`PUT /api/backup/stream` refuses
`backup.spare_stream_active`, 409, when this box holds a pair link, before the probe), the dashboard's
backup screen words (English and Spanish: "This venue's spare box receives the venue's copy, and a
venue copies to one place at a time. Nothing was changed. To copy to your bucket instead, remove the
spare box in Settings → Servers first."), `packages/credentials/src/cli.ts:180-189` (`rotate` refuses
`credentials.rotation_spare_joined` with exit 1 when `readPairLink` finds a link, before any
re-seal; its message names the rule of D7), `apps/server/src/membership-removal.ts` (removing the
box a pair link names deletes this box's pair link, in a node transaction after the chart is saved,
then reloads the stream — the refusal's words send the person there, so it must work),
`docs/operations/` (the rotation runbook gains D7's rule). Tests `stream-api.route.test.ts`,
`membership-removal-api.test.ts`, `packages/credentials/src/cli.test.ts`, the dashboard screen's
test.

- [ ] **Step 1: Write the failing tests.** "refuses bucket settings while a spare is joined, saving
  nothing" (the vault holds no `backup.stream` row afterwards); "rotate refuses while a spare is
  joined and re-seals nothing" (every row's `key_version` unchanged); control: "rotate runs with no
  pair link"; "removing the spare deletes the pair link, and bucket settings can then be saved".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/stream-api.route.test.ts`,
  `pnpm --filter @waitron/credentials exec vitest run src/cli.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Look at the refusal on the backup screen in both themes and at phone width.
- [ ] **Step 4: Run** them — PASS; the dashboard screen's test.
- [ ] **Step 5: Commit** `git commit -s -m "server: a venue with a spare copies to it alone, and its key ring is not rotated under it"`.

### Task 4.6: Final checks for 3b-4

- [ ] Typecheck `@waitron/server`, `@waitron/node-db`, `@waitron/credentials`, `@waitron/setup`,
  `@waitron/dashboard`; `pnpm format:check`; root `scripts/errors-reachable.test.ts`,
  `scripts/write-path-tables.test.ts`, `scripts/alert-codes.test.ts` (no new incident code is
  expected; it must stay green), `scripts/personal-log-params.test.ts`, `scripts/english-only.test.ts`.
  PR first line: "Adds a node.db migration (`node_pair_link`). A spare runs its store; nothing streams
  to it yet." `/finish-branch`, full path.

---

## PR 3b-5 — joining brings the data

Full review path. Unblocks "finished joining" for a venue that does not file with Veri*Factu.

### Task 5.1: The main box streams to the spare

**Files:** Modify `spare-pipe.ts` (`startStorePipe(deps: { storeUrl; authorityPem; lookup?; log }): Promise<{ loopbackUrl: string; problem(): { reason: string; since: string } | null; close() }>`
— a `net` server on `127.0.0.1:0`; each connection `tls.connect`s to the address `lookupBoxName`
gives for the store's host, `servername` that host, `ca` the venue authority,
`rejectUnauthorized: true`, then pipes; the last refusal is kept as `problem()`), `stream-host.ts`
(`start()` reads `readPairLink`: with `role: "streams"` and `state: "streaming"`, it starts the pipe and
builds the `BucketConfig` `{ endpoint: pipe.loopbackUrl, region: SPARE_STORE_REGION, bucket:
SPARE_STORE_BUCKET, prefix: "", accessKeyId, secretAccessKey }` with `venueId` from the link; else
today's bucket settings; `status()` reports the pipe's `problem()` as the bucket problem when the
supervisor has none). Test `stream-host.test.ts`, `spare-pipe.test.ts`.

**Interfaces — Consumes:** `readPairLink`, `readPairSecret` (Task 4.1); `lookupBoxName` (Task 3.1).

- [ ] **Step 1: Write the failing tests.** "streams to the spare's store when the pair link says
  streaming" (the supervisor is built with a loopback endpoint and the pair's key); "streams to the
  bucket when there is no pair link" (today's path, a pin); "a pipe refused by the spare's
  certificate puts the stream's bucket problem in its status" (Review Focus 3); "the main box keeps
  selling while the spare's store refuses every write" (Review Focus 4: a stand-in store answering
  507; a sale's commit is not delayed past 1 second).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/stream-host.test.ts src/spare-pipe.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then `src/stream-api.route.test.ts src/box-status.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: the main box streams to its spare's store over the venue's network"`.

### Task 5.2: The main box writes the spare's `nodes` row when its store answers

**Files:** Create `apps/server/src/spare-join.ts`; register it in `boot.ts`'s full start on the
singleton primary and in `background-duties.ts` (stopped at a stepdown). Test `spare-join.test.ts`.

**Interfaces — Produces:** `runSpareJoin(deps: { db; node; ring; nodeId; stream: StreamHost; probe?; intervalMs?; log; signal }): Promise<void>`
— while this box's pair link is `pending`: every 5 seconds probe the spare's store through a store
pipe with the pair's key (`packages/stream/src/probe.ts`); on the first success, in one `venue.db`
transaction insert the spare's `nodes` row through `insertReservedNodeTx` (`packages/db/src/reserved-identity.ts:26-31`:
name `<main box's name> (standby)`, the main box's filing and tax modules, the spare's public key from
the link, its endorsement re-made with `endorseKey` — the same bytes, Ed25519 signatures being
deterministic — and its location as `venueLocationId`), skipping it when the row exists; then, in a
node transaction, the link's state → `streaming`; then `stream.reload()`. One-line comment at the
site: venue first, node after, and why a re-run repairs it. A nodes row whose public key differs from
the link's is a fault in Waitron: refuse and log `spare.join_key_mismatch`.

- [ ] **Step 1: Write the failing tests.** "writes the spare's row and starts streaming once its
  store answers"; "a pending spare whose store never answers is not a counted peer" (Review Focus 1:
  after 30 simulated seconds with a refusing probe, `joined(spareId)` is false, the main box's start
  check proceeds, and the link is still `pending`); "a crash after the row and before the link is
  repaired by the next run" (the row once, the link `streaming`); "a second join's link replaces a
  pending one".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/spare-join.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `src/handover-stepdown.test.ts src/boot.start-check.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: the main box records its spare once the spare's store answers"`.

### Task 5.3: The spare takes its first full copy

**Files:** Create `apps/server/src/spare-copy.ts`; run it in the latch start (`boot.ts:1699-1745`) when
the pair link is `awaiting_copy`; `/api/box/status` there answers `{ adoption: "pending", copy:
"waiting" | "restoring" | "ready" }`. Test `spare-copy.test.ts`.

**Interfaces — Produces:** `takeFirstCopy(deps: { stateDir; node; ring; nodeId; litestreamBin; store: SpareStore; pinnedPrimaryKey: string; venueId; now; log; signal }): Promise<"ready">`
— every 5 seconds: `readPointer` from its own store over loopback (`packages/stream/src/pointer.ts`),
kept only when `verifyPointer` passes under the pinned main-box key (`node_primary_key`); then
`restoreGeneration` (`packages/stream/src/restore.ts:56`) of the pointer's generation into
`<state>/spare-copy/venue.db`; then, opening the copy read-only: integrity (`checkIntegrity`,
`restore-stream.ts:88`), not ahead of this software (`assertNotAhead`), and a `nodes` row for this box whose public key is this box's own. A copy lacking the row
is discarded and tried again (the main box writes it before streaming, D6, so this is a late copy).
Then it writes `<state>/spare-copy/ready.json` and asks for a restart. Logs
`spare.first_copy_ready` with `bytes` (the copy's size) and `ms` (from the store's first answer to
the copy being ready) — the owner's measurement reads this line (below).

- [ ] **Step 1: Write the failing tests** (fake store and fake restore): "restores the newest
  generation the main box signed"; "ignores a pointer another key signed" (control: the right key
  passes); "discards a copy without this box's row and tries again"; "ignores a pointer naming
  another venue id"; "reports waiting, restoring and ready on the box status".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/spare-copy.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `src/box-status.route.test.ts src/finish-adoption.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a joining spare restores its first full copy from its own store"`.

### Task 5.4: The copy is put in place at the next start, and joining finishes

**Files:** Create `apps/server/src/spare-copy-placement.ts`; call it in `boot.ts` before the venue
store opens. Modify `finish-adoption.ts` (`runFinishAdoption` no longer establishes: it checks that
this box's `nodes` row exists with its own public key — else keeps the latch and logs —
`ensureMirrorViewer`, clears the latch, sets the pair link to `copied`, and asks for a restart; the
`PendingAdoption` comment's "nothing copies" sentence goes), `reserved-identity.ts`
(`establishReservedStandbyIdentity` keeps its one remaining job — the module operations — for 3b-F;
or, if Step 0 finds none left outside 3b-F, it is left untouched for 3b-F to change), and the hand
lists of `scripts/backup-room-note.test.ts` and `scripts/spare-space.test.ts` if the placement
replaces the live `venue.db` (it does).

**Interfaces — Produces:** `placeFirstCopy(deps: { stateDir; venueDir; log }): Promise<boolean>` — when
`ready.json` exists: under `lockVenueDatabase`, delete `<state>/backup-room-note.json` first
(CLAUDE.md §3), remove `venue.db-wal`, `venue.db-shm` and `.venue.db-litestream/`, rename the copy
over `venue.db`, remove `ready.json` last; a crash at any point re-runs at the next start.

- [ ] **Step 0:** `git grep -n "insertReservedNodeTx\|establishReservedStandbyIdentity" -- apps packages`
  and record which callers remain once finishing no longer inserts the row; write the Changed checks
  rows for `finish-adoption.test.ts`, `reserved-identity.test.ts` and `boot.adoption-allocation.test.ts`
  before the code.
- [ ] **Step 1: Write the failing tests.** "puts the copy in place before the store opens, keeping
  node.db, secrets.env and the certificates" (their bytes unchanged); "deletes the backup-room note
  before replacing venue.db"; "a crash after the rename finishes at the next start"; "joining
  finishes when the copy holds this box's row, and the next start is a mirror" (a boot test: the
  latch is gone, `holders.mode.current` is `mirror`, `/api/node` answers `acceptingSales: false`);
  "keeps the latch when the row's key is not this box's".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/spare-copy-placement.test.ts src/finish-adoption.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then `src/boot.mirror.test.ts src/boot.adoption-allocation.test.ts
  src/reserved-identity.test.ts src/allocated-standby-host.test.ts`; root
  `scripts/backup-room-note.test.ts scripts/spare-space.test.ts scripts/write-path-tables.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a spare puts its first copy in place and finishes joining"`.

### Task 5.5: A box that lost its `node.db` does not start as a selling box (A1274)

**Files:** Modify `boot.ts` (before the role holders are built: when `readNodeMode` finds no row for
this node id and the held chart lists this node in any standing but `serving-primary`, or lists it
with another box as `serving-primary`, throw `node.state_missing`), `boot-failure.ts` and the
recovery page's words (`apps/server/src/i18n/recovery-page.ts`, English and Spanish), `errors.ts`.
Test `boot.node-state-missing.test.ts` (new), `recovery-surface.test.ts`.

The words: title "This box has lost its record of which box it is"; action "It holds the venue's
data but not its own role, so it will not sell or file in case it is the spare. To use it again,
press Start again below and add it as a spare from the main box." (and Spanish). Start again keeps
its safe Stop (CLAUDE.md §3).

- [ ] **Step 1: Write the failing tests.** "a spare whose node.db is lost refuses to start with
  node.state_missing and files nothing" (a joined spare's folder with `node.db` deleted; the drain's
  stand-in is never called); control: "a first box with no mode row still starts as the sole
  primary" (the chart names it serving primary); the recovery page shows the title and action in
  both languages.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/boot.node-state-missing.test.ts src/recovery-surface.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Render the recovery page string to a file and open it in both themes and
  at phone width (CLAUDE.md §4: string-rendered pages have no harness).
- [ ] **Step 4: Run** them — PASS; then `src/node-db-copy.test.ts` (its "reads as a sole primary
  once its node.db is lost" case stays: it reads the reader, not the start) and
  `src/boot.failed-start.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a box that lost its own record does not start selling beside the main box"`.

### Task 5.6: Two boxes, end to end

**Files:** Create `apps/server/src/spare-join.e2e.test.ts` (first comment: a simulation in one
process on loopback, not qualification). Add it to the stream job (`ci.yml:1312-1323`,
`scripts/ci-workflow.test.mjs:62-74`) and to the server shards' excludes (`ci.yml:1177`).

- [ ] **Step 1: Write the test.** Two servers in two folders, the real pinned Litestream and
  versitygw, the fiscal module disabled; the boxes' own names resolved to `127.0.0.1` by an injected
  lookup and their stores on two ports. The main box sells two bills; the spare joins through
  `POST /setup-api/adopt` with a confirmed authority; the test waits for the spare's
  `spare.first_copy_ready`, its restart and its mirror start, then checks: the spare's `venue.db`
  holds both bills and its own `nodes` row; the main box's `nodes` table holds the spare's row; the
  main box's start check (restart it) asks the spare at `box-<spare>` and counts its verified answer
  (R13 end to end), with no `own_address`; no socket the two servers opened went to an address other
  than loopback (a `net.Socket.prototype.connect` spy in this process; Litestream's and versitygw's
  addresses are loopback by configuration). It records the copy's `bytes` and `ms` in the test's
  output as a number for the PR, not a bound.
- [ ] **Step 2: Run** `node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs`,
  then `pnpm --filter @waitron/server exec vitest run src/spare-join.e2e.test.ts` — PASS; then a
  control: comment out Task 5.2's row write and see the spare keep waiting and the test fail at its
  time limit for that reason; restore it. Then `scripts/ci-workflow.test.mjs`. Check the stream job
  still finishes in about 4 minutes on CI (CLAUDE.md §2); if not, split by the cause, never cut a check.
- [ ] **Step 3: Commit** `git commit -s -m "server: a spare joins over the venue's network and holds the venue's data, end to end"`.

### Task 5.7: Docs, the guide, and final checks

**Files:** `docs/operations/` (a runbook section "Adding a spare box": what each box must have, that
no internet is needed, that a venue with a bucket copy cannot add one until copy-up, the key-ring
rule of D7, and the measurement below); the guide in `apps/server/src/guide/en/` and `guide/es/` (a
section on adding a spare and the fingerprint comparison, with a shared `{#adding-a-spare}` heading
— A1283); `docs/developers/conventions-data.md` (one entry: the pair link and the store); the backlog
lines are the controller's at landing. Final checks: typecheck every touched package,
`pnpm format:check`, root `scripts/guide-links.test.ts`, `apps/server` `src/guide-content.test.ts`,
`scripts/errors-reachable.test.ts`, `scripts/claude-md-pointers.test.ts`. PR first line: "A spare
now receives the venue's data over the venue's network and finishes joining (venues that do not file
with Veri*Factu; 3b-F brings those)." `/finish-branch`, full path.

---

## PR 3b-F — a Veri*Factu venue can add a spare (FISCAL — the owner lands it)

Waits for Q1. Full review path, plus the fiscal suites unedited unless a row says otherwise.

**What has to happen, and why it is fiscal.** The spare's switch-on (A947 4b, A1018 Slice 7) reads
the spare's retained dormant tax-filing setup: for a promotion, `readHourRecoveryState` calls
`readRetainedHourDormant` (`packages/fiscal-verifactu/src/hour-recovery-state.ts:50-52`). That setup
is written only by the fiscal module's `establish` step, inside its host's preparation state
(`hour-dormant-standby.ts:146-166`), and that step needs a person's authority
(`readOperationAuthority`, `:178-180`), the spare's `nodes` row (`configuration(…, requireTarget:
true)`, `:209`), and a host offering `withPreparationState` (`:146`). After 3b-5 the one request
that carries a person's authority is the joining request on the main box, and the spare's row is
written later, by Task 5.2. Read, not run; the trace below runs it.

### Task F.0: Trace, and choose (a STOP gate)

- [ ] Run the fiscal module's `reserve` and `establish` for a standby in a scratch test on the main
  box's database (the pattern of `allocated-standby-host.test.ts:189-229`, with the hour-dormant
  input `{ kind: "hour-dormant", version: 1 }`), and record in this plan which of these works, with
  the output:
  - **(a, default)** the joining request runs `reserve` and `establish` with the person's authority,
    on the main box, writing the retained setup there (the copy carries it to the spare), with the
    spare's `nodes` row written in the same request — which moves D6's moment for a fiscal venue
    and needs Review Focus 1 re-run: an abandoned join then leaves a counted peer, removable from
    the Servers screen;
  - **(b)** `reserve` alone at joining writes the retained setup, keyed to the standby's id, and
    `establish` becomes a check Task 5.2 can run with no person (a fiscal module change);
  - **(c)** neither, and the setup is written at switch-on instead (moves the work to 4b).
  Record the choice and its test output here before Task F.1. A choice other than (a) or (b) is a
  STOP: it goes back to the owner.

### Task F.1: The failing end-to-end test

- [ ] `apps/server/src/spare-join.fiscal.e2e.test.ts`: the Task 5.6 test with the fiscal module
  enabled, then the spare's promotion through the existing hour-promotion harness
  (`hour-promotion.test.ts`'s fixture) reads a retained setup for the spare and takes a fresh
  installation name. Run it — FAIL today with `module.operation_invalid` at the joining route (D12).

### Task F.2: Implement the chosen option

- [ ] The files F.0 names; the setup app sends the fiscal module's operation input in the adopt
  request when the venue files with Veri*Factu; `assertAdoptionModules` is lifted on the main box
  for the hour-dormant path only; the setup app's words for `module.operation_invalid` on the adopt
  path go. Every fiscal suite runs unedited, or each changed check has a row marked FISCAL — owner
  rules. Run F.1 — PASS; then `pnpm --filter @waitron/fiscal-verifactu exec vitest run` and the
  golden and immutability suites.

### Task F.3: Final checks

- [ ] As Task 5.7's final checks, plus `git diff main -- packages/fiscal-verifactu` reviewed line by
  line in the PR body. PR first line: "FISCAL — a Veri*Factu venue can add a spare: its dormant
  tax-filing setup is written at joining."

---

## What CI and the simulation prove, and what needs the owner's two boxes

**Proved in CI** (the stream job runs Linux with both binaries): the store, the pipes, the pair's key
and the authority pin, end to end on loopback; the first full copy, the placement, finishing
joining, the main box's start check counting and verifying the spare; that the two servers in the
test opened no socket off loopback. This is a simulation: two servers on one machine, names resolved
by an injected lookup, one network interface.

**Not provable in CI, and why:** that two real boxes find each other by mDNS on a real switch (CI has
one host); how long the first full copy takes for a real venue's database on the box's hardware and
network; that nothing in joining reaches for the internet on a box whose cable is unplugged (the test
watches only its own process's sockets, not Litestream's or the operating system's).

**The owner's measurement** (after 3b-5; with 3b-F for a Veri*Factu venue). Not done by any
implementer. Two boxes on one switch, the internet unplugged from the switch, the main box holding the
venue's real data:

1. Add the spare from its own screen. Note the time on the main box when Connect is pressed.
2. Wait for the spare to restart by itself. On the spare, read its box status (`/api/box/status`) or
   its log line `spare.first_copy_ready`: it gives `bytes` and `ms`.
3. On the main box, Settings → Servers lists the spare; restart the main box and check it starts
   without waiting (its log line `handover.start_check` lists the spare as answered).
4. Read both boxes' clocks at the start and the end (§11's rehearsal note).

That line is the receipt the backlog has asked for since 2026-10-02
(`docs/backlog/replication-cloud.md:280-293`, "Adding a mirror while the internet is down").

---

## Questions for the owner

### Q1 — Adding a spare to a venue that files with Veri*Factu needs one tax-filing change. May 3b include it, as a pull request you land?

**A worked example.** Friday afternoon, before service. You plug the second box in, open "Add a spare
box to this venue" and sign in. Today the spare refuses before it changes anything: "this module
cannot be adopted" (`module.operation_invalid`, probe P6). That refusal exists because a spare's
switch-on later needs a small piece of tax-filing setup kept for it — which taxpayer, which
environment, which invoice series names it will base its own on — and that setup must be written
while a person who may approve it is signed in. After 3b-1 to 3b-5, a venue that does not file with
Veri*Factu can add a spare end to end; yours cannot until this change.

- **With the recommended default**, 3b ends with a sixth pull request, 3b-F, marked fiscal: when
  you add the spare, the main box writes that setup under your sign-in, and the spare receives it in
  its copy. You land 3b-F yourself, as every fiscal pull request. It changes no invoice, no chain
  and no filing; it changes which box writes the spare's dormant setup, and when.
- **The alternative** is to leave the setup to the switch-on slice (4b, already fiscal), which would
  then write it when the manager switches. 3b stays non-fiscal, but no Veri*Factu venue can add a
  spare until 4b lands, so A1018's Slices 5 and 7 stay unreachable on your real boxes until then.

**Recommended default: yes, as 3b-F**, built last so the five other pull requests never wait for
your landing.

---

## Probes

Each probe's scratch files are outside the worktree, under `/tmp/a947-3b-*`. "Read" claims are marked
where they are made above.

| # | Command | What it printed | Decides |
| --- | --- | --- | --- |
| P1 | `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/mirror-bundle-api.test.ts -t no_relay` | `Tests 1 passed \| 37 skipped` | fact 3 |
| P2 | (from `apps/server`, with its `tsx`) `tsx /tmp/a947-3b-probe.oe1e/cert-probe.mts`: an authority from `mintSelfSignedServerCert`, leaves from `reissueServerLeaf`, `node:tls` connects with `servername` | own name, box authority: `verified`; venue name, same leaf: `verified`; another authority: `refused: CERT_SIGNATURE_FAILURE`; leaf without the own name: `refused: ERR_TLS_CERT_ALTNAME_INVALID`; a name outside waitron.local: `refused: UNSPECIFIED` | fact 10, Task 2.2 |
| P3 | `pnpm --filter @waitron/server exec vitest run src/mirror-bind-guard.test.ts`; `git grep -n MIRROR_ALLOW_EXPOSED -- deploy` | `Tests 6 passed`; nothing | fact 6 |
| P4 | `tsx /tmp/a947-3b-probe.oe1e/r13.mts`: `endorsedKeyOf` over charts built with `buildNextMembershipDocument` | today's chart: `spare key known = false`; with the main box's endorsement: `matches = true`; endorsement signed by the wrong key: `known = false` | fact 8, Task 3.4 |
| P5 | `docker run --rm node:26-slim …`: `grep ^hosts /etc/nsswitch.conf`, `ls /lib/*/libnss_mdns*`, then a `multicast-dns` responder answering `equipo-7f3a.waitron.local` in the same container, `dns.lookup` and a `multicast-dns` query | `hosts: files dns`; no such file; `getaddrinfo (what fetch uses): EAI_AGAIN`; `mDNS query from Node: 127.0.0.1` | fact 7, Task 3.1 |
| P6 | `pnpm --filter @waitron/server exec vitest run src/adoption-allocation-refusal.test.ts`; `git log -S assertAdoptionModules --oneline -- apps/server/src/finish-adoption.ts` | `Tests 5 passed`; `59d51560f8 W41s-4 … (#1700)` | fact 1, Q1 |
| P7 | In `node:26-slim` (linux/aarch64), the pinned linux-arm64 Litestream 0.5.17 and versitygw 1.8.0 (their SHA-256 matched `deploy/Dockerfile:151` and `setup-s3-test-server.mjs:30`), versitygw serving TLS with a leaf from the box authority, `litestream replicate` for 12 s per case, then `litestream restore` (`/tmp/a947-3b-linux.ihXa/run.sh`, `run2.sh`) | `SSL_CERT_FILE` = the authority: 2–3 files in the store; no trust: 0 files; another authority: 0; wrong secret: 0, and `StatusCode: 403` logged; restore `exit 0`, `restored rows 2000`; no trust for 90 s: `files: 0` and no `x509` or `ERROR` line | facts 11, D5, Review Focus 3 |
| P8 | The same on macOS 26 with the darwin-arm64 binaries (sums matched `setup-litestream.mjs:21`, `setup-s3-test-server.mjs:34`), endpoint `https://127.0.0.1:17443` | the right authority in `SSL_CERT_FILE`: `files 0`; another: `files 0`; control over plain HTTP: `files 3` | fact 11, D5 |
| P9 | macOS: Litestream → plain HTTP on loopback → Node `tls.connect` pinned to an authority, `servername` `equipo-7f3a.waitron.local` → Node `tls.createServer` with the leaf → plain TCP to versitygw (`/tmp/a947-3b-mac.Wgln/pipes.mjs`, `run-pipes.sh`) | pinned to the right authority: `files 3`, restore `exit 0 rows 5000`; to another: `files 0; refused: CERT_SIGNATURE_FAILURE` | fact 12, D5, Tasks 4.4, 5.1 |
| P10 | `curl` of the darwin-arm64 and linux-arm64 versitygw 1.8.0 tarballs, `shasum -a 256`, `versitygw --help`, `diff LICENSE deploy/third-party/licenses/Apache-2.0.txt`, `cat NOTICE` | sums equal the pins; `--access … [$ROOT_ACCESS_KEY_ID, $ROOT_ACCESS_KEY]`, `--secret … [$ROOT_SECRET_ACCESS_KEY, …]`, `--cert`, `--key`; `0a1 >` (one blank line); `versitygw - Versity S3 Gateway` / `Copyright 2023 Versity Software`; the linux binary is 54489706 bytes | fact 13, Tasks 1.1–1.2, 4.4 |
| P11 | `curl` of `cmd/litestream/main.go` and `s3/replica_client.go` at tag `v0.5.17` from `raw.githubusercontent.com/benbjohnson/litestream`, then `grep` | `SkipVerify` at `main.go:1136`, `RootCAs … yaml:"root-cas"` inside the NATS settings at `:1175`; `replica_client.go:384-410` builds `http.Transport` and sets `TLSClientConfig` only `if c.SkipVerify` | fact 11 |
| P12 | `command -v go` | nothing | Task 1.2 |

**Claims that rest on reading only:** the till router's tie rule and lock-screen lines (fact 17); the
mirror's ambient viewer and who reaches it today (fact 6, D8); every boot line number; that a join by
name fails at the lookup today (inferred from P5); that macOS's Go ignores `SSL_CERT_FILE` (P8 shows
the result, not the reason); everything in PR 3b-F's "why it is fiscal" paragraph, which Task F.0 runs;
the placement rules Task 5.4 follows (the venue lock, the backup-room note, Litestream's folders).
